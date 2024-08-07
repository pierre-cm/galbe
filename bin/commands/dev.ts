import { $ } from 'bun'
import { Command, Option } from 'commander'
import { resolve } from 'path'

import { CWD, fmtInterval, fmtVal, instanciateRoutes, killPort, watchDir } from '../util'
import { Galbe } from '../../src'

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
    .addOption(new Option('-w, --watch', 'watch file changes').default(false, fmtVal(false)))
    .addOption(new Option('-nc, --noclear', "don't clear on file changes").default(false, fmtVal(false)))
    .addOption(
      new Option('-f, --force', 'kills any process running on defined port before strating the server').default(
        false,
        fmtVal(false)
      )
    )
    .action(async (index, props) => {
      const { port, watch, noclear, force } = props
      const clear = !noclear
      const indexPath = resolve(CWD, index)
      let g: Galbe

      if (!Bun.env.BUN_ENV) Bun.env.BUN_ENV = 'development'

      if (force) await killPort(port || 3000)

      if (watch) {
        await watchDir(
          CWD,
          async () => {
            g.stop()
            if (clear) await $`clear`
            Loader.registry.clear()
            g = (await import(indexPath)).default
            await instanciateRoutes(g)
            await g.listen(port)
          },
          { ignore: /node_modules/ }
        )
      }

      if (watch && clear) await $`clear`
      g = (await import(indexPath)).default
      await instanciateRoutes(g)
      await g.listen(port)
    })
}
