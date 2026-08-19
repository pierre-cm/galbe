import { describe, expect, test } from 'bun:test'
import { $T, Galbe } from '../src'
import { jwt, signJwt, type JwtAlgorithm, type JwtErrorCode } from '../src/middlewares'
import { OpenAPISerializer } from '../src/extras/spec/openapi.serializer'

// Tokens under test are signed here, on crypto.subtle directly, so nothing but
// the wire format is shared with the middleware's own verification path.
const enc = new TextEncoder()
const b64u = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
const b64uStr = (str: string) => b64u(enc.encode(str))
const signParams = (alg: JwtAlgorithm) =>
  alg.startsWith('HS')
    ? { name: 'HMAC' }
    : alg.startsWith('RS')
      ? { name: 'RSASSA-PKCS1-v1_5' }
      : { name: 'ECDSA', hash: `SHA-${alg.slice(2)}` }
const sign = async (payload: Record<string, any>, key: CryptoKey, alg: JwtAlgorithm = 'HS256') => {
  const data = `${b64uStr(JSON.stringify({ alg, typ: 'JWT' }))}.${b64uStr(JSON.stringify(payload))}`
  const sig = await crypto.subtle.sign(signParams(alg), key, enc.encode(data))
  return `${data}.${b64u(new Uint8Array(sig))}`
}
const pem = async (key: CryptoKey) => {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', key))
  const body = btoa(String.fromCharCode(...spki))
  return `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----\n`
}

const secret = 'a-string-secret-at-least-256-bits-long'
const hsKey = async (bits: '256' | '384' | '512' = '256') =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: `SHA-${bits}` }, false, ['sign'])
const rsa = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify']
)
const ec = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])

const now = () => Math.floor(Date.now() / 1000)
const claims = (extra: Record<string, any> = {}) => ({ sub: 'user-1', exp: now() + 60, ...extra })

describe('jwt middleware', async () => {
  const port = 7382
  const galbe = new Galbe()
  const hs = await hsKey()
  const token = await sign(claims(), hs)

  galbe.middleware('/hs/*', jwt({ publicKey: secret }))
  galbe.get('/hs/me', ctx => ctx.state.jwtPayload.sub)
  galbe.post('/hs/items', { body: { 'application/json': $T.object({ n: $T.integer() }) } }, ctx => ctx.body.n)
  galbe.get('/open', () => 'open')

  await galbe.listen(port)
  const get = (path: string, init?: RequestInit) => fetch(`http://localhost:${port}${path}`, init)
  const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } })

  test('a valid token lets the request through and lands on ctx.state', async () => {
    const resp = await get('/hs/me', auth(token))
    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe('user-1')
  })

  test('unmatched routes are untouched', async () => {
    expect((await get('/open')).status).toBe(200)
  })

  test('a missing token is a 401 with a bearer challenge', async () => {
    const resp = await get('/hs/me')
    expect(resp.status).toBe(401)
    expect(resp.headers.get('www-authenticate')).toBe('Bearer')
  })

  test('a tampered signature is rejected', async () => {
    const [head, body, sig] = token.split('.')
    const flipped = `${sig?.slice(0, -1)}${sig?.endsWith('A') ? 'B' : 'A'}`
    const resp = await get('/hs/me', auth(`${head}.${body}.${flipped}`))
    expect(resp.status).toBe(401)
    expect(resp.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"')
  })

  test('a tampered payload is rejected', async () => {
    const [head, , sig] = token.split('.')
    expect(
      (await get('/hs/me', auth(`${head}.${b64uStr(JSON.stringify(claims({ sub: 'admin' })))}.${sig}`))).status
    ).toBe(401)
  })

  test('malformed tokens are rejected', async () => {
    for (const t of ['', 'not-a-token', 'a.b', 'a.b.c.d', 'a.b.c', `${b64uStr('{')}.${b64uStr('{}')}.AAAA`])
      expect((await get('/hs/me', auth(t))).status).toBe(401)
  })

  test('an expired token is rejected, within clock tolerance it is not', async () => {
    const expired = await sign({ sub: 'user-1', exp: now() - 10 }, hs)
    expect((await get('/hs/me', auth(expired))).status).toBe(401)

    const tolerant = new Galbe()
    tolerant.middleware('/*', jwt({ publicKey: secret, clockTolerance: 60 }))
    tolerant.get('/me', ctx => ctx.state.jwtPayload.sub)
    await tolerant.listen(7383)
    expect((await fetch(`http://localhost:7383/me`, auth(expired))).status).toBe(200)
    expect((await fetch(`http://localhost:7383/me`, auth(await sign({ sub: 'u', exp: now() - 600 }, hs)))).status).toBe(
      401
    )
  })

  test('a not-yet-valid token is rejected', async () => {
    expect((await get('/hs/me', auth(await sign(claims({ nbf: now() + 60 }), hs)))).status).toBe(401)
    expect((await get('/hs/me', auth(await sign(claims({ nbf: now() - 60 }), hs)))).status).toBe(200)
  })

  test('the body is never parsed: an unauthenticated malformed request is a 401, not a 400', async () => {
    const post = (init: RequestInit) =>
      get('/hs/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{', ...init })

    expect((await post(auth(token))).status).toBe(400)
    expect((await post({})).status).toBe(401)
  })
})

