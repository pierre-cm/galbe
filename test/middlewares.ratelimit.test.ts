import { describe, expect, test } from 'bun:test'
import { $T, Galbe } from '../src'
import { rateLimit, type RateLimitInfo } from '../src/middlewares'

/** Buckets are keyed per test, so one test's spending cannot throttle another's. */
const byClient = (ctx: { request: Request }) => ctx.request.headers.get('x-client') ?? undefined

describe('rateLimit middleware', async () => {
  const port = 7404
  const galbe = new Galbe()
  const seen: RateLimitInfo[] = []

  galbe.middleware('/burst/*', rateLimit({ limit: 3, window: 60, key: byClient }))
  galbe.middleware('/refill/*', rateLimit({ limit: 2, window: 0.4, key: byClient }))
  galbe.middleware('/bounded/*', rateLimit({ limit: 1, window: 60, maxKeys: 2, key: byClient }))
  galbe.middleware('/quiet/*', rateLimit({ limit: 1, window: 60, key: byClient, headers: false }))
  galbe.middleware('/exempt/*', rateLimit({ limit: 1, window: 60, key: ctx => byClient(ctx)?.replace('free-', '') }))
  galbe.middleware(
    '/custom/*',
    rateLimit({
      limit: 1,
      window: 60,
      key: byClient,
      errorHandler: info => {
        seen.push(info)
        return new Response('slow down', { status: 418 })
      },
    })
  )
  // a handler that only observes must not be able to lift the limit
  galbe.middleware('/silent/*', rateLimit({ limit: 1, window: 60, key: byClient, errorHandler: () => {} }))
  // two limiters over one route: each instance is its own bucket
  galbe.middleware('/outer/*', rateLimit({ limit: 5, window: 60, key: byClient }))
  galbe.middleware('/outer/inner/*', rateLimit({ limit: 1, window: 60, key: byClient }))

  for (const p of ['/burst/x', '/refill/x', '/bounded/x', '/quiet/x', '/exempt/x', '/custom/x'])
    galbe.get(p, () => 'ok')
  galbe.get('/silent/x', () => 'ok')
  galbe.get('/outer/x', () => 'ok')
  galbe.get('/outer/inner/x', () => 'ok')
  galbe.post('/burst/items', { body: { 'application/json': $T.object({ n: $T.integer() }) } }, () => 'ok')

  await galbe.listen(port)
  const get = (path: string, client: string) =>
    fetch(`http://127.0.0.1:${port}${path}`, { headers: { 'x-client': client } })

  test('requests inside the limit pass and the next one is refused', async () => {
    for (let i = 0; i < 3; i++) expect((await get('/burst/x', 'steady')).status).toBe(200)
    const refused = await get('/burst/x', 'steady')
    expect(refused.status).toBe(429)
    expect(await refused.text()).toBe('Too Many Requests')
    expect((await get('/burst/x', 'steady')).status).toBe(429)
  })

  test('a refusal says how long to wait for', async () => {
    for (let i = 0; i < 3; i++) await get('/burst/x', 'patient')
    const refused = await get('/burst/x', 'patient')
    // 3 tokens per minute: one token comes back 20s after the bucket empties
    expect(refused.headers.get('retry-after')).toBe('20')
  })

  test('the RateLimit headers count the bucket down, on refusals too', async () => {
    const first = await get('/burst/x', 'counted')
    expect(first.headers.get('ratelimit-limit')).toBe('3')
    expect(first.headers.get('ratelimit-remaining')).toBe('2')
    expect(first.headers.get('ratelimit-reset')).toBe('20')
    expect((await get('/burst/x', 'counted')).headers.get('ratelimit-remaining')).toBe('1')
    expect((await get('/burst/x', 'counted')).headers.get('ratelimit-remaining')).toBe('0')
    const refused = await get('/burst/x', 'counted')
    expect(refused.status).toBe(429)
    expect(refused.headers.get('ratelimit-remaining')).toBe('0')
    expect(refused.headers.get('ratelimit-limit')).toBe('3')
    expect(refused.headers.get('ratelimit-reset')).toBe('60')
  })

  test('headers: false emits none of them', async () => {
    const response = await get('/quiet/x', 'silent')
    expect(response.status).toBe(200)
    expect(response.headers.get('ratelimit-limit')).toBe(null)
    expect(response.headers.get('ratelimit-remaining')).toBe(null)
    const refused = await get('/quiet/x', 'silent')
    expect(refused.status).toBe(429)
    expect(refused.headers.get('ratelimit-limit')).toBe(null)
    expect(refused.headers.get('retry-after')).toBe('60')
  })

  test('one key running out leaves every other key untouched', async () => {
    for (let i = 0; i < 3; i++) expect((await get('/burst/x', 'noisy')).status).toBe(200)
    expect((await get('/burst/x', 'noisy')).status).toBe(429)
    const neighbour = await get('/burst/x', 'quiet-neighbour')
    expect(neighbour.status).toBe(200)
    expect(neighbour.headers.get('ratelimit-remaining')).toBe('2')
  })

  test('tokens come back as the window elapses', async () => {
    // 2 tokens per 400ms: one token back every 200ms
    expect((await get('/refill/x', 'thirsty')).status).toBe(200)
    expect((await get('/refill/x', 'thirsty')).status).toBe(200)
    expect((await get('/refill/x', 'thirsty')).status).toBe(429)
    await Bun.sleep(300)
    expect((await get('/refill/x', 'thirsty')).status).toBe(200)
    expect((await get('/refill/x', 'thirsty')).status).toBe(429)
  })

  test('the store stays bounded, at the cost of the oldest bucket', async () => {
    expect((await get('/bounded/x', 'a')).status).toBe(200)
    expect((await get('/bounded/x', 'a')).status).toBe(429)
    // two more keys, and 'a' — the oldest of three in a store that holds two — is dropped
    expect((await get('/bounded/x', 'b')).status).toBe(200)
    expect((await get('/bounded/x', 'c')).status).toBe(200)
    expect((await get('/bounded/x', 'a')).status).toBe(200)
    // eviction is not amnesia: the keys still held are still limited
    expect((await get('/bounded/x', 'c')).status).toBe(429)
  })

  test('a key function returning nothing exempts the request', async () => {
    for (let i = 0; i < 5; i++) expect((await get('/exempt/x', 'free-')).status).toBe(200)
    expect((await get('/exempt/x', 'free-billed')).status).toBe(200)
    expect((await get('/exempt/x', 'free-billed')).status).toBe(429)
  })

  test('errorHandler replaces the refusal and is told why', async () => {
    expect((await get('/custom/x', 'teapot')).status).toBe(200)
    const refused = await get('/custom/x', 'teapot')
    expect(refused.status).toBe(418)
    expect(await refused.text()).toBe('slow down')
    expect(seen).toEqual([{ key: 'teapot', limit: 1, retryAfter: 60 }])
  })

  test('an errorHandler returning nothing falls back to the default 429', async () => {
    expect((await get('/silent/x', 'lenient')).status).toBe(200)
    const refused = await get('/silent/x', 'lenient')
    expect(refused.status).toBe(429)
    expect(refused.headers.get('retry-after')).toBe('60')
  })

  test('each instance keeps its own count', async () => {
    expect((await get('/outer/inner/x', 'nested')).status).toBe(200)
    expect((await get('/outer/inner/x', 'nested')).status).toBe(429) // the inner limit of 1
    expect((await get('/outer/x', 'nested')).status).toBe(200) // the outer 5 has spent 3
    expect((await get('/outer/x', 'nested')).status).toBe(200)
    expect((await get('/outer/x', 'nested')).status).toBe(200)
    expect((await get('/outer/x', 'nested')).status).toBe(429)
  })

  test('a throttled request is refused before its body is read', async () => {
    for (let i = 0; i < 3; i++) await get('/burst/x', 'poster')
    const response = await fetch(`http://127.0.0.1:${port}/burst/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client': 'poster' },
      body: JSON.stringify({ n: 'not an integer' }),
    })
    // a 400 here would mean the body was parsed and validated before the limiter ran
    expect(response.status).toBe(429)
  })
})

describe('rateLimit default key', async () => {
  const untrusting = new Galbe()
  const trusting = new Galbe({ trustProxy: 1 })
  for (const galbe of [untrusting, trusting]) {
    galbe.middleware(rateLimit({ limit: 1, window: 60 }))
    galbe.get('/x', () => 'ok')
  }
  await untrusting.listen(7405)
  await trusting.listen(7406)
  const get = (port: number, forwarded?: string) =>
    fetch(`http://127.0.0.1:${port}/x`, forwarded ? { headers: { 'x-forwarded-for': forwarded } } : undefined)

  test('without trustProxy, a spoofed X-Forwarded-For does not open a fresh bucket', async () => {
    expect((await get(7405, '203.0.113.1')).status).toBe(200)
    expect((await get(7405, '203.0.113.2')).status).toBe(429)
    expect((await get(7405, '203.0.113.3')).status).toBe(429)
    expect((await get(7405)).status).toBe(429)
  })

  test('with trustProxy, each forwarded client gets its own bucket', async () => {
    expect((await get(7406, '203.0.113.1')).status).toBe(200)
    expect((await get(7406, '203.0.113.1')).status).toBe(429)
    expect((await get(7406, '203.0.113.2')).status).toBe(200)
    expect((await get(7406, '203.0.113.2')).status).toBe(429)
  })
})

describe('rateLimit configuration', () => {
  test('an unusable limiter is rejected at registration', () => {
    expect(() => rateLimit({ limit: 0, window: 60 })).toThrow(SyntaxError)
    expect(() => rateLimit({ limit: -1, window: 60 })).toThrow(SyntaxError)
    expect(() => rateLimit({ limit: Infinity, window: 60 })).toThrow(SyntaxError)
    expect(() => rateLimit({ limit: 1, window: 0 })).toThrow(SyntaxError)
    expect(() => rateLimit({ limit: 1, window: -60 })).toThrow(SyntaxError)
    expect(() => rateLimit({ limit: 1, window: 60, maxKeys: 0 })).toThrow(SyntaxError)
    expect(() => rateLimit({ limit: 1, window: 60, maxKeys: 1.5 })).toThrow(SyntaxError)
    expect(() => rateLimit({ limit: 1, window: 0.5, maxKeys: 1 })).not.toThrow()
  })

  test('it contributes no schema fragment and no security metadata', () => {
    const def = rateLimit({ limit: 1, window: 60 })
    expect(def.schema).toBeUndefined()
    expect(def.security).toBeUndefined()
    expect(def.hooks).toBeUndefined()
    expect(def.beforeParse).toBeInstanceOf(Function)
  })
})
