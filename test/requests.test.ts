import { expect, test, describe, beforeAll } from 'bun:test'
import { Galbe, $T } from '../src'
import { formdata, type Case, fileHash, handleBody, isAsyncIterator } from './test.utils'

const port = 7358
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']

describe('requests', () => {
  beforeAll(async () => {
    const galbe = new Galbe()

    galbe.get('/test', () => {})
    galbe.post('/test', () => {})
    galbe.put('/test', () => {})
    galbe.patch('/test', () => {})
    galbe.delete('/test', () => {})
    galbe.options('/test', () => {})
    galbe.head('/test', () => {})

    galbe.get('/headers', ctx => {
      return ctx.headers
    })
    galbe.get(
      '/headers/schema',
      {
        headers: {
          string: $T.string(),
          zero: $T.number(),
          number: $T.number(),
          'neg-number': $T.number(),
          float: $T.number(),
          integer: $T.integer(),
          'boolean-true': $T.boolean(),
          'boolean-false': $T.boolean()
        }
      },
      ctx => {
        return ctx.headers
      }
    )

    galbe.get('/params/:param1/separate/:param2/:param3', ctx => {
      return ctx.params
    })
    galbe.get(
      '/params/schema/:p1/:p2/:p3/:p4',
      {
        params: {
          p1: $T.string(),
          p2: $T.number(),
          p3: $T.integer(),
          p4: $T.boolean()
        }
      },
      ctx => {
        return ctx.params
      }
    )

    galbe.get('/query/params', ctx => {
      return ctx.query
    })
    galbe.get(
      '/query/params/schema',
      {
        query: {
          p1: $T.string(),
          p2: $T.number(),
          p3: $T.boolean(),
          p4: $T.union([$T.number(), $T.boolean()]),
          p5: $T.optional($T.string()),
          p6: $T.array($T.union([$T.string()]))
        }
      },
      ctx => {
        return ctx.query
      }
    )

    galbe.post('/none', handleBody)
    galbe.post('/ba', { body: $T.byteArray() }, handleBody)
    galbe.post('/bool', { body: $T.boolean() }, handleBody)
    galbe.post('/num', { body: $T.number() }, handleBody)
    galbe.post('/str', { body: $T.string() }, handleBody)
    galbe.post('/arr', { body: $T.array() }, handleBody)
    galbe.post('/obj', { body: $T.object($T.any()) }, handleBody)

    galbe.post('/form', { body: $T.urlForm() }, handleBody)
    galbe.post('/mp', { body: $T.multipartForm() }, handleBody)

    galbe.post('/stream/ba', { body: $T.stream($T.byteArray()) }, handleBody)
    galbe.post('/stream/str', { body: $T.stream($T.string()) }, handleBody)
    galbe.post('/stream/form', { body: $T.stream($T.urlForm()) }, async ctx => {
      let resp: Record<string, any> = {}
      for await (const [k, v] of ctx.body) {
        if (k in resp) {
          resp[k] = Array.isArray(resp[k]) ? [...resp[k], v] : [resp[k], v]
        } else resp[k] = v
      }
      return { type: 'object', content: resp }
    })
    galbe.post('/stream/mp', { body: $T.stream($T.multipartForm()) }, async ctx => {
      let resp: Record<string, any> = {}
      for await (const field of ctx.body) {
        let k = field?.headers.name
        if (k && k in resp) {
          resp[k].content = Array.isArray(resp[k]?.content)
            ? [...resp[k].content, field?.content]
            : [resp[k]?.content, field?.content]
        } else resp[k] = field
      }
      return { type: 'object', content: resp }
    })

    let schema_jsonFile = {
      string: $T.string(),
      number: $T.number(),
      bool: $T.boolean(),
      arrayStr: $T.array($T.string()),
      arrayNumber: $T.array($T.number()),
      arrayBool: $T.array($T.boolean())
    }

    galbe.post(
      '/mp/file',
      { body: $T.multipartForm({ imgFile: $T.byteArray(), jsonFile: $T.object(schema_jsonFile) }) },
      handleBody
    )
    galbe.post(
      '/mp/stream/file',
      { body: $T.stream($T.multipartForm({ imgFile: $T.byteArray(), jsonFile: $T.object(schema_jsonFile) })) },
      async ctx => {
        if (isAsyncIterator(ctx.body)) {
          const chunks: any[] = []
          for await (const chunk of ctx.body) {
            const c = { ...chunk } as any
            if (chunk.content instanceof Uint8Array) c.content = await fileHash(chunk.content)
            chunks.push(c)
          }
          return { type: 'AsyncIterator', content: chunks }
        } else {
          return { type: null, content: 'error' }
        }
      }
    )
    galbe.post('/ba/file', { body: $T.byteArray() }, async ctx => {
      if (ctx?.body instanceof Uint8Array) {
        return { type: 'byteArray', content: await fileHash(ctx.body) }
      } else {
        return { type: null, content: 'error' }
      }
    })
    galbe.post('/ba/stream/file', { body: $T.stream($T.byteArray()) }, async ctx => {
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

    await galbe.listen(port)
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
      { body: null, type: undefined, schema: 'ba', expected: { status: 200, type: 'byteArray', resp: '' } },
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
      { body: null, type: contentType, schema: 'ba', expected: { status: 200, type: 'byteArray', resp: '' } },
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
      { body: null, type: contentType, schema: 'ba', expected: { status: 200, type: 'byteArray', resp: '' } },
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
      { body: null, type: contentType, schema: 'ba', expected: { status: 200, type: 'byteArray', resp: '' } },
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
      { body: null, type: contentType, schema: 'ba', expected: { status: 200, type: 'byteArray', resp: '' } },
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
      { body: null, type: contentType, schema: 'ba', expected: { status: 200, type: 'byteArray', resp: '' } },
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
      { body: 'test', schema: 'none', expected: { status: 200, type: 'byteArray', resp: 'test' } },
      { body: 'test', schema: 'ba', expected: { status: 200, type: 'byteArray', resp: 'test' } },
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
        expected: { status: 200, type: 'AsyncIterator', resp: Object.fromEntries([116, 101, 115, 116].entries()) }
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

      console.log(respBody)

      expect(resp.status).toBe(expected.status)
      if (expected.type) expect(respBody.type).toEqual(expected.type)
      if (respBody.type === 'object' && expected.resp === null) expect(respBody.content).toBeNull
      // else if (respBody.type === 'AsyncIterator') expect(new Uint8Array(Object.values(respBody.content))).toEqual(expected.resp)
      else expect(respBody.content).toEqual(expected.resp)
    }
  })

  test('body, application/octet-stream', async () => {
    const contentType = 'application/octet-stream'
    const cases: Case[] = [
      { body: 'test', type: contentType, schema: 'none', expected: { status: 200, type: 'byteArray', resp: 'test' } },
      { body: 'test', type: contentType, schema: 'ba', expected: { status: 200, type: 'byteArray', resp: 'test' } },
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
        expected: { status: 200, type: 'AsyncIterator', resp: Object.fromEntries(new Uint8Array([116, 101, 115, 116]).entries()) }
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
      { body: 'test', type: contentType, schema: 'ba', expected: { status: 200, type: 'byteArray', resp: 'test' } },
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
        expected: { status: 200, type: 'AsyncIterator', resp: Object.fromEntries(new Uint8Array([116, 101, 115, 116]).entries()) }
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
      { body: 'test', type: contentType, schema: 'ba', expected: { status: 200, type: 'byteArray', resp: 'test' } },
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
        expected: { status: 200, type: 'AsyncIterator', resp: Object.fromEntries(new Uint8Array([116, 101, 115, 116]).entries()) }
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
      { body: strBody, type: contentType, schema: 'ba', expected: { status: 200, type: 'byteArray', resp: strBody } },
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
        expected: { status: 200, type: 'AsyncIterator', resp: Object.fromEntries(Uint8Array.from(strBody, c => c.charCodeAt(0)).entries()) }
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
      { body: form, schema: 'ba', expected: { status: 200, type: 'byteArray', resp: objRespStrRgx } },
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
