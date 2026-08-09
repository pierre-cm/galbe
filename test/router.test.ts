import { expect, test, describe } from 'bun:test'
import { Galbe, MethodNotAllowedError, NotFoundError, type RouteNode } from '../src'

describe('router', () => {
  test('empty', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    expect(router.prefix).toBe('')
    expect(router.routes).toEqual({ routes: {} })
  })

  test('routes, bad syntax', async () => {
    const galbe = new Galbe()

    const invalidPaths = ['.', '/@', '/-ta', '/test/-ta', '/hell@/w0rld', '/last-', '../', './x', '/hello?']

    for (const p of invalidPaths) {
      try {
        galbe.get(p, () => { })
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(SyntaxError)
      }
    }
  })

  test('chaining routes', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    expect(router.routes).toEqual({ routes: {} })

    galbe.get('/', () => { })
    let r: RouteNode | undefined = router.routes

    expect(r?.routes.get?.method).toBe('get')
    expect(r?.routes.get?.path).toBe('/')
    expect(r?.param).toBeUndefined()
    expect(r?.children).toBeUndefined()

    const mockHandler = () => { }
    galbe.get('/test', mockHandler)
    r = r?.children?.test

    expect(r?.routes.get?.method).toBe('get')
    expect(r?.routes.get?.path).toBe('/test')
    expect(r?.param).toBeUndefined()
    expect(r?.children).toBeUndefined()
    expect(r?.routes.get?.handler).toBe(mockHandler)

    const mockHandler2 = () => { }
    galbe.get('/test/:foo', mockHandler2)
    r = r?.param

    expect(r?.routes.get?.method).toBe('get')
    expect(r?.routes.get?.path).toBe('/test/:foo')
    expect(r?.param).toBeUndefined()
    expect(r?.children).toBeUndefined()
    expect(r?.routes.get?.handler).toBe(mockHandler2)

    const mockHandler3 = () => { }
    galbe.get('/test/:foo/bar', mockHandler3)

    expect(r?.children).toHaveProperty('bar')
    expect(r?.param).toBeUndefined()
    expect(r?.children?.bar?.routes.get?.handler).toBe(mockHandler3)
  })

  test('redefining root', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    const [h1, h2, h3] = [() => { }, () => { }, () => { }]

    galbe.get('/', h1)
    galbe.get('/test', h2)
    galbe.get('/', h3)

    let r: RouteNode | undefined = router.routes
    expect(router.prefix).toBe('')
    expect(r?.routes.get?.method).toBe('get')
    expect(r?.routes.get?.path).toBe('/')
    expect(r?.routes.get?.handler).toBe(h3)
    expect(r?.children?.test?.routes.get?.method).toBe('get')
    expect(r?.children?.test?.routes.get?.handler).toBe(h2)

    const [h4, h5] = [() => { }, () => { }]

    galbe.get('/foo/bar', h4)
    galbe.get('/foo', h5)

    r = router?.routes?.children?.foo
    expect(r?.routes.get?.method).toBe('get')
    expect(r?.routes.get?.path).toBe('/foo')
    expect(r?.routes.get?.handler).toBe(h5)
    expect(r?.children?.bar?.routes.get?.method).toBe('get')
    expect(r?.children?.bar?.routes.get?.path).toBe('/foo/bar')
    expect(r?.children?.bar?.routes.get?.handler).toBe(h4)
  })

  test('find route', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    const [h1, h3, h4] = [() => { }, () => { }, () => { }, () => { }]

    galbe.get('/', h1)
    galbe.get('/test/foo', h3)
    galbe.get('/test/foo/bar', h4)

    let r1 = router.find('get', '/')
    expect(r1.path).toBe('/')
    expect(r1.handler).toBe(h1)
    let r2 = router.find('get', '/test/foo')
    expect(r2.path).toBe('/test/foo')
    expect(r2.handler).toBe(h3)
    let r3 = router.find('get', '/test/foo/bar')
    expect(r3.path).toBe('/test/foo/bar')
    expect(r3.handler).toBe(h4)

    try {
      router.find('get', '/test')
      expect.unreachable()
    } catch (err: any) {
      expect(err).toBeInstanceOf(NotFoundError)
      expect(err.status).toBe(404)
      expect(err.payload).toBe('Not Found')
    }

    try {
      router.find('get', '/test/bar/bar')
      expect.unreachable()
    } catch (err: any) {
      expect(err).toBeInstanceOf(NotFoundError)
      expect(err.status).toBe(404)
      expect(err.payload).toBe('Not Found')
    }
  })

  test('find route param', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    const [h1, h2] = [() => { }, () => { }]

    galbe.get('/test/:foo', h1)
    galbe.get('/test/test', h2)

    let r1 = router.find('get', '/test/42')
    expect(r1.path).toBe('/test/:foo')
    expect(r1.handler).toBe(h1)

    let r2 = router.find('get', '/test/test')
    expect(r2.path).toBe('/test/test')
    expect(r2.handler).toBe(h2)
  })

  test('wildcard routes', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    const [h1, h2, h3, h4] = [() => { }, () => { }, () => { }, () => { }]

    galbe.get('/test/foo/*', h1)
    galbe.get('/test/foo/bar', h2)
    galbe.get('/test/foo/:p/bar', h3)

    galbe.get('/test/foo/*/lol', h4)

    let r1 = router.find('get', '/test/foo/bar/42')
    expect(r1.path).toBe('/test/foo/*')
    expect(r1.handler).toBe(h1)

    let r3 = router.find('get', '/test/foo/bar/bar')
    expect(r3.path).toBe('/test/foo/:p/bar')
    expect(r3.handler).toBe(h3)

    let r4 = router.find('get', '/test/foo/foo')
    expect(r4.path).toBe('/test/foo/*')
    expect(r4.handler).toBe(h1)

    let r5 = router.find('get', '/test/foo/toto/lol')
    expect(r5.path).toBe('/test/foo/*/lol')
    expect(r5.handler).toBe(h4)
  })

  test('method not allowed', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    const [h1, h2] = [() => { }, () => { }]

    galbe.put('/test/foo', h1)
    galbe.post('/test/bar/*', h2)

    let r1 = router.find('put', '/test/foo')
    expect(r1.path).toBe('/test/foo')
    expect(r1.handler).toBe(h1)
    try {
      router.find('get', '/test/foo')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(MethodNotAllowedError)
    }

    let r2 = router.find('post', '/test/bar/tender')
    expect(r2.path).toBe('/test/bar/*')
    expect(r2.handler).toBe(h2)
    try {
      router.find('delete', '/test/bar/toto/titi')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(MethodNotAllowedError)
    }
  })

  test('trailing slash routes', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    const handler = () => { }
    galbe.get('/test/', handler)

    expect(router.routes.children?.test?.routes.get?.handler).toBe(handler)

    const r = router.find('get', '/test')
    expect(r.path).toBe('/test/')
    expect(r.handler).toBe(handler)
  })

  test('trailing slash requests match slash-less routes', async () => {
    // symmetric with the case above: a route declared without a trailing
    // slash must also match a request sent with one
    const galbe = new Galbe()
    const router = galbe.router

    const handler = () => { }
    galbe.get('/tail', handler)
    galbe.get('/user/:id', () => 'param')

    const r = router.find('get', '/tail/')
    expect(r.path).toBe('/tail')
    expect(r.handler).toBe(handler)

    expect(router.find('get', '/user/42/').path).toBe('/user/:id')

    // root is unaffected
    galbe.get('/', () => 'root')
    expect(router.find('get', '/').path).toBe('/')

    // still a 404 for unknown paths
    expect(() => router.find('get', '/unknown/')).toThrow(NotFoundError)
  })

  test('route cache is a bounded LRU', async () => {
    // a flood of distinct lookups — hits or misses — must not grow the cache
    // past cacheLimit (memory-exhaustion DoS otherwise)
    const galbe = new Galbe({ router: { cacheEnabled: true, cacheLimit: 8 } })
    const router = galbe.router

    galbe.get('/static', () => 's')
    galbe.get('/user/:id', () => 'u')

    for (let i = 0; i < 100; i++) {
      try {
        router.find('get', `/miss/${i}`)
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundError)
      }
    }
    expect((router as any).cachedRoutes.size).toBeLessThanOrEqual(8)

    for (let i = 0; i < 100; i++) router.find('get', `/user/${i}`)
    expect((router as any).cachedRoutes.size).toBeLessThanOrEqual(8)

    // routing still works after evictions
    expect(router.find('get', '/user/42').path).toBe('/user/:id')
    expect(router.find('get', '/static').path).toBe('/static')
    expect(() => router.find('get', '/nope')).toThrow(NotFoundError)
  })

  test('backtracking with multiple alternatives', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    galbe.get('/a/b', () => 'ab')
    galbe.get('/:p/c', () => 'pc')

    const route = router.find('get', '/a/c')
    expect(route).toBeDefined()
    expect(route.path).toBe('/:p/c')
  })

  test('backtracking with multiple levels of alternatives', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    galbe.get('/a/b', () => 'ab')
    galbe.get('/a/:p', () => 'ap')
    galbe.get('/:p/c', () => 'pc')

    const route = router.find('get', '/a/c')
    expect(route.path).toBe('/a/:p')

    const route2 = router.find('get', '/d/c')
    expect(route2.path).toBe('/:p/c')
  })

  test('wildcard route matches parent path with no remaining segment', async () => {
    // /a/* should match /a itself, not just /a/<something>.
    const galbe = new Galbe()
    const router = galbe.router

    const handler = () => 'wild'
    galbe.get('/a/*', handler)

    const r = router.find('get', '/a')
    expect(r.path).toBe('/a/*')
    expect(r.handler).toBe(handler)
  })

  test('static-route cache is hit on subsequent finds', async () => {
    // The cache key on add must align with the key used on find: lowercase
    // method, full path including basePath. Otherwise the pre-cache is dead.
    const galbe = new Galbe({ basePath: '/v1', router: { cacheEnabled: true } })
    const router = galbe.router

    galbe.get('/health', () => 'ok')

    expect((router as any).cachedRoutes.has('[get]/v1/health')).toBe(true)

    const r = router.find('get', '/v1/health')
    expect(r.path).toBe('/v1/health')
  })

  test('backtracking failure case', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    galbe.get('/a/*/d', () => 'wild')
    galbe.get('/:p/c/d', () => 'param')

    const route = router.find('get', '/a/c/d')
    expect(route.path).toBe('/a/*/d')

    const galbe2 = new Galbe()
    const router2 = galbe2.router
    galbe2.get('/a/b/c', () => '1')
    galbe2.get('/a/:p/d', () => '2')
    galbe2.get('/:p/b/e', () => '3')

    const route2 = router2.find('get', '/a/b/e')
    expect(route2.path).toBe('/:p/b/e')
  })

  // Segments named after Object.prototype members must route like any other
  // segment and never write onto globals (children maps are null-prototype).
  test('path segments named after Object.prototype members', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    galbe.get('/constructor/x', () => 'cx')
    galbe.get('/toString/:p', () => 'ts')
    galbe.get('/__proto__', () => 'proto')

    expect(router.find('get', '/constructor/x').path).toBe('/constructor/x')
    expect(router.find('get', '/toString/hello').path).toBe('/toString/:p')
    expect(router.find('get', '/__proto__').path).toBe('/__proto__')
    expect(() => router.find('get', '/constructor')).toThrow(NotFoundError)
    expect(() => router.find('get', '/valueOf')).toThrow(NotFoundError)
    expect(() => router.find('get', '/hasOwnProperty/x')).toThrow(NotFoundError)

    // walking the trie used to set .children/.routes on the global Object function
    expect((Object as any).children).toBeUndefined()
    expect((Object as any).routes).toBeUndefined()
    expect(Object.keys(Object.prototype)).toEqual([])
  })
})
