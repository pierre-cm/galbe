import { describe, expect, test } from 'bun:test'
import { $T, Galbe, NotFoundError, RequestError, UnauthorizedError } from '../src'
import type { GalbePlugin } from '../src/types'
import { OpenAPISerializer } from '../src/extras/spec/openapi.serializer'
import { Kind } from '../src/schema'
import { Compiled } from '../src/validator.compile'

describe('middleware', async () => {
  const port = 7376
  const galbe = new Galbe()
  await galbe.listen(port)
  const get = (path: string) => fetch(`http://localhost:${port}${path}`)

  test('prefix middleware runs only for matching routes', async () => {
    const calls: string[] = []
    galbe.middleware('/mw/*', ctx => {
      calls.push(ctx.route!.path)
    })
    galbe.get('/mw/a', () => 'a')
    galbe.get('/mw/a/b', () => 'b')
    galbe.get('/mw-other', () => 'other')

    for (const p of ['/mw/a', '/mw/a/b', '/mw-other']) expect((await get(p)).status).toBe(200)
    expect(calls).toEqual(['/mw/a', '/mw/a/b'])
  })

  test('trailing wildcard matches the prefix itself', async () => {
    let count = 0
    galbe.middleware('/pre/*', () => {
      count++
    })
    galbe.get('/pre', () => 'root')
    galbe.get('/pre/x', () => 'x')

    await get('/pre')
    await get('/pre/x')
    expect(count).toBe(2)
  })

  test('exact pattern does not match the subtree', async () => {
    let count = 0
    galbe.middleware('/exact', () => {
      count++
    })
    galbe.get('/exact', () => 'e')
    galbe.get('/exact/sub', () => 's')

    await get('/exact')
    await get('/exact/sub')
    expect(count).toBe(1)
  })

  test("'*' segment matches param segments", async () => {
    let count = 0
    galbe.middleware('/users/*/profile', () => {
      count++
    })
    galbe.get('/users/:id/profile', () => 'profile')
    galbe.get('/users/:id/settings', () => 'settings')

    await get('/users/42/profile')
    await get('/users/42/settings')
    expect(count).toBe(1)
  })

  test('middleware short-circuit response preempts hooks and handler', async () => {
    galbe.middleware('/short/*', () => 'stopped')
    galbe.get(
      '/short',
      [
        () => {
          expect.unreachable()
        },
      ],
      () => {
        expect.unreachable()
      }
    )

    const resp = await get('/short')
    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe('stopped')
  })

  test('middleware errors map like hook errors', async () => {
    galbe.middleware('/auth/*', () => {
      throw new UnauthorizedError()
    })
    galbe.get('/auth/secret', () => 'secret')

    expect((await get('/auth/secret')).status).toBe(401)
  })

  test('middleware can pass state to the handler', async () => {
    galbe.middleware('/state/*', ctx => {
      ctx.state.user = 'mom'
    })
    galbe.get('/state', ctx => `Hello ${ctx.state.user}!`)

    expect(await (await get('/state')).text()).toBe('Hello mom!')
  })

  test('middleware declared after route registration applies', async () => {
    let count = 0
    galbe.get('/late/x', () => 'x')
    await get('/late/x')
    expect(count).toBe(0)

    galbe.middleware('/late/*', () => {
      count++
    })
    await get('/late/x')
    expect(count).toBe(1)
  })

  test('invalid patterns throw SyntaxError', () => {
    expect(() => galbe.middleware('/a/:id/*', () => {})).toThrow(SyntaxError)
    expect(() => galbe.middleware('/a/b*', () => {})).toThrow(SyntaxError)
    expect(() => galbe.middleware('', () => {})).toThrow(SyntaxError)
  })
})

