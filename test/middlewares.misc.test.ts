import { describe, expect, test } from 'bun:test'
import { $T, Galbe, NotFoundError, RequestError } from '../src'
import { bearer, logger, requestId, timing, type LogEntry } from '../src/middlewares'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('requestId middleware', async () => {
  const port = 7407
  const galbe = new Galbe()

  galbe.middleware(requestId())
  galbe.middleware('/secure/*', bearer({ token: 'letmein' }))
  galbe.middleware('/named/*', requestId({ header: 'x-correlation-id', stateHolder: 'correlationId' }))
  galbe.middleware('/own/*', requestId({ trustHeader: false, generate: () => 'generated' }))

  galbe.get('/echo', ctx => ctx.state.requestId)
  galbe.get('/named/echo', ctx => ctx.state.correlationId)
  galbe.get('/own/echo', ctx => ctx.state.requestId)
  galbe.get('/secure/x', () => 'ok')
  galbe.get('/strict', { headers: { 'x-need': $T.string() } }, () => 'ok')

  await galbe.listen(port)
  const get = (path: string, headers?: Record<string, string>) => fetch(`http://localhost:${port}${path}`, { headers })

  test('an id is generated, carried on the state and echoed back', async () => {
    const response = await get('/echo')
    const id = response.headers.get('x-request-id')
    expect(id).toMatch(UUID)
    expect(await response.text()).toBe(id!)
  })

  test('a usable inbound id is reused, so a trace spans services', async () => {
    const response = await get('/echo', { 'x-request-id': 'trace-42:abc.def' })
    expect(response.headers.get('x-request-id')).toBe('trace-42:abc.def')
    expect(await response.text()).toBe('trace-42:abc.def')
  })

  test('an id that could break a header or a log line is replaced', async () => {
    for (const bad of ['has space', 'quote"d', 'semi;colon', 'x'.repeat(129), '']) {
      const response = await get('/echo', { 'x-request-id': bad })
      expect(response.headers.get('x-request-id')).toMatch(UUID)
    }
  })

  test('trustHeader: false ignores the caller entirely', async () => {
    const response = await get('/own/echo', { 'x-request-id': 'client-chosen' })
    expect(response.headers.get('x-request-id')).toBe('generated')
    expect(await response.text()).toBe('generated')
  })

  test('the header name and the state key are configurable', async () => {
    const response = await get('/named/echo', { 'x-correlation-id': 'from-gateway' })
    expect(response.headers.get('x-correlation-id')).toBe('from-gateway')
    expect(await response.text()).toBe('from-gateway')
  })

  test('a generator that returns something a header cannot carry is named', async () => {
    const g = new Galbe()
    g.middleware(requestId({ trustHeader: false, generate: () => 'not a header value' }))
    g.get('/x', () => 'ok')
    await g.listen(7420)

    const response = await fetch('http://localhost:7420/x')
    expect(response.status).toBe(500)
  })

  test('rejected requests carry the id too, which is the point of running first', async () => {
    const unauthorized = await get('/secure/x')
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.headers.get('x-request-id')).toMatch(UUID)

    const invalid = await get('/strict')
    expect(invalid.status).toBe(400)
    expect(invalid.headers.get('x-request-id')).toMatch(UUID)
  })

  test('a trusting instance declares the header it reads, a distrusting one declares nothing', () => {
    expect(requestId().schema).toEqual({ headers: { 'x-request-id': $T.optional($T.string()) } })
    expect(requestId({ header: 'x-trace' }).schema).toEqual({ headers: { 'x-trace': $T.optional($T.string()) } })
    expect(requestId({ trustHeader: false }).schema).toBeUndefined()
  })
})

