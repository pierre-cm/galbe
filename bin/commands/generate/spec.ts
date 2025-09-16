import { Command, Option } from 'commander'
import { resolve, relative, extname } from 'path'
import { CWD, fmtList, instanciateRoutes, silentExec } from '../../util'
import { Galbe } from '../../../src'
import { OpenAPISerializer } from '../../../src/extras'
import { softMerge } from '../../../src/util'
import { OpenAPIV3 } from 'openapi-types'

const specTargets = ['openapi:3.0:json', 'openapi:3.0:yaml']
const parsePckgAuthoRgx = /^\s*([^<(]*)(?:<([^>]+)>)?\s*(?:\(([^)]*)\))?\s*$/

const parseAuthor = (author: { name: string; url: string; email: string } | string) => {
  if (!author) return undefined
  if (typeof author === 'string') {
    let m = author.match(parsePckgAuthoRgx)
    if (!m) return undefined
    const [_, name, email, url] = m
    return { name: name?.trim(), email: email?.trim(), url: url?.trim() }
  }
  return author
}

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
          ext === '.json' ? JSON.parse(str) : ['.yml', '.yaml'].includes(ext) ? Bun.YAML.parse(str) : null
        baseSpec = rd(await Bun.file(relative(CWD, base)).text())
      }

      let pckg: any = {}
      try {
        pckg = await Bun.file(resolve(CWD, 'package.json')).json()
      } catch (e) {}

      Bun.write(Bun.stdout, `📖 \x1b[1;30mGenerating ${target.split(':')?.[0]} spec\x1b[0m`)

      let error = null
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

      if (tName === 'openapi') {
        let openapiSpec = await OpenAPISerializer(g)
        openapiSpec = {
          ...openapiSpec,
          info: {
            title: pckg?.name || 'Galbe app',
            description: pckg?.description,
            contact: parseAuthor(pckg.author),
            //license: TODO
            version: pckg?.version || '0.1.0',
          },
        }
        openapiSpec = softMerge(openapiSpec, baseSpec) as OpenAPIV3.Document
        Bun.write(
          resolve(CWD, out),
          tFormat === 'json' ? JSON.stringify(openapiSpec, null, 2) : Bun.YAML.stringify(openapiSpec, null, 2)
        )
      }

      Bun.write(Bun.stdout, ' : \x1b[1;30m\x1b[32mdone\x1b[0m\n')
    })
}
