import { $ } from 'bun'
import { devNull } from 'os'
import { Script, createContext } from 'vm'
import { Command, Option } from 'commander'
import { resolve, extname } from 'path'
import { rm } from 'fs/promises'
import { transformSync } from '@swc/core'
import { CWD, fmtList, instanciateRoutes, silentExec, abbreviateVar } from '../../util'
import { $T, Galbe, GalbeCLICommand, Method, Route, STResponse } from '../../../src'
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
      new Option('-t, --target <target>', `build target ${fmtList(clientTargets)}`).argParser(v => {
        if (clientTargets.includes(v)) return v
        console.log(`error: target must be one of ${fmtList(clientTargets)}`)
        process.exit(1)
      })
    )
    .action(async (index, props) => {
      let { target, out } = props
      if (!target) target = clientTargets.includes(extname(index)?.slice(1)) ? extname(index)?.slice(1) : 'ts'
      if (!out) out = { ts: 'dist/client.ts', js: 'dist/client.js', cli: 'dist/cli' }[target]
      let pckg: any = {}
      try {
        pckg = await Bun.file(resolve(CWD, 'package.json')).json()
      } catch (e) {}

      let error = null
      Bun.write(Bun.stdout, '💻 \x1b[1;30mBuilding \x1b[36mGalbe\x1b[0m\x1b[1;30m client\x1b[0m')
      let g: Galbe = await silentExec(async () => {
        try {
          const g = (await import(resolve(CWD, index))).default
          await instanciateRoutes(g)
          await g.init()
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
        options: [],
        head: [],
      }
      const types: Record<string, STResponse> = {}
      let commands: GalbeCLICommand[] = []
      const metaRoutes = g.meta?.reduce(
        (routes, c) => ({ ...routes, ...c.routes }),
        {} as Record<string, Record<string, Record<string, any>>>
      )

      walkRoutes(g.router.routes, r => {
        let meta = metaRoutes?.[r.path]?.[r.method]
        let [_, summary, description] = meta?.head?.match(/^([^\n]*)\n\n(.*)/) || []
        if (!summary) description = meta?.head
        let route = {
          ...r,
          ...(meta?.operationId ? { alias: meta?.operationId } : {}),
          ...(summary ? { summary } : {}),
          ...(description ? { description } : {}),
          pathT: r.path.replaceAll(/:([^\/]+)/g, '${$1}'),
          params:
            Object.fromEntries(
              [...r.path.matchAll(/:([^\/]+)/g)]?.map(m => [
                m?.[1],
                {
                  ...(r.schema?.params?.[m?.[1]]
                    ? {
                        type: schemaToTypeStr(r.schema.params[m[1]]),
                        ...(r.schema.params[m[1]]?.description
                          ? { description: r.schema.params[m[1]].description as string }
                          : {}),
                      }
                    : { type: 'string' }),
                },
              ])
            ) || {},
          contentTypes: Object.keys(r.schema.body || { default: '' })
            .map(s => `'${s}'`)
            .join('|'),
          schemas: {
            ...(r.schema.headers ? { headers: schemaToTypeStr($T.object(r.schema.headers)) } : {}),
            ...(r.schema.query ? { query: schemaToTypeStr($T.object(r.schema.query)) } : {}),
            ...(r.schema.body
              ? {
                  body: `{${Object.entries(r.schema.body)
                    .map(([ct, s]) => `${ct}: ${schemaToTypeStr(s)}`)
                    .join(';')}}`,
                }
              : {}),
            ...(r.schema.response
              ? {
                  response: Object.fromEntries(
                    Object.entries(r.schema.response).map(([k, v]) => [
                      k === 'default' ? '"default"' : k,
                      schemaToTypeStr(v as STSchema),
                    ])
                  ),
                }
              : {}),
          },
        }
        Object.values(r.schema.response || {})
          .filter(s => s?.id)
          .forEach(s => {
            //@ts-ignore
            types[s.id] = schemaToTypeStr(s)
          })
        routes[r.method.toLocaleLowerCase()].push(route)
        if (target === 'cli' && meta?.operationId)
          commands.push({
            name: meta.operationId,
            tags: meta?.tags ? (Array.isArray(meta.tags) ? meta.tags : [meta.tags]) : [],
            description: route.summary || route.description,
            route,
            arguments:
              Object.entries((route?.params || {}) as Record<string, { type: string; description?: string }>)?.map(
                ([k, p]) => {
                  return {
                    name: k,
                    type: p.type === 'boolean' ? '' : `<${p.type}>`,
                    description: p?.description || '',
                  }
                }
              ) || [],
            options:
              Object.entries((r.schema?.query || {}) as Record<string, STSchema>)?.map(([k, o]) => {
                let type = schemaToTypeStr({ ...o, [Optional]: false })
                return {
                  name: k,
                  short: abbreviateVar(k),
                  type: type === 'boolean' ? '' : `<${type}>`,
                  description: o?.description || '',
                  default: o.default,
                }
              }) || [],
          })
      })

      if (target === 'js' || target === 'ts') {
        const file = await Bun.file(resolve(import.meta.dir, '..', '..', 'res', 'client.template.ts')).text()
        let filled = file.replaceAll(/\/\*\%([\s\S]*?)\%\*\//g, (_match, p) => {
          let idt = p.match(/^\n*([ \t]*)/, p)?.[1] || ''
          const script = new Script(p)
          const sandbox = {
            console,
            version: pckg?.version || '0.1.0',
            routes,
            types,
          }
          createContext(sandbox)
          let res = script.runInNewContext(sandbox)
          if (typeof res === 'string') res = res.split('\n')
          if (Array.isArray(res)) return res.map((s, i) => (i === 0 ? s : `${idt}${s}`)).join('\n')
          return res ?? ''
        })

        if (target === 'js') {
          filled = transformSync(filled, {
            jsc: {
              parser: {
                syntax: 'typescript',
              },
              preserveAllComments: true,
              target: 'esnext',
            },
          }).code
        }

        await Bun.write(out, filled)
      } else if (target === 'cli') {
        const file = await Bun.file(resolve(import.meta.dir, '..', '..', 'res', 'cli.template.js')).text()

        // Plugin CLI hook
        if (commands) for (let p of g.plugins) if (p.cli) await p.cli(commands)

        const tags = commands.reduce(
          (p, c) => {
            if (c.tags.length)
              for (const t of c.tags) {
                if (!(t in p)) p[t] = []
                p[t].push(c)
              }
            else p[''].push(c)
            return p
          },
          { '': [] as GalbeCLICommand[] }
        )

        let filled = file.replaceAll(/\/\*\%([\s\S]*?)\%\*\//g, (_match, p) => {
          let idt = p.match(/^\n*([ \t]*)/, p)?.[1] || ''
          const script = new Script(p)
          const sandbox = {
            console,
            name: pckg?.name || 'Galbe app CLI',
            description: pckg?.description || '',
            version: pckg?.version || '0.1.0',
            tags,
          }
          createContext(sandbox)
          let res = script.runInNewContext(sandbox)
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

      Bun.write(Bun.stdout, ' : \x1b[1;30m\x1b[32mdone\x1b[0m\n')
      process.exit(0)
    })
}
