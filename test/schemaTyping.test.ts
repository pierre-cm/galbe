import { describe, test, expect } from 'bun:test'
import { Galbe, $T } from '../src'
import type { STSchema, STArray, STString, STUnion, STIntersection, STObject, Static } from '../src/schema'
import { Kind } from '../src/schema'
import type { Context, STBodyContent, STBodyType } from '../src/types'

// Type-level regression tests for the dropped `[key: string]: any` index
// signature on STSchema and the STBody/STBodyType decoupling.

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T
type IsUnion<T, U = T> = T extends any ? ([U] extends [T] ? false : true) : never

describe('schema typing', () => {
  test('STSchema does not accept arbitrary fields', () => {
    const s = $T.string() satisfies STSchema
    // @ts-expect-error — STSchema must not have an open index signature anymore.
    const bad: STSchema = { ...s, randomField: 'whatever' }
    void bad
    expect(true).toBe(true)
  })

  test('STArray exposes ArrayOptions on its type', () => {
    const arr = $T.array($T.string(), { minLength: 1, maxLength: 3, unique: true })
    type _arr_minLength = Expect<Equal<typeof arr.minLength, number | undefined>>
    type _arr_maxLength = Expect<Equal<typeof arr.maxLength, number | undefined>>
    type _arr_unique = Expect<Equal<typeof arr.unique, boolean | undefined>>
    expect(arr.minLength).toBe(1)
    expect(arr.maxLength).toBe(3)
    expect(arr.unique).toBe(true)
  })

  test('$T.record infers Record<string, Static<V>>', () => {
    const r = $T.record($T.integer())
    type _rec = Expect<Equal<Static<typeof r>, Record<string, number>>>
    const nested = $T.object({ meta: $T.record($T.string()) })
    type _nested = Expect<Equal<Static<typeof nested>, { meta: Record<string, string> }>>
    expect(r.additionalProperties).toMatchObject({ [Kind]: 'integer' })
  })

  test('an object with additionalProperties still types only its declared props', () => {
    // intersecting the value schema in would resolve every declared key to
    // `declared & value` — usually `never`
    const o = $T.object({ id: $T.string() }, { additionalProperties: $T.integer() })
    type _o = Expect<Equal<Static<typeof o>, { id: string }>>
    expect(o.additionalProperties).toMatchObject({ [Kind]: 'integer' })
  })

  test('STString exposes StringOptions on its type', () => {
    const s = $T.string({ minLength: 2, maxLength: 5, pattern: /^[a-z]+$/, format: 'email' })
    type _str_minLength = Expect<Equal<typeof s.minLength, number | undefined>>
    type _str_pattern = Expect<Equal<typeof s.pattern, RegExp | undefined>>
    type _str_format = Expect<Equal<typeof s.format, string | undefined>>
    expect(s.minLength).toBe(2)
    expect(s.format).toBe('email')
  })

  test('STBodyType is MediaType and STBodyContent uses full media type keys', () => {
    // STBodyType is now `\`${string}/${string}\`` (MediaType).
    // Full media type strings are valid STBodyType values.
    type _json = Extract<STBodyType, 'application/json'>
    type _text = Extract<STBodyType, 'text/plain'>
    type _ba = Extract<STBodyType, 'application/octet-stream'>
    type _form = Extract<STBodyType, 'application/x-www-form-urlencoded'>
    type _mp = Extract<STBodyType, 'multipart/form-data'>
    type _def = Extract<STBodyType, '*/*'>
    const all: STBodyType[] = [
      'application/json',
      'text/plain',
      'application/octet-stream',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      '*/*',
    ]
    expect(all.length).toBe(6)
    type _content = Expect<Equal<keyof STBodyContent, STBodyType>>
    void (null as unknown as _json | _text | _ba | _form | _mp | _def)
  })

  test('Options.deprecated is part of every schema', () => {
    const s = $T.string({ deprecated: true })
    expect(s.deprecated).toBe(true)
  })

  test('reading a typed constraint requires the typed schema', () => {
    // Generic STSchema must NOT expose constraint fields directly.
    const fn = (s: STSchema) => {
      // @ts-expect-error — `pattern` belongs to STString, not STSchema.
      void s.pattern
      // @ts-expect-error — `minLength` belongs to STString/STArray/STByteArray.
      void s.minLength
      // @ts-expect-error — `min` belongs to STNumber/STInteger.
      void s.min
    }
    fn($T.string())
    fn($T.array() as unknown as STArray)
    fn($T.string() as unknown as STString)
    expect(true).toBe(true)
  })

  describe('STUnion / STIntersection have no `props` field', () => {
    test('STUnion only exposes members at the type and runtime levels', () => {
      const u: STUnion = $T.union([$T.string(), $T.number()])
      // Runtime: `.members` is the schema array; `.props` was a phantom field
      // and is no longer claimed at the type level.
      expect(Array.isArray(u.members)).toBe(true)
      expect(u.members.length).toBe(2)
      // @ts-expect-error — STUnion no longer declares a `props` field.
      void u.props
      // Reading at runtime should be undefined (the constructor never set it).
      expect((u as any).props).toBeUndefined()
    })

    test('STIntersection only exposes allOf at the type and runtime levels', () => {
      const i: STIntersection<[STObject, STObject]> = $T.intersection([
        $T.object({ a: $T.string() }),
        $T.object({ b: $T.number() }),
      ])
      expect(Array.isArray(i.allOf)).toBe(true)
      expect(i.allOf.length).toBe(2)
      // @ts-expect-error — STIntersection no longer declares a `props` field.
      void i.props
      // The previous broken merge that silently dropped conflicting keys
      // is removed; the constructor no longer computes `.props`.
      expect((i as any).props).toBeUndefined()
    })

    test('intersectionize still validates by walking allOf', async () => {
      // Behavioral check that runtime validation works without a precomputed
      // `props` on the intersection — sanity confirmation for the removal.
      const { Galbe } = await import('../src')
      const g = new Galbe()
      g.post(
        '/inter',
        {
          body: {
            'application/json': $T.intersection([$T.object({ a: $T.string() }), $T.object({ b: $T.number() })]),
          },
        },
        ctx => ctx.body
      )
      const port = 7366
      await g.listen(port)
      try {
        const ok = await fetch(`http://localhost:${port}/inter`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ a: 'x', b: 1 }),
        })
        expect(ok.status).toBe(200)
        await ok.body?.cancel()

        const bad = await fetch(`http://localhost:${port}/inter`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ a: 'x' }),
        })
        expect(bad.status).toBe(400)
        await bad.body?.cancel()
      } finally {
        g.stop()
      }
    })
  })
})

