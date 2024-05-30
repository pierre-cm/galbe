import { $ } from 'bun'
import { devNull } from 'os'
import { Command, Option } from 'commander'
import { resolve } from 'path'
import { rm } from 'fs/promises'
import { transformSync } from '@swc/core'
import { CWD, fmtList, fmtVal, instanciateRoutes, pckg, silentExec } from '../../util'
import { $T, Galbe, Method, Route } from '../../../src'
import { walkRoutes } from '../../../src/util'
import { schemaToTypeStr, Optional, STSchema } from '../../../src/schema'

const clientTargets = ['ts', 'js', 'cli']

export default (cmd: Command) => {
  cmd
    .description('generate a \x1b[1;30m\x1b[36mGalbe\x1b[0m client')
    .argument('<index>', 'index file')
    .addOption(
      new Option('-o, --out <file>', 'output file').default(
        null,
        fmtList(['dist/client.ts', 'dist/client.js', 'dist/cli'])
      )
    )
    .addOption(
      new Option('-t, --target <target>', `build target ${fmtList(clientTargets)}`)
        .argParser(v => {
          if (clientTargets.includes(v)) return v
          console.log(`error: target must be one of ${fmtList(clientTargets)}`)
          process.exit(1)
        })
        .default('ts', fmtVal('ts'))
    )
    .action(async (index, props) => {
      let { target, out } = props
      if (!out) out = { ts: 'dist/client.ts', js: 'dist/client.js', cli: 'dist/cli' }[target]

      let error = null
      process.stdout.write('💻 \x1b[1;30mBuilding \x1b[36mGalbe\x1b[0m\x1b[1;30m client\x1b[0m')
      let g: Galbe = await silentExec(async () => {
        try {
          const g = (await import(resolve(CWD, index))).default
          await instanciateRoutes(g)
          return g
        } catch (err) {
          error = err
        }
      })
      if (error) {
        console.log(`\nerror: galbe instance import failed`)
        console.log(error)
        return process.exit(1)
      }

      const routes: Record<Method, Route[]> = {
        get: [],
        post: [],
        put: [],
        patch: [],
        delete: [],
        options: []
      }
      let commands: { name: string; route: any; description?: string; arguments?: any; options?: any }[] = []
      const metaRoutes = g.meta?.reduce(
        (routes, c) => ({ ...routes, ...c.routes }),
        {} as Record<string, Record<string, Record<string, any>>>
      )

      for (let [method, node] of Object.entries(g.router.routes)) {
        walkRoutes(node, r => {
          let meta = metaRoutes?.[r.path]?.[r.method]
          let route = {
            ...r,
            ...(meta?.operationId ? { alias: meta?.operationId } : {}),
            pathT: r.path.replaceAll(/:([^\/]+)/g, '${$1}'),
            params:
              Object.fromEntries(
                [...r.path.matchAll(/:([^\/]+)/g)]?.map(m => [
                  m?.[1],
                  {
                    ...(r.schema?.params?.[m?.[1]] ? { type: schemaToTypeStr(r.schema.params[m[1]]) } : {})
                  }
                ])
              ) || {},
            schemas: {
              ...(r.schema.headers ? { headers: schemaToTypeStr($T.object(r.schema.headers)) } : {}),
              ...(r.schema.query ? { query: schemaToTypeStr($T.object(r.schema.query)) } : {}),
              ...(r.schema.body ? { body: schemaToTypeStr(r.schema.body) } : {}),
              ...(r.schema.response
                ? {
                    response: Object.fromEntries(
                      Object.entries(r.schema.response).map(([k, v]) => [k, schemaToTypeStr(v)])
                    )
                  }
                : {})
            }
          }
          routes[method.toLocaleLowerCase()].push(route)
          if (target === 'cli' && meta?.operationId)
            commands.push({
              name: meta.operationId,
              description: meta.head,
              route,
              arguments:
                Object.entries((r.schema?.params || {}) as Record<string, STSchema>)?.map(([k, p]) => {
                  let type = schemaToTypeStr({ ...p, [Optional]: false })
                  return {
                    name: k,
                    type: type === 'boolean' ? '' : `<${type}>`,
                    description: p?.description || ''
                  }
                }) || [],
              options:
                Object.entries((r.schema?.query || {}) as Record<string, STSchema>)?.map(([k, o]) => {
                  let type = schemaToTypeStr({ ...o, [Optional]: false })
                  return {
                    name: k,
                    short: k[0],
                    type: type === 'boolean' ? '' : `<${type}>`,
                    description: o?.description || '',
                    default: typeof o?.default === 'string' ? `"${o.default}"` : o?.default ?? 'undefined'
                  }
                }) || []
            })
        })
      }

      if (target === 'js' || target === 'ts') {
        const file = await Bun.file(resolve(import.meta.dir, '..', '..', 'res', 'client.template.ts')).text()
        let filled = file.replaceAll(/\/\*\%([\s\S]*?)\%\*\//g, (_match, p) => {
          let idt = p.match(/^\n*([ \t]*)/, p)?.[1] || ''
          let func = new Function(p)
          let res = func.call({ version: pckg.version, routes })
          if (typeof res === 'string') res = res.split('\n')
          if (Array.isArray(res)) return res.map((s, i) => (i === 0 ? s : `${idt}${s}`)).join('\n')
          return res ?? ''
        })

        if (target === 'js') {
          filled = transformSync(filled, {
            jsc: {
              parser: {
                syntax: 'typescript'
              },
              preserveAllComments: true,
              target: 'esnext'
            }
          }).code
        }

        await Bun.write(out, filled)
      } else if (target === 'cli') {
        const file = await Bun.file(resolve(import.meta.dir, '..', '..', 'res', 'cli.template.js')).text()

        let filled = file.replaceAll(/\/\*\%([\s\S]*?)\%\*\//g, (_match, p) => {
          let idt = p.match(/^\n*([ \t]*)/, p)?.[1] || ''
          let func = new Function(p)
          let res = func.call({ name: pckg.name, description: pckg.description, version: pckg.version, commands })
          if (typeof res === 'string') res = res.split('\n')
          if (Array.isArray(res)) return res.map((s, i) => (i === 0 ? s : `${idt}${s}`)).join('\n')
          return res ?? ''
        })
        const buildId = crypto.randomUUID()
        const buildPath = resolve(CWD, '.galbe', 'client', `${buildId}.js`)
        await Bun.write(buildPath, filled)
        await $`bun build --compile ${buildPath} --outfile ${resolve(CWD, out)} > ${devNull} && printf "\u200B"`
        await rm(resolve(CWD, '.galbe'), { recursive: true })
      }

      process.stdout.write(' : \x1b[1;30m\x1b[32mdone\x1b[0m\n')
    })
}