describe('middleware schema fragments', async () => {
  const port = 7380
  const galbe = new Galbe()
  await galbe.listen(port)
  const get = (path: string, init?: RequestInit) => fetch(`http://localhost:${port}${path}`, init)
  const schemaOf = (path: string) => galbe.router.find('get', path).schema

  test('fragment lands on matched routes only', async () => {
    galbe.middleware('/frag/*', { schema: { headers: { 'x-key': $T.string() } } })
    galbe.get('/frag/a', () => 'a')
    galbe.get('/frag-other', () => 'other')

    expect(Object.keys(schemaOf('/frag/a').headers ?? {})).toEqual(['x-key'])
    expect(schemaOf('/frag-other').headers).toBeUndefined()
    expect((await get('/frag/a')).status).toBe(400)
    expect((await get('/frag/a', { headers: { 'x-key': 'k' } })).status).toBe(200)
    expect((await get('/frag-other')).status).toBe(200)
  })

  test('route-declared keys win over fragments', async () => {
    galbe.middleware('/win/*', { schema: { headers: { 'x-num': $T.string() } } })
    galbe.get('/win/a', { headers: { 'x-num': $T.integer() } }, ctx => typeof ctx.headers['x-num'])

    expect(await (await get('/win/a', { headers: { 'x-num': '42' } })).text()).toBe('number')
    expect((await get('/win/a', { headers: { 'x-num': 'nope' } })).status).toBe(400)
  })

  test('fragments merge for middleware registered after the routes', async () => {
    galbe.get('/late-frag', () => 'ok')
    expect((await get('/late-frag')).status).toBe(200)

    galbe.middleware('/late-frag', { schema: { query: { q: $T.string() } } })
    expect((await get('/late-frag')).status).toBe(400)
    expect((await get('/late-frag?q=1')).status).toBe(200)
  })

  test('repeated recomposition is idempotent', async () => {
    galbe.middleware('/idem/*', { hooks: () => {}, schema: { headers: { 'x-a': $T.optional($T.string()) } } })
    galbe.get('/idem/a', { headers: { 'x-b': $T.optional($T.string()) } }, () => 'ok')
    const merged = { ...schemaOf('/idem/a').headers }

    // any later matching registration recomposes the route
    galbe.middleware('/idem/*', () => {})
    galbe.middleware('/idem/a', () => {})

    expect(schemaOf('/idem/a').headers).toEqual(merged)
    expect((await get('/idem/a')).status).toBe(200)
  })

  test('a fragment registered after the route wins over an earlier one, as when both precede it', async () => {
    galbe.middleware('/order/*', { schema: { headers: { 'x-k': $T.optional($T.string()) } } })
    galbe.get('/order/a', () => 'ok')
    galbe.middleware('/order/*', { schema: { headers: { 'x-k': $T.integer() } } })

    expect((schemaOf('/order/a').headers as Record<string, any>)['x-k'][Kind]).toBe('integer')
    expect((await get('/order/a', { headers: { 'x-k': '1' } })).status).toBe(200)
    expect((await get('/order/a', { headers: { 'x-k': 'nope' } })).status).toBe(400)
  })

  test('fragment-declared params are validated by a compiled validator', async () => {
    galbe.middleware('/tenant/*', { schema: { params: { tid: $T.integer() } } })
    galbe.get('/tenant/:tid', ctx => typeof ctx.params.tid)

    expect((schemaOf('/tenant/7').params as Record<string, any>)?.tid?.[Compiled]).toBeDefined()
    expect(await (await get('/tenant/7')).text()).toBe('number')
    expect((await get('/tenant/abc')).status).toBe(400)
  })

  test('a shared schema object is not contaminated across routes', async () => {
    const schema = { headers: { 'x-own': $T.optional($T.string()) } }
    galbe.middleware('/shared/in/*', { schema: { headers: { 'x-frag': $T.string() } } })
    galbe.get('/shared/in/a', schema, () => 'in')
    galbe.get('/shared/out', schema, () => 'out')

    expect(Object.keys(schema.headers)).toEqual(['x-own'])
    expect(Object.keys(schemaOf('/shared/in/a').headers ?? {})).toEqual(['x-frag', 'x-own'])
    expect((await get('/shared/out')).status).toBe(200)
  })
})

