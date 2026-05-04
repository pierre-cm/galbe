import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { Galbe, $T } from '../src'
import { instanciateRoutes } from '../bin/util'
import { walkRoutes } from '../src/util'
import { schemaToTypeStr, Kind, Optional, Stream } from '../src/schema'
import { generateClientCode } from '../bin/commands/generate/client'
import type { GalbeClientRoute } from '../src'
import type { STResponse, STResponseEntry, STResponseContent } from '../src/types'
import type { STSchema } from '../src/schema'

// ─── test server ──────────────────────────────────────────────────────────────

const PORT = 47220
const captured: { method: string; url: string; body: string; headers: Record<string, string> }[] = []
let server: ReturnType<typeof Bun.serve>

// ─── helpers duplicated from generator (kept minimal) ─────────────────────────

const MIME_SHORT: Record<string, string> = {
  'application/json': 'json',
  'application/x-www-form-urlencoded': 'urlForm',
  'multipart/form-data': 'multipart',
  'application/octet-stream': 'byteArray',
  'text/plain': 'text',
  '*/*': 'raw',
}
const mimeToShort = (mime: string) => MIME_SHORT[mime] ?? (mime.startsWith('text/') ? 'text' : 'raw')
const isResponseValue = (e: STResponseEntry) => Kind in (e as any) && typeof (e as any)[Kind] === 'string'
const deriveOperationId = (method: string, path: string) =>
  `${method}-${path.replace(/\//g, '-').replace(/:/g, '').replace(/^-/, '').replace(/-+/g, '-').replace(/-$/, '')}`

const buildRoutes = (g: Galbe, metaRoutes?: Record<string, any>): GalbeClientRoute[] => {
  const routes: GalbeClientRoute[] = []
  walkRoutes(g.router.routes, r => {
    const meta = metaRoutes?.[r.path]?.[r.method]
    const operationId = meta?.operationId ?? deriveOperationId(r.method, r.path)
    const autoDerived = !meta?.operationId

    let body: Record<string, STSchema> | null = null
    const rawBody = r.schema.body as any
    if (rawBody && (rawBody as STSchema)[Kind] !== 'null') {
      body = {}
      for (const [mime, s] of Object.entries(rawBody)) {
        if (!mime.includes('/') || !s) continue
        body[mimeToShort(mime)] = s as STSchema
      }
      if (!Object.keys(body).length) body = null
    }

    const query: GalbeClientRoute['query'] = {}
    for (const [k, s] of Object.entries((r.schema.query ?? {}) as Record<string, STSchema>)) {
      query[k] = { type: schemaToTypeStr({ ...s, [Optional]: false }), optional: !!(s as any)[Optional] }
    }

    routes.push({
      method: r.method,
      path: r.path,
      operationId,
      autoDerived,
      params: Object.fromEntries(
        [...r.path.matchAll(/:([^/]+)/g)].map(m => {
          const ps = (r.schema.params as Record<string, STSchema>)?.[m[1]]
          return [m[1], { type: ps ? schemaToTypeStr(ps) : 'string' }]
        })
      ),
      query,
      headers: {},
      body,
      response: (r.schema.response as STResponse) ?? null,
      tags: meta?.tags ?? [],
    })
  })
  return routes
}

// ─── test galbe app ───────────────────────────────────────────────────────────

const g = new Galbe()

// explicit operationId via meta (simulated via a manual meta map)
const META: Record<string, Record<string, { operationId?: string }>> = {
  '/users': { get: { operationId: 'listUsers' }, post: { operationId: 'createUser' } },
  '/users/:id': { get: { operationId: 'getUser' } },
  '/ping': { get: {} }, // no operationId → auto-derived
}

g.get(
  '/users',
  {
    query: { page: $T.optional($T.number()) },
    response: { 200: $T.array($T.object({ id: $T.string(), name: $T.string() })) },
  },
  () => {}
)

g.post(
  '/users',
  {
    body: { 'application/json': $T.object({ name: $T.string() }) },
    response: {
      200: $T.object({ id: $T.string(), name: $T.string() }),
      400: $T.object({ error: $T.string() }),
    },
  },
  () => {}
)