describe('jwt claim checks', async () => {
  const port = 7384
  const galbe = new Galbe()
  const hs = await hsKey()

  galbe.middleware(
    '/iss/*',
    jwt({ publicKey: secret, issuer: ['https://auth.example.com', 'https://alt.example.com'] })
  )
  galbe.middleware('/aud/*', jwt({ publicKey: secret, audience: 'my-api' }))
  galbe.middleware('/sub/*', jwt({ publicKey: secret, subject: 'user-1' }))
  galbe.middleware('/validate/*', jwt({ publicKey: secret, validate: p => p.role === 'admin' }))
  galbe.middleware('/holder/*', jwt({ publicKey: secret, stateHolder: 'user' }))
  for (const p of ['/iss/x', '/aud/x', '/sub/x', '/validate/x']) galbe.get(p, () => 'ok')
  galbe.get('/holder/x', ctx => ctx.state.user.sub)

  await galbe.listen(port)
  const status = async (path: string, payload: Record<string, any>) =>
    (
      await fetch(`http://localhost:${port}${path}`, {
        headers: { authorization: `Bearer ${await sign(claims(payload), hs)}` },
      })
    ).status

  test('issuer must be one of the accepted ones', async () => {
    expect(await status('/iss/x', { iss: 'https://auth.example.com' })).toBe(200)
    expect(await status('/iss/x', { iss: 'https://alt.example.com' })).toBe(200)
    expect(await status('/iss/x', { iss: 'https://evil.example.com' })).toBe(401)
    expect(await status('/iss/x', {})).toBe(401)
  })

  test('audience matches a string or any member of an array claim', async () => {
    expect(await status('/aud/x', { aud: 'my-api' })).toBe(200)
    expect(await status('/aud/x', { aud: ['other', 'my-api'] })).toBe(200)
    expect(await status('/aud/x', { aud: 'other' })).toBe(401)
    expect(await status('/aud/x', {})).toBe(401)
  })

  test('subject must match', async () => {
    expect(await status('/sub/x', {})).toBe(200)
    expect(await status('/sub/x', { sub: 'user-2' })).toBe(401)
  })

  test('validate() rejects the payload it returns false for', async () => {
    expect(await status('/validate/x', { role: 'admin' })).toBe(200)
    expect(await status('/validate/x', { role: 'user' })).toBe(401)
  })

  test('stateHolder names the state key', async () => {
    const resp = await fetch(`http://localhost:${port}/holder/x`, {
      headers: { authorization: `Bearer ${await sign(claims(), hs)}` },
    })
    expect(await resp.text()).toBe('user-1')
  })
})