describe('middleware beforeParse', async () => {
  const port = 7381
  const galbe = new Galbe()
  await galbe.listen(port)
  const get = (path: string) => fetch(`http://localhost:${port}${path}`)
  const post = (path: string, body: string, contentType = 'application/json') =>
    fetch(`http://localhost:${port}${path}`, { method: 'POST', headers: { 'content-type': contentType }, body })

  test('a returned Response short-circuits before hooks and handler', async () => {
    galbe.middleware('/bp/short/*', { beforeParse: () => new Response('nope', { status: 401 }) })
    galbe.get(
      '/bp/short',
      [
        () => {
          expect.unreachable()
        },
      ],
      () => {
        expect.unreachable()
      }
    )

    const resp = await get('/bp/short')
    expect(resp.status).toBe(401)
    expect(await resp.text()).toBe('nope')
  })

  test('hooks run in registration order, falling through when they return nothing', async () => {
    const calls: string[] = []
    galbe.middleware('/bp/order/*', {
      beforeParse: [
        () => {
          calls.push('a')
        },
        () => {
          calls.push('b')
        },
      ],
    })
    galbe.middleware('/bp/order/*', {
      beforeParse: () => {
        calls.push('c')
      },
    })
    galbe.get('/bp/order', () => {
      calls.push('handler')
      return 'ok'
    })

    expect((await get('/bp/order')).status).toBe(200)
    expect(calls).toEqual(['a', 'b', 'c', 'handler'])
  })

  test('a later hook does not run once one short-circuits', async () => {
    const calls: string[] = []
    galbe.middleware('/bp/stop/*', {
      beforeParse: [
        () => {
          calls.push('first')
          return new Response('halt', { status: 403 })
        },
        () => {
          calls.push('second')
        },
      ],
    })
    galbe.get('/bp/stop', () => 'ok')

    expect((await get('/bp/stop')).status).toBe(403)
    expect(calls).toEqual(['first'])
  })

  test('pattern scoping applies as it does for hooks', async () => {
    const calls: string[] = []
    galbe.middleware('/bp/scope/*', {
      beforeParse: ctx => {
        calls.push(ctx.route!.path)
      },
    })
    galbe.get('/bp/scope/a', () => 'a')
    galbe.get('/bp/scope-other', () => 'other')

    for (const p of ['/bp/scope/a', '/bp/scope-other']) expect((await get(p)).status).toBe(200)
    expect(calls).toEqual(['/bp/scope/a'])
  })

  test('a thrown RequestError maps like a hook error', async () => {
    galbe.middleware('/bp/throw/*', {
      beforeParse: () => {
        throw new UnauthorizedError()
      },
    })
    galbe.get('/bp/throw/secret', () => expect.unreachable())

    expect((await get('/bp/throw/secret')).status).toBe(401)
  })

  test('rejects before validation: 401, not 400, on a malformed body', async () => {
    galbe.middleware('/bp/guard/*', {
      beforeParse: () => {
        throw new UnauthorizedError()
      },
    })
    const schema = { body: { 'application/json': $T.object({ n: $T.integer() }) } }
    galbe.post('/bp/guard/x', schema, () => expect.unreachable())
    galbe.post('/bp/unguarded', schema, () => 'ok')

    expect((await post('/bp/unguarded', '{')).status).toBe(400)
    expect((await post('/bp/guard/x', '{')).status).toBe(401)
  })

  test('the body is never read when the slot short-circuits', async () => {
    galbe.middleware('/bp/limit/*', { beforeParse: () => new Response('', { status: 401 }) })
    const schema = { bodyLimit: 8, body: { 'text/plain': $T.string() } }
    galbe.post('/bp/limit/x', schema, () => expect.unreachable())
    galbe.post('/bp/unlimited', schema, () => 'ok')

    // a body this size is refused with 413 on the content-length check, which
    // sits after the slot: reaching 401 proves nothing of it was read
    expect((await post('/bp/unlimited', 'a'.repeat(128), 'text/plain')).status).toBe(413)
    expect((await post('/bp/limit/x', 'a'.repeat(128), 'text/plain')).status).toBe(401)
  })

  test('state set before parsing reaches the handler', async () => {
    galbe.middleware('/bp/state/*', {
      beforeParse: ctx => {
        ctx.state.user = 'mom'
      },
    })
    galbe.get('/bp/state', ctx => `Hello ${ctx.state.user}!`)

    expect(await (await get('/bp/state')).text()).toBe('Hello mom!')
  })

  test('a def registered after the routes recomposes them', async () => {
    galbe.get('/bp/late/x', () => 'x')
    expect((await get('/bp/late/x')).status).toBe(200)

    galbe.middleware('/bp/late/*', { beforeParse: () => new Response('', { status: 401 }) })
    expect((await get('/bp/late/x')).status).toBe(401)
  })

  test('composedPre stays undefined for routes with no matching beforeParse', async () => {
    galbe.middleware('/bp/cost/*', { hooks: () => {}, schema: { headers: { 'x-k': $T.optional($T.string()) } } })
    galbe.get('/bp/cost/plain', () => 'plain')
    galbe.middleware('/bp/cost/pre/*', { beforeParse: () => {} })
    galbe.get('/bp/cost/pre/a', () => 'a')

    expect(galbe.router.find('get', '/bp/cost/plain').composedPre).toBeUndefined()
    expect(galbe.router.find('get', '/bp/cost/pre/a').composedPre).toBeDefined()
  })
})

