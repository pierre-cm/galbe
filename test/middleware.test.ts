import { describe, expect, test } from 'bun:test'
import { Galbe, UnauthorizedError } from '../src'
import { OpenAPISerializer } from '../src/extras/spec/openapi.serializer'

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

describe('middleware ordering', async () => {
  const port = 7377
  const order: string[] = []
  const galbe = new Galbe()
  await galbe.use({
    name: 'test.order',
    beforeHandle: () => {
      order.push('plugin:before')
    },
    afterHandle: () => {
      order.push('plugin:after')
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

  test('plugins → middleware (registration order) → route hooks → handler', async () => {
    const resp = await fetch(`http://localhost:${port}/ord`)
    expect(resp.status).toBe(200)
    expect(order).toEqual([
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
