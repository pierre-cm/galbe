import { expect, test, describe, beforeAll, afterAll } from 'bun:test'
import { mkdir, rm, writeFile } from 'fs/promises'
import { defineRoutes, globBase, metaAnalysis } from '../src/routes'
import type { Route } from '../src'
import { Galbe } from '../src'
import type { RouteMeta } from '../src/routes'

const TREE = 'test/resources/tree'
// built at runtime: a committed fixture can't be named node_modules (gitignored)
const DEPS = 'test/resources/depstree'

describe('routeFiles', () => {
  test('meta analysis, empty', async () => {
    let meta = await metaAnalysis('./test/resources/test.route.empty.ts')
    expect(meta).toEqual({
      header: {},
      routes: {
        '/one': {
          get: {},
        },
        '/two': {
          post: {},
        },
        '/three': {
          put: {},
        },
      },
    })
  })

  test('meta analysis, comments', async () => {
    let meta = await metaAnalysis('./test/resources/test.route.comment.ts')
    expect(meta).toEqual({
      header: {
        head: 'description\nmultiline',
        tag: 'test',
      },
      routes: {
        '/test/:param1': {
          get: {
            head: 'This part\nhere',
            tags: 'tag1, tag2, tag3',
            summary: 'short summary',
            description: 'longer description example',
            deprecated: true,
            param: ['{path} param1 description', '{query} param2 description'],
          },
        },
        '/test': {
          post: {
            tags: 'tag1, tag2, tag3',
            summary: 'short summary',
            description: 'longer description example',
            body: 'body descripton',
          },
          put: {
            tags: 'tag1, tag2',
            other: 'Hello Mom!',
          },
          patch: {
            head: 'patch method',
          },
          options: {
            head: 'options method',
          },
          delete: {
            head: 'delete method',
          },
          head: {
            head: 'head method',
          },
        },
      },
    })
  })

  test('glob static base anchoring', () => {
    expect(globBase('src/**/*.route.{js,ts}')).toBe('src')
    expect(globBase('src/api/*.route.ts')).toBe('src/api')
    expect(globBase('src/foo.route.ts')).toBe('src')
  })

  test('define routes, no route', async () => {
    const g = new Galbe()
    await defineRoutes({}, g)
    expect(g.router.routes).toEqual({
      routes: {},
    })
  })

  test('define routes, no route (false)', async () => {
    const g = new Galbe({ routes: false })
    await defineRoutes({ routes: false }, g)
    expect(g.router.routes).toEqual({
      routes: {},
    })
  })

  test('define routes, no route found', async () => {
    const g = new Galbe()
    await defineRoutes({ routes: 'unexisting_route' }, g)
    expect(g.router.routes).toEqual({
      routes: {},
    })
  })

  test('define routes, route.empty', async () => {
    const g = new Galbe()

    await defineRoutes({ routes: 'test/resources/test.route.empty.ts' }, g)

    const r = g.router.routes
    expect(r?.children?.one?.routes.get).toMatchObject({
      method: 'get',
      path: '/one',
      handler: () => {},
    })
    expect(r?.children?.two?.routes.post).toMatchObject({
      method: 'post',
      path: '/two',
      handler: () => {},
    })
    expect(r?.children?.three?.routes.put).toMatchObject({
      method: 'put',
      path: '/three',
      handler: () => {},
    })
    expect(g.meta).toMatchObject([
      {
        header: {},
        routes: {
          '/one': {
            get: {},
          },
          '/two': {
            post: {},
          },
          '/three': {
            put: {},
          },
        },
      },
    ])
    expect(g.meta?.[0].file).toMatch(/test\.route\.empty\.ts$/)
  })

  test('define routes, all', async () => {
    const g = new Galbe()

    await defineRoutes({ routes: ['test/resources/test.route.*.ts'] }, g)

    const r = g.router.routes
    expect(r?.children?.one?.routes.get).toMatchObject({
      method: 'get',
      path: '/one',
      handler: () => {},
    })
    expect(r?.children?.two?.routes.post).toMatchObject({
      method: 'post',
      path: '/two',
      handler: () => {},
    })
    expect(r?.children?.three?.routes.put).toMatchObject({
      method: 'put',
      path: '/three',
      handler: () => {},
    })
    expect(r?.children?.test?.param?.routes.get).toMatchObject({
      method: 'get',
      path: '/test/:param1',
      handler: () => {},
    })
    for (const method of ['post', 'put', 'patch', 'options', 'delete', 'head'] as const) {
      expect(r?.children?.test?.routes[method]).toMatchObject({
        method,
        path: '/test',
        handler: () => {},
      })
    }
    expect(g.meta?.sort((a, b) => (a.file < b.file ? 1 : -1))).toMatchObject([
      {
        header: {},
        routes: {
          '/one': {
            get: {},
          },
          '/two': {
            post: {},
          },
          '/three': {
            put: {},
          },
        },
      },
      {
        header: {
          head: 'description\nmultiline',
          tag: 'test',
        },
        routes: {
          '/test/:param1': {
            get: {
              head: 'This part\nhere',
              tags: 'tag1, tag2, tag3',
              summary: 'short summary',
              description: 'longer description example',
              deprecated: true,
              param: ['{path} param1 description', '{query} param2 description'],
            },
          },
          '/test': {
            post: {
              tags: 'tag1, tag2, tag3',
              summary: 'short summary',
              description: 'longer description example',
              body: 'body descripton',
            },
            put: {
              tags: 'tag1, tag2',
              other: 'Hello Mom!',
            },
          },
        },
      },
    ])
    expect(g.meta?.[0].file).toMatch(/test\.route\..*$/)
    expect(g.meta?.[1].file).toMatch(/test\.route\..*$/)
  })

  test('static records (path, target) on galbe.staticTargets', async () => {
    // The build step needs the user-supplied static (path, target) pairs to
    // copy assets next to the bundle.
    const g = new Galbe()
    g.static('/static', './test/resources/static')
    g.static('/img', './test/resources/image.png')
    expect(g.staticTargets).toEqual([
      { path: '/static', target: './test/resources/static' },
      { path: '/img', target: './test/resources/image.png' },
    ])
  })

  test('onRouteAdded fires with the registered route and unsubscribes', () => {
    const g = new Galbe()
    const added: Route[] = []
    const unsub = g.onRouteAdded(({ route }) => added.push(route))
    g.get('/a', () => 'a')
    unsub()
    g.get('/b', () => 'b')
    expect(added.map(r => r.path)).toEqual(['/a'])
  })
})

