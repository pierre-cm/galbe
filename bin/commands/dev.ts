import { $ } from 'bun'
import { Command, Option } from 'commander'
import { resolve } from 'path'
import { mkdir } from 'fs/promises'

import { CWD, fmtInterval, fmtVal, instanciateRoutes, watchDir } from '../util'
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
    .action(async (index, props) => {
      const { port, watch } = props
      const indexPath = resolve(CWD, index)
      const devPath = resolve(CWD, '.galbe', 'dev')
      let g: Galbe
      let v = 0

      Bun.env.BUN_ENV = 'development'

      await mkdir(devPath, { recursive: true })

      if (watch) {
        await watchDir(
          CWD,
          async ({ path }) => {
            g.stop()
            v++
            await $`clear`
            Loader.registry.delete(path)
            Loader.registry.delete(indexPath)
            g = (await import(indexPath)).default
            await instanciateRoutes(g)
            await g.listen(port)
          },
          { ignore: /node_modules/ }
        )
      }

      if (watch) await $`clear`
      g = (await import(indexPath)).default
      await instanciateRoutes(g)
      await g.listen(port)
    })
}