g.get(
  '/users/:id',
  {
    params: { id: $T.string() },
    response: {
      200: $T.object({ id: $T.string(), name: $T.string() }),
      404: $T.object({ error: $T.string() }),
    },
  },
  () => {}
)

g.get('/ping', {}, () => {})

// ─── setup / teardown ─────────────────────────────────────────────────────────

let tmpDir: string
let clientPath: string
let client: any

beforeAll(async () => {
  await instanciateRoutes(g)
  await g.init()

  const routes = buildRoutes(g, META)
  const runtimeContent = await Bun.file(resolve(__dirname, '../bin/res/client.runtime.ts')).text()

  const code = await generateClientCode({
    routes,
    namedTypes: {},
    className: 'TestClient',
    version: '0.0.0',
    runtimeContent,
  })

  tmpDir = await mkdtemp(resolve(tmpdir(), 'galbe-client-test-'))
  clientPath = resolve(tmpDir, 'client.ts')
  await Bun.write(clientPath, code)

  server = Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url)
      const body = req.body ? await new Response(req.body).text() : ''
      const headers: Record<string, string> = {}
      req.headers.forEach((v, k) => { headers[k] = v })
      captured.push({ method: req.method, url: url.pathname + url.search, body, headers })

      if (req.method === 'GET' && url.pathname === '/users') {
        return new Response(JSON.stringify([{ id: '1', name: 'Alice' }]), {
          headers: { 'content-type': 'application/json' },
        })
      }
      if (req.method === 'POST' && url.pathname === '/users') {
        const b = JSON.parse(body)
        return new Response(JSON.stringify({ id: '2', name: b.name }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      if (req.method === 'GET' && url.pathname.startsWith('/users/')) {
        const id = url.pathname.split('/')[2]
        if (id === 'missing') return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
        return new Response(JSON.stringify({ id, name: 'Alice' }), { headers: { 'content-type': 'application/json' } })
      }
      if (req.method === 'GET' && url.pathname === '/ping') {
        return new Response('pong', { headers: { 'content-type': 'text/plain' } })
      }
      return new Response('not found', { status: 404 })
    },
  })

  const mod = await import(clientPath)
  client = new mod.default({ server: { url: `http://localhost:${PORT}` } })
})

afterAll(async () => {
  server?.stop()
  if (tmpDir) await rm(tmpDir, { recursive: true })
})

// ─── simple API ───────────────────────────────────────────────────────────────

describe('simple API — happy paths', () => {
  test('listUsers(): returns array body directly', async () => {
    captured.length = 0
    const users = await client.listUsers()
    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('GET')
    expect(captured[0].url).toContain('/users')
    expect(users).toEqual([{ id: '1', name: 'Alice' }])
  })

  test('listUsers({ query: { page: 2 } }): serialises query param', async () => {
    captured.length = 0
    await client.listUsers({ query: { page: 2 } })
    expect(captured[0].url).toContain('page=2')
  })

  test('createUser(body): sends JSON body, returns created user', async () => {
    captured.length = 0
    const user = await client.createUser({ name: 'Bob' })
    expect(captured[0].method).toBe('POST')
    expect(JSON.parse(captured[0].body)).toEqual({ name: 'Bob' })
    expect(captured[0].headers['content-type']).toContain('application/json')
    expect(user).toEqual({ id: '2', name: 'Bob' })
  })

  test('getUser(id): path param is interpolated', async () => {
    captured.length = 0
    const user = await client.getUser('abc')
    expect(captured[0].url).toContain('/users/abc')
    expect(user).toEqual({ id: 'abc', name: 'Alice' })
  })

  test('auto-derived operationId: get-ping is callable', async () => {
    captured.length = 0
    const result = await client['get-ping']()
    expect(captured[0].url).toBe('/ping')
    expect(result).toBe('pong')
  })
})

// ─── simple API — errors ──────────────────────────────────────────────────────

describe('simple API — error handling', () => {
  test('throws GalbeClientError on non-2xx', async () => {
    let err: any
    try { await client.getUser('missing') } catch (e) { err = e }
    expect(err).toBeDefined()
    expect(err.name).toBe('GalbeClientError')
    expect(err.status).toBe(404)
    expect(typeof err.body).toBe('string')
  })

  test('GalbeClientError.body is pre-consumed text', async () => {
    let err: any
    try { await client.getUser('missing') } catch (e) { err = e }
    expect(err.body).toContain('not found')
  })
})