describe('routeFiles, directory groups', () => {
  test('dirPrefix is on by default, anchored on the glob static base', async () => {
    const g = new Galbe()
    await defineRoutes({ routes: `${TREE}/**/*.route.ts` }, g)

    expect(g.router.find('get', '/health').path).toBe('/health')
    expect(g.router.find('get', '/api/users').path).toBe('/api/users')
    expect(g.router.find('get', '/api/users/7').path).toBe('/api/users/:id')
    expect(g.router.find('get', '/api/admin/stats').path).toBe('/api/admin/stats')
  })

  test('dirPrefix: false opts out', async () => {
    const g = new Galbe()
    await defineRoutes({ routes: { pattern: `${TREE}/api/admin/*.route.ts`, dirPrefix: false } }, g)

    expect(g.router.find('get', '/stats').path).toBe('/stats')
    expect(() => g.router.find('get', '/api/admin/stats')).toThrow()
  })

  test('array patterns anchor their own base', async () => {
    const g = new Galbe()
    await defineRoutes({ routes: [`${TREE}/api/admin/**/*.route.ts`, `${TREE}/health.route.ts`] }, g)

    // admin pattern base is .../api/admin: stats.route.ts sits at the base
    expect(g.router.find('get', '/stats').path).toBe('/stats')
    // exact file pattern: the file's own directory is the base
    expect(g.router.find('get', '/health').path).toBe('/health')
  })

  test('@prefix overrides the dir-derived prefix; @prefix / opts a file out', async () => {
    const g = new Galbe()
    await defineRoutes({ routes: `${TREE}/v2/*.route.ts` }, g)

    expect(g.router.find('get', '/legacy/old').path).toBe('/legacy/old')
    expect(g.router.find('get', '/root').path).toBe('/root')
    expect(() => g.router.find('get', '/v2/old')).toThrow()
  })

  test('meta keys are rewritten to the final relative path', async () => {
    const g = new Galbe()
    await defineRoutes({ routes: `${TREE}/**/*.route.ts` }, g)

    const usersMeta = g.meta?.find(m => m.file.endsWith('users.route.ts'))
    expect(usersMeta?.routes['/api/users']?.get).toMatchObject({ head: 'List users', tags: 'users' })
    expect(usersMeta?.routes['/api/users/:id']?.get).toBeDefined()
    const legacyMeta = g.meta?.find(m => m.file.endsWith('legacy.route.ts'))
    expect(legacyMeta?.routes['/legacy/old']?.get).toBeDefined()
  })

  test('@galbe-ignore vetoes registration, @galbe-hide keeps serving', async () => {
    const g = new Galbe()
    const events: { route: Route; meta?: RouteMeta }[] = []
    await defineRoutes({ routes: `${TREE}/api/*.route.ts` }, g, (({ type, route, meta }: any) => {
      if (type === 'add') events.push({ route, meta })
    }) as any)

    // ignored: not served, not reported
    expect(() => g.router.find('get', '/secret')).toThrow()
    expect(events.find(e => e.route.path === '/secret')).toBeUndefined()
    // hidden: served, reported with hide meta
    expect(g.router.find('get', '/internal').path).toBe('/internal')
    expect(events.find(e => e.route.path === '/internal')?.meta?.hide).toBe(true)
  })

  test('prefixed @galbe-ignore veto and basePath interplay', async () => {
    const g = new Galbe({ basePath: '/base' })
    await defineRoutes({ routes: `${TREE}/**/*.route.ts` }, g)

    expect(g.router.find('get', '/base/api/users').path).toBe('/base/api/users')
    expect(() => g.router.find('get', '/base/api/secret')).toThrow()
    // meta keys stay relative to basePath
    const usersMeta = g.meta?.find(m => m.file.endsWith('users.route.ts'))
    expect(usersMeta?.routes['/api/users']?.get).toBeDefined()
  })

  test('static registration inside a prefixed file', async () => {
    const g = new Galbe()
    await defineRoutes({ routes: `${TREE}/api/assets.route.ts` }, g)

    // exact-file pattern: no prefix from dir, but pass the tree glob instead
    expect(g.router.find('get', '/assets').static?.root).toBe('/assets')

    const g2 = new Galbe()
    await defineRoutes({ routes: `${TREE}/**/*.route.ts` }, g2)
    expect(g2.router.find('get', '/api/assets').static?.root).toBe('/api/assets')
    expect(g2.router.find('get', '/api/assets/chameleon.png').path).toBe('/api/assets/chameleon.png')
    expect(g2.staticTargets).toContainEqual({ path: '/api/assets', target: 'test/resources/static' })
  })

  test('invalid directory segment fails boot', async () => {
    const g = new Galbe()
    expect(defineRoutes({ routes: 'test/resources/badtree/**/*.route.ts' }, g)).rejects.toThrow(
      /invalid directory name/
    )
  })
})

