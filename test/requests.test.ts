import { expect, test, describe, beforeAll } from 'bun:test'
import { Kadre, T } from '../src/index'

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options']
const port = 7357

const decoder = new TextDecoder()

const formdata = (data: Record<string, string | string[] | Blob>): FormData => {
  const form = new FormData()
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) for (const v2 of v) form.append(k, v2)
    else form.append(k, v)
  }
  return form
}

const fileHash = async ba =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', ba)))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')

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
      '/headers/schema1',
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
      '/params/schema1/:p1/:p2/:p3',
      {
        params: {
          p1: T.String(),
          p2: T.Number(),
          p3: T.Boolean()
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
      '/query/params/schema1',
      {
        query: {
          p1: T.String(),
          p2: T.Number(),
          p3: T.Boolean(),
          p4: T.Union([T.Number(), T.Boolean()])
        }
      },
      ctx => {
        return ctx.query
      }
    )

    const bodyForm = {
      string: T.String(),
      number: T.Number(),
      bool: T.Boolean(),
      arrayStr: T.Array(T.String()),
      arrayNumber: T.Array(T.Number()),
      arrayBool: T.Array(T.Boolean()),
      optional: T.Optional(T.String())
      // any: T.Any()
    }
    const bodyObj = { ...bodyForm, file: T.Optional(T.ByteArray()), object: T.Optional(T.Object({ foo: T.String() })) }
    const bodyObjJson = { ...bodyForm, file: T.Optional(T.ByteArray()), object: T.Optional(T.Object(bodyForm)) }

    const parseBody = async body =>
      typeof body === 'object' && !Array.isArray(body)
        ? Object.fromEntries(
            await Promise.all(
              Object.entries(body).map(async ([k, v]) => {
                if (v instanceof Uint8Array) return [k, await fileHash(v)]
                else return [k, await parseBody(v)]
              })
            )
          )
        : body

    const handleBody = async (ctx: any) => {
      if (ctx.body === undefined) {
        return { type: 'undefined' }
      }
      if (ctx?.body instanceof ReadableStream) {
        let content = ''
        for await (const chunk of ctx.body) content += decoder.decode(chunk)
        return { type: 'ReadableStream', content }
      }
      if (Array.isArray(ctx.body)) {
        return { type: 'array', content: ctx.body }
      } else {
        return { type: typeof ctx.body, content: await parseBody(ctx.body) }
      }
    }
    kadre.post('/body', handleBody)
    kadre.post('/body/schema/string', { body: T.String() }, handleBody)
    kadre.post('/body/schema/number', { body: T.Number() }, handleBody)
    kadre.post('/body/schema/bool', { body: T.Boolean() }, handleBody)
    kadre.post('/body/schema/object', { body: T.Object(bodyObj) }, handleBody)
    kadre.post('/body/schema/array', { body: T.Array(T.Any()) }, handleBody)

    kadre.post('/body/schema/urlForm', { body: T.UrlForm(bodyForm) }, handleBody)
    kadre.post('/body/schema/multipartForm', { body: T.MultipartForm(bodyObj) }, handleBody)
    kadre.post('/body/schema/multipartForm/json', { body: T.MultipartForm(bodyObjJson) }, handleBody)

    kadre.post('/body/schema/urlForm/stream', { body: T.Stream(T.UrlForm(bodyForm)) }, async ctx => {
      let resp = {}
      for await (const [k, v] of ctx.body) {
        if (k in resp) {
          resp[k] = Array.isArray(resp[k]) ? [...resp[k], v] : [resp[k], v]
        } else resp[k] = v
      }
      return { type: 'object', content: resp }
    })
    kadre.post('/body/schema/multipartForm/stream', { body: T.Stream(T.MultipartForm(bodyObj)) }, async ctx => {
      let resp = {}
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
    await kadre.listen(port)
  })

  test('empty calls', async () => {
    for (let method of METHODS) {
      let resp = await fetch(`http://localhost:${port}/test`, { method: method.toUpperCase() })
      expect(resp.ok).toBeTrue()
    }
  })

  test('path not found', async () => {
    for (let method of METHODS) {
      let resp = await fetch(`http://localhost:${port}/does/not/exist`, { method: method.toUpperCase() })
      expect(resp.status).toBe(404)
    }
  })

  test('parse headers', async () => {
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

  test('parse path params', async () => {
    const expected = {
      param1: 'one',
      param2: '2',
      param3: 'true'
    }
    let resp = await fetch(`http://localhost:${port}/params/one/separate/2/true`)
    let body = await resp.json()

    expect(body).toEqual(expected)
  })

  test('parse query params', async () => {
    const expected = {
      param1: 'one',
      param2: '2',
      param3: 'true'
    }
    let resp = await fetch(`http://localhost:${port}/query/params?param1=one&param2=2&param3=true`)
    let body = await resp.json()

    expect(body).toEqual(expected)
  })

  test('parse undefined body', async () => {
    const types: Record<string, any> = {
      '': { type: 'undefined', content: undefined },
      unknown: { type: 'undefined', content: undefined },
      'text/plain': { type: 'undefined', content: undefined },
      'application/json': { type: 'undefined', content: undefined },
      'application/x-www-form-urlencoded': { type: 'undefined', content: undefined },
      'multipart/form-data': { type: 'undefined', content: undefined }
    }

    for (const [type, expected] of Object.entries(types)) {
      let resp = await fetch(`http://localhost:${port}/body`, {
        method: 'POST',
        headers: { 'Content-Type': type }
      })
      let body = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(200)
      expect(body.type).toBe(expected.type)
      expect(body.content).toBe(expected.content)
    }
  })

  test('parse text body', async () => {
    const types: Record<string, any> = {
      '': { type: 'ReadableStream', content: 'test' },
      unknown: { type: 'ReadableStream', content: 'test' },
      'text/plain': { type: 'string', content: 'test' },
      'application/json': { status: 400 },
      'application/x-www-form-urlencoded': { type: 'object', content: {} },
      'multipart/form-data': { type: 'object', content: {} }
    }

    for (const [type, expected] of Object.entries(types)) {
      let resp = await fetch(`http://localhost:${port}/body`, {
        method: 'POST',
        headers: { 'Content-Type': type },
        body: 'test'
      })
      let body = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status ?? 200)
      expect(body.type).toEqual(expected.type)
      if (body.type === 'object') expect(body.content).toMatchObject(expected.content)
      else expect(body.content).toEqual(expected.content)
    }
  })

  test('parse json body', async () => {
    const strBody = '{"string":"text","number":42,"boolean":true,"object":{"foo":"bar"}}'
    const types: Record<string, any> = {
      '': { type: 'ReadableStream', content: strBody },
      unknown: { type: 'ReadableStream', content: strBody },
      'text/plain': { type: 'string', content: strBody },
      'application/json': { type: 'object', content: JSON.parse(strBody) },
      'application/x-www-form-urlencoded': { type: 'object', content: {} },
      'multipart/form-data': { type: 'object', content: {} }
    }

    for (const [type, expected] of Object.entries(types)) {
      let resp = await fetch(`http://localhost:${port}/body`, {
        method: 'POST',
        headers: { 'Content-Type': type },
        body: strBody
      })
      let body = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(200)
      expect(body.type).toEqual(expected.type)
      if (body.type === 'object') expect(body.content).toMatchObject(expected.content)
      else expect(body.content).toEqual(expected.content)
    }
  })

  test('parse json primitives', async () => {
    const bodies: Record<string, { type: string; val: any }> = {
      '"string"': { type: 'string', val: 'string' },
      '0': { type: 'number', val: 0 },
      '42': { type: 'number', val: 42 },
      '42.5': { type: 'number', val: 42.5 },
      '-42.5': { type: 'number', val: -42.5 },
      true: { type: 'boolean', val: true },
      false: { type: 'boolean', val: false },
      '["foo","bar"]': { type: 'array', val: ['foo', 'bar'] }
    }

    for (const [content, expected] of Object.entries(bodies)) {
      let resp = await fetch(`http://localhost:${port}/body`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: content
      })
      let body = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(200)
      expect(body.type).toEqual(expected.type)
      expect(body.content).toEqual(expected.val)
    }
  })

  test('parse UrlForm body', async () => {
    const strBody = 'string=text&number=42&boolean=true&encoded%3D=%3D'
    const types: Record<string, any> = {
      '': { type: 'ReadableStream', content: strBody },
      unknown: { type: 'ReadableStream', content: strBody },
      'text/plain': { type: 'string', content: strBody },
      'application/json': { status: 400 },
      'application/x-www-form-urlencoded': {
        type: 'object',
        content: {
          string: 'text',
          number: '42',
          boolean: 'true',
          'encoded=': '='
        }
      },
      'multipart/form-data': { type: 'object', content: {} }
    }

    for (const [type, expected] of Object.entries(types)) {
      let resp = await fetch(`http://localhost:${port}/body`, {
        method: 'POST',
        headers: { 'Content-Type': type },
        body: strBody
      })
      let body = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status ?? 200)
      expect(body.type).toEqual(expected.type)
      if (body.type === 'object') expect(body.content).toMatchObject(expected.content)
      else expect(body.content).toEqual(expected.content)
    }
  })

  test('parse MultipartForm body', async () => {
    // const form = new FormData()
    // form.append('string', 'text')
    // form.append('number', '42')
    // form.append('boolean', 'true')
    const form = formdata({
      string: 'text',
      number: '42',
      boolean: 'true'
    })
    const types: Record<string, any> = {
      'application/x-www-form-urlencoded': { type: 'object', content: {} },
      'multipart/form-data': {
        type: 'object',
        content: {
          string: { headers: { name: 'string' }, content: 'text' },
          number: { headers: { name: 'number' }, content: '42' },
          boolean: { headers: { name: 'boolean' }, content: 'true' }
        }
      }
    }
    for (const [type, expected] of Object.entries(types)) {
      //@ts-ignore
      let resp = await fetch(`http://localhost:${port}/body`, {
        method: 'POST',
        headers: { ...(type !== 'multipart/form-data' ? { 'Content-Type': type } : {}) },
        body: form
      })
      let body = (await resp.json()) as { type: string; content: any }

      expect(resp.status).toBe(expected.status ?? 200)
      expect(body.type).toEqual(expected.type)
      if (body.type === 'object') expect(body.content).toMatchObject(expected.content)
      else expect(body.content).toEqual(expected.content)
    }
  })

  test('parse schema headers', async () => {
    const headers = {
      String: 'hello mom',
      Zero: '0',
      Number: '3615',
      'Neg-Number': '-42',
      Float: '3.1415',
      Integer: '42',
      'Boolean-True': 'true',
      'Boolean-False': 'false'
    }
    let resp = await fetch(`http://localhost:${port}/headers/schema1`, { headers })
    let body = (await resp.json()) as any

    expect(resp.status).toBe(200)
    expect(body).toMatchObject({
      string: 'hello mom',
      zero: 0,
      number: 3615,
      'neg-number': -42,
      float: 3.1415,
      integer: 42,
      'boolean-true': true,
      'boolean-false': false
    })
  })

  test('parse schema headers missing', async () => {
    const headers = {
      // String: 'hello mom', Missing
      // zero: 0, Missing
      Number: '3615',
      'Neg-Number': '-42',
      Float: '3.1415',
      Integer: '42',
      'Boolean-True': 'true',
      'Boolean-False': 'false'
    }
    let resp = await fetch(`http://localhost:${port}/headers/schema1`, { headers })
    let body = (await resp.json()) as any

    expect(resp.status).toBe(400)
    expect(Object.keys(body?.headers).length).toBe(2)
    expect(body?.headers?.string).toBeDefined()
    expect(body?.headers?.zero).toBeDefined()
  })

  test('parse schema headers test types', async () => {
    const headers = {
      String: 'hello mom',
      Zero: '0',
      Number: '3615',
      'Neg-Number': '-42',
      Float: '3.1415',
      Integer: '42',
      'Boolean-True': 'true',
      'Boolean-False': 'false'
    }
    const cases: { h: Record<string, string>; status?: number }[] = [
      { h: { String: 'Lorem ipsum dolor sit amet' } },
      { h: { String: '42' } },
      { h: { String: 'true' } },
      { h: { Number: '42' } },
      { h: { Integer: '0' } },
      { h: { Integer: '42' } },
      { h: { Integer: '0.1' }, status: 400 },
      { h: { Integer: '-5.5' }, status: 400 },
      { h: { Integer: '-aaa' }, status: 400 },
      { h: { Number: 'Lorem ipsum dolor sit amet' }, status: 400 },
      { h: { Number: 'true' }, status: 400 },
      { h: { 'Boolean-True': 'true' } },
      { h: { 'Boolean-True': 'false' } },
      { h: { 'Boolean-True': 'True' }, status: 400 },
      { h: { 'Boolean-True': 'False' }, status: 400 },
      { h: { 'Boolean-True': '1' }, status: 400 },
      { h: { 'Boolean-True': '0' }, status: 400 },
      { h: { 'Boolean-True': '42' }, status: 400 },
      { h: { 'Boolean-True': 'Lorem ipsum dolor sit amet' }, status: 400 }
    ]

    for (const c of cases) {
      let resp = await fetch(`http://localhost:${port}/headers/schema1`, { headers: { ...headers, ...c.h } })
      expect(resp.status).toBe(c.status ?? 200)
    }
  })

  test('parse schema params', async () => {
    let resp = await fetch(`http://localhost:${port}/params/schema1/str/42/true`)
    let body = (await resp.json()) as any

    expect(resp.status).toBe(200)
    expect(body).toMatchObject({
      p1: 'str',
      p2: 42,
      p3: true
    })
  })

  test('parse schema params test types', async () => {
    const params = {
      p1: 'str',
      p2: '42',
      p3: 'true'
    }
    const cases: { p: Record<string, string>; status?: number }[] = [
      { p: { ...params, p1: 'Lorem ipsum dolor sit amet' } },
      { p: { ...params, p1: '42' } },
      { p: { ...params, p1: 'true' } },
      { p: { ...params, p2: '42' } },
      { p: { ...params, p2: 'Lorem ipsum dolor sit amet' }, status: 400 },
      { p: { ...params, p2: 'true' }, status: 400 },
      { p: { ...params, p3: 'true' } },
      { p: { ...params, p3: 'false' } },
      { p: { ...params, p3: 'True' }, status: 400 },
      { p: { ...params, p3: 'False' }, status: 400 },
      { p: { ...params, p3: '1' }, status: 400 },
      { p: { ...params, p3: '0' }, status: 400 },
      { p: { ...params, p3: '42' }, status: 400 }
    ]

    for (const c of cases) {
      let resp = await fetch(`http://localhost:${port}/params/schema1/${c.p.p1}/${c.p.p2}/${c.p.p3}`)
      expect(resp.status).toBe(c.status ?? 200)
    }
  })

  test('parse schema query params', async () => {
    let url = new URL(`http://localhost:${port}/query/params/schema1`)
    url.searchParams.set('p1', 'str')
    url.searchParams.set('p2', '42')
    url.searchParams.set('p3', 'true')
    url.searchParams.set('p4', 'true')
    let resp = await fetch(url)
    let body = (await resp.json()) as any

    expect(resp.status).toBe(200)
    expect(body).toMatchObject({
      p1: 'str',
      p2: 42,
      p3: true,
      p4: true
    })
  })

  test('parse schema query params missing', async () => {
    let url = new URL(`http://localhost:${port}/query/params/schema1`)
    url.searchParams.set('p1', 'str')
    // url.searchParams.set('p2', '42') Missing
    // url.searchParams.set('p3', 'true') Missing
    url.searchParams.set('p4', '42')
    let resp = await fetch(url)
    let body = (await resp.json()) as any

    expect(resp.status).toBe(400)
    expect(Object.keys(body?.query).length).toBe(2)
    expect(body?.query?.p2).toBeDefined()
    expect(body?.query?.p3).toBeDefined()
  })

  test('parse schema query test types', async () => {
    const params = {
      p1: 'str',
      p2: '42',
      p3: 'true',
      p4: 'true'
    }
    const cases: { p: Record<string, string>; status?: number }[] = [
      { p: { ...params, p1: 'Lorem ipsum dolor sit amet' } },
      { p: { ...params, p1: '42' } },
      { p: { ...params, p1: 'true' } },
      { p: { ...params, p2: '42' } },
      { p: { ...params, p2: 'Lorem ipsum dolor sit amet' }, status: 400 },
      { p: { ...params, p2: 'true' }, status: 400 },
      { p: { ...params, p3: 'true' } },
      { p: { ...params, p3: 'false' } },
      { p: { ...params, p3: 'True' }, status: 400 },
      { p: { ...params, p3: 'False' }, status: 400 },
      { p: { ...params, p3: '1' }, status: 400 },
      { p: { ...params, p3: '0' }, status: 400 },
      { p: { ...params, p3: '42' }, status: 400 },
      { p: { ...params, p3: 'Lorem ipsum dolor sit amet' }, status: 400 },
      { p: { ...params, p4: 'true' } },
      { p: { ...params, p4: 'false' } },
      { p: { ...params, p4: '1' } },
      { p: { ...params, p4: '0' } },
      { p: { ...params, p4: '42' } },
      { p: { ...params, p4: 'Lorem ipsum dolor sit amet' }, status: 400 }
    ]

    for (const c of cases) {
      let url = new URL(`http://localhost:${port}/query/params/schema1`)
      for (const [k, v] of Object.entries(c.p)) url.searchParams.set(k, v)
      let resp = await fetch(url)
      expect(resp.status).toBe(c.status ?? 200)
    }
  })

  test('parse schema body', async () => {
    const requestBody = `{"string":"string","bool":true,"arrayStr":["string"],"arrayNumber":[1,2,3],"arrayBool":[true,false],"object":{"foo":"string"},"optional":"string","any":"any","number":42}`
    const expectedBody = {
      string: 'string',
      bool: true,
      arrayStr: ['string'],
      arrayNumber: [1, 2, 3],
      arrayBool: [true, false],
      object: { foo: 'string' },
      optional: 'string',
      number: 42
    }
    const schemaCases: Record<
      string,
      { b: any; h?: Record<string, string>; expected: { status?: number; body?: any; type?: string } }[]
    > = {
      string: [
        { b: 'string', h: {}, expected: { body: 'string', type: 'string' } },
        { b: 'string', h: { 'content-type': 'text/plain' }, expected: { body: 'string', type: 'string' } },
        { b: 'string', h: { 'content-type': 'application/json' }, expected: { body: 'string', type: 'string' } },
        {
          b: '{"foo":"bar"}',
          h: { 'content-type': 'application/json' },
          expected: { body: '{"foo":"bar"}', type: 'string' }
        }
      ],
      number: [
        { b: '42', h: {}, expected: { body: 42, type: 'number' } },
        { b: '42', h: { 'content-type': 'text/plain' }, expected: { body: 42, type: 'number' } },
        { b: '42', h: { 'content-type': 'application/json' }, expected: { body: 42, type: 'number' } },
        { b: 'string', h: { 'content-type': 'text/plain' }, expected: { status: 400 } },
        { b: 'true', h: { 'content-type': 'text/plain' }, expected: { status: 400 } }
      ],
      bool: [
        { b: 'true', h: {}, expected: { body: true, type: 'boolean' } },
        { b: 'true', h: { 'content-type': 'text/plain' }, expected: { body: true, type: 'boolean' } },
        { b: 'true', h: { 'content-type': 'application/json' }, expected: { body: true, type: 'boolean' } },
        { b: 'false', h: {}, expected: { body: false, type: 'boolean' } },
        { b: 'false', h: { 'content-type': 'text/plain' }, expected: { body: false, type: 'boolean' } },
        { b: 'false', h: { 'content-type': 'application/json' }, expected: { body: false, type: 'boolean' } },
        { b: 'string', h: { 'content-type': 'text/plain' }, expected: { status: 400 } },
        { b: '0', h: { 'content-type': 'text/plain' }, expected: { status: 400 } },
        { b: '1', h: { 'content-type': 'text/plain' }, expected: { status: 400 } }
      ],
      object: [
        { b: requestBody, h: {}, expected: { type: 'object', body: expectedBody } },
        { b: requestBody, h: { 'content-type': 'application/json' }, expected: { type: 'object', body: expectedBody } },
        { b: requestBody, h: { 'content-type': 'text/plain' }, expected: { type: 'object', body: expectedBody } },
        { b: '{}', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: '', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: undefined, h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: 'text', h: {}, expected: { status: 400 } },
        { b: 'text', h: { 'content-type': 'text/plain' }, expected: { status: 400 } },
        { b: 'text', h: { 'content-type': 'application/json' }, expected: { status: 400 } }
      ],
      array: [
        { b: '[]', h: {}, expected: { body: [], type: 'array' } },
        { b: '[]', h: { 'content-type': 'text/plain' }, expected: { body: [], type: 'array' } },
        { b: '[]', h: { 'content-type': 'application/json' }, expected: { body: [], type: 'array' } },
        {
          b: '[42, "string", true, {"foo":"bar"}]',
          h: {},
          expected: { body: [42, 'string', true, { foo: 'bar' }], type: 'array' }
        },
        {
          b: '[42, "string", true, {"foo":"bar"}]',
          h: { 'content-type': 'text/plain' },
          expected: { body: [42, 'string', true, { foo: 'bar' }], type: 'array' }
        },
        {
          b: '[42, "string", true, {"foo":"bar"}]',
          h: { 'content-type': 'application/json' },
          expected: { body: [42, 'string', true, { foo: 'bar' }], type: 'array' }
        },
        { b: undefined, h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: '', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: '0', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: 'string', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: 'true', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: '{}', h: { 'content-type': 'application/json' }, expected: { status: 400 } }
      ],
      urlForm: [
        {
          b: 'string=Hello%20Mom&number=42&bool=true&optional=toto',
          h: { 'content-type': 'application/x-www-form-urlencoded' },
          expected: {
            type: 'object',
            body: {
              string: 'Hello Mom',
              number: 42,
              bool: true,
              optional: 'toto',
              arrayStr: [],
              arrayNumber: [],
              arrayBool: []
            }
          }
        },
        {
          b: 'string=Hello%20Mom&number=-42&bool=false',
          h: { 'content-type': 'application/x-www-form-urlencoded' },
          expected: {
            type: 'object',
            body: { string: 'Hello Mom', number: -42, bool: false, arrayStr: [], arrayNumber: [], arrayBool: [] }
          }
        },
        {
          b: 'string=Hello%20Mom&number=-42&bool=false&arrayBool=true&arrayStr=toto&arrayStr=titi&arrayNumber=36&arrayBool=false',
          h: { 'content-type': 'application/x-www-form-urlencoded' },
          expected: {
            type: 'object',
            body: {
              string: 'Hello Mom',
              number: -42,
              bool: false,
              arrayStr: ['toto', 'titi'],
              arrayNumber: [36],
              arrayBool: [true, false]
            }
          }
        },
        {
          b: 'string=Hello%20Mom&number=42&bool=true&optional=toto',
          h: { 'content-type': 'application/json' },
          expected: { status: 400 }
        },
        { b: undefined, h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: '', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: '0', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: 'string', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: 'true', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: '{}', h: { 'content-type': 'application/json' }, expected: { status: 400 } }
      ],
      multipartForm: [
        {
          b: formdata({
            string: 'string',
            number: '42',
            bool: 'true',
            arrayStr: ['one', 'two', 'three'],
            arrayNumber: ['1'],
            arrayBool: ['true', 'false'],
            file: Bun.file('test/resources/image.png')
          }),
          expected: {
            type: 'object',
            body: {
              string: { headers: { name: 'string' }, content: 'string' },
              number: { headers: { name: 'number' }, content: 42 },
              bool: { headers: { name: 'bool' }, content: true },
              arrayStr: { headers: { name: 'arrayStr' }, content: ['one', 'two', 'three'] },
              arrayNumber: { headers: { name: 'arrayNumber' }, content: [1] },
              arrayBool: { headers: { name: 'arrayBool' }, content: [true, false] },
              file: {
                headers: {
                  name: 'file',
                  filename: 'test/resources/image.png'
                },
                content: await fileHash(new Uint8Array(await Bun.file('test/resources/image.png').arrayBuffer()))
              }
            }
          }
        },
        { b: '', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: '0', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: 'string', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: 'true', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: '{}', h: { 'content-type': 'application/json' }, expected: { status: 400 } }
      ],
      'multipartForm/json': [
        {
          b: formdata({
            string: 'string',
            number: '42',
            bool: 'true',
            arrayStr: [],
            arrayNumber: ['1', '2.5', '-1'],
            arrayBool: ['true', 'false'],
            object: Bun.file('test/resources/object.json')
          }),
          expected: {
            type: 'object',
            body: {
              string: { headers: { name: 'string' }, content: 'string' },
              number: { headers: { name: 'number' }, content: 42 },
              bool: { headers: { name: 'bool' }, content: true },
              arrayStr: { headers: { name: 'arrayStr' }, content: [] },
              arrayNumber: { headers: { name: 'arrayNumber' }, content: [1, 2.5, -1] },
              arrayBool: { headers: { name: 'arrayBool' }, content: [true, false] },
              object: {
                headers: { name: 'object' },
                content: {
                  string: 'test',
                  number: 3.14,
                  bool: true,
                  arrayStr: ['un', 'deux', 'trois'],
                  arrayNumber: [0],
                  arrayBool: [true, false]
                }
              }
            }
          }
        },
        {
          b: formdata({
            string: 'string',
            number: '42',
            bool: 'true',
            arrayStr: [],
            arrayNumber: ['1', '2.5', '-1'],
            arrayBool: ['true', 'false'],
            object: Bun.file('test/resources/object-missing.json')
          }),
          expected: { status: 400 }
        }
      ],
      'urlForm/stream': [
        {
          b: 'string=Hello%20Mom&number=42&bool=true&optional=toto',
          h: { 'content-type': 'application/x-www-form-urlencoded' },
          expected: {
            type: 'object',
            body: {
              string: 'Hello Mom',
              number: 42,
              bool: true,
              optional: 'toto'
            }
          }
        },
        {
          b: 'string=Hello%20Mom&number=-42&bool=false',
          h: { 'content-type': 'application/x-www-form-urlencoded' },
          expected: {
            type: 'object',
            body: { string: 'Hello Mom', number: -42, bool: false }
          }
        },
        {
          b: 'string=Hello%20Mom&number=-42&bool=false&arrayBool=true&arrayStr=toto&arrayStr=titi&arrayNumber=36&arrayBool=false',
          h: { 'content-type': 'application/x-www-form-urlencoded' },
          expected: {
            type: 'object',
            body: {
              string: 'Hello Mom',
              number: -42,
              bool: false,
              arrayStr: ['toto', 'titi'],
              arrayNumber: 36,
              arrayBool: [true, false]
            }
          }
        },
        {
          b: 'string=Hello%20Mom&number=42&bool=true&optional=toto',
          h: { 'content-type': 'application/json' },
          expected: { status: 400 }
        },
        { b: undefined, h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: '', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: '0', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: 'string', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: 'true', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: '{}', h: { 'content-type': 'application/json' }, expected: { status: 400 } }
      ],
      'multipartForm/stream': [
        {
          b: formdata({
            string: 'string',
            number: '42',
            bool: 'true',
            arrayStr: ['a'],
            arrayNumber: ['1', '2.5', '-1'],
            arrayBool: ['true', 'false']
          }),
          expected: {
            type: 'object',
            body: {
              string: { headers: { name: 'string' }, content: 'string' },
              number: { headers: { name: 'number' }, content: 42 },
              bool: { headers: { name: 'bool' }, content: true },
              arrayStr: { headers: { name: 'arrayStr' }, content: 'a' },
              arrayNumber: { headers: { name: 'arrayNumber' }, content: [1, 2.5, -1] },
              arrayBool: { headers: { name: 'arrayBool' }, content: [true, false] }
            }
          }
        },
        { b: undefined, h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: '', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: '0', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: 'string', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: 'true', h: { 'content-type': 'application/json' }, expected: { status: 400 } },
        { b: '{}', h: { 'content-type': 'application/json' }, expected: { status: 400 } }
      ]
    }

    for (const [path, sc] of Object.entries(schemaCases)) {
      for (const c of sc) {
        let resp = await fetch(`http://localhost:${port}/body/schema/${path}`, {
          method: 'POST',
          ...(c?.h ? { headers: c.h } : {}),
          body: c.b
        })
        let body = (await resp.json()) as any
        if (resp.status !== (c.expected?.status || 200)) console.log('BODY', body)

        expect(resp.status).toBe(c.expected?.status ?? 200)
        expect(body.type).toEqual(c.expected.type)
        if (body.type === 'object') expect(body.content).toMatchObject(c.expected.body)
        else expect(body.content).toEqual(c.expected.body)
      }
    }
  })
})
