import { $T, Galbe } from '../src'
import type { Static } from '../src/schema'
import { describe, test, expect, beforeAll } from 'bun:test'
import { formdata } from './test.utils'

// Test utils
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T
type Extends<A, B> = A extends B ? true : false

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

type _any = Expect<Extends<Static<typeof any>, any>>
type _nil = Expect<Extends<Static<typeof nil>, null>>
type _bool = Expect<Extends<Static<typeof bool>, boolean>>
type _num = Expect<Extends<Static<typeof num>, number>>
type _int = Expect<Extends<Static<typeof int>, number>>
type _str = Expect<Extends<Static<typeof str>, string>>
type _literal = Expect<Extends<Static<typeof literal>, 'foo'>>
type _ba = Expect<Extends<Static<typeof ba>, Uint8Array<ArrayBufferLike>>>
type _obj = Expect<Extends<Static<typeof obj>, Record<string | number, any>>>

// Basic schema wrappers

const opt_str = $T.optional($T.string())
const null_str = $T.nullable($T.string())
const nullish_str = $T.nullish($T.string())

type _opt_str = Expect<Extends<Static<typeof opt_str>, string | undefined>>
type _null_str = Expect<Extends<Static<typeof null_str>, string | null>>
type _nullish_str = Expect<Extends<Static<typeof nullish_str>, string | null | undefined>>

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

type _arr_nil = Expect<Extends<Static<typeof arr_nil>, null[]>>
type _arr_bool = Expect<Extends<Static<typeof arr_bool>, boolean[]>>
type _arr_num = Expect<Extends<Static<typeof arr_num>, number[]>>
type _arr_int = Expect<Extends<Static<typeof arr_int>, number[]>>
type _arr_str = Expect<Extends<Static<typeof arr_str>, string[]>>
type _arr_obj = Expect<Extends<Static<typeof arr_obj>, { foo: 42 }[]>>
type _arr_arr = Expect<Extends<Static<typeof arr_arr>, 'hello'[][]>>

type _arr_union = Expect<Extends<Static<typeof arr_union>, ('hello' | 'mom')[]>>
type _arr_intersection = Expect<Extends<Static<typeof arr_intersection>, ({ foo: string } & { bar: number })[]>>

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
      ba: Uint8Array<ArrayBufferLike>
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

type _union_str_number = Expect<Extends<Static<typeof union_str_number>, string | number>>
type _union_str_any = Expect<Extends<Static<typeof union_str_any>, any>>
type _union_union_number = Expect<Extends<Static<typeof union_union_number>, 'foo' | 'bar' | 'baz'>>
type _union_intersection = Expect<
  Extends<Static<typeof union_intersection>, ({ foo: 42 } & { bar: number }) | { test: 'test' }>
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

type _intersection_obj_obj = Expect<Extends<Static<typeof intersection_obj_obj>, { foo: string } & { bar: boolean }>>
type _intersection_union_obj = Expect<
  Extends<Static<typeof intersection_union_obj>, ({ foo: string } | { bar: boolean }) & { baz: 42 }>
>
type _intersection_intersection_obj = Expect<
  Extends<Static<typeof intersection_intersection_obj>, { foo: string } & { bar: boolean } & { baz: '42' }>
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

type _stream_ba = Expect<Extends<Static<typeof stream_ba>, AsyncGenerator<Uint8Array<ArrayBufferLike>>>>
type _stream_str = Expect<Extends<Static<typeof stream_str>, AsyncGenerator<string>>>
type _stream_obj = Expect<
  Extends<
    Static<typeof stream_obj>,
    AsyncGenerator<
      | ['foo', 'hi']
      | ['bar', number]
      | [
          'obj',
          {
            nested: boolean
          }
        ]
    >
  >
>
type _stream_multipart = Expect<
  Extends<
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
        }
    >
  >