describe('jwt algorithms and keys', async () => {
  const port = 7385
  const galbe = new Galbe()
  const rsaPem = await pem(rsa.publicKey)
  const ecPem = await pem(ec.publicKey)

  galbe.middleware('/hs/*', jwt({ publicKey: secret }))
  galbe.middleware('/rs/*', jwt({ publicKey: rsaPem }))
  galbe.middleware('/es/*', jwt({ publicKey: ecPem }))
  galbe.middleware('/jwk/*', jwt({ publicKey: await crypto.subtle.exportKey('jwk', rsa.publicKey) }))
  galbe.middleware('/cryptokey/*', jwt({ publicKey: ec.publicKey }))
  galbe.middleware('/hs256only/*', jwt({ publicKey: secret, algorithms: ['HS256'] }))
  for (const p of ['/hs/x', '/rs/x', '/es/x', '/jwk/x', '/cryptokey/x', '/hs256only/x']) galbe.get(p, () => 'ok')

  await galbe.listen(port)
  const status = async (path: string, token: string) =>
    (await fetch(`http://localhost:${port}${path}`, { headers: { authorization: `Bearer ${token}` } })).status

  test('HS256, RS256 and ES256 tokens verify against their key', async () => {
    expect(await status('/hs/x', await sign(claims(), await hsKey(), 'HS256'))).toBe(200)
    expect(await status('/rs/x', await sign(claims(), rsa.privateKey, 'RS256'))).toBe(200)
    expect(await status('/es/x', await sign(claims(), ec.privateKey, 'ES256'))).toBe(200)
  })

  test('a JWK and an imported CryptoKey work as keys', async () => {
    expect(await status('/jwk/x', await sign(claims(), rsa.privateKey, 'RS256'))).toBe(200)
    expect(await status('/cryptokey/x', await sign(claims(), ec.privateKey, 'ES256'))).toBe(200)
  })

  test('the key decides the algorithm: an alg-confusion token is rejected', async () => {
    // the classic attack: re-sign with HS256 using the RSA public key as the
    // HMAC secret, betting the verifier trusts the token's own alg header
    const forged = await crypto.subtle.importKey('raw', enc.encode(rsaPem), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ])
    expect(await status('/rs/x', await sign(claims(), forged, 'HS256'))).toBe(401)

    const [, body, sig] = (await sign(claims(), rsa.privateKey, 'RS256')).split('.')
    expect(await status('/rs/x', `${b64uStr(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${body}.${sig}`)).toBe(401)
    expect(await status('/rs/x', `${b64uStr(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${body}.`)).toBe(401)
  })

  test('the whole family of a key is accepted, and `algorithms` narrows it', async () => {
    expect(await status('/hs/x', await sign(claims(), await hsKey('384'), 'HS384'))).toBe(200)
    expect(await status('/hs256only/x', await sign(claims(), await hsKey('384'), 'HS384'))).toBe(401)
    expect(await status('/hs256only/x', await sign(claims(), await hsKey(), 'HS256'))).toBe(200)
  })

  test('a key no accepted algorithm can use is a configuration error, not a 401', async () => {
    const g = new Galbe()
    const sha1 = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, [
      'verify',
    ])
    g.middleware('/sha1/*', jwt({ publicKey: sha1 }))
    g.middleware('/mismatch/*', jwt({ publicKey: secret, algorithms: ['RS256'] }))
    g.get('/sha1/x', () => 'ok')
    g.get('/mismatch/x', () => 'ok')
    await g.listen(7391)

    const token = await sign(claims(), await hsKey())
    for (const p of ['/sha1/x', '/mismatch/x'])
      expect((await fetch(`http://localhost:7391${p}`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(
        500
      )
  })

  test('a signature from another key of the same algorithm is rejected', async () => {
    const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    expect(await status('/es/x', await sign(claims(), other.privateKey, 'ES256'))).toBe(401)
  })

  test('RFC 7515 A.1 verifies: the failure is the expired claim, not the signature', async () => {
    // known-good vector — signature valid, `exp` in 2011
    const vector =
      'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const codes: JwtErrorCode[] = []
    const rfc = new Galbe()
    rfc.middleware(
      '/*',
      jwt({
        publicKey: {
          kty: 'oct',
          k: 'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow',
        },
        errorHandler: error => {
          codes.push(error.code)
          return new Response('', { status: 401 })
        },
      })
    )
    rfc.get('/x', () => 'ok')
    await rfc.listen(7386)

    expect((await fetch('http://localhost:7386/x', { headers: { authorization: `Bearer ${vector}` } })).status).toBe(
      401
    )
    expect(codes).toEqual(['expired'])
  })
})

describe('jwt sources', async () => {
  const port = 7387
  const galbe = new Galbe()
  const hs = await hsKey()
  const token = await sign(claims(), hs)

  galbe.middleware('/cookie/*', jwt({ publicKey: secret, sources: ['cookie:session'] }))
  galbe.middleware('/both/*', jwt({ publicKey: secret, sources: ['bearer', 'cookie:session'] }))
  galbe.get('/cookie/x', ctx => ctx.state.jwtPayload.sub)
  galbe.get('/both/x', ctx => ctx.state.jwtPayload.sub)

  await galbe.listen(port)
  const get = (path: string, headers?: Record<string, string>) => fetch(`http://localhost:${port}${path}`, { headers })

  test('a cookie source reads the token from the named cookie', async () => {
    const resp = await get('/cookie/x', { cookie: `session=${token}` })
    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe('user-1')
  })

  test('a cookie source ignores the bearer header', async () => {
    expect((await get('/cookie/x', { authorization: `Bearer ${token}` })).status).toBe(401)
    expect((await get('/cookie/x', { cookie: `other=${token}` })).status).toBe(401)
  })

  test('cookie lookup does not reach through the prototype chain', async () => {
    const proto = new Galbe()
    proto.middleware('/*', jwt({ publicKey: secret, sources: ['cookie:constructor'] }))
    proto.get('/x', () => 'ok')
    await proto.listen(7388)

    expect((await fetch('http://localhost:7388/x')).status).toBe(401)
  })

  test('several sources are tried in order', async () => {
    expect((await get('/both/x', { authorization: `Bearer ${token}` })).status).toBe(200)
    expect((await get('/both/x', { cookie: `session=${token}` })).status).toBe(200)
    expect((await get('/both/x')).status).toBe(401)
    // a cookie-authenticated request needs no bearer challenge to be answered
    expect((await get('/both/x', { cookie: `session=nope` })).status).toBe(401)
  })

  test('an invalid source is a registration-time error', () => {
    expect(() => jwt({ publicKey: secret, sources: ['header:x-token' as 'bearer'] })).toThrow(SyntaxError)
  })
})

describe('jwt errorHandler', async () => {
  const port = 7389
  const galbe = new Galbe()
  const hs = await hsKey()
  const seen: JwtErrorCode[] = []

  galbe.middleware(
    '/custom/*',
    jwt({
      publicKey: secret,
      errorHandler: error => {
        seen.push(error.code)
        return new Response(JSON.stringify({ error: error.code }), { status: 419 })
      },
    })
  )
  // returning nothing lets the request through: optional authentication
  galbe.middleware('/optional/*', jwt({ publicKey: secret, errorHandler: () => {} }))
  galbe.get('/custom/x', () => 'ok')
  galbe.get('/optional/x', ctx => (ctx.state.jwtPayload ? 'auth' : 'anon'))

  await galbe.listen(port)
  const get = (path: string, headers?: Record<string, string>) => fetch(`http://localhost:${port}${path}`, { headers })

  test('a returned Response replaces the default rejection', async () => {
    const resp = await get('/custom/x')
    expect(resp.status).toBe(419)
    expect(await resp.json()).toEqual({ error: 'missing' })

    expect((await get('/custom/x', { authorization: 'Bearer a.b.c' })).status).toBe(419)
    expect(seen).toEqual(['missing', 'malformed'])
  })

  test('the handler is not called for a valid token', async () => {
    seen.length = 0
    expect((await get('/custom/x', { authorization: `Bearer ${await sign(claims(), hs)}` })).status).toBe(200)
    expect(seen).toEqual([])
  })

  test('returning nothing lets the request through unauthenticated', async () => {
    expect(await (await get('/optional/x')).text()).toBe('anon')
    expect(await (await get('/optional/x', { authorization: `Bearer ${await sign(claims(), hs)}` })).text()).toBe(
      'auth'
    )
  })

  test('an error thrown by validate() is not flattened into a 401', async () => {
    const boom = new Galbe()
    boom.middleware(
      '/*',
      jwt({
        publicKey: secret,
        validate: () => {
          throw new Error('boom')
        },
      })
    )
    boom.get('/x', () => 'ok')
    await boom.listen(7390)

    const resp = await fetch('http://localhost:7390/x', {
      headers: { authorization: `Bearer ${await sign(claims(), hs)}` },
    })
    expect(resp.status).toBe(500)
  })
})

describe('jwt schema fragment and security metadata', async () => {
  test('matched routes gain an optional JWT authorization header', async () => {
    const g = new Galbe()
    g.middleware('/api/*', jwt({ publicKey: secret }))
    g.get('/api/x', () => 'x')
    g.get('/other', () => 'other')

    const headers = g.router.find('get', '/api/x').schema.headers as Record<string, any>
    expect(headers.authorization).toMatchObject({ format: 'JWT', pattern: /^Bearer /i })
    expect(g.router.find('get', '/other').schema.headers).toBeUndefined()
  })

  test('the bearer scheme is defined and required on matched operations', async () => {
    const g = new Galbe()
    g.middleware('/api/*', jwt({ publicKey: secret }))
    g.get('/api/x', () => 'x')
    g.get('/other', () => 'other')

    const spec = await OpenAPISerializer(g)
    expect(spec.components?.securitySchemes).toEqual({
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    })
    expect((spec.paths?.['/api/x'] as any).get.security).toEqual([{ bearerAuth: [] }])
    expect((spec.paths?.['/other'] as any).get.security).toBeUndefined()
    // the scheme owns the credential, so the header is not documented twice
    expect((spec.paths?.['/api/x'] as any).get.parameters).toBeUndefined()
  })

  test('a cookie source documents as an apiKey scheme, and sources stack as alternatives', async () => {
    const g = new Galbe()
    g.middleware('/c/*', jwt({ publicKey: secret, sources: ['cookie:session'] }))
    g.middleware('/b/*', jwt({ publicKey: secret, sources: ['bearer', 'cookie:session'] }))
    g.get('/c/x', () => 'x')
    g.get('/b/x', () => 'x')

    const spec = await OpenAPISerializer(g)
    expect(spec.components?.securitySchemes).toMatchObject({
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'session' },
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    })
    expect((spec.paths?.['/c/x'] as any).get.security).toEqual([{ cookieAuth: [] }])
    expect((spec.paths?.['/b/x'] as any).get.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }])
  })

  test('securityScheme renames the scheme so two instances can coexist', async () => {
    const g = new Galbe()
    g.middleware('/users/*', jwt({ publicKey: secret, securityScheme: 'userAuth' }))
    g.middleware('/admin/*', jwt({ publicKey: secret, securityScheme: 'adminAuth' }))
    g.get('/users/x', () => 'x')
    g.get('/admin/x', () => 'x')

    const spec = await OpenAPISerializer(g)
    expect(Object.keys(spec.components?.securitySchemes ?? {})).toEqual(['userAuth', 'adminAuth'])
    expect((spec.paths?.['/admin/x'] as any).get.security).toEqual([{ adminAuth: [] }])
  })

  test('securityScheme: false emits no security metadata', async () => {
    const g = new Galbe()
    g.middleware('/api/*', jwt({ publicKey: secret, securityScheme: false }))
    g.get('/api/x', () => 'x')

    const spec = await OpenAPISerializer(g)
    expect(spec.components?.securitySchemes).toBeUndefined()
    expect((spec.paths?.['/api/x'] as any).get.security).toBeUndefined()
    // without a scheme owning it, the header documents as a plain parameter
    expect((spec.paths?.['/api/x'] as any).get.parameters).toMatchObject([{ name: 'authorization', in: 'header' }])
  })

  test('a group typed by the def reads the header from the fragment', async () => {
    const g = new Galbe()
    g.group('/api', jwt({ publicKey: secret }), api => {
      api.get('/x', ctx => {
        const header: string | undefined = ctx.headers.authorization
        return header ?? ''
      })
    })

    expect((g.router.find('get', '/api/x').schema.headers as Record<string, any>).authorization).toBeDefined()
  })
})