describe('logger middleware', async () => {
  const port = 7408
  const galbe = new Galbe()
  const entries: LogEntry[] = []

  galbe.middleware(requestId())
  galbe.middleware(logger({ log: entry => entries.push(entry), skip: ctx => ctx.route?.path === '/health' }))
  galbe.middleware('/secure/*', bearer({ token: 'letmein' }))

  galbe.get('/secure/x', () => 'ok')
  galbe.get('/strict', { headers: { 'x-need': $T.string() } }, () => 'ok')
  galbe.get('/ok', () => 'ok')
  galbe.get('/health', () => 'up')
  galbe.get('/created', ctx => {
    ctx.set.status = 201
    return 'made'
  })
  galbe.get('/raw', () => new Response('teapot', { status: 418 }))
  galbe.get('/short', [() => new Response('gone', { status: 410 })], () => 'never')
  galbe.get('/missing', () => {
    throw new NotFoundError()
  })
  galbe.get('/broken', () => {
    throw new Error('boom')
  })
  galbe.post('/items', { body: { 'application/json': $T.object({ n: $T.integer() }) } }, () => 'ok')

  await galbe.listen(port)
  const get = (path: string) => fetch(`http://localhost:${port}${path}`)
  const last = () => entries.at(-1)!

  test('a finished request is logged with its method, path and status', async () => {
    await get('/ok')
    expect(last().method).toBe('GET')
    expect(last().path).toBe('/ok')
    expect(last().status).toBe(200)
    expect(last().error).toBeUndefined()
    expect(last().duration).toBeGreaterThanOrEqual(0)
  })

  test('the status logged is the one the request ended on', async () => {
    await get('/created')
    expect(last().status).toBe(201)
    await get('/raw')
    expect(last().status).toBe(418)
    await get('/short')
    expect(last().status).toBe(410)
  })

  test('a request that ends on an error is logged with its status and the error', async () => {
    const notFound = await get('/missing')
    expect(notFound.status).toBe(404)
    expect(last().status).toBe(404)
    expect(last().error).toBeInstanceOf(NotFoundError)

    const broken = await get('/broken')
    expect(broken.status).toBe(500)
    expect(last().status).toBe(500)
    expect((last().error as Error).message).toBe('boom')
  })

  test('the query string is left out of the logged path', async () => {
    await get('/ok?token=super-secret&page=2')
    expect(last().path).toBe('/ok')
  })

  test('the request id is picked up when requestId runs ahead', async () => {
    const response = await get('/ok')
    expect(last().requestId).toBe(response.headers.get('x-request-id')!)
  })

  test('skip leaves a request unlogged', async () => {
    const before = entries.length
    await get('/health')
    expect(entries.length).toBe(before)
  })

  test('a request rejected before the chain is logged: it is the traffic an access log is for', async () => {
    const invalid = await fetch(`http://localhost:${port}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ n: 'not an integer' }),
    })
    expect(invalid.status).toBe(400)
    expect(last().status).toBe(400)
    expect(last().path).toBe('/items')
    expect(last().error).toBeInstanceOf(RequestError)
  })

  test('an auth rejection is logged with the status it ended on', async () => {
    const rejected = await get('/secure/x')
    expect(rejected.status).toBe(401)
    expect(last().status).toBe(401)
    expect((last().error as any).status).toBe(401)
    // and the id still makes it onto the line: requestId runs in the same slot
    expect(last().requestId).toBe(rejected.headers.get('x-request-id')!)

    const strict = await get('/strict')
    expect(strict.status).toBe(400)
    expect(last().status).toBe(400)
  })

  test('the default logger writes one console line per request', async () => {
    const written: string[] = []
    const original = console.log
    console.log = (line: string) => written.push(line)
    try {
      const solo = new Galbe()
      solo.middleware(logger())
      solo.get('/x', () => 'ok')
      await solo.listen(7409)
      await fetch('http://localhost:7409/x')
    } finally {
      console.log = original
    }
    const line = written.find(l => l.includes('/x'))
    expect(line).toBeDefined()
    expect(line!.replaceAll(/\x1b\[[0-9;]*m/g, '')).toMatch(/^GET \/x 200 \d+\.\dms$/)
  })
})

describe('timing middleware', async () => {
  const port = 7410
  const galbe = new Galbe()

  galbe.middleware('/plain/*', timing())
  galbe.middleware('/named/*', timing({ name: 'api', description: 'handler', precision: 3 }))
  galbe.middleware('/quiet/*', timing({ skip: ctx => ctx.set.status === 204 }))

  galbe.get('/plain/fast', () => 'ok')
  galbe.get('/plain/slow', async () => {
    await Bun.sleep(20)
    return 'ok'
  })
  galbe.get('/plain/measured', ctx => {
    ctx.set.headers['server-timing'] = 'db;dur=5'
    return 'ok'
  })
  galbe.get('/plain/missing', () => {
    throw new NotFoundError()
  })
  galbe.get('/plain/strict', { headers: { 'x-need': $T.string() } }, () => 'ok')
  galbe.get('/named/x', () => 'ok')
  galbe.get('/quiet/empty', ctx => {
    ctx.set.status = 204
    return null
  })
  galbe.get('/quiet/x', () => 'ok')

  await galbe.listen(port)
  const get = (path: string) => fetch(`http://localhost:${port}${path}`)

  test('the response reports how long the server took', async () => {
    const header = (await get('/plain/fast')).headers.get('server-timing')
    expect(header).toMatch(/^total;dur=\d+\.\d$/)
  })

  test('the duration is the real one', async () => {
    const header = (await get('/plain/slow')).headers.get('server-timing')
    expect(Number(header!.match(/dur=([\d.]+)/)![1])).toBeGreaterThanOrEqual(20)
  })

  test('a measurement the route took is kept alongside', async () => {
    const header = (await get('/plain/measured')).headers.get('server-timing')
    expect(header).toMatch(/^db;dur=5, total;dur=\d+\.\d$/)
  })

  test('an error response is measured as well', async () => {
    const response = await get('/plain/missing')
    expect(response.status).toBe(404)
    expect(response.headers.get('server-timing')).toMatch(/^total;dur=/)
  })

  test('a request rejected before the chain is measured too', async () => {
    const response = await get('/plain/strict')
    expect(response.status).toBe(400)
    expect(response.headers.get('server-timing')).toMatch(/^total;dur=/)
  })

  test('the name, description and precision are configurable', async () => {
    const header = (await get('/named/x')).headers.get('server-timing')
    expect(header).toMatch(/^api;dur=\d+\.\d{3};desc="handler"$/)
  })

  test('skip sees the finished request', async () => {
    expect((await get('/quiet/empty')).headers.get('server-timing')).toBe(null)
    expect((await get('/quiet/x')).headers.get('server-timing')).toMatch(/^total;dur=/)
  })

  test('a header the response could not carry is rejected at registration', () => {
    expect(() => timing({ precision: -1 })).toThrow(SyntaxError)
    expect(() => timing({ precision: 1.5 })).toThrow(SyntaxError)
    expect(() => timing({ precision: 7 })).toThrow(SyntaxError)
    expect(() => timing({ description: 'say "hi"' })).toThrow(SyntaxError)
    expect(() => timing({ description: 'line\nbreak' })).toThrow(SyntaxError)
    expect(() => timing({ name: 'not a token' })).not.toThrow()
  })

  test('a name that is not a token is made into one', async () => {
    const solo = new Galbe()
    solo.middleware(timing({ name: 'my handler' }))
    solo.get('/x', () => 'ok')
    await solo.listen(7411)
    expect((await fetch('http://localhost:7411/x')).headers.get('server-timing')).toMatch(/^my-handler;dur=/)
  })
})
