import { expect, test, describe, beforeAll } from 'bun:test'
import { Kadre, T } from '../src'
import {
  formdata,
  type Case,
  fileHash,
  schema_objectBase,
  schema_object,
  handleBody,
  isAsyncIterator,
  handleUrlFormStream
} from './test.utils'

const port = 7358
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options']

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
          const chunks: any[] = []
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
})