// ─── .safe() API ─────────────────────────────────────────────────────────────

describe('.safe() API', () => {
  test('returns { ok: true, data } on 2xx', async () => {
    const result = await client.listUsers().safe()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([{ id: '1', name: 'Alice' }])
  })

  test('returns { ok: false, error } on non-2xx with parsed body', async () => {
    const result = await client.getUser('missing').safe()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(404)
      expect(result.error.body).toEqual({ error: 'not found' })
    }
  })

  test('.safe() does not consume the main .then() path', async () => {
    // Both paths should work independently
    const safeResult = await client.listUsers().safe()
    const directResult = await client.listUsers()
    expect(safeResult.ok).toBe(true)
    expect(directResult).toEqual([{ id: '1', name: 'Alice' }])
  })
})

// ─── $raw API ────────────────────────────────────────────────────────────────

describe('$raw API', () => {
  test('$raw.listUsers() returns full response object with status', async () => {
    const resp = await client.$raw.listUsers()
    expect(resp.status).toBe(200)
    expect(resp.ok).toBe(true)
    expect(resp.headers).toBeDefined()
  })

  test('$raw.listUsers().body.json() parses JSON body', async () => {
    const resp = await client.$raw.listUsers()
    const body = await resp.body.json()
    expect(body).toEqual([{ id: '1', name: 'Alice' }])
  })

  test('$raw.getUser() on 404 returns status 404 with ok=false', async () => {
    const resp = await client.$raw.getUser('missing')
    expect(resp.status).toBe(404)
    expect(resp.ok).toBe(false)
  })

  test('$raw.getUser("missing").body.json() returns error payload', async () => {
    const resp = await client.$raw.getUser('missing')
    const body = await resp.body.json()
    expect(body).toEqual({ error: 'not found' })
  })
})

// ─── code shape ──────────────────────────────────────────────────────────────

describe('generated code shape', () => {
  test('generated file is valid TypeScript (no import errors)', async () => {
    // Already verified by the import above — if beforeAll succeeded, TypeScript compiled fine
    expect(client).toBeDefined()
  })

  test('class is named TestClient', async () => {
    const mod = await import(clientPath)
    expect(mod.default.name).toBe('TestClient')
  })

  test('GalbeClientError is exported', async () => {
    const mod = await import(clientPath)
    expect(typeof mod.GalbeClientError).toBe('function')
  })
})

// ─── config transform ─────────────────────────────────────────────────────────

describe('config transform', () => {
  test('transform can rename operationIds', async () => {
    const routes = buildRoutes(g, META)
    const runtimeContent = await Bun.file(resolve(__dirname, '../bin/res/client.runtime.ts')).text()

    const code = await generateClientCode({
      routes: routes.map(r => ({ ...r, operationId: r.operationId === 'listUsers' ? 'getAllUsers' : r.operationId })),
      namedTypes: {},
      className: 'TransformedClient',
      version: '0.0.0',
      runtimeContent,
    })

    const transformedPath = resolve(tmpDir, 'transformed.ts')
    await Bun.write(transformedPath, code)
    const mod = await import(transformedPath)
    const c = new mod.default({ server: { url: `http://localhost:${PORT}` } })
    expect(typeof c.getAllUsers).toBe('function')
  })

  test('transform can filter routes', async () => {
    const routes = buildRoutes(g, META)
    const runtimeContent = await Bun.file(resolve(__dirname, '../bin/res/client.runtime.ts')).text()

    const code = await generateClientCode({
      routes: routes.filter(r => r.operationId === 'listUsers'),
      namedTypes: {},
      className: 'FilteredClient',
      version: '0.0.0',
      runtimeContent,
    })

    const filteredPath = resolve(tmpDir, 'filtered.ts')
    await Bun.write(filteredPath, code)
    const mod = await import(filteredPath)
    const c = new mod.default({ server: { url: `http://localhost:${PORT}` } })
    expect(typeof c.listUsers).toBe('function')
    expect(typeof c.createUser).toBe('undefined')
  })
})
