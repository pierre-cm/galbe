import { describe, test, expect, afterEach } from 'bun:test'
import { mkdir, writeFile } from 'fs/promises'
import {
  cleanup,
  config,
  createApp,
  freePort,
  runCli,
  until,
  HELLO_ROUTE,
  INDEX,
  type App,
  type CliProc
} from './cli.utils'
import { WATCH_IGNORE, watchDir } from '../bin/util'

type DevServer = CliProc & { port: number }

const procs: CliProc[] = []
const dirs: string[] = []

const dev = async (files: App, args: string[] = []): Promise<{ dir: string; server: DevServer }> => {
  const dir = await createApp(files)
  dirs.push(dir)
  const port = await freePort()
  const proc = runCli(dir, ['dev', 'index.ts', '-p', String(port), '-nc', ...args])
  procs.push(proc)
  return { dir, server: { ...proc, port } }
}

const get = (dev: DevServer, path: string) => fetch(`http://localhost:${dev.port}${path}`)
const waitForBody = (dev: DevServer, path: string, expected?: string) =>
  until(dev, `${path} to respond${expected ? ` with '${expected}'` : ''}`, async () => {
    const body = await (await get(dev, path)).text()
    if (expected === undefined || body === expected) return body
    return undefined
  })

afterEach(() => cleanup(procs, dirs))

describe('galbe dev', () => {
  test(
    'boots and serves route files',
    async () => {
      const { server } = await dev({
        'index.ts': INDEX,
        'galbe.config.ts': config({ routes: 'src/**/*.route.ts' }),
        'src/hello.route.ts': HELLO_ROUTE
      })

      expect(await waitForBody(server, '/hello')).toBe('hello world')
      expect(server.output()).toContain('Constructing routes')
    },
    30_000
  )

  test(
    'route and middleware files shipped by dependencies are never picked up',
    async () => {
      // an app-wide pattern must stay app-wide: `node_modules` holds other
      // packages' files, including directory names no route could be prefixed by
      const { server } = await dev({
        'index.ts': INDEX,
        'galbe.config.ts': config({ routes: '**/*.route.ts', middleware: '**/*.middleware.ts' }),
        'hello.route.ts': HELLO_ROUTE,
        'node_modules/leaky/bad dir/x.route.ts': `export default (g: any) => {\n  g.get('/x', () => 'x')\n}\n`,
        'node_modules/leaky/routes/leak.route.ts': `export default (g: any) => {\n  g.get('/leak', () => 'leak')\n}\n`,
        'node_modules/leaky/leak.middleware.ts': `export default (ctx: any, next: any) => {\n  ctx.state.who = 'leak'\n  return next()\n}\n`
      })

      expect(await waitForBody(server, '/hello')).toBe('hello world')
      expect((await get(server, '/node_modules/leaky/routes/leak')).status).toBe(404)
      expect(server.output()).not.toContain('node_modules')
    },
    30_000
  )

  test(
    'middleware files apply to the routes they scope',
    async () => {
      const { server } = await dev({
        'index.ts': INDEX,
        'galbe.config.ts': config({ routes: 'src/**/*.route.ts', middleware: 'src/**/*.middleware.ts' }),
        'src/hello.route.ts': HELLO_ROUTE,
        'src/who.middleware.ts': `export default (ctx: any, next: any) => {\n  ctx.state.who = 'mw'\n  return next()\n}\n`
      })

      expect(await waitForBody(server, '/hello')).toBe('hello mw')
    },
    30_000
  )

  test(
    'watch mode reloads the app when a route file changes',
    async () => {
      const { dir, server } = await dev(
        {
          'index.ts': INDEX,
          'galbe.config.ts': config({ routes: 'src/**/*.route.ts' }),
          'src/hello.route.ts': HELLO_ROUTE
        },
        ['-w', '.']
      )

      expect(await waitForBody(server, '/hello')).toBe('hello world')

      await writeFile(
        `${dir}/src/hello.route.ts`,
        HELLO_ROUTE.replace("ctx.state.who ?? 'world'", "ctx.state.who ?? 'reloaded'")
      )
      expect(await waitForBody(server, '/hello', 'hello reloaded')).toBe('hello reloaded')

      // a broken edit kills the app but not the watcher: the next save recovers
      await writeFile(`${dir}/src/hello.route.ts`, `import type { Galbe } from 'galbe'\nthis is not valid(\n`)
      await writeFile(
        `${dir}/src/hello.route.ts`,
        HELLO_ROUTE.replace("ctx.state.who ?? 'world'", "ctx.state.who ?? 'recovered'")
      )
      expect(await waitForBody(server, '/hello', 'hello recovered')).toBe('hello recovered')
    },
    60_000
  )

  test(
    'an invalid directory name in the app tree fails boot with a clear error',
    async () => {
      const { server } = await dev({
        'index.ts': INDEX,
        'galbe.config.ts': config({ routes: 'src/**/*.route.ts' }),
        'src/bad dir/x.route.ts': `export default (g: any) => {\n  g.get('/x', () => 'x')\n}\n`
      })

      expect(await server.exited).not.toBe(0)
      expect(server.output()).toContain("invalid directory name 'bad dir'")
    },
    30_000
  )
})

describe('dev watcher', () => {
  test('WATCH_IGNORE covers the directories the analyzer skips', () => {
    for (const path of [
      'node_modules/foo/index.ts',
      'src/node_modules/foo/index.ts',
      'node_modules',
      '.git/index.lock',
      '.git',
      '.galbe/out.js',
      'src\\node_modules\\foo\\index.ts'
    ])
      expect(WATCH_IGNORE.test(path)).toBe(true)
    // only whole segments: a file merely named after one still reloads
    for (const path of ['src/hello.route.ts', 'src/node_modules.ts', 'src/my.git.ts', 'galbe.config.ts'])
      expect(WATCH_IGNORE.test(path)).toBe(false)
  })

  test(
    '--watchignore adds to the built-in ignores instead of replacing them',
    async () => {
      const dir = await createApp({})
      dirs.push(dir)
      await mkdir(`${dir}/node_modules/dep`, { recursive: true })
      const seen: string[] = []
      await watchDir(dir, ({ path }) => {
        if (path) seen.push(path)
      }, { ignore: /\.skip\.ts$/ })

      await writeFile(`${dir}/node_modules/dep/index.ts`, 'export default 1\n')
      await writeFile(`${dir}/ignored.skip.ts`, 'export default 2\n')
      await writeFile(`${dir}/watched.ts`, 'export default 3\n')

      const proc = { output: () => seen.join(', ') } as CliProc
      await until(proc, 'watched.ts change event', async () =>
        seen.some(p => p.includes('watched.ts')) || undefined
      )
      await Bun.sleep(300)
      expect(seen.filter(p => p.includes('node_modules') || p.includes('.skip.ts'))).toEqual([])
    },
    30_000
  )
})
