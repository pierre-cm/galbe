import { describe, test, expect, beforeAll } from 'bun:test'
import {
  formdata,
  type Case,
  fileHash,
  schema_object,
  handleBody,
  schema_objectBase,
  handleUrlFormStream,
  isAsyncIterator
} from './test.utils'
import { Kadre, T } from '../src'

const port = 7357

describe('parser', () => {
  beforeAll(async () => {
    const kadre = new Kadre()

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
    kadre.get(
      '/query/params/schema/constraints',
      {
        query: {
          default: T.Optional(T.String({ default: 'DEFAULT_VALUE' })),
          int: T.Integer({ exclusiveMinimum: 10, maximum: 42 }),
          num: T.Number({ minimum: 10, exclusiveMaximum: 42 }),
          str: T.String({ minLength: 4, maxLength: 8, pattern: '^a.*z' }),
          array: T.Optional(T.Array(T.Integer(), { minItems: 3, maxItems: 5, uniqueItems: true }))
        }
      },
      ctx => {
        return ctx.query
      }
    )

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

  test('type constraints', async () => {
    const cases: any = [
      {
        p: { int: '11', num: '10', str: 'aaaz', array: ['1', '2', '3'] },
        expected: { body: { default: 'DEFAULT_VALUE', int: 11, num: 10, str: 'aaaz', array: [1, 2, 3] } }
      },
      {
        p: { default: '', int: '42', num: '41.5', str: 'a______z', array: ['1', '2', '3', '4', '5'] },
        expected: { body: { default: '', int: 42, num: 41.5, str: 'a______z', array: [1, 2, 3, 4, 5] } }
      },
      {
        p: { int: '10', num: '42.01', str: 'xxxxxxxxxx' },
        expected: {
          status: 400,
          body: {
            query: {
              int: '10 is less or equal to 10',
              num: '42.01 is greater or equal to 42',
              str: ['xxxxxxxxxx length is too large (8 char max)', 'xxxxxxxxxx does not match pattern ^a.*z']
            }
          }
        }
      }
    ]

    for (let { p, expected } of cases) {
      let search = new URLSearchParams()
      for (const [k, v] of Object.entries(p)) search.append(k, v as string)

      let resp = await fetch(`http://localhost:${port}/query/params/schema/constraints?${search.toString()}`)
      let body = await resp.json()

      expect(resp.status).toBe(expected.status ?? 200)
      expect(body).toEqual(expected.body)
    }
  })
})
