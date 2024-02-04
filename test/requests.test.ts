import { expect, test, describe, beforeAll } from 'bun:test'
import { Kadre, T, type Context } from '../src/index'

const port = 7357
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options']
const decoder = new TextDecoder()

type Case = {
  body?: any
  type?: string
  schema: string
  expected: { status: number; type?: string; resp?: any }
}
const formdata = (data: Record<string, string | string[] | Blob>): FormData => {
  const form = new FormData()
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) for (const v2 of v) form.append(k, v2)
    else form.append(k, v)
  }
  return form
}
const fileHash = async (ba: any) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', ba)))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')

const isAsyncIterator = (obj: any) => {
  if (Object(obj) !== obj) return false
  const method = obj[Symbol.asyncIterator]
  if (typeof method != 'function') return false
  const aIter = method.call(obj)
  return aIter === obj
}
const parseBody = async (body: any): Promise<any> =>
  typeof body === 'object' && body !== null && !Array.isArray(body)
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(body).map(async ([k, v]) => {
            if (v instanceof Uint8Array) return [k, await fileHash(v)]
            else return [k, await parseBody(v)]
          })
        )
      )
    : body
const parseAsyncIterator = async (body: any): Promise<any> => {
  const chunks = []
  let type
  for await (const chunk of body) {
    if (chunk instanceof Uint8Array) type = 'ByteArray'
    else if (typeof chunk === 'string') type = 'string'
    chunks.push(chunk)
  }
  // @ts-ignore
  if (type === 'ByteArray') return new Uint8Array(chunks.map(c => Array.from(c)).flat())
  if (type === 'string') return chunks.join('')
  return chunks
}
const handleBody = async (ctx: any) => {
  if (ctx.body === undefined) {
    return { type: 'undefined' }
  }
  if (ctx?.body instanceof ReadableStream) {
    let content = ''
    for await (const chunk of ctx.body) {
      if (typeof chunk === 'string') content += chunk
      else content += decoder.decode(chunk)
    }
    return { type: 'ReadableStream', content }
  }
  if (Array.isArray(ctx.body)) {
    return { type: 'array', content: ctx.body }
  }
  if (ctx?.body instanceof Uint8Array) {
    return { type: 'ByteArray', content: decoder.decode(ctx.body) }
  }
  if (isAsyncIterator(ctx.body)) {
    return { type: 'AsyncIterator', content: await parseAsyncIterator(ctx.body) }
  } else {
    return { type: typeof ctx.body, content: await parseBody(ctx.body) }
  }
}
const handleUrlFormStream = async (ctx: Context) => {
  let resp: Record<string, any> = {}
  for await (const [k, v] of ctx.body) {
    if (k in resp) {
      resp[k] = Array.isArray(resp[k]) ? [...resp[k], v] : [resp[k], v]
    } else resp[k] = v
  }
  return { type: 'object', content: resp }
}

const schema_objectBase = {
  ba: T.ByteArray(),
  string: T.String(),
  number: T.Number(),
  bool: T.Boolean(),
  any: T.Any(),
  optional: T.Optional(T.Any())
}
const schema_object = {
  ...schema_objectBase,
  object: T.Object(T.Any()),
  array: T.Array(T.Any())
}

