import { $ } from 'bun'
import { Command, Option } from 'commander'
import { resolve, dirname } from 'path'

import { CWD, fmtInterval, fmtVal, instanciateRoutes, killPort, watchDir } from '../util'
import { Galbe } from '../../src'
import { softMerge } from '../../src/util'
import { existsSync } from 'fs'

const defaultPort = 3000

export default (cmd: Command) => {
  cmd
    .description('start a dev server running your \x1b[1;30m\x1b[36mGalbe\x1b[0m application')
    .argument('<index>', 'index file')
    .addOption(
      new Option('-p, --port <number>', `port number ${fmtInterval(1, 65535)}`)
        .argParser(v => {
          if (parseInt(v) >= 1 && parseInt(v) <= 65535) return v
          console.log(`error: port range must be between ${fmtInterval(1, 65535)}`)
          process.exit(1)
        })
        .default(null, fmtVal(defaultPort))
    )
    .addOption(new Option('-w, --watch <dir>', 'watch file changes').default(false, fmtVal(false)))
    .addOption(new Option('-wi, --watchignore <regexp>', 'ignore file changes').default(false, fmtVal(false)))
    .addOption(new Option('-nc, --noclear', "don't clear on file changes").default(false, fmtVal(false)))
    .addOption(
      new Option('-f, --force', 'kills any process running on defined port before strating the server').default(
        false,
        fmtVal(false)
      )
    )
    .action(async (index, props) => {
      const { port, watch, watchignore, noclear, force } = props
      const indexPath = resolve(CWD, index)
      const indexDir = dirname(indexPath)
      let watch_dir = typeof watch === 'string' ? watch : indexDir
      const clear = !noclear
      let galbeConfig = {}
      let g: Galbe

      if (existsSync(`${indexDir}/galbe.config.ts`)) {
        galbeConfig = (await import(`${indexDir}/galbe.config.ts`)).default
      } else if (existsSync(`${indexDir}/galbe.config.js`)) {
        galbeConfig = (await import(`${indexDir}/galbe.config.js`)).default
      }

      if (!Bun.env.BUN_ENV) Bun.env.BUN_ENV = 'development'

      if (force) await killPort(port || 3000)

      if (!!watch) {
        await watchDir(
          watch_dir,
          async () => {
            g.stop()
            if (clear) await $`clear`
            Loader.registry.clear()
            g = (await import(indexPath)).default
            await instanciateRoutes(g)
            await g.listen(port)
          },
          { ignore: watchignore ? new RegExp(watchignore) : /node_modules/ }
        )
      }

      if (!!watch && clear) await $`clear`
      g = (await import(indexPath)).default
      let conf = g.config
      g.config = softMerge(galbeConfig, conf)
      await instanciateRoutes(g)
      await g.listen(port)
    })
}
