import { $T, Galbe, middleware } from '../src'
import type { Static } from '../src/schema'
import type { ContextSet, Route } from '../src/types'
import type { SocketAddress } from 'bun'
import { describe, test, expect, beforeAll } from 'bun:test'
import { formdata } from './test.utils'

// Test utils
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
// assignability, for context types that carry more keys than the ones asserted
type Extends<A, B> = A extends B ? true : false
type Expect<T extends true> = T

// Basic Schema types

const any = $T.any()
const nil = $T.null()
const bool = $T.boolean()
const num = $T.number()
const int = $T.integer()
const str = $T.string()
const literal = $T.literal('foo')
const ba = $T.byteArray()
const obj = $T.object()

type _any = Expect<Equal<Static<typeof any>, any>>
type _nil = Expect<Equal<Static<typeof nil>, null>>
type _bool = Expect<Equal<Static<typeof bool>, boolean>>
type _num = Expect<Equal<Static<typeof num>, number>>
type _int = Expect<Equal<Static<typeof int>, number>>
type _str = Expect<Equal<Static<typeof str>, string>>
type _literal = Expect<Equal<Static<typeof literal>, 'foo'>>

// String schema must accept StringOptions (pattern/format/minLength/maxLength),
// not NumberOptions. Regression for the `STString extends NumberOptions` typo.
const str_with_pattern = $T.string({ pattern: /^foo/, format: 'email', minLength: 1, maxLength: 10 })
type _str_pattern = Expect<Equal<typeof str_with_pattern.pattern, RegExp | undefined>>
type _str_format = Expect<Equal<typeof str_with_pattern.format, string | undefined>>
type _str_minLen = Expect<Equal<typeof str_with_pattern.minLength, number | undefined>>
type _str_maxLen = Expect<Equal<typeof str_with_pattern.maxLength, number | undefined>>
type _ba = Expect<Equal<Static<typeof ba>, Uint8Array>>
type _obj = Expect<Equal<Static<typeof obj>, Record<string | number, any>>>

// Basic schema wrappers

const opt_str = $T.optional($T.string())
const null_str = $T.nullable($T.string())
const nullish_str = $T.nullish($T.string())

type _opt_str = Expect<Equal<Static<typeof opt_str>, string | undefined>>
type _null_str = Expect<Equal<Static<typeof null_str>, string | null>>
type _nullish_str = Expect<Equal<Static<typeof nullish_str>, string | null | undefined>>

// Array schema type

const arr_nil = $T.array($T.null())
const arr_bool = $T.array($T.boolean())
const arr_num = $T.array($T.number())
const arr_int = $T.array($T.integer())
const arr_str = $T.array($T.string())
const arr_obj = $T.array($T.object({ foo: $T.literal(42) }))
const arr_arr = $T.array($T.array($T.literal('hello')))

const arr_union = $T.array($T.union([$T.literal('hello'), $T.literal('mom')]))
const arr_intersection = $T.array($T.intersection([$T.object({ foo: $T.string() }), $T.object({ bar: $T.number() })]))

type _arr_nil = Expect<Equal<Static<typeof arr_nil>, null[]>>
type _arr_bool = Expect<Equal<Static<typeof arr_bool>, boolean[]>>
type _arr_num = Expect<Equal<Static<typeof arr_num>, number[]>>
type _arr_int = Expect<Equal<Static<typeof arr_int>, number[]>>
type _arr_str = Expect<Equal<Static<typeof arr_str>, string[]>>
type _arr_obj = Expect<Equal<Static<typeof arr_obj>, { foo: 42 }[]>>
type _arr_arr = Expect<Equal<Static<typeof arr_arr>, 'hello'[][]>>

type _arr_union = Expect<Equal<Static<typeof arr_union>, ('hello' | 'mom')[]>>
type _arr_intersection = Expect<Equal<Static<typeof arr_intersection>, ({ foo: string } & { bar: number })[]>>

// Object schema type

const obj_1 = $T.object({
  any: $T.any(),
  nil: $T.null(),
  bool: $T.boolean(),
  num: $T.number(),
  int: $T.integer(),
  str: $T.string(),
  literal: $T.literal('foo'),
  ba: $T.byteArray(),
  arr: $T.array($T.string()),
  obj: $T.object({
    foo: $T.string(),
  }),
})

type _obj_1 = Expect<
  Equal<
    Static<typeof obj_1>,
    {
      literal: 'foo'
      any: any
      nil: null
      bool: boolean
      num: number
      int: number
      str: string
      ba: Uint8Array
      arr: string[]
      obj: {
        foo: string
      }
    }
  >
>

// Union type

const union_str_number = $T.union([$T.string(), $T.number()])
const union_str_any = $T.union([$T.string(), $T.any()])
const union_union_number = $T.union([$T.union([$T.literal('foo'), $T.literal('bar')]), $T.literal('baz')])
const union_intersection = $T.union([
  $T.intersection([$T.object({ foo: $T.literal(42) }), $T.object({ bar: $T.number() })]),
  $T.object({ test: $T.literal('test') }),
])

type _union_str_number = Expect<Equal<Static<typeof union_str_number>, string | number>>
type _union_str_any = Expect<Equal<Static<typeof union_str_any>, any>>
type _union_union_number = Expect<Equal<Static<typeof union_union_number>, 'foo' | 'bar' | 'baz'>>
type _union_intersection = Expect<
  Equal<Static<typeof union_intersection>, ({ foo: 42 } & { bar: number }) | { test: 'test' }>
