import { expect, test, describe } from 'bun:test'
import { Galbe, NotFoundError, type RouteNode } from '../src'

describe('router', () => {
  test('empty', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    expect(router.prefix).toBe('')
    expect(router.routes.GET).toEqual({})
    expect(router.routes.POST).toEqual({})
    expect(router.routes.PUT).toEqual({})
    expect(router.routes.PATCH).toEqual({})
    expect(router.routes.DELETE).toEqual({})
    expect(router.routes.OPTIONS).toEqual({})
  })

  test('routes, bad syntax', async () => {
    const galbe = new Galbe()

    const invalidPaths = [
      '.',
      '/@',
      '/-ta',
      '/test/-ta',
      '/test/my.path',
      '/hell@/w0rld',
      '/last-',
      '../',
      './x',
      '/hello?'
    ]

    for (const p of invalidPaths) {
      try {
        galbe.get(p, () => {})
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(SyntaxError)
      }
    }
  })

  test('chaining routes', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    expect(router.routes.GET).toEqual({})

    galbe.get('/', () => {})
    let r: RouteNode | undefined = router.routes.GET

    expect(r?.route?.method).toBe('get')
    expect(r?.route?.path).toBe('/')
    expect(r?.param).toBeUndefined()
    expect(r?.children).toBeUndefined()

    const mockHandler = () => {}
    galbe.get('/test', mockHandler)
    r = r?.children?.test

    expect(r?.route?.method).toBe('get')
    expect(r?.route?.path).toBe('/test')
    expect(r?.param).toBeUndefined()
    expect(r?.children).toBeUndefined()
    expect(r?.route?.handler).toBe(mockHandler)

    const mockHandler2 = () => {}
    galbe.get('/test/:foo', mockHandler2)
    r = r?.param

    expect(r?.route?.method).toBe('get')
    expect(r?.route?.path).toBe('/test/:foo')
    expect(r?.param).toBeUndefined()
    expect(r?.children).toBeUndefined()
    expect(r?.route?.handler).toBe(mockHandler2)

    const mockHandler3 = () => {}
    galbe.get('/test/:foo/bar', mockHandler3)

    expect(r?.children).toHaveProperty('bar')
    expect(r?.param).toBeUndefined()
    expect(r?.children?.bar?.route?.handler).toBe(mockHandler3)
  })

  test('redefining root', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    const [h1, h2, h3] = [() => {}, () => {}, () => {}]

    galbe.get('/', h1)
    galbe.get('/test', h2)
    galbe.get('/', h3)

    let r: RouteNode | undefined = router.routes.GET
    expect(router.prefix).toBe('')
    expect(r?.route?.method).toBe('get')
    expect(r?.route?.path).toBe('/')
    expect(r?.route?.handler).toBe(h3)
    expect(r?.children?.test?.route?.method).toBe('get')
    expect(r?.children?.test?.route?.handler).toBe(h2)

    const [h4, h5] = [() => {}, () => {}]

    galbe.get('/foo/bar', h4)
    galbe.get('/foo', h5)

    r = router?.routes?.GET?.children?.foo
    expect(r?.route?.method).toBe('get')
    expect(r?.route?.path).toBe('/foo')
    expect(r?.route?.handler).toBe(h5)
    expect(r?.children?.bar?.route?.method).toBe('get')
    expect(r?.children?.bar?.route?.path).toBe('/foo/bar')
    expect(r?.children?.bar?.route?.handler).toBe(h4)
  })

  test('find route', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    const [h1, h3, h4] = [() => {}, () => {}, () => {}, () => {}]

    galbe.get('/', h1)
    galbe.get('/test/foo', h3)
    galbe.get('/test/foo/bar', h4)

    let r1 = router.find('GET', '/')
    expect(r1.path).toBe('/')
    expect(r1.handler).toBe(h1)
    let r2 = router.find('GET', '/test/foo')
    expect(r2.path).toBe('/test/foo')
    expect(r2.handler).toBe(h3)
    let r3 = router.find('GET', '/test/foo/bar')
    expect(r3.path).toBe('/test/foo/bar')
    expect(r3.handler).toBe(h4)

    try {
      router.find('GET', '/test')
      expect.unreachable()
    } catch (err: any) {
      expect(err).toBeInstanceOf(NotFoundError)
      expect(err.status).toBe(404)
      expect(err.payload).toBe('Not found')
    }

    try {
      router.find('GET', '/test/bar/bar')
      expect.unreachable()
    } catch (err: any) {
      expect(err).toBeInstanceOf(NotFoundError)
      expect(err.status).toBe(404)
      expect(err.payload).toBe('Not found')
    }
  })

  test('find route param', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    const [h1, h2] = [() => {}, () => {}]

    galbe.get('/test/:foo', h1)
    galbe.get('/test/test', h2)

    let r1 = router.find('GET', '/test/42')
    expect(r1.path).toBe('/test/:foo')
    expect(r1.handler).toBe(h1)

    let r2 = router.find('GET', '/test/test')
    expect(r2.path).toBe('/test/test')
    expect(r2.handler).toBe(h2)
  })

  test('wildcard routes', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    const [h1, h2, h3, h4] = [() => {}, () => {}, () => {}, () => {}]

    galbe.get('/test/foo/*', h1)
    galbe.get('/test/foo/bar', h2)
    galbe.get('/test/foo/:p/bar', h3)

    galbe.get('/test/foo/*/lol', h4)

    let r1 = router.find('GET', '/test/foo/bar/42')
    expect(r1.path).toBe('/test/foo/*')
    expect(r1.handler).toBe(h1)

    let r3 = router.find('GET', '/test/foo/bar/bar')
    expect(r3.path).toBe('/test/foo/:p/bar')
    expect(r3.handler).toBe(h3)

    let r4 = router.find('GET', '/test/foo/foo')
    expect(r4.path).toBe('/test/foo/*')
    expect(r4.handler).toBe(h1)

    let r5 = router.find('GET', '/test/foo/toto/lol')
    expect(r5.path).toBe('/test/foo/*/lol')
    expect(r5.handler).toBe(h4)
  })
})