describe('signJwt', async () => {
  const port = 7392
  const galbe = new Galbe()
  const rsaPem = await pem(rsa.publicKey)
  const pkcs8 = async (key: CryptoKey) => {
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', key))
    const body = btoa(String.fromCharCode(...der))
    return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----\n`
  }

  galbe.middleware('/hs/*', jwt({ publicKey: secret }))
  galbe.middleware('/rs/*', jwt({ publicKey: rsaPem }))
  galbe.middleware('/es/*', jwt({ publicKey: ec.publicKey }))
  galbe.middleware('/strict/*', jwt({ publicKey: secret, issuer: 'https://auth.example.com', audience: 'my-api' }))
  for (const p of ['/hs/x', '/rs/x', '/es/x', '/strict/x']) galbe.get(p, ctx => ctx.state.jwtPayload.sub ?? 'ok')

  await galbe.listen(port)
  const get = (path: string, token: string) =>
    fetch(`http://localhost:${port}${path}`, { headers: { authorization: `Bearer ${token}` } })
  const partsOf = (token: string) => {
    const [head, body] = token.split('.')
    return {
      header: JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(head!), c => c.charCodeAt(0)))),
      payload: JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body!), c => c.charCodeAt(0)))),
    }
  }

  test('a signed token verifies, on every key form', async () => {
    expect((await get('/hs/x', await signJwt({ sub: 'user-1' }, secret))).status).toBe(200)
    expect((await get('/rs/x', await signJwt({ sub: 'user-1' }, await pkcs8(rsa.privateKey)))).status).toBe(200)
    expect((await get('/es/x', await signJwt({ sub: 'user-1' }, ec.privateKey))).status).toBe(200)
    expect(await (await get('/hs/x', await signJwt({ sub: 'user-1' }, secret))).text()).toBe('user-1')
  })

  test('the algorithm defaults to the key, and `algorithm` picks another of its family', async () => {
    expect(partsOf(await signJwt({}, secret)).header).toEqual({ typ: 'JWT', alg: 'HS256' })
    expect(partsOf(await signJwt({}, await pkcs8(rsa.privateKey))).header.alg).toBe('RS256')
    expect(partsOf(await signJwt({}, ec.privateKey)).header.alg).toBe('ES256')
    expect(partsOf(await signJwt({}, secret, { algorithm: 'HS512' })).header.alg).toBe('HS512')
    expect((await get('/hs/x', await signJwt({ sub: 'u' }, secret, { algorithm: 'HS512' }))).status).toBe(200)
  })

  test('a signature made here verifies outside this middleware too', async () => {
    // the token is checked against crypto.subtle directly: what is asserted is
    // the wire format, not agreement between two halves of the same module
    const token = await signJwt({ sub: 'user-1' }, secret)
    const [head, body, sig] = token.split('.')
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'verify',
    ])
    const bytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    expect(await crypto.subtle.verify('HMAC', key, bytes(sig!), enc.encode(`${head}.${body}`))).toBe(true)
  })

  test('option shorthands fill the standard claims', async () => {
    const token = await signJwt({ sub: 'user-1' }, secret, {
      expiresIn: 3600,
      notBefore: 60,
      issuer: 'https://auth.example.com',
      audience: ['my-api', 'other'],
      subject: 'ignored',
    })
    const { payload } = partsOf(token)

    expect(payload).toMatchObject({ iss: 'https://auth.example.com', aud: ['my-api', 'other'], sub: 'user-1' })
    expect(payload.iat).toBeCloseTo(now(), -1)
    expect(payload.exp - payload.iat).toBe(3600)
    expect(payload.nbf - payload.iat).toBe(60)
  })

  test('a payload claim wins over the option that would set it', async () => {
    const { payload } = partsOf(await signJwt({ iss: 'explicit', iat: 42 }, secret, { issuer: 'from-option' }))
    expect(payload).toMatchObject({ iss: 'explicit', iat: 42 })
  })

  test('extra header fields are carried, but never the algorithm', async () => {
    const { header } = partsOf(await signJwt({}, secret, { header: { kid: 'key-1', alg: 'none' } }))
    expect(header).toEqual({ typ: 'JWT', kid: 'key-1', alg: 'HS256' })
  })

  test('a token signed for one audience is refused by a middleware pinned to another', async () => {
    const good = await signJwt({ sub: 'u' }, secret, { issuer: 'https://auth.example.com', audience: 'my-api' })
    const bad = await signJwt({ sub: 'u' }, secret, { issuer: 'https://evil.example.com', audience: 'my-api' })

    expect((await get('/strict/x', good)).status).toBe(200)
    expect((await get('/strict/x', bad)).status).toBe(401)
    expect((await get('/strict/x', await signJwt({ sub: 'u' }, secret, { expiresIn: -60 }))).status).toBe(401)
  })

  test('a key that cannot sign is rejected outright', async () => {
    const verifyOnly = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    expect(signJwt({}, verifyOnly)).rejects.toThrow(/sign/)
    expect(signJwt({}, rsaPem)).rejects.toThrow()
    expect(signJwt({}, secret, { algorithm: 'RS256' })).rejects.toThrow(/no supported algorithm/)
  })
})
