import { describe, expect, test } from 'bun:test'
import { Galbe } from '../src'
import { defineRoutes } from '../src/routes'
import { OpenAPISerializer } from '../src/extras/spec/openapi.serializer'

const TREE = 'test/resources/tree'
const ROUTES = `${TREE}/**/*.route.ts`
const MW = `${TREE}/**/*.middleware.ts`

// invoke a route's precomposed chain directly: middleware ordering is fully
// resolved at registration, no server needed
const runChain = async (g: Galbe, path: string): Promise<string[]> => {
  const order: string[] = []
  ;(globalThis as any).__mwOrder = order
  try {
    await g.router.find('get', path).composed({ set: {}, state: {}, params: {}, headers: {}, query: {} } as any)
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

    // one entry per registration: multi.middleware.ts registers at two scopes
    expect(middlewareFiles.map(m => m.scope)).toEqual([
      '*',
      '/api/*',
      '/api/*',
      '/api/users/*',
      '/api/users/*',
      '/api/users/*',
      '/api/admin/*',
    ])

    // entry-file registrations first, then files by depth/path, then in-file
    expect(await runChain(g, '/api/admin/stats')).toEqual(['entry', 'log', 'auth', 'audit1', 'audit2', 'infile'])
    expect(await runChain(g, '/api/users')).toEqual(['entry', 'log', 'auth', 'scoped', 'tenant', 'infile'])
    expect(await runChain(g, '/health')).toEqual(['entry', 'log'])
  })

  test('a def default export registers hooks, fragment and security', async () => {
    const g = new Galbe()
    await defineRoutes({ routes: ROUTES, middleware: `${TREE}/**/tenant.middleware.ts` }, g)

    expect(await runChain(g, '/api/users')).toEqual(['tenant', 'infile'])
    // the fragment lands on the scoped routes' schemas, nowhere else
    expect(Object.keys(g.router.find('get', '/api/users').schema.headers ?? {})).toEqual(['x-tenant-id'])
    expect(g.router.find('get', '/health').schema.headers).toBeUndefined()
    expect(g.middlewares[0]).toMatchObject({ pattern: '/api/users/*', security: 'apiKey' })
  })

  test("a discovered def's security reaches the spec, nearest scope winning", async () => {
    const g = new Galbe()
    await defineRoutes({ routes: ROUTES, middleware: MW }, g)
    const spec = await OpenAPISerializer(g)
    const op = (p: string) => (spec.paths![p] as any).get

    // the def at /api/users/* is nearer than auth.middleware.ts's @security at /api/*
    expect(op('/api/users').security).toEqual([{ apiKey: [] }])
    // the def defines the scheme it names, so it needs no config entry
    expect(spec.components?.securitySchemes?.apiKey).toEqual({ type: 'apiKey', in: 'header', name: 'x-tenant-id' })
    // and the scheme documents x-tenant-id, so the fragment's parameter is dropped
    // (shared parameters are promoted to components and referenced by $ref)
    const params = op('/api/users').parameters.map(
      (p: any) => p.name ?? (spec.components!.parameters as any)[p.$ref.split('/').pop()].name
    )
    expect(params).toContain('x-api')
    expect(params).not.toContain('x-tenant-id')
    // outside the def's scope, the middleware-file header still applies
    expect(op('/api/admin/stats').security).toEqual([{ bearerAuth: [] }])
    expect(op('/health').security).toBeUndefined()
  })

  test('a file exporting neither a def nor a registration function errors', async () => {
    const g = new Galbe()
    const errors: any[] = []
    const { middlewareFiles } = await defineRoutes(
      { routes: ROUTES, middleware: `${TREE}/invalid.middleware.ts` },
      g,
      ({ type, error }) => {
        if (type === 'error') errors.push(error)
      }
    )

    expect(middlewareFiles).toEqual([])
    expect(errors[0]?.message).toContain('must default-export')
  })

  test('a registration function registers every hook, in order', async () => {
    const g = new Galbe()
    await defineRoutes({ routes: ROUTES, middleware: `${TREE}/api/admin/*.middleware.ts` }, g)

    expect(await runChain(g, '/api/admin/stats')).toEqual(['audit1', 'audit2', 'infile'])
  })

  test('a registration function may register several scopes, each recorded on its own', async () => {
    const g = new Galbe()
    const { middlewareFiles } = await defineRoutes({ routes: ROUTES, middleware: `${TREE}/**/multi.middleware.ts` }, g)

    expect(middlewareFiles.map(m => m.scope)).toEqual(['/api/*', '/api/users/*'])
    expect(g.metaMiddleware.map(m => m.scope)).toEqual(['/api/*', '/api/users/*'])
    // and each fragment merges into the routes its own scope matches
    expect(Object.keys(g.router.find('get', '/api/users').schema.headers ?? {})).toEqual(['x-api'])
    expect(Object.keys(g.router.find('get', '/api/users').schema.query ?? {})).toEqual(['page'])
    expect(g.router.find('get', '/api/admin/stats').schema.query).toBeUndefined()
    expect(g.router.find('get', '/health').schema.headers).toBeUndefined()
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
