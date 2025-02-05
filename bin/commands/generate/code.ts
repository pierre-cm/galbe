import { $ } from 'bun'
import { devNull } from 'os'
import { Command, Option } from 'commander'
import { resolve, relative, extname } from 'path'
import { rm, exists } from 'fs/promises'

import { CWD, fmtList, fmtVal } from '../../util'
import { generateFromOapi } from './code/openapi.parser'

const srcTargets = ['ts', 'js']
const inputFormats = ['openapi:3.0:yaml', 'openapi:3.0:json']

export default (cmd: Command) => {
  cmd
    .description('generate \x1b[1;30m\x1b[36mGalbe\x1b[0m sources')
    .argument('<input>', 'input file')
    .addOption(
      new Option('-f, --format <format>', `input format ${fmtList(inputFormats)}`)
        .argParser(v => {
          if (inputFormats.includes(v)) return v
          console.log(`error: format must be one of ${fmtList(inputFormats)}`)
          process.exit(1)
        })
        .default(null, fmtVal('openapi:3.0:{yaml,json}'))
    )
    .addOption(
      new Option('-t, --target <target>', `source target ${fmtList(srcTargets)}`)
        .argParser(v => {
          if (srcTargets.includes(v)) return v
          console.log(`error: target must be one of ${fmtList(srcTargets)}`)
          process.exit(1)
        })
        .default('ts', fmtVal('ts'))
    )
    .addOption(new Option('-o, --out <dir>', 'output dir').default('src', fmtVal('src')))
    .addOption(new Option('-F, --force', 'force overriding output'))
    .action(async (input, props) => {
      let { format, target, out, force } = props

      let inputExt = extname(input)
      if (inputExt === '.yml') inputExt = '.yaml'
      if (!['.yaml', '.json'].includes(inputExt)) console.log('error: unknown input extension')

      if (!format) format = `openapi:3.0:${inputExt.slice(1)}`

      if (await exists(resolve(CWD, out))) {
        if(!force){
          console.log(
            `error: output directory ${fmtVal(
              out
            )} already exists. If you're sure you want to override its content, please remove it before or use the ${fmtVal(
              '-F --force'
            )} option`
          )
          process.exit(1)
        }
        await rm(resolve(CWD, out), { recursive: true })
      }

      Bun.write(Bun.stdout, '💻 \x1b[1;30mGenerating \x1b[36mGalbe\x1b[0m\x1b[1;30m sources\x1b[0m')
      try {
        let match = format.match(/^([^:]*):([^:]*):(.*)$/)
        if (!match) throw new Error(`error: invalid format ${format}`)
        let [_, kind, version, ext] = match
        if (kind === 'openapi') {
          await generateFromOapi(relative(CWD, input), resolve(CWD, out), { version, ext, target })
        } else throw new Error('error: unknown format')

        await $`bunx prettier --write "${resolve(CWD, out)}/**/*.{js,ts}" > ${devNull} && printf "\u200B"`
      } catch (err) {
        console.log(`error: ${err.message}`)
        process.exit(1)
      }
      Bun.write(Bun.stdout, ' : \x1b[1;30m\x1b[32mdone\x1b[0m\n')
    })
}