describe('routeFiles, dependency directories', () => {
  // a dependency tree the app never wrote: `bad dir` is a directory name no
  // route file could ever be prefixed by, and the .route/.middleware files are
  // another package's, not the app's
  beforeAll(async () => {
    await mkdir(`${DEPS}/node_modules/leaky/bad dir`, { recursive: true })
    await mkdir(`${DEPS}/node_modules/leaky/routes`, { recursive: true })
    await mkdir(`${DEPS}/.git/hooks`, { recursive: true })
    await writeFile(`${DEPS}/app.route.ts`, `export default (g: any) => {\n  g.get('/app', () => 'app')\n}\n`)
    await writeFile(
      `${DEPS}/app.middleware.ts`,
      `import { middleware } from '../../../src'\nexport default middleware({ hooks: (_ctx: any, next: any) => next() })\n`
    )
    await writeFile(
      `${DEPS}/node_modules/leaky/bad dir/x.route.ts`,
      `export default (g: any) => {\n  g.get('/x', () => 'x')\n}\n`
    )
    await writeFile(
      `${DEPS}/node_modules/leaky/routes/leak.route.ts`,
      `export default (g: any) => {\n  g.get('/leak', () => 'leak')\n}\n`
    )
    await writeFile(
      `${DEPS}/node_modules/leaky/leak.middleware.ts`,
      `import { middleware } from '../../../../../src'\nexport default middleware({ hooks: (_ctx: any, next: any) => next() })\n`
    )
    await writeFile(
      `${DEPS}/.git/hooks/hook.route.ts`,
      `export default (g: any) => {\n  g.get('/hook', () => 'hook')\n}\n`
    )
  })
  afterAll(async () => {
    await rm(DEPS, { recursive: true, force: true })
  })

  test('node_modules and .git are skipped, app files still found', async () => {
    const g = new Galbe()
    await defineRoutes({ routes: `${DEPS}/**/*.route.ts`, middleware: `${DEPS}/**/*.middleware.ts` }, g)

    expect(g.router.find('get', '/app').path).toBe('/app')
    expect(() => g.router.find('get', '/node_modules/leaky/routes/leak')).toThrow()
    expect(() => g.router.find('get', '/.git/hooks/hook')).toThrow()
    expect(g.metaMiddleware.map(m => m.file.split('/').at(-1))).toEqual(['app.middleware.ts'])
  })

  test('a pattern naming node_modules opts back in', async () => {
    const g = new Galbe()
    await defineRoutes({ routes: `${DEPS}/node_modules/leaky/routes/*.route.ts` }, g)

    expect(g.router.find('get', '/leak').path).toBe('/leak')
  })
})