>

// Intersection type

const intersection_obj_obj = $T.intersection([$T.object({ foo: $T.string() }), $T.object({ bar: $T.boolean() })])
const intersection_union_obj = $T.intersection([
  $T.union([$T.object({ foo: $T.string() }), $T.object({ bar: $T.boolean() })]),
  $T.object({ baz: $T.literal(42) }),
])
const intersection_intersection_obj = $T.intersection([
  $T.intersection([$T.object({ foo: $T.string() }), $T.object({ bar: $T.boolean() })]),
  $T.object({ baz: $T.literal('42') }),
])

type _intersection_obj_obj = Expect<Equal<Static<typeof intersection_obj_obj>, { foo: string } & { bar: boolean }>>
type _intersection_union_obj = Expect<
  Equal<Static<typeof intersection_union_obj>, ({ foo: string } | { bar: boolean }) & { baz: 42 }>
>
type _intersection_intersection_obj = Expect<
  Equal<Static<typeof intersection_intersection_obj>, { foo: string } & { bar: boolean } & { baz: '42' }>
>

// Stream types

const stream_ba = $T.stream($T.byteArray())
const stream_str = $T.stream($T.string())
const stream_obj = $T.stream(
  $T.object({ foo: $T.literal('hi'), bar: $T.number(), obj: $T.object({ nested: $T.boolean() }) })
)
const stream_multipart = $T.stream(
  $T.multipartForm({ foo: $T.literal('hi'), bar: $T.number(), obj: $T.object({ nested: $T.boolean() }) })
)
const stream_union = $T.stream($T.union([$T.object({ foo: $T.string() }), $T.object({ bar: $T.boolean() })]))
const stream_intersection = $T.stream(
  $T.intersection([$T.object({ foo: $T.string() }), $T.object({ bar: $T.boolean() })])
)

type _stream_ba = Expect<Equal<Static<typeof stream_ba>, AsyncGenerator<Uint8Array>>>
type _stream_str = Expect<Equal<Static<typeof stream_str>, AsyncGenerator<string>>>
type _stream_obj = Expect<
  Equal<
    Static<typeof stream_obj>,
    AsyncGenerator<
      | ['foo', 'hi']
      | ['bar', number]
      | [
          'obj',
          {
            nested: boolean
          },
        ]
    >
  >
>
type _stream_multipart = Expect<
  Equal<
    Static<typeof stream_multipart>,
    AsyncGenerator<
      | {
          headers: {
            type?: string
            name: 'foo'
            filename?: string
          }
          content: 'hi'
        }
      | {
          headers: {
            type?: string
            name: 'bar'
            filename?: string
          }
          content: number
        }
      | {
          headers: {
            type?: string
            name: 'obj'
            filename?: string
          }
          content: {
            nested: boolean
          }
        },
      void,
      unknown
    >
  >
>
type _stream_union = Expect<Equal<Static<typeof stream_union>, AsyncGenerator<['foo', string] | ['bar', boolean]>>>
type _stream_intersection = Expect<
  Equal<Static<typeof stream_intersection>, AsyncGenerator<['foo', string] | ['bar', boolean]>>
>

// Endpoints

const g = new Galbe()

// Path params

g.get('/params/noschema/:param1/and/:param2', ctx => {
  const { params } = ctx
  type _ep_params = Expect<Equal<typeof params, { param1: string; param2: string }>>
  ctx.set.status = typeof params.param1 === 'string' && typeof params.param2 === 'string' ? 200 : 500
})

g.get(
  '/params/schema/:bool/:num/:int/:str/:literal',
  { params: { bool: $T.boolean(), num: $T.number(), int: $T.integer(), str: $T.string(), literal: $T.literal(42) } },
  ctx => {
    const { params } = ctx
    type _ep_params = Expect<
      Equal<typeof params, { bool: boolean; num: number; int: number; str: string; literal: 42 }>
    >
    ctx.set.status =
      typeof params.bool === 'boolean' &&
      typeof params.num === 'number' &&
      typeof params.int === 'number' &&
      typeof params.str === 'string' &&
      params.literal === 42
        ? 200
        : 500
  }
)

// Query params

g.get('/query', ctx => {
  const { query } = ctx
  type _ep_params = Expect<Equal<typeof query, Record<string | number | symbol, any>>>
})

g.get(
  '/query/schema',
  {
    query: {
      bool: $T.boolean(),
      num: $T.number(),
      int: $T.integer(),
      str: $T.string(),
      literal: $T.literal('foo'),
      opt: $T.optional($T.literal('opt')),
    },
  },
  ctx => {
    const { query } = ctx
    type _ep_query = Expect<
      Equal<typeof query, { bool: boolean; num: number; int: number; str: string; literal: 'foo'; opt?: 'opt' }>
    >
    ctx.set.status =
      typeof query.bool === 'boolean' &&
      typeof query.num === 'number' &&
      typeof query.int === 'number' &&
      typeof query.str === 'string' &&
      (query.opt !== undefined ? query.opt === 'opt' : true) &&
      query.literal === 'foo'
        ? 200
        : 500
  }
)

// Body