describe('middleware ordering', async () => {
  const port = 7377
  const order: string[] = []
  const galbe = new Galbe()
  await galbe.use({
    name: 'test.order',
    onRoute: () => {
      order.push('plugin:onRoute')
    },
    beforeHandle: () => {
      order.push('plugin:before')
    },
    afterHandle: () => {
      order.push('plugin:after')
    },
  })
  galbe.middleware('/ord/*', {
    beforeParse: () => {
      order.push('mw:beforeParse')
    },
  })
  galbe.middleware('/ord/*', async (_, next) => {
    order.push('mw1:in')
    await next()
    order.push('mw1:out')
  })
  galbe.middleware('/ord/*', () => {
    order.push('mw2')
  })
  galbe.get(
    '/ord',
    [
      async (_, next) => {
        order.push('hook:in')
        await next()
        order.push('hook:out')
      },
    ],
    () => {
      order.push('handler')
      return 'ok'
    }
  )
  await galbe.listen(port)

  test('plugins.onRoute → beforeParse → plugins.beforeHandle → middleware (registration order) → route hooks → handler', async () => {
    const resp = await fetch(`http://localhost:${port}/ord`)
    expect(resp.status).toBe(200)
    expect(order).toEqual([
      'plugin:onRoute',
      'mw:beforeParse',
      'plugin:before',
      'mw1:in',
      'mw2',
      'hook:in',
      'handler',
      'hook:out',
      'mw1:out',
      'plugin:after',
    ])
  })
})

describe('middleware, global and basePath', async () => {
  const port = 7378
  const galbe = new Galbe({ basePath: '/base' })
  let global = 0
  let api = 0
  galbe.middleware(() => {
    global++
  })
  galbe.middleware('/api/*', () => {
    api++
  })
  galbe.get('/api/x', () => 'x')
  galbe.get('/y', () => 'y')
  await galbe.listen(port)

  test('global middleware runs everywhere, patterns are relative to basePath', async () => {
    expect((await fetch(`http://localhost:${port}/base/api/x`)).status).toBe(200)
    expect((await fetch(`http://localhost:${port}/base/y`)).status).toBe(200)
    expect(global).toBe(2)
    expect(api).toBe(1)
  })
})

