import { $ } from 'bun'
import { Command, Option } from 'commander'
import { resolve, dirname } from 'path'

import { CWD, fmtInterval, fmtVal, instanciateRoutes, resolveReloadStrategy, watchDir } from '../util'
import { Galbe } from '../../src'
import { softMerge } from '../../src/util'
import { existsSync } from 'fs'

const DEFAULT_PORT = 3000

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
        .default(null, fmtVal(DEFAULT_PORT))
    )
    .addOption(new Option('-w, --watch [dir]', 'watch file changes').default(false, fmtVal(false)))
    .addOption(new Option('-wi, --watchignore <regexp>', 'ignore file changes').default(false, fmtVal(false)))
    .addOption(new Option('-nc, --noclear', "don't clear on file changes").default(false, fmtVal(false)))
    .action(async (index, props) => {
      const { port, watch, watchignore, noclear } = props
      const indexPath = resolve(CWD, index)
      const indexDir = dirname(indexPath)
      let watch_dir = typeof watch === 'string' ? watch : watch ? indexDir : ''
      const clear = !noclear
      let galbeConfig = {}
      let g: Galbe

      if (existsSync(`${indexDir}/galbe.config.ts`)) {
        galbeConfig = (await import(`${indexDir}/galbe.config.ts`)).default
      } else if (existsSync(`${indexDir}/galbe.config.js`)) {
        galbeConfig = (await import(`${indexDir}/galbe.config.js`)).default
      }

      if (!Bun.env.BUN_ENV) Bun.env.BUN_ENV = 'development'

      if (!!watch_dir && resolveReloadStrategy() === 'respawn') {
        // Reload by respawning the app process: a syntax error in an edited file
        // kills the child, not the watcher — the next save reloads.
        const spawnApp = () =>
          Bun.spawn([process.execPath, process.argv[1], 'dev', index, '-p', `${port || DEFAULT_PORT}`], {
            stdio: ['inherit', 'inherit', 'inherit'],
            cwd: CWD,
          })
        const killChild = () => {
          try {
            child?.kill()
          } catch {}
        }
        process.on('SIGINT', () => {
          killChild()
          process.exit(0)
        })
        process.on('SIGTERM', () => {
          killChild()
          process.exit(0)
        })
        if (clear) await $`clear`.nothrow()
        let child = spawnApp()
        let reloading: Promise<void> = Promise.resolve()
        await watchDir(
          watch_dir,
          () => {
            reloading = reloading.then(async () => {
              killChild()
              await child.exited
              if (clear) await $`clear`.nothrow()
              child = spawnApp()
            })
          },
          { ignore: watchignore ? new RegExp(watchignore) : undefined }
        )
        // The watcher is non-persistent and a pending promise alone does not
        // keep the event loop alive — hold it open with an interval.
        setInterval(() => {}, 2 ** 31 - 1)
        return
      }

      if (!!watch_dir) {
        await watchDir(
          watch_dir,
          async () => {
            g.stop()
            if (clear) await $`clear`.nothrow()
            Loader.registry.clear()
            try {
              g = (await import(indexPath)).default
            } catch (e) {
              console.error('\x1b[0;31mReload failed:\x1b[0m', e)
              return
            }
            g.config = softMerge(galbeConfig, g.config)
            await instanciateRoutes(g)
            await g.listen(port)
          },
          { ignore: watchignore ? new RegExp(watchignore) : undefined }
        )
      }

      if (!!watch_dir && clear) await $`clear`.nothrow()
      g = (await import(indexPath)).default
      let conf = g.config
      g.config = softMerge(galbeConfig, conf)
      await instanciateRoutes(g)
      await g.listen(port)
    })
}
