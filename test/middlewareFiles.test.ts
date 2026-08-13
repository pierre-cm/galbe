import { describe, expect, test } from 'bun:test'
import { Galbe } from '../src'
import { defineRoutes } from '../src/routes'

const TREE = 'test/resources/tree'
const ROUTES = `${TREE}/**/*.route.ts`
const MW = `${TREE}/**/*.middleware.ts`

// invoke a route's precomposed chain directly: middleware ordering is fully
// resolved at registration, no server needed
const runChain = async (g: Galbe, path: string): Promise<string[]> => {
  const order: string[] = []
  ;(globalThis as any).__mwOrder = order
  try {
    await g.router.find('get', path).composed({ set: {}, state: {}, params: {} } as any)
  } finally {
    delete (globalThis as any).__mwOrder
  }
  return order
}

describe('middleware files', () => {
  test('discovery, directory scoping and deterministic ordering', async () => {
    const g = new Galbe()
    g.middleware(() => {
      ;(globalThis as any).__mwOrder?.push('entry')
    })
    const { middlewareFiles } = await defineRoutes({ routes: ROUTES, middleware: MW }, g)

    expect(middlewareFiles.map(m => m.scope)).toEqual(['*', '/api/*', '/api/users/*', '/api/admin/*'])

    // entry-file registrations first, then files by depth/path, then in-file
    expect(await runChain(g, '/api/admin/stats')).toEqual(['entry', 'log', 'auth', 'audit1', 'audit2', 'infile'])
    expect(await runChain(g, '/api/users')).toEqual(['entry', 'log', 'auth', 'scoped', 'infile'])
    expect(await runChain(g, '/health')).toEqual(['entry', 'log'])
  })

  test('array export registers every hook, in order', async () => {
    const g = new Galbe()
    await defineRoutes({ routes: ROUTES, middleware: `${TREE}/api/admin/*.middleware.ts` }, g)

    expect(await runChain(g, '/api/admin/stats')).toEqual(['audit1', 'audit2', 'infile'])
  })

  test('scope export narrows relative to the file directory scope', async () => {
    const g = new Galbe()
    await defineRoutes({ routes: ROUTES, middleware: `${TREE}/**/scoped.middleware.ts` }, g)

    expect(await runChain(g, '/api/users')).toEqual(['scoped', 'infile'])
    expect(await runChain(g, '/api/admin/stats')).toEqual(['infile'])
  })

  test('@galbe-ignore skips the middleware file', async () => {
    const g = new Galbe()
    const { middlewareFiles } = await defineRoutes({ routes: ROUTES, middleware: `${TREE}/*.middleware.ts` }, g)

    expect(middlewareFiles.map(m => m.file).some(f => f.endsWith('ignored.middleware.ts'))).toBe(false)
    expect(await runChain(g, '/health')).toEqual(['log'])
  })

  test('middleware: false disables discovery only', async () => {
    const g = new Galbe()
    await defineRoutes({ routes: ROUTES, middleware: false }, g)

    expect(g.metaMiddleware).toEqual([])
    expect(await runChain(g, '/api/users')).toEqual(['infile'])
  })

  test('routes: false disables the whole analyzer, middleware files included', async () => {
    const g = new Galbe()
    const { routeFiles, middlewareFiles } = await defineRoutes({ routes: false, middleware: MW }, g)

    expect(routeFiles).toEqual([])
    expect(middlewareFiles).toEqual([])
    expect(g.middlewares).toEqual([])
    expect(g.router.routes).toEqual({ routes: {} })
  })

  test('header metadata is captured on galbe.metaMiddleware', async () => {
    const g = new Galbe()
    await defineRoutes({ routes: ROUTES, middleware: MW }, g)

    const auth = g.metaMiddleware.find(m => m.file.endsWith('auth.middleware.ts'))
    expect(auth).toMatchObject({ scope: '/api/*', header: { security: 'bearerAuth', tags: 'api' } })
  })
})
