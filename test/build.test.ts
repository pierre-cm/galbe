import { describe, test, expect, afterEach } from 'bun:test'
import { cleanup, config, createApp, freePort, runCli, until, HELLO_ROUTE, INDEX, type CliProc } from './cli.utils'

const procs: CliProc[] = []
const dirs: string[] = []

afterEach(() => cleanup(procs, dirs))

describe('galbe build', () => {
  test(
    'bundles an app that boots and serves its route files',
    async () => {
      const port = await freePort()
      const dir = await createApp({
        'index.ts': INDEX,
        'galbe.config.ts': config({ routes: '**/*.route.ts', port }),
        'hello.route.ts': HELLO_ROUTE,
        // a dependency's route files must not end up in the bundle either
        'node_modules/leaky/bad dir/x.route.ts': `export default (g: any) => {\n  g.get('/x', () => 'x')\n}\n`
      })
      dirs.push(dir)

      const build = runCli(dir, ['build', 'index.ts'])
      procs.push(build)
      expect(await build.exited).toBe(0)
      expect(build.output()).toContain('done')

      const proc = Bun.spawn([process.execPath, `${dir}/dist/app/index.js`], {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe'
      })
      const running: CliProc = {
        output: () => 'built app produced no output',
        exited: proc.exited,
        stop: async () => {
          proc.kill()
          await proc.exited
        }
      }
      procs.push(running)

      const body = await until(running, 'the built app to serve /hello', async () =>
        (await fetch(`http://localhost:${port}/hello`)).text()
      )
      expect(body).toBe('hello world')
    },
    60_000
  )

  test(
    'a boot error is reported as itself, not swallowed by the error handler',
    async () => {
      const dir = await createApp({
        'index.ts': INDEX,
        'galbe.config.ts': config({ routes: 'src/**/*.route.ts' }),
        'src/bad dir/x.route.ts': `export default (g: any) => {\n  g.get('/x', () => 'x')\n}\n`
      })
      dirs.push(dir)

      const build = runCli(dir, ['build', 'index.ts'])
      procs.push(build)

      expect(await build.exited).not.toBe(0)
      expect(build.output()).toContain("invalid directory name 'bad dir'")
      expect(build.output()).not.toContain('is not iterable')
    },
    60_000
  )
})