// Null bodies
g.get('/body', ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, null>>
  ctx.set.status = body === null ? 200 : 500
})
g.get('/body/schema', { body: { 'application/json': $T.string() } }, ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, null>>
  ctx.set.status = body === null ? 200 : 500
})
g.options('/body', ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, null>>
  ctx.set.status = body === null ? 200 : 500
})
g.options('/body/schema', { body: { 'application/json': $T.string() } }, ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, null>>
  ctx.set.status = body === null ? 200 : 500
})
g.head('/body', ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, null>>
  ctx.set.status = body === null ? 200 : 500
})
g.head('/body/schema', { body: { 'application/json': $T.string() } }, ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, null>>
  ctx.set.status = body === null ? 200 : 500
})

g.post('/body/post/noschema', ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, any>>
})
g.patch('/body/patch/noschema', ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, any>>
})

g.post('/body/post', { body: $T.null() }, ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, null>>
  ctx.set.status = body === null ? 200 : 500
})
g.patch('/body/patch', { body: $T.null() }, ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, null>>
  ctx.set.status = body === null ? 200 : 500
})

// Body ByteArray

g.post('/body/ba', { body: { 'application/octet-stream': $T.byteArray() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, Uint8Array>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'application/octet-stream'>>
  ctx.set.status = body instanceof Uint8Array ? 200 : 500
})

g.post('/body/ba/stream', { body: { 'application/octet-stream': $T.stream($T.byteArray()) } }, async ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, AsyncGenerator<Uint8Array>>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'application/octet-stream'>>
  for await (const bp of body) {
    if (body instanceof Uint8Array) ctx.set.status = 500
  }
})

// Body Text

