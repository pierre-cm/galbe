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

    expect(router.routes).toEqual({ routes: {} })

    galbe.get('/', () => {})
    let r: RouteNode | undefined = router.routes

    expect(r?.routes.get?.method).toBe('get')
    expect(r?.routes.get?.path).toBe('/')
    expect(r?.param).toBeUndefined()
    expect(r?.children).toBeUndefined()

    const mockHandler = () => {}
    galbe.get('/test', mockHandler)
    r = r?.children?.test

    expect(r?.routes.get?.method).toBe('get')
    expect(r?.routes.get?.path).toBe('/test')
    expect(r?.param).toBeUndefined()
    expect(r?.children).toBeUndefined()
    expect(r?.routes.get?.handler).toBe(mockHandler)

    const mockHandler2 = () => {}
    galbe.get('/test/:foo', mockHandler2)
    r = r?.param

    expect(r?.routes.get?.method).toBe('get')
    expect(r?.routes.get?.path).toBe('/test/:foo')
    expect(r?.param).toBeUndefined()
    expect(r?.children).toBeUndefined()
    expect(r?.routes.get?.handler).toBe(mockHandler2)

    const mockHandler3 = () => {}
    galbe.get('/test/:foo/bar', mockHandler3)

    expect(r?.children).toHaveProperty('bar')
    expect(r?.param).toBeUndefined()
    expect(r?.children?.bar?.routes.get?.handler).toBe(mockHandler3)
  })

  test('redefining root', async () => {
    const galbe = new Galbe()
    const router = galbe.router

    const [h1, h2, h3] = [() => {}, () => {}, () => {}]

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

    const [h4, h5] = [() => {}, () => {}]

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

    const [h1, h3, h4] = [() => {}, () => {}, () => {}, () => {}]

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
      expect(err.payload).toBe('Not found')
    }

    try {
      router.find('get', '/test/bar/bar')
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

    const [h1, h2, h3, h4] = [() => {}, () => {}, () => {}, () => {}]

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

    const [h1, h2] = [() => {}, () => {}]

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
})