>
type _stream_union = Expect<Extends<Static<typeof stream_union>, AsyncGenerator<['foo', string] | ['bar', boolean]>>>
type _stream_intersection = Expect<
  Extends<Static<typeof stream_intersection>, AsyncGenerator<['foo', string] | ['bar', boolean]>>
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
g.get('/body/schema', { body: $T.string() }, ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, null>>
  ctx.set.status = body === null ? 200 : 500
})
g.options('/body', ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, null>>
  ctx.set.status = body === null ? 200 : 500
})
g.options('/body/schema', { body: $T.string() }, ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, null>>
  ctx.set.status = body === null ? 200 : 500
})
g.head('/body', ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, null>>
  ctx.set.status = body === null ? 200 : 500
})
g.head('/body/schema', { body: $T.string() }, ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, null>>
  ctx.set.status = body === null ? 200 : 500
})

g.post('/body/post', ctx => {
  const { body } = ctx
  type _ep_body = Expect<Equal<typeof body, any>>
})
g.patch('/body/patch', ctx => {
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

g.post('/body/ba', { body: { byteArray: $T.byteArray() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, Uint8Array<ArrayBufferLike>>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'byteArray'>>
  ctx.set.status = body instanceof Uint8Array ? 200 : 500
})

g.post('/body/ba/stream', { body: { byteArray: $T.stream($T.byteArray()) } }, async ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Extends<typeof body, AsyncGenerator<Uint8Array<ArrayBufferLike>>>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'byteArray'>>
  for await (const bp of body) {
    if (body instanceof Uint8Array) ctx.set.status = 500
  }
})

// Body Text

g.post('/body/text/str', { body: { text: $T.string() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, string>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'text'>>
  ctx.set.status = typeof body === 'string' ? 200 : 500
})

g.post('/body/text/literal', { body: { text: $T.literal('foo') } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, 'foo'>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'text'>>
  ctx.set.status = body === 'foo' ? 200 : 500
})

g.post('/body/text/bool', { body: { text: $T.boolean() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, boolean>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'text'>>
  ctx.set.status = typeof body === 'boolean' ? 200 : 500
})

g.post('/body/text/num', { body: { text: $T.number() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, number>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'text'>>
  ctx.set.status = typeof body === 'number' ? 200 : 500
})

g.post('/body/text/int', { body: { text: $T.integer() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, number>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'text'>>
  ctx.set.status = typeof body === 'number' ? 200 : 500
})

g.post('/body/text/union', { body: { text: $T.union([$T.literal('foo'), $T.number()]) } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, 'foo' | number>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'text'>>
  ctx.set.status = body === 'foo' || typeof body === 'number' ? 200 : 500
})

g.post('/body/text/stream', { body: { text: $T.stream($T.string()) } }, async ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Extends<typeof body, AsyncGenerator<string>>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'text'>>
  for await (const chunk of body) if (typeof chunk !== 'string') ctx.set.status = 500
})

// Body Json

g.post('/body/json/bool', { body: { json: $T.boolean() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Extends<typeof body, boolean>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'json'>>
  ctx.set.status = typeof body === 'boolean' ? 200 : 500
})

g.post('/body/json/num', { body: { json: $T.number() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Extends<typeof body, number>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'json'>>
  ctx.set.status = typeof body === 'number' ? 200 : 500
})

g.post('/body/json/int', { body: { json: $T.integer() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Extends<typeof body, number>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'json'>>
  ctx.set.status = typeof body === 'number' ? 200 : 500
})

g.post('/body/json/str', { body: { json: $T.string() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Extends<typeof body, string>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'json'>>
  ctx.set.status = typeof body === 'string' ? 200 : 500
})

g.post('/body/json/arr', { body: { json: $T.array($T.string()) } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Extends<typeof body, string[]>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'json'>>
  ctx.set.status = Array.isArray(body) && body.every(i => typeof i === 'string') ? 200 : 500
})

g.post('/body/json/union', { body: { json: $T.union([$T.boolean(), $T.string()]) } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Extends<typeof body, boolean | string>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'json'>>
  ctx.set.status = typeof body === 'string' || typeof body === 'boolean' ? 200 : 500
})

g.post('/body/json/obj', { body: { json: $T.object({ foo: $T.string() }) } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Extends<typeof body, { foo: string }>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'json'>>
  ctx.set.status = typeof body.foo === 'string' ? 200 : 500
})

// Body UrlForm

g.post(
  '/body/urlForm',
  { body: { urlForm: $T.object({ foo: $T.string(), bar: $T.number(), opt: $T.optional($T.literal('opt')) }) } },
  ctx => {
    const { body, contentType } = ctx
    type _ep_body = Expect<Equal<typeof body, { foo: string; bar: number; opt?: 'opt' }>>
    type _ep_contentType = Expect<Extends<typeof contentType, 'urlForm'>>
    ctx.set.status =
      typeof body.foo === 'string' && typeof body.bar === 'number' && (body.opt ? body.opt === 'opt' : true) ? 200 : 500
  }
)

g.post(
  '/body/urlForm/union',
  { body: { urlForm: $T.union([$T.object({ foo: $T.string() }), $T.object({ bar: $T.boolean() })]) } },
  ctx => {
    const { body, contentType } = ctx
    type _ep_body = Expect<Extends<typeof body, { foo: string } | { bar: boolean }>>
    type _ep_contentType = Expect<Extends<typeof contentType, 'urlForm'>>
    //@ts-ignore
    typeof body.foo ? typeof body.foo === 'string' : true && body.bar ? typeof body.bar === 'number' : true ? 200 : 500
  }
)

g.post(
  '/body/urlForm/stream',
  { body: { urlForm: $T.stream($T.object({ foo: $T.string(), bar: $T.number() })) } },
  async ctx => {
    const { body, contentType } = ctx
    type _ep_body = Expect<Extends<typeof body, AsyncGenerator<['foo', string] | ['bar', number]>>>
    type _ep_contentType = Expect<Extends<typeof contentType, 'urlForm'>>
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
    body: { multipart: $T.multipartForm({ foo: $T.string(), bar: $T.number(), opt: $T.optional($T.literal('opt')) }) },
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
    type _ep_contentType = Expect<Extends<typeof contentType, 'multipart'>>
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
      multipart: $T.stream(
        $T.multipartForm({ foo: $T.string(), bar: $T.number(), opt: $T.optional($T.literal('opt')) })
      ),
    },
  },
  async ctx => {
    const { body, contentType } = ctx
    type _ep_body = Expect<
      Extends<
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
            }
        >
      >
    >
    type _ep_contentType = Expect<Extends<typeof contentType, 'multipart'>>
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

g.post('/body/default', { body: { default: $T.any() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, any>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'default'>>
})

g.post('/body/default/ba', { body: { default: $T.byteArray() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, Uint8Array<ArrayBufferLike>>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'default'>>
})

g.post('/body/default/str', { body: { default: $T.string() } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, string>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'default'>>
})

g.post('/body/default/stream/ba', { body: { default: $T.stream($T.byteArray()) } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, AsyncGenerator<Uint8Array<ArrayBufferLike>>>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'default'>>
})

g.post('/body/default/stream/str', { body: { default: $T.stream($T.string()) } }, ctx => {
  const { body, contentType } = ctx
  type _ep_body = Expect<Equal<typeof body, AsyncGenerator<string>>>
  type _ep_contentType = Expect<Extends<typeof contentType, 'default'>>
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
    }
    const cases: Case[] = [
      { method: 'get', path: '/params/noschema/foo/and/42', expected: 200 },
      { method: 'get', path: '/params/schema/true/0/1/foo/42', expected: 200 },
      { method: 'get', path: '/params/schema/foo/0/1/foo/42', expected: 400 },
      { method: 'get', path: '/params/schema/true/x/1/foo/42', expected: 400 },
      { method: 'get', path: '/params/schema/true/0/y/foo/42', expected: 400 },
      { method: 'get', path: '/params/schema/true/0/y/foo/43', expected: 400 },

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
    for (let { method, path, type, body, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${path}`, {
        method: method.toUpperCase(),
        body,
        headers: { ...(type ? { 'content-type': type } : {}) },
      })
      expect(resp.status).toBe(expected)
    }
  })
})