g.post('/body/text/str', { body: { 'text/plain': $T.string() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, string>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'text/plain'>>
  ctx.set.status = typeof body === 'string' ? 200 : 500
})

g.post('/body/text/literal', { body: { 'text/plain': $T.literal('foo') } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, 'foo'>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'text/plain'>>
  ctx.set.status = body === 'foo' ? 200 : 500
})

g.post('/body/text/bool', { body: { 'text/plain': $T.boolean() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, boolean>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'text/plain'>>
  ctx.set.status = typeof body === 'boolean' ? 200 : 500
})

g.post('/body/text/num', { body: { 'text/plain': $T.number() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, number>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'text/plain'>>
  ctx.set.status = typeof body === 'number' ? 200 : 500
})

g.post('/body/text/int', { body: { 'text/plain': $T.integer() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, number>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'text/plain'>>
  ctx.set.status = typeof body === 'number' ? 200 : 500
})

g.post('/body/text/union', { body: { 'text/plain': $T.union([$T.literal('foo'), $T.number()]) } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, 'foo' | number>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'text/plain'>>
  ctx.set.status = body === 'foo' || typeof body === 'number' ? 200 : 500
})

g.post('/body/text/stream', { body: { 'text/plain': $T.stream($T.string()) } }, async ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, AsyncGenerator<string>>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'text/plain'>>
  for await (const chunk of body) if (typeof chunk !== 'string') ctx.set.status = 500
})

// Body Json

g.post('/body/json/bool', { body: { 'application/json': $T.boolean() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, boolean>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'application/json'>>
  ctx.set.status = typeof body === 'boolean' ? 200 : 500
})

g.post('/body/json/num', { body: { 'application/json': $T.number() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, number>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'application/json'>>
  ctx.set.status = typeof body === 'number' ? 200 : 500
})

g.post('/body/json/int', { body: { 'application/json': $T.integer() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, number>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'application/json'>>
  ctx.set.status = typeof body === 'number' ? 200 : 500
})

g.post('/body/json/str', { body: { 'application/json': $T.string() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, string>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'application/json'>>
  ctx.set.status = typeof body === 'string' ? 200 : 500
})

g.post('/body/json/arr', { body: { 'application/json': $T.array($T.string()) } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, string[]>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'application/json'>>
  ctx.set.status = Array.isArray(body) && body.every(i => typeof i === 'string') ? 200 : 500
})

g.post('/body/json/union', { body: { 'application/json': $T.union([$T.boolean(), $T.string()]) } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, boolean | string>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'application/json'>>
  ctx.set.status = typeof body === 'string' || typeof body === 'boolean' ? 200 : 500
})

g.post(
  '/body/json/intersection',
  { body: { 'application/json': $T.intersection([$T.object({ foo: $T.string() }), $T.object({ bar: $T.number() })]) } },
  ctx => {
    const { body, contentType } = ctx
    type _ep_body = Expect<Equal<typeof body, { foo: string } & { bar: number }>>
    type _ep_contentType = Expect<Equal<typeof contentType, 'application/json'>>
    ctx.set.status = typeof body.foo === 'string' || typeof body.bar === 'number' ? 200 : 500
  }
)

g.post('/body/json/obj', { body: { 'application/json': $T.object({ foo: $T.string() }) } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, { foo: string }>>
  type _ep_contentType = Expect<Equal<typeof contentType, 'application/json'>>
  ctx.set.status = typeof body.foo === 'string' ? 200 : 500
})

// Body UrlForm

g.post(
  '/body/urlForm',
  {
    body: {
      'application/x-www-form-urlencoded': $T.object({
        foo: $T.string(),
        bar: $T.number(),
        opt: $T.optional($T.literal('opt')),
      }),
    },
  },
  ctx => {
    const { body, contentType } = ctx
    type _ep_body = Expect<Equal<typeof body, { foo: string; bar: number; opt?: 'opt' }>>
    type _ep_contentType = Expect<Equal<typeof contentType, 'application/x-www-form-urlencoded'>>
    ctx.set.status =
      typeof body.foo === 'string' && typeof body.bar === 'number' && (body.opt ? body.opt === 'opt' : true) ? 200 : 500
  }
)

g.post(
  '/body/urlForm/union',
  {
    body: {
      'application/x-www-form-urlencoded': $T.union([
        $T.object({ foo: $T.string() }),
        $T.object({ bar: $T.boolean() }),
      ]),
    },
  },
  ctx => {
    const { body, contentType } = ctx
    type _ep_body = Expect<Equal<typeof body, { foo: string } | { bar: boolean }>>
    type _ep_contentType = Expect<Equal<typeof contentType, 'application/x-www-form-urlencoded'>>
    //@ts-ignore
    typeof body.foo ? typeof body.foo === 'string' : true && body.bar ? typeof body.bar === 'number' : true ? 200 : 500
  }
)

g.post(
  '/body/urlForm/stream',
  { body: { 'application/x-www-form-urlencoded': $T.stream($T.object({ foo: $T.string(), bar: $T.number() })) } },
  async ctx => {
    const { body, contentType } = ctx
    type _ep_body = Expect<Equal<typeof body, AsyncGenerator<['foo', string] | ['bar', number]>>>
    type _ep_contentType = Expect<Equal<typeof contentType, 'application/x-www-form-urlencoded'>>
    for await (const [k, v] of body) {
      if (k === 'foo' && typeof v !== 'string') ctx.set.status = 500
      if (k === 'bar' && typeof v !== 'number') ctx.set.status = 500
    }
  }
)

// Body MultipartForm

g.post(
  '/body/multipart',
  {
    body: {
      'multipart/form-data': $T.multipartForm({
        foo: $T.string(),
        bar: $T.number(),
        opt: $T.optional($T.literal('opt')),
      }),
    },
  },
  ctx => {
    const { body, contentType } = ctx
    type _ep_body = Expect<
      Equal<
        typeof body,
        {
          foo: {
            headers: {
              type?: string
              name: 'foo'
              filename?: string
            }
            content: string
          }
          bar: {
            headers: {
              type?: string
              name: 'bar'
              filename?: string
            }
            content: number
          }
          opt: {
            headers: {
              type?: string
              name: 'opt'
              filename?: string
            }
            content: 'opt' | undefined
          }
        }
      >
    >
    type _ep_contentType = Expect<Equal<typeof contentType, 'multipart/form-data'>>
    if (body.foo) {
      if (body.foo.headers?.type && typeof body.foo.headers?.type !== 'string') ctx.set.status = 500
      if (body.foo.headers?.filename && typeof body.foo.headers?.filename !== 'string') ctx.set.status = 500
      if (body.foo.headers.name !== 'foo') ctx.set.status = 500
      if (typeof body.foo.content !== 'string') ctx.set.status = 500
    }
    if (body.bar) {
      if (body.bar.headers?.type && typeof body.bar.headers?.type !== 'string') ctx.set.status = 500
      if (body.bar.headers?.filename && typeof body.bar.headers?.filename !== 'string') ctx.set.status = 500
      if (body.bar.headers.name !== 'bar') ctx.set.status = 500
      if (typeof body.bar.content !== 'number') ctx.set.status = 500
    }
    if (body.opt) {
      if (body.opt.headers?.type && typeof body.opt.headers?.type !== 'string') ctx.set.status = 500
      if (body.opt.headers?.filename && typeof body.opt.headers?.filename !== 'string') ctx.set.status = 500
      if (body.opt.headers.name !== 'opt') ctx.set.status = 500
      if (body.opt.content && body.opt.content !== 'opt') ctx.set.status = 500
    }
  }
)

g.post(
  '/body/multipart/stream',
  {
    body: {
      'multipart/form-data': $T.stream(
        $T.multipartForm({ foo: $T.string(), bar: $T.number(), opt: $T.optional($T.literal('opt')) })
      ),
    },
  },
  async ctx => {
    const { body, contentType } = ctx
    type _ep_body = Expect<
      Equal<
        typeof body,
        AsyncGenerator<
          | {
              headers: {
                type?: string
                name: 'foo'
                filename?: string
              }
              content: string
            }
          | {
              headers: {
                type?: string
                name: 'bar'
                filename?: string
              }
              content: number
            }
          | {
              headers: {
                type?: string
                name: 'opt'
                filename?: string
              }
              content: 'opt' | undefined
            },
          void,
          unknown
        >
      >
    >
    type _ep_contentType = Expect<Equal<typeof contentType, 'multipart/form-data'>>
    for await (const mp of body) {
      if (mp.headers.name === 'foo') {
        if (mp.headers?.type && typeof mp.headers?.type !== 'string') ctx.set.status = 500
        if (mp.headers?.filename && typeof mp.headers?.filename !== 'string') ctx.set.status = 500
        if (mp.headers.name !== 'foo') ctx.set.status = 500
        if (typeof mp.content !== 'string') ctx.set.status = 500
      }
      if (mp.headers.name === 'bar') {
        if (mp.headers?.type && typeof mp.headers?.type !== 'string') ctx.set.status = 500
        if (mp.headers?.filename && typeof mp.headers?.filename !== 'string') ctx.set.status = 500
        if (mp.headers.name !== 'bar') ctx.set.status = 500
        if (typeof mp.content !== 'number') ctx.set.status = 500
      }
      if (mp.headers.name === 'opt') {
        if (mp.headers?.type && typeof mp.headers?.type !== 'string') ctx.set.status = 500
        if (mp.headers?.filename && typeof mp.headers?.filename !== 'string') ctx.set.status = 500
        if (mp.headers.name !== 'opt') ctx.set.status = 500
        if (mp.content && mp.content !== 'opt') ctx.set.status = 500
      }
    }
  }
)

// Body Default

g.post('/body/default', { body: { '*/*': $T.any() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, any>>
  type _ep_contentType = Expect<Equal<typeof contentType, '*/*'>>
})

g.post('/body/default/ba', { body: { '*/*': $T.byteArray() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, Uint8Array>>
  type _ep_contentType = Expect<Equal<typeof contentType, '*/*'>>
})

g.post('/body/default/str', { body: { '*/*': $T.string() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, string>>
  type _ep_contentType = Expect<Equal<typeof contentType, '*/*'>>
})

g.post('/body/default/stream/ba', { body: { '*/*': $T.stream($T.byteArray()) } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, AsyncGenerator<Uint8Array>>>
  type _ep_contentType = Expect<Equal<typeof contentType, '*/*'>>
})

g.post('/body/default/stream/str', { body: { '*/*': $T.stream($T.string()) } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, AsyncGenerator<string>>>
  type _ep_contentType = Expect<Equal<typeof contentType, '*/*'>>
})

// Whole-context inference
//
// The assertions above pin individual context keys, so a key nobody thought to
// assert (`request`, `state`, `set`, `remoteAddress`, `clientAddress`, `route`,
// `cookies`) can be
// retyped without any test failing. These pin `typeof ctx` in full on a handful
// of representative routes: any change to the context object — a retyped field,
// a dropped key, a new key — fails here. Registered on a throwaway instance so
// the runtime case table below stays the authority on what is actually served.

const ctxG = new Galbe()

// No schema: headers/query/cookies stay open, params come from the path, no body.
ctxG.get('/ctx/noschema/:id', ctx => {
  type _ctx = Expect<
    Equal<
      typeof ctx,
      {
        headers: Record<string | number | symbol, any>
        params: { id: string }
        query: Record<string | number | symbol, any>
        contentType: undefined
        body: null
        request: Request
        remoteAddress: SocketAddress | null
        clientAddress: string | null
        route?: Route
        state: Record<string, any>
        set: ContextSet
        cookies: Record<string | number | symbol, any>
      }
    >
  >
})

// Every request schema populated, single body media type.
ctxG.post(
  '/ctx/full/:id',
  {
    headers: { 'x-tok': $T.string() },
    query: { q: $T.string(), opt: $T.optional($T.integer()) },
    params: { id: $T.integer() },
    cookies: { sid: $T.string() },
    body: { 'application/json': $T.object({ a: $T.string() }) },
  },
  ctx => {
    type _ctx = Expect<
      Equal<
        typeof ctx,
        {
          headers: { 'x-tok': string }
          params: { id: number }
          query: { q: string; opt?: number }
          contentType: 'application/json'
          body: { a: string }
          request: Request
          remoteAddress: SocketAddress | null
          clientAddress: string | null
          route?: Route
          state: Record<string, any>
          set: ContextSet
          cookies: { sid: string }
        }
      >
    >
  }
)

// Multiple body media types: the context is a union discriminated by contentType.
ctxG.post(
  '/ctx/multi',
  { body: { 'application/json': $T.object({ a: $T.string() }), 'text/plain': $T.string() } },
  ctx => {
    type _ctx = Expect<
      Equal<
        typeof ctx,
        | {
            headers: Record<string | number | symbol, any>
            params: {}
            query: Record<string | number | symbol, any>
            contentType: 'application/json'
            body: { a: string }
            request: Request
            remoteAddress: SocketAddress | null
            clientAddress: string | null
            route?: Route
            state: Record<string, any>
            set: ContextSet
            cookies: Record<string | number | symbol, any>
          }
        | {
            headers: Record<string | number | symbol, any>
            params: {}
            query: Record<string | number | symbol, any>
            contentType: 'text/plain'
            body: string
            request: Request
            remoteAddress: SocketAddress | null
            clientAddress: string | null
            route?: Route
            state: Record<string, any>
            set: ContextSet
            cookies: Record<string | number | symbol, any>
          }
      >
    >
  }
)

// Streaming body: the stream wrapper must survive into the context type.
ctxG.post('/ctx/stream', { body: { 'application/octet-stream': $T.stream($T.byteArray()) } }, ctx => {
  type _ctx = Expect<
    Equal<
      typeof ctx,
      {
        headers: Record<string | number | symbol, any>
        params: {}
        query: Record<string | number | symbol, any>
        contentType: 'application/octet-stream'
        body: AsyncGenerator<Uint8Array>
        request: Request
        remoteAddress: SocketAddress | null
        clientAddress: string | null
        route?: Route
        state: Record<string, any>
        set: ContextSet
        cookies: Record<string | number | symbol, any>
      }
    >
  >
})

// Middleware defs and group fragments

const tenantMw = middleware({
  schema: { headers: { 'x-tenant-id': $T.string() }, query: { page: $T.optional($T.integer()) } },
  hooks: (ctx, next) => {
    // a def's schema types the def's own hooks, with no annotation
    type _mw_headers = Expect<Extends<typeof ctx.headers, { 'x-tenant-id': string }>>
    type _mw_query = Expect<Extends<typeof ctx.query, { page?: number }>>
    return next()
  },
})

g.group('/mw', tenantMw, group => {
  group.get('/frag', ctx => {
    const { headers, query } = ctx
    type _grp_headers = Expect<Extends<typeof headers, { 'x-tenant-id': string }>>
    type _grp_query = Expect<Extends<typeof query, { page?: number }>>
    ctx.set.status = typeof headers['x-tenant-id'] === 'string' ? 200 : 500
  })

  // route-declared keys win over the fragment, in the types as at runtime
  group.get('/override', { headers: { 'x-tenant-id': $T.integer() } }, ctx => {
    const { headers } = ctx
    type _grp_override = Expect<Extends<typeof headers, { 'x-tenant-id': number }>>
    ctx.set.status = typeof headers['x-tenant-id'] === 'number' ? 200 : 500
  })

  // nested groups stack fragments
  group.group('/nested', middleware({ schema: { headers: { 'x-nested': $T.string() } } }), nested => {
    nested.get('/leaf', ctx => {
      const { headers } = ctx
      type _grp_nested = Expect<Extends<typeof headers, { 'x-tenant-id': string; 'x-nested': string }>>
      ctx.set.status = typeof headers['x-nested'] === 'string' ? 200 : 500
    })
  })
})

// no fragment in scope: header access stays permissive
g.get('/nofrag', ctx => {
  ctx.set.status = ctx.headers.anything === undefined ? 200 : 500
})

const port = 7362
describe('types', () => {
  beforeAll(async () => {
    await g.listen(port)
  })

  test('endpoint request static types match runtime types', async () => {
    type Case = {
      body?: any
      method: string
      type?: string
      path: string
      expected: number
      headers?: Record<string, string>
    }
    const cases: Case[] = [
      { method: 'get', path: '/params/noschema/foo/and/42', expected: 200 },
      { method: 'get', path: '/params/schema/true/0/1/foo/42', expected: 200 },
      { method: 'get', path: '/params/schema/foo/0/1/foo/42', expected: 400 },
      { method: 'get', path: '/params/schema/true/x/1/foo/42', expected: 400 },
      { method: 'get', path: '/params/schema/true/0/y/foo/42', expected: 400 },
      { method: 'get', path: '/params/schema/true/0/y/foo/43', expected: 400 },

      // middleware fragments: merged into matched routes, validated like route-declared keys
      { method: 'get', path: 'mw/frag', expected: 400 },
      { method: 'get', path: 'mw/frag', headers: { 'x-tenant-id': 'acme' }, expected: 200 },
      { method: 'get', path: 'mw/frag?page=2', headers: { 'x-tenant-id': 'acme' }, expected: 200 },
      { method: 'get', path: 'mw/frag?page=abc', headers: { 'x-tenant-id': 'acme' }, expected: 400 },
      { method: 'get', path: 'mw/override', headers: { 'x-tenant-id': '42' }, expected: 200 },
      { method: 'get', path: 'mw/override', headers: { 'x-tenant-id': 'abc' }, expected: 400 },
      { method: 'get', path: 'mw/nested/leaf', headers: { 'x-tenant-id': 'acme', 'x-nested': 'y' }, expected: 200 },
      { method: 'get', path: 'mw/nested/leaf', headers: { 'x-tenant-id': 'acme' }, expected: 400 },
      { method: 'get', path: 'nofrag', expected: 200 },

      { method: 'get', path: '/query', expected: 200 },
      { method: 'get', path: '/query?anything=42', expected: 200 },
      { method: 'get', path: '/query/schema?bool=true&num=42&int=0&str=bar&literal=foo', expected: 200 },
      { method: 'get', path: '/query/schema?bool=false&num=36&int=1&str=foo&literal=foo&opt=opt', expected: 200 },
      { method: 'get', path: '/query/schema?bool=foo&num=42&int=0&str=bar&literal=foo&opt=opt', expected: 400 },
      { method: 'get', path: '/query/schema?bool=true&num=foo&int=0&str=bar&literal=foo&opt=opt', expected: 400 },
      { method: 'get', path: '/query/schema?bool=true&num=1&int=true&str=bar&literal=foo&opt=opt', expected: 400 },
      { method: 'get', path: '/query/schema?bool=true&num=1&int=0&literal=foo&opt=opt', expected: 400 },
      { method: 'get', path: '/query/schema?bool=true&num=1&int=0&str=str&literal=bar&opt=opt', expected: 400 },
      { method: 'get', path: '/query/schema?bool=true&num=1&int=0&str=str&literal=foo&opt=noop', expected: 400 },

      { method: 'get', path: '/body', body: null, expected: 200 },
      { method: 'get', path: '/body/schema', body: null, expected: 200 },
      { method: 'option', path: '/body', body: null, expected: 200 },
      { method: 'option', path: '/body/schema', body: null, expected: 200 },
      { method: 'head', path: '/body', body: null, expected: 200 },
      { method: 'head', path: '/body/schema', body: null, expected: 200 },
      { method: 'post', path: '/body/post', body: null, expected: 200 },
      { method: 'patch', path: '/body/patch', body: null, expected: 200 },
      { method: 'post', path: '/body/post', body: null, expected: 200 },
      { method: 'patch', path: '/body/patch', body: null, expected: 200 },

      { method: 'post', path: '/body/ba', type: 'application/octet-stream', body: new Uint8Array([]), expected: 200 },
      {
        method: 'post',
        path: '/body/ba/stream',
        type: 'application/octet-stream',
        body: new Uint8Array([]),
        expected: 200,
      },

      { method: 'post', path: '/body/text/str', type: 'text/plain', body: 'hello', expected: 200 },
      { method: 'post', path: '/body/text/str', type: 'text/plain', body: null, expected: 200 },

      { method: 'post', path: '/body/text/literal', type: 'text/plain', body: 'foo', expected: 200 },
      { method: 'post', path: '/body/text/literal', type: 'text/plain', body: 'bar', expected: 400 },

      { method: 'post', path: '/body/text/bool', type: 'text/plain', body: 'true', expected: 200 },
      { method: 'post', path: '/body/text/bool', type: 'text/plain', body: 'false', expected: 200 },
      { method: 'post', path: '/body/text/bool', type: 'text/plain', body: '0', expected: 400 },

      { method: 'post', path: '/body/text/num', type: 'text/plain', body: '0', expected: 200 },
      { method: 'post', path: '/body/text/num', type: 'text/plain', body: '-42', expected: 200 },
      { method: 'post', path: '/body/text/num', type: 'text/plain', body: '42.42', expected: 200 },
      { method: 'post', path: '/body/text/num', type: 'text/plain', body: 'true', expected: 400 },
      { method: 'post', path: '/body/text/num', type: 'text/plain', body: null, expected: 400 },

      { method: 'post', path: '/body/text/int', type: 'text/plain', body: '0', expected: 200 },
      { method: 'post', path: '/body/text/int', type: 'text/plain', body: '-42', expected: 200 },
      { method: 'post', path: '/body/text/int', type: 'text/plain', body: '42.42', expected: 400 },
      { method: 'post', path: '/body/text/int', type: 'text/plain', body: 'true', expected: 400 },
      { method: 'post', path: '/body/text/int', type: 'text/plain', body: null, expected: 400 },

      { method: 'post', path: '/body/text/union', type: 'text/plain', body: 'foo', expected: 200 },
      { method: 'post', path: '/body/text/union', type: 'text/plain', body: '42', expected: 200 },
      { method: 'post', path: '/body/text/union', type: 'text/plain', body: 'hello', expected: 400 },
      { method: 'post', path: '/body/text/stream', type: 'text/plain', body: '42424242', expected: 200 },
      { method: 'post', path: '/body/text/stream', type: 'text/plain', body: null, expected: 200 },

      { method: 'post', path: '/body/json/bool', type: 'application/json', body: 'true', expected: 200 },
      { method: 'post', path: '/body/json/bool', type: 'application/json', body: 'false', expected: 200 },
      { method: 'post', path: '/body/json/bool', type: 'application/json', body: '0', expected: 400 },
      { method: 'post', path: '/body/json/bool', type: 'application/json', body: '', expected: 400 },
      { method: 'post', path: '/body/json/bool', type: 'application/json', body: null, expected: 400 },

      { method: 'post', path: '/body/json/num', type: 'application/json', body: '1', expected: 200 },
      { method: 'post', path: '/body/json/num', type: 'application/json', body: '1.5', expected: 200 },
      { method: 'post', path: '/body/json/num', type: 'application/json', body: 'foo', expected: 400 },
      { method: 'post', path: '/body/json/num', type: 'application/json', body: '', expected: 400 },
      { method: 'post', path: '/body/json/num', type: 'application/json', body: null, expected: 400 },

      { method: 'post', path: '/body/json/int', type: 'application/json', body: '1', expected: 200 },
      { method: 'post', path: '/body/json/int', type: 'application/json', body: '1.5', expected: 400 },
      { method: 'post', path: '/body/json/int', type: 'application/json', body: 'foo', expected: 400 },
      { method: 'post', path: '/body/json/int', type: 'application/json', body: '', expected: 400 },
      { method: 'post', path: '/body/json/int', type: 'application/json', body: null, expected: 400 },

      { method: 'post', path: '/body/json/str', type: 'application/json', body: '"foo"', expected: 200 },
      { method: 'post', path: '/body/json/str', type: 'application/json', body: 'foo', expected: 400 },
      { method: 'post', path: '/body/json/str', type: 'application/json', body: '', expected: 400 },
      { method: 'post', path: '/body/json/str', type: 'application/json', body: null, expected: 400 },

      { method: 'post', path: '/body/json/arr', type: 'application/json', body: '[]', expected: 200 },
      { method: 'post', path: '/body/json/arr', type: 'application/json', body: '["foo","bar"]', expected: 200 },
      { method: 'post', path: '/body/json/arr', type: 'application/json', body: '["foo","bar",42]', expected: 400 },
      { method: 'post', path: '/body/json/arr', type: 'application/json', body: '', expected: 400 },
      { method: 'post', path: '/body/json/arr', type: 'application/json', body: null, expected: 400 },

      { method: 'post', path: '/body/json/union', type: 'application/json', body: '"foo"', expected: 200 },
      { method: 'post', path: '/body/json/union', type: 'application/json', body: '""', expected: 200 },
      { method: 'post', path: '/body/json/union', type: 'application/json', body: 'true', expected: 200 },
      { method: 'post', path: '/body/json/union', type: 'application/json', body: 'false', expected: 200 },
      { method: 'post', path: '/body/json/union', type: 'application/json', body: '42', expected: 400 },
      { method: 'post', path: '/body/json/union', type: 'application/json', body: '', expected: 400 },
      { method: 'post', path: '/body/json/union', type: 'application/json', body: null, expected: 400 },

      {
        method: 'post',
        path: '/body/json/intersection',
        type: 'application/json',
        body: '{"foo":"foo","bar":42}',
        expected: 200,
      },
      {
        method: 'post',
        path: '/body/json/intersection',
        type: 'application/json',
        body: '{"foo":"foo"}',
        expected: 400,
      },
      { method: 'post', path: '/body/json/intersection', type: 'application/json', body: '{"bar":42}', expected: 400 },
      { method: 'post', path: '/body/json/intersection', type: 'application/json', body: '{}', expected: 400 },
      { method: 'post', path: '/body/json/intersection', type: 'application/json', body: '', expected: 400 },
      { method: 'post', path: '/body/json/intersection', type: 'application/json', body: null, expected: 400 },

      { method: 'post', path: '/body/json/obj', type: 'application/json', body: '{"foo":"bar"}', expected: 200 },
      { method: 'post', path: '/body/json/obj', type: 'application/json', body: '{"foo":42}', expected: 400 },
      { method: 'post', path: '/body/json/obj', type: 'application/json', body: '{}', expected: 400 },
      { method: 'post', path: '/body/json/obj', type: 'application/json', body: '', expected: 400 },
      { method: 'post', path: '/body/json/obj', type: 'application/json', body: null, expected: 400 },

      {
        method: 'post',
        path: '/body/urlForm',
        type: 'application/x-www-form-urlencoded',
        body: 'foo=foo&bar=42&opt=opt',
        expected: 200,
      },
      {
        method: 'post',
        path: '/body/urlForm',
        type: 'application/x-www-form-urlencoded',
        body: 'foo=bar&bar=0',
        expected: 200,
      },
      {
        method: 'post',
        path: '/body/urlForm',
        type: 'application/x-www-form-urlencoded',
        body: 'foo=test&bar=no',
        expected: 400,
      },
      {
        method: 'post',
        path: '/body/urlForm',
        type: 'application/x-www-form-urlencoded',
        body: 'foo=test&bar=1&opt=no',
        expected: 400,
      },
      {
        method: 'post',
        path: '/body/urlForm',
        type: 'application/x-www-form-urlencoded',
        body: 'foo=test',
        expected: 400,
      },
      {
        method: 'post',
        path: '/body/urlForm',
        type: 'application/x-www-form-urlencoded',
        body: '',
        expected: 400,
      },
      {
        method: 'post',
        path: '/body/urlForm',
        type: 'application/x-www-form-urlencoded',
        body: null,
        expected: 400,
      },

      {
        method: 'post',
        path: '/body/multipart',
        body: formdata({ foo: 'foo', bar: '42', opt: 'opt' }),
        expected: 200,
      },
      {
        method: 'post',
        path: '/body/multipart',
        body: formdata({ foo: 'foo', bar: '42' }),
        expected: 200,
      },
      {
        method: 'post',
        path: '/body/multipart',
        body: formdata({ bar: '42' }),
        expected: 400,
      },
      {
        method: 'post',
        path: '/body/multipart',
        body: formdata({ foo: 'foo', bar: 'bar' }),
        expected: 400,
      },
      {
        method: 'post',
        path: '/body/multipart',
        body: formdata({}),
        expected: 400,
      },
      {
        method: 'post',
        path: '/body/multipart',
        body: null,
        expected: 400,
      },

      {
        method: 'post',
        path: '/body/multipart/stream',
        body: formdata({ foo: 'foo', bar: '42', opt: 'opt' }),
        expected: 200,
      },
      {
        method: 'post',
        path: '/body/multipart/stream',
        body: formdata({ foo: 'foo', bar: '42' }),
        expected: 200,
      },
      {
        method: 'post',
        path: '/body/multipart/stream',
        body: formdata({ bar: '42' }),
        expected: 400,
      },
      {
        method: 'post',
        path: '/body/multipart/stream',
        body: formdata({ foo: 'foo', bar: 'bar' }),
        expected: 400,
      },
      {
        method: 'post',
        path: '/body/multipart/stream',
        body: formdata({}),
        expected: 400,
      },
      {
        method: 'post',
        path: '/body/multipart/stream',
        body: null,
        expected: 400,
      },
    ]
    for (let { method, path, type, body, expected, headers: reqHeaders } of cases) {
      let resp = await fetch(`http://localhost:${port}/${path}`, {
        method: method.toUpperCase(),
        body,
        headers: { ...(type ? { 'content-type': type } : {}), ...(reqHeaders ?? {}) },
      })
      if (resp.status !== expected) console.log(await resp.json())
      expect(resp.status).toBe(expected)
    }
  })
})