describe('requests', () => {
  beforeAll(async () => {
    const kadre = new Kadre()

    kadre.get('/test', () => {})
    kadre.post('/test', () => {})
    kadre.put('/test', () => {})
    kadre.patch('/test', () => {})
    kadre.delete('/test', () => {})
    kadre.options('/test', () => {})

    kadre.get('/headers', ctx => {
      return ctx.headers
    })
    kadre.get(
      '/headers/schema',
      {
        headers: {
          string: T.String(),
          zero: T.Number(),
          number: T.Number(),
          'neg-number': T.Number(),
          float: T.Number(),
          integer: T.Integer(),
          'boolean-true': T.Boolean(),
          'boolean-false': T.Boolean()
        }
      },
      ctx => {
        return ctx.headers
      }
    )

    kadre.get('/params/:param1/separate/:param2/:param3', ctx => {
      return ctx.params
    })
    kadre.get(
      '/params/schema/:p1/:p2/:p3/:p4',
      {
        params: {
          p1: T.String(),
          p2: T.Number(),
          p3: T.Integer(),
          p4: T.Boolean()
        }
      },
      ctx => {
        return ctx.params
      }
    )

    kadre.get('/query/params', ctx => {
      return ctx.query
    })
    kadre.get(
      '/query/params/schema',
      {
        query: {
          p1: T.String(),
          p2: T.Number(),
          p3: T.Boolean(),
          p4: T.Union([T.Number(), T.Boolean()]),
          p5: T.Optional(T.String())
        }
      },
      ctx => {
        return ctx.query
      }
    )

    kadre.post('/none', handleBody)
    kadre.post('/ba', { body: T.ByteArray() }, handleBody)
    kadre.post('/bool', { body: T.Boolean() }, handleBody)
    kadre.post('/num', { body: T.Number() }, handleBody)
    kadre.post('/str', { body: T.String() }, handleBody)
    kadre.post('/arr', { body: T.Array(T.Any()) }, handleBody)
    kadre.post('/obj', { body: T.Object(T.Any()) }, handleBody)

    kadre.post('/form', { body: T.UrlForm(T.Any()) }, handleBody)
    kadre.post('/mp', { body: T.MultipartForm(T.Any()) }, handleBody)

    kadre.post('/stream/ba', { body: T.Stream(T.ByteArray()) }, handleBody)
    kadre.post('/stream/str', { body: T.Stream(T.String()) }, handleBody)
    kadre.post('/stream/form', { body: T.Stream(T.UrlForm(T.Any())) }, async ctx => {
      let resp: Record<string, any> = {}
      for await (const [k, v] of ctx.body) {
        if (k in resp) {
          resp[k] = Array.isArray(resp[k]) ? [...resp[k], v] : [resp[k], v]
        } else resp[k] = v
      }
      return { type: 'object', content: resp }
    })
    kadre.post('/stream/mp', { body: T.Stream(T.MultipartForm(T.Any())) }, async ctx => {
      let resp: Record<string, any> = {}
      for await (const field of ctx.body) {
        let k = field.headers.name
        if (k in resp) {
          resp[k].content = Array.isArray(resp[k]?.content)
            ? [...resp[k].content, field.content]
            : [resp[k]?.content, field.content]
        } else resp[k] = field
      }
      return { type: 'object', content: resp }
    })

    kadre.post('/obj/schema/base', { body: T.Object(schema_object) }, handleBody)
    kadre.post(
      '/form/schema/base',
      {
        body: T.UrlForm({
          ...schema_objectBase,
          union: T.Optional(T.Union([T.Number(), T.Boolean()])),
          literal: T.Optional(T.Literal('x')),
          array: T.Array(T.Any())
        })
      },
      handleBody
    )
    kadre.post(
      '/form/stream/schema/base',
      {
        body: T.Stream(
          T.UrlForm({
            ...schema_objectBase,
            union: T.Optional(T.Union([T.Number(), T.Boolean()])),
            literal: T.Optional(T.Literal('x')),
            array: T.Array(T.Any()),
            numArray: T.Optional(T.Array(T.Number()))
          })
        )
      },
      handleUrlFormStream
    )
    kadre.post(
      '/mp/schema/base',
      {
        body: T.MultipartForm({
          ...schema_objectBase,
          union: T.Optional(T.Union([T.Number(), T.Boolean()])),
          literal: T.Optional(T.Literal('x')),
          array: T.Array(T.Any())
        })
      },
      handleBody
    )
    kadre.post(
      '/mp/stream/schema/base',
      {
        body: T.Stream(
          T.MultipartForm({
            ...schema_objectBase,
            union: T.Optional(T.Union([T.Number(), T.Boolean()])),
            literal: T.Optional(T.Literal('x')),
            array: T.Array(T.Any())
          })
        )
      },
      handleBody
    )

    let schema_jsonFile = {
      string: T.String(),
      number: T.Number(),
      bool: T.Boolean(),
      arrayStr: T.Array(T.String()),
      arrayNumber: T.Array(T.Number()),
      arrayBool: T.Array(T.Boolean())
    }

    kadre.post(
      '/mp/file',
      { body: T.MultipartForm({ imgFile: T.ByteArray(), jsonFile: T.Object(schema_jsonFile) }) },
      handleBody
    )
    kadre.post(
      '/mp/stream/file',
      { body: T.Stream(T.MultipartForm({ imgFile: T.ByteArray(), jsonFile: T.Object(schema_jsonFile) })) },
      async ctx => {
        if (isAsyncIterator(ctx.body)) {
          const chunks = []
          for await (const chunk of ctx.body) {
            if (chunk.content instanceof Uint8Array) chunk.content = await fileHash(chunk.content)
            chunks.push(chunk)
          }
          return { type: 'AsyncIterator', content: chunks }
        } else {
          return { type: null, content: 'error' }
        }
      }
    )
    kadre.post('/ba/file', { body: T.ByteArray() }, async ctx => {
      if (ctx?.body instanceof Uint8Array) {
        return { type: 'ByteArray', content: await fileHash(ctx.body) }
      } else {
        return { type: null, content: 'error' }
      }
    })
    kadre.post('/ba/stream/file', { body: T.Stream(T.ByteArray()) }, async ctx => {
      if (isAsyncIterator(ctx.body)) {
        let bytes = new Uint8Array()
        for await (const b of ctx.body) {
          bytes = new Uint8Array([...bytes, ...b])
        }
        return { type: 'AsyncIterator', content: await fileHash(bytes) }
      } else {
        return { type: null, content: 'error' }
      }
    })

    await kadre.listen(port)
  })

  test('methods, empty calls', async () => {
    for (let method of METHODS) {
      let resp = await fetch(`http://localhost:${port}/test`, { method: method.toUpperCase() })
      expect(resp.ok).toBeTrue()
    }
  })

  test('methods, path not found', async () => {
    for (let method of METHODS) {
      let resp = await fetch(`http://localhost:${port}/does/not/exist`, { method: method.toUpperCase() })
      expect(resp.status).toBe(404)
    }
  })

  test('headers', async () => {
    const headers = {
      String: 'hello mom',
      Number: '42',
      Boolean: 'true'
    }
    const expected = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))

    let resp = await fetch(`http://localhost:${port}/headers`, { headers })
    let body = await resp.json()

    expect(body).toMatchObject(expected)
  })

  test('path params', async () => {
    const expected = {
      param1: 'one',
      param2: '2',
      param3: 'true'
    }
    let resp = await fetch(`http://localhost:${port}/params/one/separate/2/true`)
    let body = await resp.json()

    expect(body).toEqual(expected)
  })

  test('query params', async () => {
    const expected = {
      param1: 'one',
      param2: '2',
      param3: 'true'
    }
    let resp = await fetch(`http://localhost:${port}/query/params?param1=one&param2=2&param3=true`)
    let body = await resp.json()

    expect(body).toEqual(expected)
  })

  test('no body, no header', async () => {
    const cases: Case[] = [
      { body: null, type: undefined, schema: 'none', expected: { status: 200, resp: null } },
      { body: null, type: undefined, schema: 'ba', expected: { status: 200, type: 'ByteArray', resp: '' } },
      { body: null, type: undefined, schema: 'bool', expected: { status: 400 } },
      { body: null, type: undefined, schema: 'num', expected: { status: 400 } },
      { body: null, type: undefined, schema: 'str', expected: { status: 400 } },
      { body: null, type: undefined, schema: 'arr', expected: { status: 400 } },
      { body: null, type: undefined, schema: 'obj', expected: { status: 400 } },
      { body: null, type: undefined, schema: 'form', expected: { status: 400 } },
      { body: null, type: undefined, schema: 'mp', expected: { status: 400 } },
      { body: null, type: undefined, schema: 'stream/ba', expected: { status: 200, type: 'ReadableStream', resp: '' } },
      { body: null, type: undefined, schema: 'stream/str', expected: { status: 400 } },
      { body: null, type: undefined, schema: 'stream/form', expected: { status: 400 } },
      { body: null, type: undefined, schema: 'stream/mp', expected: { status: 400 } }
    ]
    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: {
          ...(type ? { 'content-type': type } : {})
        }
      })

      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (expected.type) expect(respBody.type).toEqual(expected.type)
      if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
      else expect(respBody.content).toEqual(expected.resp)
    }
  })

  test('no body, application/octet-stream', async () => {
    const contentType = 'application/octet-stream'
    const cases: Case[] = [
      { body: null, type: contentType, schema: 'none', expected: { status: 200, resp: '' } },
      { body: null, type: contentType, schema: 'ba', expected: { status: 200, type: 'ByteArray', resp: '' } },
      { body: null, type: contentType, schema: 'bool', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'num', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'str', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'arr', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'obj', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'form', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'mp', expected: { status: 400 } },
      {
        body: null,
        type: contentType,
        schema: 'stream/ba',
        expected: { status: 200, type: 'ReadableStream', resp: '' }
      },
      { body: null, type: contentType, schema: 'stream/str', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'stream/form', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'stream/mp', expected: { status: 400 } }
    ]

    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: {
          ...(type ? { 'content-type': type } : {})
        }
      })

      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (expected.type) expect(respBody.type).toEqual(expected.type)
      if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
      else expect(respBody.content).toEqual(expected.resp)
    }
  })

  test('no body, application/json', async () => {
    const contentType = 'application/json'
    const cases: Case[] = [
      { body: null, type: contentType, schema: 'none', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'ba', expected: { status: 200, type: 'ByteArray', resp: '' } },
      { body: null, type: contentType, schema: 'bool', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'num', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'str', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'arr', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'obj', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'form', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'mp', expected: { status: 400 } },
      {
        body: null,
        type: contentType,
        schema: 'stream/ba',
        expected: { status: 200, type: 'ReadableStream', resp: '' }
      },
      { body: null, type: contentType, schema: 'stream/str', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'stream/form', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'stream/mp', expected: { status: 400 } }
    ]

    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: {
          ...(type ? { 'content-type': type } : {})
        }
      })

      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (expected.type) expect(respBody.type).toEqual(expected.type)
      if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
      else expect(respBody.content).toEqual(expected.resp)
    }
  })

  test('no body, text/plain', async () => {
    const contentType = 'text/plain'
    const cases: Case[] = [
      { body: null, type: contentType, schema: 'none', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'ba', expected: { status: 200, type: 'ByteArray', resp: '' } },
      { body: null, type: contentType, schema: 'bool', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'num', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'str', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'arr', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'obj', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'form', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'mp', expected: { status: 400 } },
      {
        body: null,
        type: contentType,
        schema: 'stream/ba',
        expected: { status: 200, type: 'ReadableStream', resp: '' }
      },
      { body: null, type: contentType, schema: 'stream/str', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'stream/form', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'stream/mp', expected: { status: 400 } }
    ]

    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: {
          ...(type ? { 'content-type': type } : {})
        }
      })

      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (expected.type) expect(respBody.type).toEqual(expected.type)
      if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
      else expect(respBody.content).toEqual(expected.resp)
    }
  })

  test('no body, application/x-www-form-urlencoded', async () => {
    const contentType = 'application/x-www-form-urlencoded'
    const cases: Case[] = [
      { body: null, type: contentType, schema: 'none', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'ba', expected: { status: 200, type: 'ByteArray', resp: '' } },
      { body: null, type: contentType, schema: 'bool', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'num', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'str', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'arr', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'obj', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'form', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'mp', expected: { status: 400 } },
      {
        body: null,
        type: contentType,
        schema: 'stream/ba',
        expected: { status: 200, type: 'ReadableStream', resp: '' }
      },
      { body: null, type: contentType, schema: 'stream/str', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'stream/form', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'stream/mp', expected: { status: 400 } }
    ]

    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: {
          ...(type ? { 'content-type': type } : {})
        }
      })

      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (expected.type) expect(respBody.type).toEqual(expected.type)
      if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
      else expect(respBody.content).toEqual(expected.resp)
    }
  })

  test('no body, multipart/form-data', async () => {
    const contentType = 'multipart/form-data'
    const cases: Case[] = [
      { body: null, type: contentType, schema: 'none', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'ba', expected: { status: 200, type: 'ByteArray', resp: '' } },
      { body: null, type: contentType, schema: 'bool', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'num', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'str', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'arr', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'obj', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'form', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'mp', expected: { status: 400 } },
      {
        body: null,
        type: contentType,
        schema: 'stream/ba',
        expected: { status: 200, type: 'ReadableStream', resp: '' }
      },
      { body: null, type: contentType, schema: 'stream/str', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'stream/form', expected: { status: 400 } },
      { body: null, type: contentType, schema: 'stream/mp', expected: { status: 400 } }
    ]

    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: {
          ...(type ? { 'content-type': type } : {})
        }
      })

      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (expected.type) expect(respBody.type).toEqual(expected.type)
      if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
      else expect(respBody.content).toEqual(expected.resp)
    }
  })

  test('body, no header', async () => {
    const cases: Case[] = [
      { body: 'test', schema: 'none', expected: { status: 200, type: 'ByteArray', resp: 'test' } },
      { body: 'test', schema: 'ba', expected: { status: 200, type: 'ByteArray', resp: 'test' } },
      { body: 'true', schema: 'bool', expected: { status: 200, type: 'boolean', resp: true } },
      { body: 'false', schema: 'bool', expected: { status: 200, type: 'boolean', resp: false } },
      { body: 'test', schema: 'bool', expected: { status: 400 } },
      { body: '0', schema: 'num', expected: { status: 200, type: 'number', resp: 0 } },
      { body: '42', schema: 'num', expected: { status: 200, type: 'number', resp: 42 } },
      { body: '-8000', schema: 'num', expected: { status: 200, type: 'number', resp: -8000 } },
      { body: '3.14', schema: 'num', expected: { status: 200, type: 'number', resp: 3.14 } },
      { body: 'test', schema: 'num', expected: { status: 400 } },
      { body: 'test', schema: 'str', expected: { status: 200, type: 'string', resp: 'test' } },
      { body: '42', schema: 'str', expected: { status: 200, type: 'string', resp: '42' } },
      { body: 'false', schema: 'str', expected: { status: 200, type: 'string', resp: 'false' } },
      { body: '[]', schema: 'arr', expected: { status: 200, type: 'array', resp: [] } },
      {
        body: '["a", 42, true, null, {"foo": "bar"}]',
        schema: 'arr',
        expected: { status: 200, type: 'array', resp: ['a', 42, true, null, { foo: 'bar' }] }
      },
      { body: 'test', schema: 'arr', expected: { status: 400 } },
      { body: '{}', schema: 'obj', expected: { status: 200, type: 'object', resp: {} } },
      { body: '{"foo": "bar"}', schema: 'obj', expected: { status: 200, type: 'object', resp: { foo: 'bar' } } },
      { body: 'test', schema: 'obj', expected: { status: 400 } },
      { body: 'test', schema: 'form', expected: { status: 400 } },
      { body: 'test', schema: 'mp', expected: { status: 400 } },
      {
        body: 'test',
        schema: 'stream/ba',
        expected: { status: 200, type: 'AsyncIterator', resp: new Uint8Array([116, 101, 115, 116]) }
      },
      { body: 'test', schema: 'stream/str', expected: { status: 200, type: 'AsyncIterator', resp: 'test' } },
      { body: 'test', schema: 'stream/form', expected: { status: 400 } },
      { body: 'test', schema: 'stream/mp', expected: { status: 400 } }
    ]

    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: {
          ...(type ? { 'content-type': type } : {})
        }
      })

      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (expected.type) expect(respBody.type).toEqual(expected.type)
      if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
      else expect(respBody.content).toEqual(expected.resp)
    }
  })

  test('body, application/octet-stream', async () => {
    const contentType = 'application/octet-stream'
    const cases: Case[] = [
      { body: 'test', type: contentType, schema: 'none', expected: { status: 200, type: 'ByteArray', resp: 'test' } },
      { body: 'test', type: contentType, schema: 'ba', expected: { status: 200, type: 'ByteArray', resp: 'test' } },
      { body: 'true', type: contentType, schema: 'bool', expected: { status: 200, type: 'boolean', resp: true } },
      { body: 'false', type: contentType, schema: 'bool', expected: { status: 200, type: 'boolean', resp: false } },
      { body: 'test', type: contentType, schema: 'bool', expected: { status: 400 } },
      { body: '0', type: contentType, schema: 'num', expected: { status: 200, type: 'number', resp: 0 } },
      { body: '42', type: contentType, schema: 'num', expected: { status: 200, type: 'number', resp: 42 } },
      { body: '-8000', type: contentType, schema: 'num', expected: { status: 200, type: 'number', resp: -8000 } },
      { body: '3.14', type: contentType, schema: 'num', expected: { status: 200, type: 'number', resp: 3.14 } },
      { body: 'test', type: contentType, schema: 'num', expected: { status: 400 } },
      { body: 'test', type: contentType, schema: 'str', expected: { status: 200, type: 'string', resp: 'test' } },
      { body: '42', type: contentType, schema: 'str', expected: { status: 200, type: 'string', resp: '42' } },
      { body: 'false', type: contentType, schema: 'str', expected: { status: 200, type: 'string', resp: 'false' } },
      { body: '[]', type: contentType, schema: 'arr', expected: { status: 200, type: 'array', resp: [] } },
      {
        body: '["a", 42, true, null, {"foo": "bar"}]',
        type: contentType,
        schema: 'arr',
        expected: { status: 200, type: 'array', resp: ['a', 42, true, null, { foo: 'bar' }] }
      },
      { body: 'test', type: contentType, schema: 'arr', expected: { status: 400 } },
      { body: '{}', type: contentType, schema: 'obj', expected: { status: 200, type: 'object', resp: {} } },
      {
        body: '{"foo": "bar"}',
        type: contentType,
        schema: 'obj',
        expected: { status: 200, type: 'object', resp: { foo: 'bar' } }
      },
      { body: 'test', type: contentType, schema: 'obj', expected: { status: 400 } },
      { body: 'test', type: contentType, schema: 'form', expected: { status: 400 } },
      { body: 'test', type: contentType, schema: 'mp', expected: { status: 400 } },
      {
        body: 'test',
        type: contentType,
        schema: 'stream/ba',
        expected: { status: 200, type: 'AsyncIterator', resp: new Uint8Array([116, 101, 115, 116]) }
      },
      {
        body: 'test',
        type: contentType,
        schema: 'stream/str',
        expected: { status: 200, type: 'AsyncIterator', resp: 'test' }
      },
      { body: 'test', type: contentType, schema: 'stream/form', expected: { status: 400 } },
      { body: 'test', type: contentType, schema: 'stream/mp', expected: { status: 400 } }
    ]

    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: {
          ...(type ? { 'content-type': type } : {})
        }
      })

      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (expected.type) expect(respBody.type).toEqual(expected.type)
      if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
      else expect(respBody.content).toEqual(expected.resp)
    }
  })

  test('body, application/json', async () => {
    const contentType = 'application/json'
    const cases: Case[] = [
      {
        body: '{"foo":"bar"}',
        type: contentType,
        schema: 'none',
        expected: { status: 200, type: 'object', resp: { foo: 'bar' } }
      },
      { body: 'test', type: contentType, schema: 'none', expected: { status: 400 } },
      { body: 'test', type: contentType, schema: 'ba', expected: { status: 200, type: 'ByteArray', resp: 'test' } },
      { body: 'true', type: contentType, schema: 'bool', expected: { status: 200, type: 'boolean', resp: true } },
      { body: 'false', type: contentType, schema: 'bool', expected: { status: 200, type: 'boolean', resp: false } },
      { body: 'test', type: contentType, schema: 'bool', expected: { status: 400 } },
      { body: '0', type: contentType, schema: 'bool', expected: { status: 400 } },
      { body: '0', type: contentType, schema: 'num', expected: { status: 200, type: 'number', resp: 0 } },
      { body: '42', type: contentType, schema: 'num', expected: { status: 200, type: 'number', resp: 42 } },
      { body: '-8000', type: contentType, schema: 'num', expected: { status: 200, type: 'number', resp: -8000 } },
      { body: '3.14', type: contentType, schema: 'num', expected: { status: 200, type: 'number', resp: 3.14 } },
      { body: 'test', type: contentType, schema: 'num', expected: { status: 400 } },
      { body: '"test"', type: contentType, schema: 'str', expected: { status: 200, type: 'string', resp: 'test' } },
      { body: '"42"', type: contentType, schema: 'str', expected: { status: 200, type: 'string', resp: '42' } },
      { body: '"false"', type: contentType, schema: 'str', expected: { status: 200, type: 'string', resp: 'false' } },
      { body: 'test', type: contentType, schema: 'str', expected: { status: 400 } },
      { body: '[]', type: contentType, schema: 'arr', expected: { status: 200, type: 'array', resp: [] } },
      {
        body: '["a", 42, true, null, {"foo": "bar"}]',
        type: contentType,
        schema: 'arr',
        expected: { status: 200, type: 'array', resp: ['a', 42, true, null, { foo: 'bar' }] }
      },
      { body: 'test', type: contentType, schema: 'arr', expected: { status: 400 } },
      { body: '{}', type: contentType, schema: 'obj', expected: { status: 200, type: 'object', resp: {} } },
      {
        body: '{"foo": "bar"}',
        type: contentType,
        schema: 'obj',
        expected: { status: 200, type: 'object', resp: { foo: 'bar' } }
      },
      { body: 'test', type: contentType, schema: 'obj', expected: { status: 400 } },
      { body: 'test', type: contentType, schema: 'form', expected: { status: 400 } },
      { body: 'test', type: contentType, schema: 'mp', expected: { status: 400 } },
      {
        body: 'test',
        type: contentType,
        schema: 'stream/ba',
        expected: { status: 200, type: 'AsyncIterator', resp: new Uint8Array([116, 101, 115, 116]) }
      },
      {
        body: 'test',
        type: contentType,
        schema: 'stream/str',
        expected: { status: 200, type: 'AsyncIterator', resp: 'test' }
      },
      { body: 'test', type: contentType, schema: 'stream/form', expected: { status: 400 } },
      { body: 'test', type: contentType, schema: 'stream/mp', expected: { status: 400 } }
    ]

    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: {
          ...(type ? { 'content-type': type } : {})
        }
      })

      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (expected.type) expect(respBody.type).toEqual(expected.type)
      if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
      else expect(respBody.content).toEqual(expected.resp)
    }
  })

  test('body, text/plain', async () => {
    const contentType = 'text/plain'
    const cases: Case[] = [
      { body: 'test', type: contentType, schema: 'none', expected: { status: 200, type: 'string', resp: 'test' } },
      { body: 'test', type: contentType, schema: 'ba', expected: { status: 200, type: 'ByteArray', resp: 'test' } },
      { body: 'true', type: contentType, schema: 'bool', expected: { status: 200, type: 'boolean', resp: true } },
      { body: 'false', type: contentType, schema: 'bool', expected: { status: 200, type: 'boolean', resp: false } },
      { body: 'test', type: contentType, schema: 'bool', expected: { status: 400 } },
      { body: '0', type: contentType, schema: 'bool', expected: { status: 400 } },
      { body: '0', type: contentType, schema: 'num', expected: { status: 200, type: 'number', resp: 0 } },
      { body: '42', type: contentType, schema: 'num', expected: { status: 200, type: 'number', resp: 42 } },
      { body: '-8000', type: contentType, schema: 'num', expected: { status: 200, type: 'number', resp: -8000 } },
      { body: '3.14', type: contentType, schema: 'num', expected: { status: 200, type: 'number', resp: 3.14 } },
      { body: 'test', type: contentType, schema: 'num', expected: { status: 400 } },
      { body: 'test', type: contentType, schema: 'str', expected: { status: 200, type: 'string', resp: 'test' } },
      { body: '"test"', type: contentType, schema: 'str', expected: { status: 200, type: 'string', resp: '"test"' } },
      { body: '42', type: contentType, schema: 'str', expected: { status: 200, type: 'string', resp: '42' } },
      { body: 'false', type: contentType, schema: 'str', expected: { status: 200, type: 'string', resp: 'false' } },
      { body: '[]', type: contentType, schema: 'arr', expected: { status: 200, type: 'array', resp: [] } },
      {
        body: '["a", 42, true, null, {"foo": "bar"}]',
        type: contentType,
        schema: 'arr',
        expected: { status: 200, type: 'array', resp: ['a', 42, true, null, { foo: 'bar' }] }
      },
      { body: 'test', type: contentType, schema: 'arr', expected: { status: 400 } },
      { body: '{}', type: contentType, schema: 'obj', expected: { status: 200, type: 'object', resp: {} } },
      {
        body: '{"foo": "bar"}',
        type: contentType,
        schema: 'obj',
        expected: { status: 200, type: 'object', resp: { foo: 'bar' } }
      },
      { body: 'test', type: contentType, schema: 'obj', expected: { status: 400 } },
      { body: 'test', type: contentType, schema: 'form', expected: { status: 400 } },
      { body: 'test', type: contentType, schema: 'mp', expected: { status: 400 } },
      {
        body: 'test',
        type: contentType,
        schema: 'stream/ba',
        expected: { status: 200, type: 'AsyncIterator', resp: new Uint8Array([116, 101, 115, 116]) }
      },
      {
        body: 'test',
        type: contentType,
        schema: 'stream/str',
        expected: { status: 200, type: 'AsyncIterator', resp: 'test' }
      },
      { body: 'test', type: contentType, schema: 'stream/form', expected: { status: 400 } },
      { body: 'test', type: contentType, schema: 'stream/mp', expected: { status: 400 } }
    ]

    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: {
          ...(type ? { 'content-type': type } : {})
        }
      })

      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (expected.type) expect(respBody.type).toEqual(expected.type)
      if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
      else expect(respBody.content).toEqual(expected.resp)
    }
  })

  test('body, application/x-www-form-urlencoded', async () => {
    const contentType = 'application/x-www-form-urlencoded'
    const strBody = 'string=text&number=42&boolean=true&encoded%3D=%3D'
    const objBody = { string: 'text', number: '42', boolean: 'true', 'encoded=': '=' }
    const cases: Case[] = [
      { body: strBody, type: contentType, schema: 'none', expected: { status: 200, type: 'object', resp: objBody } },
      { body: strBody, type: contentType, schema: 'ba', expected: { status: 200, type: 'ByteArray', resp: strBody } },
      { body: strBody, type: contentType, schema: 'bool', expected: { status: 400 } },
      { body: strBody, type: contentType, schema: 'num', expected: { status: 400 } },
      { body: strBody, type: contentType, schema: 'str', expected: { status: 400 } },
      { body: strBody, type: contentType, schema: 'arr', expected: { status: 400 } },
      { body: strBody, type: contentType, schema: 'obj', expected: { status: 400 } },
      { body: strBody, type: contentType, schema: 'form', expected: { status: 200, type: 'object', resp: objBody } },
      { body: strBody, type: contentType, schema: 'mp', expected: { status: 400 } },
      {
        body: strBody,
        type: contentType,
        schema: 'stream/ba',
        expected: { status: 200, type: 'AsyncIterator', resp: Uint8Array.from(strBody, c => c.charCodeAt(0)) }
      },
      {
        body: strBody,
        type: contentType,
        schema: 'stream/str',
        expected: { status: 200, type: 'AsyncIterator', resp: strBody }
      },
      {
        body: strBody,
        type: contentType,
        schema: 'stream/form',
        expected: { status: 200, type: 'object', resp: objBody }
      },
      { body: strBody, type: contentType, schema: 'stream/mp', expected: { status: 400 } }
    ]

    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: {
          ...(type ? { 'content-type': type } : {})
        }
      })

      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (expected.type) expect(respBody.type).toEqual(expected.type)
      if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
      else expect(respBody.content).toEqual(expected.resp)
    }
  })

  test('body, multipart/form-data', async () => {
    const objBody = { string: 'text', number: '42', boolean: 'true' }
    const objResp = {
      string: {
        content: 'text',
        headers: {
          name: 'string'
        }
      },
      number: {
        content: '42',
        headers: {
          name: 'number'
        }
      },
      boolean: {
        content: 'true',
        headers: {
          name: 'boolean'
        }
      }
    }
    const objRespStrRgx = new RegExp(
      '^---WebkitFormBoundary[0-9a-f]{32}\r\nContent-Disposition: form-data; name="string"\r\n\r\ntext\r\n' +
        '---WebkitFormBoundary[0-9a-f]{32}\r\nContent-Disposition: form-data; name="number"\r\n\r\n42\r\n' +
        '---WebkitFormBoundary[0-9a-f]{32}\r\nContent-Disposition: form-data; name="boolean"\r\n\r\ntrue\r\n' +
        '---WebkitFormBoundary[0-9a-f]{32}--\r\n$'
    )
    const form = formdata(objBody)

    const cases: Case[] = [
      { body: form, schema: 'none', expected: { status: 200, type: 'object', resp: objResp } },
      { body: form, schema: 'ba', expected: { status: 200, type: 'ByteArray', resp: objRespStrRgx } },
      { body: form, schema: 'bool', expected: { status: 400 } },
      { body: form, schema: 'num', expected: { status: 400 } },
      { body: form, schema: 'str', expected: { status: 400 } },
      { body: form, schema: 'arr', expected: { status: 400 } },
      { body: form, schema: 'obj', expected: { status: 400 } },
      { body: form, schema: 'form', expected: { status: 400 } },
      { body: form, schema: 'mp', expected: { status: 200, type: 'object', resp: objResp } },
      {
        body: form,
        schema: 'stream/str',
        expected: { status: 200, type: 'AsyncIterator', resp: objRespStrRgx }
      },
      { body: form, schema: 'stream/form', expected: { status: 400 } },
      { body: form, schema: 'stream/mp', expected: { status: 200, type: 'object', resp: objResp } }
    ]

    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: {
          ...(type ? { 'content-type': type } : {})
        }
      })

      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (expected.type) expect(respBody.type).toEqual(expected.type)
      if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
      else if (expected.resp instanceof RegExp) expect(respBody.content).toMatch(expected.resp)
      else expect(respBody.content).toEqual(expected.resp)
    }
  })

  //-- Parser --//

  test('headers', async () => {
    const cases: any = [
      {
        h: {
          string: 'Hello',
          zero: '0',
          number: '42',
          'Neg-Number': '-10',
          float: '3.14',
          integer: '42',
          'boolean-true': 'true',
          'boolean-false': 'false'
        },
        expected: {
          body: {
            string: 'Hello',
            zero: 0,
            number: 42,
            'neg-number': -10,
            float: 3.14,
            integer: 42,
            'boolean-true': true,
            'boolean-false': false
          }
        }
      },
      {
        h: {
          string: 'Hello',
          zero: '0',
          number: '42',
          float: '3.14',
          integer: '42',
          'boolean-true': 'a',
          'boolean-false': 'false'
        },
        expected: {
          status: 400,
          body: {
            headers: {
              'neg-number': 'Required',
              'boolean-true': "a is not a valid boolean. Should be 'true' or 'false'"
            }
          }
        }
      }
    ]

    for (let { h, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/headers/schema`, { headers: h })
      let body = await resp.json()
      expect(resp.status).toBe(expected.status ?? 200)
      expect(body).toMatchObject(expected.body)
    }
  })

  test('path params, schema', async () => {
    const cases: any = [
      {
        p: { p1: 'one', p2: '3.14', p3: '42', p4: 'true' },
        expected: { body: { p1: 'one', p2: 3.14, p3: 42, p4: true } }
      },
      {
        p: { p1: '_', p2: 'test', p3: '42.5', p4: 'a' },
        expected: {
          status: 400,
          body: {
            params: {
              p2: 'test is not a valid number',
              p3: '42.5 is not a valid integer',
              p4: "a is not a valid boolean. Should be 'true' or 'false'"
            }
          }
        }
      }
    ]
    for (let { p, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/params/schema/${p.p1}/${p.p2}/${p.p3}/${p.p4}`)
      let body = await resp.json()
      expect(resp.status).toBe(expected.status ?? 200)
      expect(body).toEqual(expected.body)
    }
  })

  test('query params', async () => {
    const cases: any = [
      {
        p: { p1: 'one', p2: '3.14', p3: 'false', p4: '42' },
        expected: { body: { p1: 'one', p2: 3.14, p3: false, p4: 42 } }
      },
      {
        p: { p1: 'one', p2: '3.14', p3: 'true', p4: 'true', p5: 'hello' },
        expected: { body: { p1: 'one', p2: 3.14, p3: true, p4: true, p5: 'hello' } }
      },
      {
        p: { p1: '36', p2: 'a', p3: '0' },
        expected: {
          status: 400,
          body: {
            query: {
              p2: 'a is not a valid number',
              p3: "0 is not a valid boolean. Should be 'true' or 'false'",
              p4: 'Required'
            }
          }
        }
      }
    ]

    for (let { p, expected } of cases) {
      let search = new URLSearchParams()
      for (const [k, v] of Object.entries(p)) search.append(k, v as string)

      let resp = await fetch(`http://localhost:${port}/query/params/schema?${search.toString()}`)
      let body = await resp.json()

      expect(resp.status).toBe(expected.status ?? 200)
      expect(body).toEqual(expected.body)
    }
  })

  test('body, json, schema object', async () => {
    const type = 'application/json'
    const schema = 'obj/schema/base'
    const cases: Case[] = [
      {
        body: JSON.stringify({
          ba: '',
          string: '',
          number: 0,
          bool: false,
          object: {},
          array: [],
          any: false
        }),
        type,
        schema,
        expected: {
          status: 200,
          type: 'object',
          resp: { ba: '', string: '', number: 0, bool: false, object: {}, array: [], any: false }
        }
      },
      {
        body: JSON.stringify({
          ba: 'Hello',
          string: 'Mom!',
          number: 42,
          bool: true,
          object: { foo: 'bar' },
          array: [false, 'one', 2],
          any: '36',
          optional: 'optional'
        }),
        type,
        schema,
        expected: {
          status: 200,
          type: 'object',
          resp: {
            ba: 'Hello',
            string: 'Mom!',
            number: 42,
            bool: true,
            object: { foo: 'bar' },
            array: [false, 'one', 2],
            any: '36',
            optional: 'optional'
          }
        }
      },
      {
        body: JSON.stringify({
          ba: false,
          string: 42,
          number: 'a',
          bool: 'x',
          object: [],
          array: {},
          any: {}
        }),
        type,
        schema,
        expected: {
          status: 400,
          resp: {
            body: {
              ba: 'Not a valid ByteArray',
              string: '42 is not a valid string',
              number: 'a is not a valid number',
              bool: "x is not a valid boolean. Should be 'true' or 'false'",
              object: 'Expected an object, not an array',
              array: 'Not a valid array'
            }
          }
        }
      }
    ]
    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: { ...(type ? { 'content-type': type } : {}) }
      })
      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (resp.status === 200) {
        if (expected.type) expect(respBody.type).toEqual(expected.type)
        if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
        else expect(respBody.content).toEqual(expected.resp)
      } else {
        if (expected.resp === null) expect(respBody.content).toBeNull
        else expect(respBody).toEqual(expected.resp)
      }
    }
  })

  test('body, UrlForm, schema object', async () => {
    const type = 'application/x-www-form-urlencoded'
    const schema = 'form/schema/base'

    const cases: Case[] = [
      {
        body: 'ba=&string=&number=0&bool=false&any=false&union=true',
        type,
        schema,
        expected: {
          status: 200,
          type: 'object',
          resp: {
            ba: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            string: '',
            number: 0,
            bool: false,
            any: 'false',
            union: true,
            array: []
          }
        }
      },
      {
        body: 'ba=Hello&string=Mom!&number=42&bool=true&any=36&optional=optional&array=1&array=2&literal=x&union=42',
        type,
        schema,
        expected: {
          status: 200,
          type: 'object',
          resp: {
            ba: '185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969',
            string: 'Mom!',
            number: 42,
            bool: true,
            any: '36',
            optional: 'optional',
            literal: 'x',
            union: 42,
            array: ['1', '2']
          }
        }
      },
      {
        body: 'optional=optional',
        type,
        schema,
        expected: {
          status: 400,
          type: 'object',
          resp: {
            body: 'Missing fields: ba, string, number, bool, any'
          }
        }
      },
      {
        body: 'ba=&string=Hello&string=Mom!&number=aaa&bool=1&any=36&literal=y&union=X',
        type,
        schema,
        expected: {
          status: 400,
          resp: {
            body: {
              string: 'Multiple values found',
              number: 'aaa is not a valid number',
              bool: "1 is not a valid boolean. Should be 'true' or 'false'",
              literal: 'y is not a valid value',
              union: 'X could not be parsed to any of Number, Boolean'
            }
          }
        }
      }
    ]
    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: { ...(type ? { 'content-type': type } : {}) }
      })
      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (resp.status === 200) {
        if (expected.type) expect(respBody.type).toEqual(expected.type)
        if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
        else expect(respBody.content).toEqual(expected.resp)
      } else {
        if (expected.resp === null) expect(respBody.content).toBeNull
        else expect(respBody).toEqual(expected.resp)
      }
    }
  })

  test('body, UrlForm Stream, schema object', async () => {
    const type = 'application/x-www-form-urlencoded'
    const schema = 'form/stream/schema/base'

    const cases: Case[] = [
      {
        body: 'ba=&string=&number=0&bool=false&any=false&union=true',
        type,
        schema,
        expected: {
          status: 200,
          type: 'object',
          resp: {
            ba: new Uint8Array(),
            string: '',
            number: 0,
            bool: false,
            any: 'false',
            union: true,
            array: []
          }
        }
      },
      {
        body: 'ba=Hello&string=Mom!&number=42&bool=true&any=36&optional=optional&array=1&array=2&literal=x&union=42',
        type,
        schema,
        expected: {
          status: 200,
          type: 'object',
          resp: {
            ba: new Uint8Array([72, 101, 108, 108, 111]),
            string: 'Mom!',
            number: 42,
            bool: true,
            any: '36',
            optional: 'optional',
            literal: 'x',
            union: 42,
            array: ['1', '2']
          }
        }
      },
      {
        body: 'ba=Hello&string=Mom!&number=42&bool=true&any=36&optional=optional&array=1&array=2&literal=x&union=42&numArray=x',
        type,
        schema,
        expected: {
          status: 400,
          type: 'object',
          resp: {
            body: { numArray: 'x is not a valid number' }
          }
        }
      },
      {
        body: 'ba=&string=Hello&string=Mom!&number=1&bool=true&any=36&literal=y&union=X',
        type,
        schema,
        expected: {
          status: 400,
          resp: {
            body: {
              literal: 'y is not a valid value'
            }
          }
        }
      },
      {
        body: 'optional=otpional',
        type,
        schema,
        expected: {
          status: 400,
          resp: {
            body: 'Missing fields: ba, string, number, bool, any'
          }
        }
      }
    ]
    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: { ...(type ? { 'content-type': type } : {}) }
      })
      let respBody = (await resp.json()) as any

      expect(resp.status).toBe(expected.status)
      if (resp.status === 200) {
        if (expected.type) expect(respBody.type).toEqual(expected.type)
        if (expected.type === 'object' && expected.resp.content === null) expect(respBody).toBeNull
        else expect(respBody.content).toEqual(expected.resp)
      } else {
        if (expected.resp === null) expect(respBody).toBeNull
        else expect(respBody).toEqual(expected.resp)
      }
    }
  })

  test('body, MultipartForm, schema object', async () => {
    const schema = 'mp/schema/base'

    const cases: Case[] = [
      {
        body: formdata({ ba: '', string: '', number: '0', bool: 'false', any: 'false', union: 'true' }),
        schema,
        expected: {
          status: 200,
          type: 'object',
          resp: {
            ba: {
              content: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              headers: {
                name: 'ba'
              }
            },
            string: {
              content: '',
              headers: {
                name: 'string'
              }
            },
            number: {
              content: 0,
              headers: {
                name: 'number'
              }
            },
            bool: {
              content: false,
              headers: {
                name: 'bool'
              }
            },
            any: {
              content: 'false',
              headers: {
                name: 'any'
              }
            },
            union: {
              content: true,
              headers: {
                name: 'union'
              }
            },
            array: {
              content: [],
              headers: {
                name: 'array'
              }
            }
          }
        }
      },
      {
        body: formdata({
          ba: 'Hello',
          string: 'Mom!',
          number: '42',
          bool: 'true',
          any: '36',
          optional: 'optional',
          array: ['1', '2'],
          literal: 'x',
          union: '42'
        }),
        schema,
        expected: {
          status: 200,
          type: 'object',
          resp: {
            ba: {
              content: '185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969',
              headers: {
                name: 'ba'
              }
            },
            string: {
              content: 'Mom!',
              headers: {
                name: 'string'
              }
            },
            number: {
              content: 42,
              headers: {
                name: 'number'
              }
            },
            bool: {
              content: true,
              headers: {
                name: 'bool'
              }
            },
            any: {
              content: '36',
              headers: {
                name: 'any'
              }
            },
            optional: {
              content: 'optional',
              headers: {
                name: 'optional'
              }
            },
            array: {
              content: ['1', '2'],
              headers: {
                name: 'array'
              }
            },
            literal: {
              content: 'x',
              headers: {
                name: 'literal'
              }
            },
            union: {
              content: 42,
              headers: {
                name: 'union'
              }
            }
          }
        }
      },
      {
        body: formdata({ optional: 'optional' }),
        schema,
        expected: {
          status: 400,
          type: 'object',
          resp: {
            body: 'Missing fields: ba, string, number, bool, any'
          }
        }
      },
      {
        body: formdata({
          ba: '',
          string: ['Hello', 'Mom!'],
          number: 'aaa',
          bool: '1',
          any: '36',
          literal: 'y',
          union: 'X'
        }),
        schema,
        expected: {
          status: 400,
          resp: {
            body: {
              string: 'Multiple values found',
              number: 'aaa is not a valid number',
              bool: "1 is not a valid boolean. Should be 'true' or 'false'",
              literal: 'y is not a valid value',
              union: 'X could not be parsed to any of: Number, Boolean'
            }
          }
        }
      }
    ]
    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: { ...(type ? { 'content-type': type } : {}) }
      })
      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (resp.status === 200) {
        if (expected.type) expect(respBody.type).toEqual(expected.type)
        if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
        else expect(respBody.content).toEqual(expected.resp)
      } else {
        if (expected.resp === null) expect(respBody.content).toBeNull
        else expect(respBody).toEqual(expected.resp)
      }
    }
  })

  test('body, MultipartForm Stream, schema object', async () => {
    const schema = 'mp/stream/schema/base'

    const cases: Case[] = [
      {
        body: formdata({ ba: '', string: '', number: '0', bool: 'false', any: 'false', union: 'true' }),
        schema,
        expected: {
          status: 200,
          type: 'AsyncIterator',
          resp: [
            {
              content: new Uint8Array(),
              headers: {
                name: 'ba'
              }
            },
            {
              content: '',
              headers: {
                name: 'string'
              }
            },
            {
              content: 0,
              headers: {
                name: 'number'
              }
            },
            {
              content: false,
              headers: {
                name: 'bool'
              }
            },
            {
              content: 'false',
              headers: {
                name: 'any'
              }
            },
            {
              content: true,
              headers: {
                name: 'union'
              }
            },
            {
              content: [],
              headers: {
                name: 'array'
              }
            }
          ]
        }
      },
      {
        body: formdata({
          ba: 'Hello',
          string: 'Mom!',
          number: '42',
          bool: 'true',
          any: '36',
          optional: 'optional',
          array: ['1', '2'],
          literal: 'x',
          union: '42'
        }),
        schema,
        expected: {
          status: 200,
          type: 'AsyncIterator',
          resp: [
            {
              content: Uint8Array.from('Hello', c => c.charCodeAt(0)),
              headers: {
                name: 'ba'
              }
            },
            {
              content: 'Mom!',
              headers: {
                name: 'string'
              }
            },
            {
              content: 42,
              headers: {
                name: 'number'
              }
            },
            {
              content: true,
              headers: {
                name: 'bool'
              }
            },
            {
              content: '36',
              headers: {
                name: 'any'
              }
            },
            {
              content: 'optional',
              headers: {
                name: 'optional'
              }
            },
            {
              content: '1',
              headers: {
                name: 'array'
              }
            },
            {
              content: '2',
              headers: {
                name: 'array'
              }
            },
            {
              content: 'x',
              headers: {
                name: 'literal'
              }
            },
            {
              content: 42,
              headers: {
                name: 'union'
              }
            }
          ]
        }
      },
      {
        body: formdata({ optional: 'optional' }),
        schema,
        expected: {
          status: 400,
          type: 'object',
          resp: {
            body: 'Missing fields: ba, string, number, bool, any'
          }
        }
      },
      {
        body: formdata({
          ba: '',
          string: ['Hello', 'Mom!'],
          number: 'aaa',
          bool: '1',
          any: '36',
          literal: 'y',
          union: 'X'
        }),
        schema,
        expected: {
          status: 400,
          resp: {
            body: {
              number: 'aaa is not a valid number'
            }
          }
        }
      }
    ]
    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: { ...(type ? { 'content-type': type } : {}) }
      })
      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (resp.status === 200) {
        if (expected.type) expect(respBody.type).toEqual(expected.type)
        if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
        else expect(respBody.content).toEqual(expected.resp)
      } else {
        if (expected.resp === null) expect(respBody.content).toBeNull
        else expect(respBody).toEqual(expected.resp)
      }
    }
  })

  test('body, FileUpload', async () => {
    const imgFile = Bun.file('test/resources/image.png')
    const imgFileBytes = new Uint8Array(await imgFile.arrayBuffer())

    const jsonFile = Bun.file('test/resources/object.json')
    const missingJsonFile = Bun.file('test/resources/object.missing.json')
    const badSyntaxJsonFile = Bun.file('test/resources/object.badSyntax.json')

    const cases: Case[] = [
      {
        body: formdata({ imgFile, jsonFile }),
        schema: '/mp/file',
        expected: {
          status: 200,
          type: 'object',
          resp: {
            imgFile: {
              content: await fileHash(imgFileBytes),
              headers: {
                name: 'imgFile',
                filename: 'test/resources/image.png',
                type: 'image/png'
              }
            },
            jsonFile: {
              content: {
                string: 'test',
                number: 3.14,
                bool: true,
                arrayStr: ['un', 'deux', 'trois'],
                arrayNumber: [0],
                arrayBool: [true, false]
              },
              headers: {
                name: 'jsonFile',
                filename: 'test/resources/object.json',
                type: 'application/json'
              }
            }
          }
        }
      },
      {
        body: formdata({ imgFile, jsonFile: missingJsonFile }),
        schema: '/mp/file',
        expected: {
          status: 400,
          resp: {
            body: { jsonFile: { arrayBool: 'Required', arrayStr: 'Required' } }
          }
        }
      },
      {
        body: formdata({ imgFile, jsonFile: badSyntaxJsonFile }),
        schema: '/mp/file',
        expected: {
          status: 400,
          resp: {
            body: { jsonFile: "JSON Parse error: Expected '}'" }
          }
        }
      },
      {
        body: imgFileBytes,
        schema: '/ba/file',
        expected: {
          status: 200,
          type: 'ByteArray',
          resp: await fileHash(imgFileBytes)
        }
      }
    ]
    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: { ...(type ? { 'content-type': type } : {}) }
      })
      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (resp.status === 200) {
        if (expected.type) expect(respBody.type).toEqual(expected.type)
        if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
        else expect(respBody.content).toEqual(expected.resp)
      } else {
        if (expected.resp === null) expect(respBody.content).toBeNull
        else expect(respBody).toEqual(expected.resp)
      }
    }
  })

  test('body, FileUpload Stream', async () => {
    const imgFile = Bun.file('test/resources/image.png')
    const imgFileBytes = new Uint8Array(await imgFile.arrayBuffer())

    const jsonFile = Bun.file('test/resources/object.json')
    const missingJsonFile = Bun.file('test/resources/object.missing.json')
    const badSyntaxJsonFile = Bun.file('test/resources/object.badSyntax.json')

    const cases: Case[] = [
      {
        body: formdata({ imgFile, jsonFile }),
        schema: '/mp/stream/file',
        expected: {
          status: 200,
          type: 'AsyncIterator',
          resp: [
            {
              content: await fileHash(imgFileBytes),
              headers: {
                name: 'imgFile',
                filename: 'test/resources/image.png',
                type: 'image/png'
              }
            },
            {
              content: {
                string: 'test',
                number: 3.14,
                bool: true,
                arrayStr: ['un', 'deux', 'trois'],
                arrayNumber: [0],
                arrayBool: [true, false]
              },
              headers: {
                name: 'jsonFile',
                filename: 'test/resources/object.json',
                type: 'application/json'
              }
            }
          ]
        }
      },
      {
        body: formdata({ imgFile, jsonFile: missingJsonFile }),
        schema: '/mp/stream/file',
        expected: {
          status: 400,
          resp: {
            body: { jsonFile: { arrayBool: 'Required', arrayStr: 'Required' } }
          }
        }
      },
      {
        body: formdata({ imgFile, jsonFile: badSyntaxJsonFile }),
        schema: '/mp/stream/file',
        expected: {
          status: 400,
          resp: {
            body: { jsonFile: "JSON Parse error: Expected '}'" }
          }
        }
      },
      {
        body: imgFileBytes,
        schema: '/ba/stream/file',
        expected: {
          status: 200,
          type: 'AsyncIterator',
          resp: await fileHash(imgFileBytes)
        }
      }
    ]
    for (let { body, type, schema, expected } of cases) {
      let resp = await fetch(`http://localhost:${port}/${schema}`, {
        method: 'POST',
        body,
        headers: { ...(type ? { 'content-type': type } : {}) }
      })
      let respBody = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status)
      if (resp.status === 200) {
        if (expected.type) expect(respBody.type).toEqual(expected.type)
        if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
        else expect(respBody.content).toEqual(expected.resp)
      } else {
        if (expected.resp === null) expect(respBody.content).toBeNull
        else expect(respBody).toEqual(expected.resp)
      }
    }
  })
})
