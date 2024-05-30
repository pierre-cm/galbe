import { Command, Option } from 'commander'
import { resolve, extname } from 'path'
import { dump as ymlDump, load as ymlLoad } from 'js-yaml'
import { CWD, fmtList, instanciateRoutes, silentExec, softMerge } from '../../util'
import { Galbe } from '../../../src'
import { galbeToOpenapi } from './spec/openapi.serializer'

const specTargets = ['openapi:3.0:json', 'openapi:3.0:yaml']

export default (cmd: Command) => {
  cmd
    .description('generate API specification from a \x1b[1;30m\x1b[36mGalbe\x1b[0m instance')
    .argument('<index>', 'index file')
    .addOption(
      new Option('-t, --target <target>', `spec target ${fmtList(specTargets)}`)
        .argParser(v => {
          if (specTargets.includes(v)) return v
          console.log(`error: target must be one of ${fmtList(specTargets)}`)
          process.exit(1)
        })
        .default('openapi:3.0:yaml', 'openapi:3.0:yaml')
    )
    .addOption(new Option('-b, --base <file>', 'base file'))
    .addOption(
      new Option('-o, --out <file>', 'output file').default(undefined, fmtList(['spec/api.yaml', 'spec/api.json']))
    )
    .action(async (index, props) => {
      let { target, out, base } = props
      const [tName, _tVersion, tFormat] = target.split(':')
      if (!out) out = `spec/api.${tFormat}`

      let baseSpec = {}
      if (base) {
        let ext = extname(base)
        let rd = (str: string) =>
          ext === '.json' ? JSON.parse(str) : ['.yml', '.yaml'].includes(ext) ? ymlLoad(str) : null
        baseSpec = rd(await Bun.file(resolve(CWD, base)).text())
      }

      process.stdout.write(`📖 \x1b[1;30mGenerating ${target.split(':')?.[0]} spec\x1b[0m`)

      let error = null
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

      if (tName === 'openapi') {
        let openapiSpec = softMerge(galbeToOpenapi(g), baseSpec)
        Bun.write(resolve(CWD, out), tFormat === 'json' ? JSON.stringify(openapiSpec, null, 2) : ymlDump(openapiSpec))
      }

      process.stdout.write(' : \x1b[1;30m\x1b[32mdone\x1b[0m\n')
    })
}
