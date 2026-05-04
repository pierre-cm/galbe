import { Command, Option } from 'commander'
import { resolve } from 'path'
import { CWD, fmtList, instanciateRoutes, silentExec, abbreviateVar } from '../../../util'
import { $T, Galbe, type GalbeCLICommand, type GalbeCLIOptions } from '../../../../src'
import { walkRoutes } from '../../../../src/util'
import { schemaToTypeStr, Optional, type STSchema } from '../../../../src/schema'

const cliTargets = ['cac']
const cliModes = ['standalone', 'module']

export default (cmd: Command) => {
  cmd
    .description('generate a \x1b[1;30m\x1b[36mGalbe\x1b[0m CLI')
    .argument('<index>', 'index file (.ts or .js)')
    .addOption(new Option('-o, --out <file>', 'output file'))
    .addOption(
      new Option('-t, --target <target>', `CLI target ${fmtList(cliTargets)}`).default('cac').argParser(v => {
        if (cliTargets.includes(v)) return v
        console.log(`error: target must be one of ${fmtList(cliTargets)}`)
        process.exit(1)
      })
    )
    .addOption(
      new Option('-m, --mode <mode>', `output mode ${fmtList(cliModes)}`).default('standalone').argParser(v => {
        if (cliModes.includes(v)) return v
        console.log(`error: mode must be one of ${fmtList(cliModes)}`)
        process.exit(1)
      })
    )
    .addOption(new Option('-c, --config <file>', 'config file (.ts or .js)'))
    .action(async (index, props) => {
      let { target, mode, out, config } = props

      if (!out) out = mode === 'module' ? 'dist/cli.ts' : 'dist/cli'

      let pckg: any = {}
      try {
        pckg = await Bun.file(resolve(CWD, 'package.json')).json()
      } catch (e) {}

      let error = null
      Bun.write(Bun.stdout, '💻 \x1b[1;30mBuilding \x1b[36mGalbe\x1b[0m\x1b[1;30m CLI\x1b[0m')
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

      const metaRoutes = g.meta?.reduce(
        (routes, c) => ({ ...routes, ...c.routes }),
        {} as Record<string, Record<string, Record<string, any>>>
      )

      let commands: GalbeCLICommand[] = []

      walkRoutes(g.router.routes, r => {
        let meta = metaRoutes?.[r.path]?.[r.method]
        let [_, summary, description] = meta?.head?.match(/^([^\n]*)\n\n(.*)/) || []
        if (!summary) description = meta?.head

        const name =
          meta?.operationId ||
          `${r.method}-${r.path
            .replace(/\//g, '-')
            .replace(/:/g, '')
            .replace(/^-/, '')
            .replace(/-+/g, '-')
            .replace(/-$/, '')}`

        const pathT = r.path.replaceAll(/:([^\/]+)/g, '${$1}')

        const params = Object.fromEntries(
          [...r.path.matchAll(/:([^\/]+)/g)]?.map(m => [
            m?.[1],
            (r.schema?.params as Record<string, STSchema>)?.[m[1]]
              ? {
                  type: schemaToTypeStr((r.schema.params as Record<string, STSchema>)[m[1]]),
                  ...((r.schema.params as Record<string, STSchema>)[m[1]]?.description
                    ? { description: (r.schema.params as Record<string, STSchema>)[m[1]].description as string }
                    : {}),
                }
              : { type: 'string' },
          ])
        )

        commands.push({
          name,
          tags: meta?.tags ? (Array.isArray(meta.tags) ? meta.tags : [meta.tags]) : [],
          description: summary || description,
          route: r,
          pathT,
          arguments: Object.entries((params || {}) as Record<string, { type: string; description?: string }>).map(
            ([k, p]) => ({
              name: k,
              type: p.type === 'boolean' ? '' : `<${p.type}>`,
              description: p?.description || '',
            })
          ),
          options: Object.entries((r.schema?.query || {}) as Record<string, STSchema>).map(([k, o]) => {
            const type = schemaToTypeStr({ ...o, [Optional]: false })
            return {
              name: k,
              short: abbreviateVar(k),
              type: type === 'boolean' ? '' : `<${type}>`,
              description: (o?.description as string) || '',
              default: o.default,
            }
          }),
        })
      })

      // Plugin CLI hooks run first
      for (let p of g.plugins) {
        if (p.cli) {
          const result = await p.cli(commands)
          if (Array.isArray(result)) commands = result
        }
      }

      // Load user config
      let userTransform: ((commands: GalbeCLICommand[]) => GalbeCLICommand[]) | undefined
      let userOptions: GalbeCLIOptions | undefined
      if (config) {
        try {
          const configModule = await import(resolve(CWD, config))
          userTransform = configModule.transform
          userOptions = configModule.options
        } catch (err) {
          console.log(`\nerror: config file import failed`)
          console.log(err)
          return process.exit(1)
        }
      }

      // User transform runs last (user wins)
      if (userTransform) commands = userTransform(commands)

      if (target === 'cac') {
        const { generate } = await import('./targets/cac')
        await generate({
          commands,
          mode,
          out,
          pckg,
          options: userOptions,
          configPath: config ? resolve(CWD, config) : undefined,
        })
      }

      Bun.write(Bun.stdout, ' : \x1b[1;30m\x1b[32mdone\x1b[0m\n')
      process.exit(0)
    })
}