describe('groups', async () => {
  const port = 7379
  const galbe = new Galbe()
  await galbe.listen(port)
  const get = (path: string) => fetch(`http://localhost:${port}${path}`)

  test('group prefix is reflected in routing', async () => {
    galbe.group('/v1', g => {
      g.get('/users', () => 'users')
    })

    const resp = await get('/v1/users')
    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe('users')
    expect((await get('/users')).status).toBe(404)
  })

  test('nested groups', async () => {
    galbe.group('/n1', g => {
      g.group('/n2', g2 => {
        g2.get('/leaf', () => 'leaf')
      })
    })

    expect(await (await get('/n1/n2/leaf')).text()).toBe('leaf')
  })

  test('group hooks run before route hooks', async () => {
    const order: string[] = []
    galbe.group(
      '/gh',
      [
        () => {
          order.push('group')
        },
      ],
      g => {
        g.get(
          '/a',
          [
            () => {
              order.push('hook')
            },
          ],
          () => {
            order.push('handler')
            return 'a'
          }
        )
      }
    )

    await get('/gh/a')
    expect(order).toEqual(['group', 'hook', 'handler'])
  })

  test('group hooks cover matching routes registered outside the group', async () => {
    let count = 0
    galbe.group(
      '/cov',
      [
        () => {
          count++
        },
      ],
      () => {}
    )
    galbe.get('/cov/outside', () => 'outside')

    await get('/cov/outside')
    expect(count).toBe(1)
  })

  test('group-scoped middleware only applies to the group subtree', async () => {
    let count = 0
    galbe.group('/gm', g => {
      g.middleware(() => {
        count++
      })
      g.get('/in', () => 'in')
    })
    galbe.get('/gm-out', () => 'out')

    await get('/gm/in')
    await get('/gm-out')
    expect(count).toBe(1)
  })

  test('params in group prefix are routed and typed', async () => {
    galbe.group('/team/:tid', g => {
      g.get('/m/:mid', ctx => `${ctx.params.tid}:${ctx.params.mid}`)
    })

    expect(await (await get('/team/7/m/3')).text()).toBe('7:3')
  })

  test('group hooks work with params in the prefix', async () => {
    let count = 0
    galbe.group(
      '/acc/:id',
      [
        () => {
          count++
        },
      ],
      g => {
        g.get('/x', () => 'x')
      }
    )

    await get('/acc/9/x')
    expect(count).toBe(1)
  })

  test('group prefix appears in the generated OpenAPI paths', async () => {
    const g2 = new Galbe()
    g2.group('/v1', g => {
      g.get('/users', () => [])
      g.get('/users/:id', () => ({}))
    })

    const spec = await OpenAPISerializer(g2)
    expect(spec.paths).toHaveProperty('/v1/users')
    expect(spec.paths).toHaveProperty('/v1/users/{id}')
  })
})

