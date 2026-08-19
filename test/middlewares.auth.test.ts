import { describe, expect, test } from 'bun:test'
import { $T, Galbe } from '../src'
import { apiKey, AuthError, basicAuth, bearer, type AuthErrorCode } from '../src/middlewares'
import { OpenAPISerializer } from '../src/extras/spec/openapi.serializer'

const basic = (user: string, password: string) => {
  // btoa() over a JS string is latin-1; RFC 7617 credentials are UTF-8 bytes
  let bin = ''
  for (const byte of new TextEncoder().encode(`${user}:${password}`)) bin += String.fromCharCode(byte)
  return `Basic ${btoa(bin)}`
}

describe('bearer middleware', async () => {
  const port = 7393
  const galbe = new Galbe()
  const seen: AuthErrorCode[] = []

  galbe.middleware('/one/*', bearer({ token: 'secret-token' }))
  galbe.middleware('/many/*', bearer({ token: ['first', 'second'] }))
  galbe.middleware('/realm/*', bearer({ token: 'secret-token', realm: 'api' }))
  galbe.middleware('/lookup/*', bearer({ verify: token => (token === 'live' ? { userId: 42 } : false) }))
  galbe.middleware('/plain/*', bearer({ verify: token => token.startsWith('ok') }))
  galbe.middleware('/holder/*', bearer({ token: 'secret-token', stateHolder: 'client' }))
  galbe.middleware(
    '/custom/*',
    bearer({
      token: 'secret-token',
      errorHandler: error => {
        seen.push(error.code)
        return new Response('nope', { status: 418 })
      },
    })
  )
  galbe.middleware('/optional/*', bearer({ token: 'secret-token', errorHandler: () => {} }))
  for (const p of ['/one/x', '/many/x', '/realm/x', '/custom/x']) galbe.get(p, () => 'ok')
  galbe.get('/lookup/x', ctx => String(ctx.state.bearer.userId))
  galbe.get('/plain/x', ctx => ctx.state.bearer)
  galbe.get('/holder/x', ctx => ctx.state.client)
  galbe.get('/optional/x', ctx => ctx.state.bearer ?? 'anon')
  galbe.post('/one/items', { body: { 'application/json': $T.object({ n: $T.integer() }) } }, () => 'ok')

  await galbe.listen(port)
  const get = (path: string, headers?: Record<string, string>) => fetch(`http://localhost:${port}${path}`, { headers })
  const auth = (token: string) => ({ authorization: `Bearer ${token}` })

  test('the configured token is accepted and anything else is not', async () => {
    expect((await get('/one/x', auth('secret-token'))).status).toBe(200)
    expect((await get('/one/x', auth('secret-token '))).status).toBe(200) // trailing space trimmed
    expect((await get('/one/x', auth('wrong'))).status).toBe(401)
    expect((await get('/one/x', auth('secret-toke'))).status).toBe(401)
    expect((await get('/one/x', auth('secret-tokenn'))).status).toBe(401)
  })

  test('any of a list of tokens is accepted', async () => {
    expect((await get('/many/x', auth('first'))).status).toBe(200)
    expect((await get('/many/x', auth('second'))).status).toBe(200)
    expect((await get('/many/x', auth('third'))).status).toBe(401)
  })

  test('the scheme name is read case-insensitively, and another scheme is not a token', async () => {
    expect((await get('/one/x', { authorization: 'bearer secret-token' })).status).toBe(200)
    expect((await get('/one/x', { authorization: 'BEARER  secret-token' })).status).toBe(200)
    expect((await get('/one/x', { authorization: 'Basic secret-token' })).status).toBe(401)
    expect((await get('/one/x', { authorization: 'secret-token' })).status).toBe(401)
  })

  test('a missing token and a wrong one carry different challenges', async () => {
    expect((await get('/one/x')).headers.get('www-authenticate')).toBe('Bearer')
    expect((await get('/one/x', auth('wrong'))).headers.get('www-authenticate')).toBe('Bearer error="invalid_token"')
    expect((await get('/realm/x')).headers.get('www-authenticate')).toBe('Bearer realm="api"')
    expect((await get('/realm/x', auth('wrong'))).headers.get('www-authenticate')).toBe(
      'Bearer realm="api", error="invalid_token"'
    )
  })

  test('verify decides, and what it returns lands on ctx.state', async () => {
    expect(await (await get('/lookup/x', auth('live'))).text()).toBe('42')
    expect((await get('/lookup/x', auth('revoked'))).status).toBe(401)
    // a bare `true` keeps the token itself as the identity
    expect(await (await get('/plain/x', auth('ok-42'))).text()).toBe('ok-42')
    expect((await get('/plain/x', auth('no'))).status).toBe(401)
  })

  test('stateHolder names the state key', async () => {
    expect(await (await get('/holder/x', auth('secret-token'))).text()).toBe('secret-token')
  })

  test('errorHandler replaces the rejection, and returning nothing means optional auth', async () => {
    const resp = await get('/custom/x', auth('wrong'))
    expect(resp.status).toBe(418)
    expect(await resp.text()).toBe('nope')
    expect(seen).toEqual(['invalid'])

    expect(await (await get('/optional/x')).text()).toBe('anon')
    expect(await (await get('/optional/x', auth('secret-token'))).text()).toBe('secret-token')
  })

  test('the body is never parsed: an unauthenticated malformed request is a 401, not a 400', async () => {
    const post = (headers: Record<string, string>) =>
      fetch(`http://localhost:${port}/one/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: '{',
      })

    expect((await post(auth('secret-token'))).status).toBe(400)
    expect((await post({})).status).toBe(401)
  })

  test('a configuration with nothing to check against is refused', () => {
    expect(() => bearer({})).toThrow(SyntaxError)
    expect(() => bearer({ token: 'x', realm: 'we"ird' })).toThrow(SyntaxError)
  })
})

describe('apiKey middleware', async () => {
  const port = 7394
  const galbe = new Galbe()

  galbe.middleware('/header/*', apiKey({ key: 'secret-key' }))
  galbe.middleware('/named/*', apiKey({ name: 'x-tenant-key', key: ['a', 'b'] }))
  galbe.middleware('/query/*', apiKey({ in: 'query', name: 'access_token', key: 'secret-key' }))
  galbe.middleware('/cookie/*', apiKey({ in: 'cookie', name: 'session', key: 'secret-key' }))
  galbe.middleware('/lookup/*', apiKey({ verify: key => (key === 'live' ? { tenant: 'acme' } : false) }))
  for (const p of ['/header/x', '/named/x', '/query/x', '/cookie/x']) galbe.get(p, ctx => String(ctx.state.apiKey))
  galbe.get('/lookup/x', ctx => ctx.state.apiKey.tenant)

  await galbe.listen(port)
  const get = (path: string, headers?: Record<string, string>) => fetch(`http://localhost:${port}${path}`, { headers })

  test('the default x-api-key header is checked', async () => {
    expect((await get('/header/x', { 'x-api-key': 'secret-key' })).status).toBe(200)
    expect((await get('/header/x', { 'x-api-key': 'wrong' })).status).toBe(401)
    expect((await get('/header/x')).status).toBe(401)
    expect(await (await get('/header/x', { 'x-api-key': 'secret-key' })).text()).toBe('secret-key')
  })

  test('the header name is configurable, and header lookup is case-insensitive', async () => {
    expect((await get('/named/x', { 'x-tenant-key': 'a' })).status).toBe(200)
    expect((await get('/named/x', { 'X-Tenant-Key': 'b' })).status).toBe(200)
    expect((await get('/named/x', { 'x-api-key': 'a' })).status).toBe(401)
  })

  test('a query key is read from the raw URL, before any parsing', async () => {
    expect((await get('/query/x?access_token=secret-key')).status).toBe(200)
    expect((await get('/query/x?access_token=wrong')).status).toBe(401)
    expect((await get('/query/x?other=secret-key')).status).toBe(401)
    expect((await get('/query/x')).status).toBe(401)
  })

  test('a cookie key is read from the named cookie', async () => {
    expect((await get('/cookie/x', { cookie: 'session=secret-key' })).status).toBe(200)
    expect((await get('/cookie/x', { cookie: 'other=secret-key' })).status).toBe(401)
    expect((await get('/cookie/x', { cookie: 'session=wrong' })).status).toBe(401)
  })

  test('an api key rejection carries no challenge: the scheme has no registered one', async () => {
    expect((await get('/header/x')).headers.get('www-authenticate')).toBeNull()
  })

  test('verify decides, and what it returns lands on ctx.state', async () => {
    expect(await (await get('/lookup/x', { 'x-api-key': 'live' })).text()).toBe('acme')
    expect((await get('/lookup/x', { 'x-api-key': 'revoked' })).status).toBe(401)
  })

  test('a configuration with nothing to check against is refused', () => {
    expect(() => apiKey({})).toThrow(SyntaxError)
  })
})

describe('basicAuth middleware', async () => {
  const port = 7395
  const galbe = new Galbe()
  const seen: AuthErrorCode[] = []

  galbe.middleware('/users/*', basicAuth({ users: { alice: 'wonderland', bob: 'builder' } }))
  galbe.middleware('/realm/*', basicAuth({ users: { alice: 'wonderland' }, realm: 'metrics' }))
  galbe.middleware('/utf8/*', basicAuth({ users: { 'ali©e': 'påsswørd' } }))
  galbe.middleware(
    '/lookup/*',
    basicAuth({
      verify: (user, password) => (user === 'root' && password === 'toor' ? { email: 'root@example.com' } : false),
      errorHandler: error => {
        seen.push(error.code)
        return new Response('', { status: 401 })
      },
    })
  )
  for (const p of ['/realm/x', '/utf8/x']) galbe.get(p, () => 'ok')
  galbe.get('/users/x', ctx => ctx.state.basicAuth)
  galbe.get('/lookup/x', ctx => ctx.state.basicAuth.email)

  await galbe.listen(port)
  const get = (path: string, headers?: Record<string, string>) => fetch(`http://localhost:${port}${path}`, { headers })

  test('a configured pair is accepted, and the username lands on ctx.state', async () => {
    expect(await (await get('/users/x', { authorization: basic('alice', 'wonderland') })).text()).toBe('alice')
    expect(await (await get('/users/x', { authorization: basic('bob', 'builder') })).text()).toBe('bob')
  })

  test('a wrong password and an unknown user are both plain rejections', async () => {
    expect((await get('/users/x', { authorization: basic('alice', 'looking-glass') })).status).toBe(401)
    expect((await get('/users/x', { authorization: basic('mallory', 'wonderland') })).status).toBe(401)
    // credentials of one user with the password of another must not cross
    expect((await get('/users/x', { authorization: basic('alice', 'builder') })).status).toBe(401)
  })

  test('the challenge names the realm and the charset', async () => {
    expect((await get('/users/x')).headers.get('www-authenticate')).toBe('Basic realm="Restricted", charset="UTF-8"')
    expect((await get('/realm/x')).headers.get('www-authenticate')).toBe('Basic realm="metrics", charset="UTF-8"')
    expect((await get('/realm/x', { authorization: basic('alice', 'wrong') })).headers.get('www-authenticate')).toBe(
      'Basic realm="metrics", charset="UTF-8"'
    )
  })

  test('credentials are decoded as UTF-8', async () => {
    expect((await get('/utf8/x', { authorization: basic('ali©e', 'påsswørd') })).status).toBe(200)
    expect((await get('/utf8/x', { authorization: basic('ali©e', 'password') })).status).toBe(401)
  })

  test('malformed credentials are rejected as such', async () => {
    expect((await get('/lookup/x', { authorization: 'Basic !!not-base64!!' })).status).toBe(401)
    expect((await get('/lookup/x', { authorization: `Basic ${btoa('no-colon-here')}` })).status).toBe(401)
    expect((await get('/lookup/x')).status).toBe(401)
    expect(seen).toEqual(['malformed', 'malformed', 'missing'])
  })

  test('verify receives both halves, and what it returns lands on ctx.state', async () => {
    expect(await (await get('/lookup/x', { authorization: basic('root', 'toor') })).text()).toBe('root@example.com')
    expect((await get('/lookup/x', { authorization: basic('root', 'wrong') })).status).toBe(401)
  })

  test('a password containing a colon is kept whole', async () => {
    const g = new Galbe()
    g.middleware('/*', basicAuth({ users: { svc: 'pa:ss:word' } }))
    g.get('/x', ctx => ctx.state.basicAuth)
    await g.listen(7396)

    const resp = await fetch('http://localhost:7396/x', { headers: { authorization: basic('svc', 'pa:ss:word') } })
    expect(await resp.text()).toBe('svc')
  })

  test('a configuration with nothing to check against is refused', () => {
    expect(() => basicAuth({})).toThrow(SyntaxError)
  })
})

describe('auth middlewares, shared behavior', async () => {
  test('every rejection is an AuthError carrying a code', async () => {
    const errors: AuthError[] = []
    const collect = (error: AuthError) => {
      errors.push(error)
      return new Response('', { status: 401 })
    }
    const g = new Galbe()
    g.middleware('/b/*', bearer({ token: 't', errorHandler: collect }))
    g.middleware('/k/*', apiKey({ key: 'k', errorHandler: collect }))
    g.middleware('/a/*', basicAuth({ users: { u: 'p' }, errorHandler: collect }))
    for (const p of ['/b/x', '/k/x', '/a/x']) g.get(p, () => 'ok')
    await g.listen(7397)

    for (const p of ['/b/x', '/k/x', '/a/x']) await fetch(`http://localhost:7397${p}`)
    expect(errors.every(e => e instanceof AuthError)).toBe(true)
    expect(errors.map(e => e.code)).toEqual(['missing', 'missing', 'missing'])
  })

  test('an error thrown by verify is not flattened into a 401', async () => {
    const g = new Galbe()
    g.middleware(
      '/*',
      bearer({
        verify: () => {
          throw new Error('boom')
        },
      })
    )
    g.get('/x', () => 'ok')
    await g.listen(7398)

    expect((await fetch('http://localhost:7398/x', { headers: { authorization: 'Bearer t' } })).status).toBe(500)
  })
})

describe('auth middlewares, schema fragments and security metadata', () => {
  test('bearer declares the header and the http scheme that owns it', async () => {
    const g = new Galbe()
    g.middleware('/api/*', bearer({ token: 't', format: 'opaque' }))
    g.get('/api/x', () => 'x')

    const spec = await OpenAPISerializer(g)
    expect(spec.components?.securitySchemes).toEqual({
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' },
    })
    expect((spec.paths?.['/api/x'] as any).get.security).toEqual([{ bearerAuth: [] }])
    expect((spec.paths?.['/api/x'] as any).get.parameters).toBeUndefined()
    expect((g.router.find('get', '/api/x').schema.headers as Record<string, any>).authorization).toBeDefined()
  })

  test('apiKey declares its parameter and the apiKey scheme that owns it', async () => {
    const g = new Galbe()
    g.middleware('/h/*', apiKey({ key: 'k' }))
    g.middleware('/q/*', apiKey({ in: 'query', name: 'access_token', key: 'k', securityScheme: 'queryKeyAuth' }))
    g.middleware('/c/*', apiKey({ in: 'cookie', name: 'session', key: 'k', securityScheme: 'cookieKeyAuth' }))
    g.get('/h/x', () => 'x')
    g.get('/q/x', () => 'x')
    g.get('/c/x', () => 'x')

    const spec = await OpenAPISerializer(g)
    expect(spec.components?.securitySchemes).toMatchObject({
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
      queryKeyAuth: { type: 'apiKey', in: 'query', name: 'access_token' },
      cookieKeyAuth: { type: 'apiKey', in: 'cookie', name: 'session' },
    })
    for (const p of ['/h/x', '/q/x', '/c/x']) expect((spec.paths?.[p] as any).get.parameters).toBeUndefined()

    expect(Object.keys(g.router.find('get', '/h/x').schema.headers ?? {})).toEqual(['x-api-key'])
    expect(Object.keys(g.router.find('get', '/q/x').schema.query ?? {})).toEqual(['access_token'])
    // a cookie key has no fragment to contribute: the scheme documents it
    expect(g.router.find('get', '/c/x').schema.headers).toBeUndefined()
  })

  test('a mixed-case header name is read and validated all the same', async () => {
    const g = new Galbe()
    g.middleware('/api/*', apiKey({ name: 'X-Api-Key', key: 'k' }))
    g.get('/api/x', () => 'x')
    await g.listen(7399)

    // the hook reads headers case-insensitively and the fragment validates the
    // same way, so a declared name that is not already lowercase still passes
    expect((await fetch('http://localhost:7399/api/x', { headers: { 'x-api-key': 'k' } })).status).toBe(200)
    expect((await fetch('http://localhost:7399/api/x', { headers: { 'X-Api-Key': 'k' } })).status).toBe(200)
  })

  test('basicAuth declares the basic scheme', async () => {
    const g = new Galbe()
    g.middleware('/api/*', basicAuth({ users: { u: 'p' } }))
    g.get('/api/x', () => 'x')

    const spec = await OpenAPISerializer(g)
    expect(spec.components?.securitySchemes).toEqual({ basicAuth: { type: 'http', scheme: 'basic' } })
    expect((spec.paths?.['/api/x'] as any).get.security).toEqual([{ basicAuth: [] }])
    expect((spec.paths?.['/api/x'] as any).get.parameters).toBeUndefined()
  })

  test('securityScheme renames, so two instances of one middleware coexist', async () => {
    const g = new Galbe()
    g.middleware('/users/*', bearer({ token: 'u', securityScheme: 'userAuth' }))
    g.middleware('/admin/*', bearer({ token: 'a', securityScheme: 'adminAuth' }))
    g.get('/users/x', () => 'x')
    g.get('/admin/x', () => 'x')

    const spec = await OpenAPISerializer(g)
    expect(Object.keys(spec.components?.securitySchemes ?? {})).toEqual(['userAuth', 'adminAuth'])
    expect((spec.paths?.['/admin/x'] as any).get.security).toEqual([{ adminAuth: [] }])
  })

  test('securityScheme: false emits no security metadata, and no inferred scheme either', async () => {
    const g = new Galbe()
    g.middleware('/b/*', bearer({ token: 't', securityScheme: false }))
    g.middleware('/k/*', apiKey({ key: 'k', securityScheme: false }))
    g.get('/b/x', () => 'x')
    g.get('/k/x', () => 'x')

    const spec = await OpenAPISerializer(g)
    expect(spec.components?.securitySchemes).toBeUndefined()
    for (const p of ['/b/x', '/k/x']) {
      expect((spec.paths?.[p] as any).get.security).toBeUndefined()
      // with no scheme owning them, the credentials document as plain parameters
      expect((spec.paths?.[p] as any).get.parameters).toHaveLength(1)
    }
  })

  test('two auth middlewares on one route contribute both requirements', async () => {
    const g = new Galbe()
    g.middleware('/api/*', bearer({ token: 't' }))
    g.middleware('/api/admin/*', apiKey({ key: 'k' }))
    g.get('/api/admin/x', () => 'x')

    const spec = await OpenAPISerializer(g)
    // the nearest middleware scope wins the requirement, as for @security
    expect((spec.paths?.['/api/admin/x'] as any).get.security).toEqual([{ apiKeyAuth: [] }])
    expect(Object.keys(spec.components?.securitySchemes ?? {}).sort()).toEqual(['apiKeyAuth', 'bearerAuth'])
  })

  test('a group typed by the def reads the credential header from the fragment', async () => {
    const g = new Galbe()
    g.group('/api', apiKey({ name: 'x-tenant-key', key: 'k' }), api => {
      api.get('/x', ctx => {
        const key: string | undefined = ctx.headers['x-tenant-key']
        return key ?? ''
      })
    })

    expect(Object.keys(g.router.find('get', '/api/x').schema.headers ?? {})).toEqual(['x-tenant-key'])
  })
})