// Type-level regression tests for `Context` inference. Everything asserted here
// is checked by `bun run typecheck`, not at runtime: the routes are registered
// only so the assertions run against what the `Endpoint` overloads actually
// infer, which is what a user sees in their editor.
describe('context typing', () => {
  const g = new Galbe()

  test('a json body types `body` and pins `contentType` to its media type', () => {
    g.post('/ctx/json', { body: { 'application/json': $T.object({ name: $T.string(), age: $T.number() }) } }, ctx => {
      type _body = Expect<Equal<typeof ctx.body, { name: string; age: number }>>
      type _ct = Expect<Equal<typeof ctx.contentType, 'application/json'>>
      // @ts-expect-error — the body is an object, not a string.
      const wrong: string = ctx.body
      // @ts-expect-error — this route offers exactly one media type.
      const never: boolean = ctx.contentType === 'text/plain'
      void wrong
      void never
      return ctx.body
    })
    expect(true).toBe(true)
  })

  test('`contentType` discriminates `body` across media types', () => {
    g.put(
      '/ctx/multi',
      {
        body: {
          'application/json': $T.object({ a: $T.string() }),
          'text/plain': $T.string(),
          'multipart/form-data': $T.multipartForm({ f: $T.byteArray() }),
        },
      },
      ctx => {
        if (ctx.contentType === 'application/json') {
          type _json = Expect<Equal<typeof ctx.body, { a: string }>>
          return ctx.body.a
        }
        if (ctx.contentType === 'text/plain') {
          type _text = Expect<Equal<typeof ctx.body, string>>
          return ctx.body
        }
        type _mp = Expect<Equal<typeof ctx.contentType, 'multipart/form-data'>>
        return ctx.body.f.content
      }
    )
    expect(true).toBe(true)
  })

  test('empty-body methods collapse `body` to null and `contentType` to undefined', () => {
    g.get('/ctx/get', { body: { 'application/json': $T.object({ a: $T.string() }) } }, ctx => {
      type _body = Expect<Equal<typeof ctx.body, null>>
      type _ct = Expect<Equal<typeof ctx.contentType, undefined>>
      // @ts-expect-error — a get carries no body, whatever the schema declares.
      const wrong: object = ctx.body
      void wrong
      return null
    })
    // several media types on an empty-body method resolve to a single context:
    // there is no media type left to discriminate on
    g.head(
      '/ctx/head',
      { body: { 'application/json': $T.object({ a: $T.string() }), 'text/plain': $T.string() } },
      ctx => {
        type _single = Expect<Equal<IsUnion<typeof ctx>, false>>
        type _body = Expect<Equal<typeof ctx.body, null>>
        return null
      }
    )
    g.options('/ctx/options', { body: { 'text/plain': $T.string() } }, ctx => {
      type _body = Expect<Equal<typeof ctx.body, null>>
      return null
    })
    expect(true).toBe(true)
  })

  test('a `$T.null()` body and a missing body both type `body` as null', () => {
    g.post('/ctx/null', { body: $T.null() }, ctx => {
      type _body = Expect<Equal<typeof ctx.body, null>>
      type _ct = Expect<Equal<typeof ctx.contentType, undefined>>
      return null
    })
    g.post('/ctx/nobody', { query: { q: $T.string() } }, ctx => {
      type _q = Expect<Equal<typeof ctx.query, { q: string }>>
      return null
    })
    expect(true).toBe(true)
  })

  test('an optional body schema unwraps to `| null | undefined`', () => {
    g.post('/ctx/optbody', { body: { 'application/json': $T.optional($T.object({ a: $T.string() })) } }, ctx => {
      type _body = Expect<Equal<typeof ctx.body, { a: string } | null | undefined>>
      return null
    })
    expect(true).toBe(true)
  })

  test('a route with no schema keeps `body` open and `contentType` a media type', () => {
    g.post('/ctx/free', ctx => {
      type _body = Expect<Equal<typeof ctx.body, any>>
      type _ct = Expect<Equal<typeof ctx.contentType, `${string}/${string}`>>
      return ctx.body
    })
    expect(true).toBe(true)
  })

  test('params type from the schema, unknown ones fall back to string', () => {
    g.get('/ctx/:id/:slug', { params: { id: $T.integer() } }, ctx => {
      type _params = Expect<Equal<typeof ctx.params, { id: number; slug: string }>>
      // @ts-expect-error — `params` only carries the path's own params.
      void ctx.params.missing
      return null
    })
    // a schema-optional value stays typed; a schema-optional *key* is dropped
    // and falls back to string, like an undeclared param
    g.get('/ctx/opt/:id', { params: { id: $T.optional($T.integer()) } }, ctx => {
      type _params = Expect<Equal<typeof ctx.params, { id: number | undefined }>>
      return null
    })
    const optionalKey: { id?: ReturnType<typeof $T.integer> } = {}
    g.get('/ctx/optkey/:id', { params: optionalKey }, ctx => {
      type _params = Expect<Equal<typeof ctx.params, { id: string }>>
      return null
    })
    expect(true).toBe(true)
  })

  test('headers, query and cookies infer from their schemas', () => {
    g.post(
      '/ctx/entries',
      {
        headers: { 'x-token': $T.string() },
        query: { q: $T.string(), n: $T.optional($T.number()) },
        cookies: { session: $T.string(), count: $T.optional($T.integer()) },
        body: { 'application/json': $T.array($T.string()) },
      },
      ctx => {
        type _headers = Expect<Equal<typeof ctx.headers, { 'x-token': string }>>
        type _query = Expect<Equal<typeof ctx.query, { q: string; n?: number | undefined }>>
        type _cookies = Expect<Equal<typeof ctx.cookies, { session: string; count?: number | undefined }>>
        type _body = Expect<Equal<typeof ctx.body, string[]>>
        return null
      }
    )
    expect(true).toBe(true)
  })

  test('a group prefix contributes its params to the context', () => {
    g.group('/ctx/api/:v', grp => {
      grp.post('/items/:id', { params: { id: $T.integer() }, body: { 'application/json': $T.object({}) } }, ctx => {
        type _params = Expect<Equal<typeof ctx.params, { v: string; id: number }>>
        type _ct = Expect<Equal<typeof ctx.contentType, 'application/json'>>
        return null
      })
    })
    expect(true).toBe(true)
  })

  test('a handler typed against the bare `Context` fits any route', () => {
    const shared = (ctx: Context) => ctx.body
    g.post('/ctx/shared/json', { body: { 'application/json': $T.object({ a: $T.string() }) } }, shared)
    g.post('/ctx/shared/resp', { response: { 200: $T.string() } }, shared)
    g.post('/ctx/shared/bare', shared)
    g.get('/ctx/shared/get', shared)
    expect(true).toBe(true)
  })
})