describe('middleware afterHandle slot', async () => {
  const port = 7412

  test('a returned Response replaces the parsed one, nothing keeps it', async () => {
    const galbe = new Galbe()
    galbe.middleware('/x/*', {
      afterHandle: res => (res.status === 404 ? new Response('custom', { status: 404 }) : undefined),
    })
    galbe.middleware('/y/*', { afterHandle: () => new Response('replaced', { status: 202 }) })
    galbe.get('/x/miss', () => new Response('gone', { status: 404 }))
    galbe.get('/x/keep', () => 'kept')
    galbe.get('/y/a', () => 'never seen')
    await galbe.listen(port)
    const get = (p: string) => fetch(`http://localhost:${port}${p}`)

    const kept = await get('/x/keep')
    expect(kept.status).toBe(200)
    expect(await kept.text()).toBe('kept')

    const custom = await get('/x/miss')
    expect(custom.status).toBe(404)
    expect(await custom.text()).toBe('custom')

    const replaced = await get('/y/a')
    expect(replaced.status).toBe(202)
    expect(await replaced.text()).toBe('replaced')
  })

  test('it runs for the error response too, with the error in hand', async () => {
    const galbe = new Galbe()
    const seen: Array<{ status: number; error: unknown }> = []
    galbe.middleware('/*', {
      afterHandle: (res, _ctx, error) => {
        seen.push({ status: res.status, error })
      },
    })
    galbe.get('/ok', () => 'ok')
    galbe.get('/missing', () => {
      throw new NotFoundError()
    })
    galbe.post('/items', { body: { 'application/json': $T.object({ n: $T.integer() }) } }, () => 'ok')
    await galbe.listen(port + 1)

    await fetch(`http://localhost:${port + 1}/ok`)
    expect(seen.at(-1)).toEqual({ status: 200, error: undefined })

    await fetch(`http://localhost:${port + 1}/missing`)
    expect(seen.at(-1)!.status).toBe(404)
    expect(seen.at(-1)!.error).toBeInstanceOf(NotFoundError)

    // a 400 from validation never reaches the hook chain: the post slot still runs
    const invalid = await fetch(`http://localhost:${port + 1}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ n: 'nope' }),
    })
    expect(invalid.status).toBe(400)
    expect(seen.at(-1)!.status).toBe(400)
    expect(seen.at(-1)!.error).toBeInstanceOf(RequestError)
  })

  test('registration order decides, and patterns scope it', async () => {
    const galbe = new Galbe()
    const order: string[] = []
    galbe.middleware('/*', { afterHandle: () => void order.push('outer') })
    galbe.middleware('/scoped/*', { afterHandle: () => void order.push('inner') })
    galbe.get('/scoped/x', () => 'x')
    galbe.get('/other', () => 'x')
    await galbe.listen(port + 2)

    await fetch(`http://localhost:${port + 2}/scoped/x`)
    expect(order).toEqual(['outer', 'inner'])

    order.length = 0
    await fetch(`http://localhost:${port + 2}/other`)
    expect(order).toEqual(['outer'])
  })

  test('it runs inside the plugins afterHandle, ahead of it', async () => {
    const galbe = new Galbe()
    const order: string[] = []
    galbe.middleware('/*', { afterHandle: () => void order.push('middleware') })
    const plugin: GalbePlugin = {
      name: 'dev.galbe.test.after',
      afterHandle: async res => {
        order.push('plugin')
        return res
      },
    }
    await galbe.use(plugin)
    galbe.get('/x', () => 'x')
    await galbe.listen(port + 3)

    await fetch(`http://localhost:${port + 3}/x`)
    expect(order).toEqual(['middleware', 'plugin'])
  })

  test('a header set after next() still lands on the response', async () => {
    const galbe = new Galbe()
    galbe.middleware('/h/*', async (ctx, next) => {
      await next()
      ctx.set.headers['x-late'] = 'yes'
    })
    galbe.middleware('/h/*', { afterHandle: res => void res.headers.set('x-after', 'yes') })
    galbe.get('/h/x', () => 'x')
    await galbe.listen(port + 4)

    const response = await fetch(`http://localhost:${port + 4}/h/x`)
    expect(response.headers.get('x-late')).toBe('yes')
    expect(response.headers.get('x-after')).toBe('yes')
  })

  test('a streamed response passes through without being buffered', async () => {
    const galbe = new Galbe()
    const seen: string[] = []
    galbe.middleware('/*', { afterHandle: res => void seen.push(res.headers.get('content-type') ?? '') })
    galbe.get('/sse', () =>
      (async function* () {
        yield 'one\n'
        yield 'two\n'
      })()
    )
    await galbe.listen(port + 5)

    const response = await fetch(`http://localhost:${port + 5}/sse`)
    const body = await response.text()
    expect(body).toContain('one')
    expect(body).toContain('two')
    // the hook saw the stream's own response, not a buffered copy of it
    expect(seen).toEqual(['text/event-stream'])
  })
})
