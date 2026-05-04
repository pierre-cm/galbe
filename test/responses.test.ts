import { expect, test, describe, beforeAll } from 'bun:test'
import { Galbe, $T, type Context } from '../src'
import { decoder } from './test.utils'

const port = 7359
const portRaw = 7367

const UUID_RGX = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

function* genTxt(text: string) {
  const words = text.split(' ')
  for (const w of words) yield w
}

const rsTxt = (text: string) => {
  return new ReadableStream({
    async start(controller) {
      const words = text.split(' ')
      for (const w of words) controller.enqueue(w)
      controller.close()
    },
  })
}

const handleResp = (ctx: Context) => ctx.body

describe('responses', () => {
  beforeAll(async () => {
    const galbe = new Galbe()

    galbe.post(
      '/none',
      {
        body: { 'application/json': $T.optional($T.object()) },
        query: { text: $T.optional($T.string()), stream: $T.optional($T.string()) },
      },
      ctx => {
        if (ctx.query.text) {
          if (ctx.query.stream === 'generatorFunction') return genTxt(ctx.query.text)
          if (ctx.query.stream === 'readableStream') return rsTxt(ctx.query.text)
          else return ctx.query.text
        } else if (ctx.body) return ctx.body

        return null
      }
    )

    galbe.post('', { response: { test: '' } }, () => {})

    galbe.post('/ba', { response: { 200: $T.byteArray() } }, handleResp)
    galbe.post('/bool', { response: { 200: $T.boolean() } }, handleResp)
    galbe.post('/num', { response: { 200: $T.number() } }, handleResp)
    galbe.post('/str', { response: { 200: $T.string() } }, handleResp)
    galbe.post('/json/bool', { response: { 200: $T.json($T.boolean()) } }, handleResp)
    galbe.post('/json/num', { response: { 200: $T.json($T.number()) } }, handleResp)
    galbe.post('/json/str', { response: { 200: $T.json($T.string()) } }, handleResp)
    galbe.post('/json/obj', { response: { 200: $T.json($T.object()) } }, handleResp)
    galbe.post('/arr', { response: { 200: $T.array() } }, handleResp)
    galbe.post('/obj', { response: { 200: $T.object() } }, handleResp)
    galbe.post('/stream/ba', { response: { 200: $T.stream($T.byteArray()) } }, ctx =>
      ctx.body ? genTxt(ctx.body) : ''
    )
    galbe.post('/stream/str', { response: { 200: $T.stream($T.string()) } }, ctx => (ctx.body ? genTxt(ctx.body) : 42))

    await galbe.listen(port)
  })

  test('response, no schema, string', async () => {
    const reqTxt = 'Hello Mom!'
    let resp = await fetch(`http://localhost:${port}/none?text=${reqTxt}`, {
      method: 'POST',
    })

    const body = await resp.text()

    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toBe('text/plain')
    expect(body).toBe(reqTxt)
  })

  test('response, no schema, object', async () => {
    const reqBody = { foo: 'bar' }
    let resp = await fetch(`http://localhost:${port}/none`, {
      method: 'POST',
      body: JSON.stringify(reqBody),
      headers: {
        'content-type': 'application/json',
      },
    })

    const body = await resp.json()

    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toBe('application/json')
    expect(body).toEqual(reqBody)
  })

  test('response, no schema, stream', async () => {
    const reqTxt = 'Hello Mom!'
    const cases = [{ stream: 'generatorFunction' }, { stream: 'readableStream' }]

    for (const c of cases) {
      let resp = await fetch(`http://localhost:${port}/none?text=${reqTxt}&stream=${c.stream}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
      })
      const reader = resp.body?.getReader()
      let body = ''
      while (reader) {
        const { value, done } = await reader.read()
        if (done) break
        body += decoder.decode(value)
      }
      expect(resp.status).toBe(200)
      expect(resp.headers.get('content-type')).toBe('text/event-stream')
      expect(body).toMatch(new RegExp(`id:${UUID_RGX}\ndata:Hello\n\nid:${UUID_RGX}\ndata:Mom!\n\n`))
    }
  })

  test('response, ba, validation OK', async () => {
    let bodyStr = 'Hello mom!'
    let reqBody = new TextEncoder().encode(bodyStr)

    let resp = await fetch(`http://localhost:${port}/ba`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'application/octet-stream',
      },
    })

    const reader = resp.body?.getReader()
    let body = new Uint8Array()
    while (reader) {
      const { value, done } = await reader.read()
      if (done) break
      let buff = new Uint8Array(body.length + value.length)
      buff.set(body)
      buff.set(value, body.length)
      body = buff
    }

    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toBe('application/octet-stream')
    //@ts-ignore
    expect(body).toEqual(reqBody)
  })

  test('response, ba, validation error', async () => {
    let bodyStr = 'Hello mom!'

    let resp = await fetch(`http://localhost:${port}/ba`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'text/plain',
      },
    })

    expect(resp.status).toBe(500)
  })

  test('response, bool, validation OK', async () => {
    let bodyStr = 'true'
    let reqBody = true

    let resp = await fetch(`http://localhost:${port}/bool`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'application/json',
      },
    })

    const body = await resp.json()

    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toBe('application/json')
    expect(body).toEqual(reqBody)
  })

  test('response, bool, validation error', async () => {
    let bodyStr = 'true'

    let resp = await fetch(`http://localhost:${port}/bool`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'text/plain',
      },
    })

    expect(resp.status).toBe(500)
  })

  test('response, num, validation OK', async () => {
    let bodyStr = '42'
    let reqBody = 42

    let resp = await fetch(`http://localhost:${port}/num`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'application/json',
      },
    })

    const body = await resp.json()

    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toBe('application/json')
    expect(body).toEqual(reqBody)
  })

  test('response, num, validation error', async () => {
    let bodyStr = '"test"'

    let resp = await fetch(`http://localhost:${port}/num`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'application/json',
      },
    })

    expect(resp.status).toBe(500)
  })

  test('response, str, validation OK', async () => {
    let bodyStr = 'Hello Mom!'

    let resp = await fetch(`http://localhost:${port}/str`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'text/plain',
      },
    })

    const body = await resp.text()

    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toBe('text/plain')
    expect(body).toEqual(bodyStr)
  })

  test('response, json bool, validation OK', async () => {
    let bodyStr = 'false'
    let reqBody = false

    let resp = await fetch(`http://localhost:${port}/json/bool`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'application/json',
      },
    })

    const body = await resp.json()

    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toBe('application/json')
    expect(body).toEqual(reqBody)
  })

  test('response, json bool, validation error', async () => {
    let bodyStr = '3.14'

    let resp = await fetch(`http://localhost:${port}/json/bool`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'application/json',
      },
    })

    expect(resp.status).toBe(500)
  })

  test('response, json num, validation OK', async () => {
    let bodyStr = '42'
    let reqBody = 42

    let resp = await fetch(`http://localhost:${port}/json/num`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'application/json',
      },
    })

    const body = await resp.json()

    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toBe('application/json')
    expect(body).toEqual(reqBody)
  })

  test('response, json num, validation error', async () => {
    let bodyStr = '"Hi"'

    let resp = await fetch(`http://localhost:${port}/json/bool`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'application/json',
      },
    })

    expect(resp.status).toBe(500)
  })

  test('response, json str, validation OK', async () => {
    let bodyStr = '"Hello Mom!"'
    let reqBody = 'Hello Mom!'

    let resp = await fetch(`http://localhost:${port}/json/str`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'application/json',
      },
    })

    const body = await resp.json()

    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toBe('application/json')
    expect(body).toEqual(reqBody)
  })

  test('response, json str, validation error', async () => {
    let bodyStr = '3.14'

    let resp = await fetch(`http://localhost:${port}/json/str`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'application/json',
      },
    })

    expect(resp.status).toBe(500)
  })

  test('response, array, validation OK', async () => {
    let bodyStr = '[false, "one", 2]'
    let reqBody = [false, 'one', 2]

    let resp = await fetch(`http://localhost:${port}/arr`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'application/json',
      },
    })

    const body = await resp.json()

    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toBe('application/json')
    expect(body).toEqual(reqBody)
  })

  test('response, array, validation error', async () => {
    let bodyStr = '0'

    let resp = await fetch(`http://localhost:${port}/arr`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'application/json',
      },
    })

    expect(resp.status).toBe(500)
  })

  test('response, object, validation OK', async () => {
    let bodyStr = '{"str":"str", "num":0, "arr":[1,2,3], "nested": {"foo":"bar"}}'
    let reqBody = { str: 'str', num: 0, arr: [1, 2, 3], nested: { foo: 'bar' } }

    let resp = await fetch(`http://localhost:${port}/obj`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'application/json',
      },
    })

    const body = await resp.json()

    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toBe('application/json')
    expect(body).toEqual(reqBody)
  })

  test('response, object, validation error', async () => {
    let bodyStr = '"This"'

    let resp = await fetch(`http://localhost:${port}/obj`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'application/json',
      },
    })

    expect(resp.status).toBe(500)
  })

  test('response, stream ba, validation OK', async () => {
    let bodyStr = 'Hello Mom!'

    let resp = await fetch(`http://localhost:${port}/stream/ba`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'text/plain',
      },
    })

    const reader = resp.body?.getReader()
    let body = ''
    while (reader) {
      const { value, done } = await reader.read()
      if (done) break
      body += decoder.decode(value)
    }
    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toBe('text/event-stream')
    expect(body).toMatch(new RegExp(`id:${UUID_RGX}\ndata:Hello\n\nid:${UUID_RGX}\ndata:Mom!\n\n`))
  })

  test('response, stream ba, validation error', async () => {
    let bodyStr = ''

    let resp = await fetch(`http://localhost:${port}/stream/ba`, {
      method: 'POST',
      body: bodyStr,
    })

    expect(resp.status).toBe(500)
  })

  test('response, stream str, validation OK', async () => {
    let bodyStr = 'Hello Mom!'

    let resp = await fetch(`http://localhost:${port}/stream/str`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'text/plain',
      },
    })

    const reader = resp.body?.getReader()
    let body = ''
    while (reader) {
      const { value, done } = await reader.read()
      if (done) break
      body += decoder.decode(value)
    }
    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toBe('text/event-stream')
    expect(body).toMatch(new RegExp(`id:${UUID_RGX}\ndata:Hello\n\nid:${UUID_RGX}\ndata:Mom!\n\n`))
  })

  test('response, stream str, validation error', async () => {
    let bodyStr = '0'

    let resp = await fetch(`http://localhost:${port}/stream/str`, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'content-type': 'application/json',
      },
    })

    expect(resp.status).toBe(500)
  })
})

describe('raw Response return parity with ctx.set', () => {
  beforeAll(async () => {
    const galbe = new Galbe()

    // Bug case: return new Response(null, {status: 304}) with a matching response schema
    galbe.get('/raw/null-304', { response: { 304: $T.null() } }, () => new Response(null, { status: 304 }))
    galbe.get('/ctx/null-304', { response: { 304: $T.null() } }, (ctx: Context) => {
      ctx.set.status = 304
      return null
    })

    // Parity: string body
    galbe.get('/raw/str-200', { response: { 200: $T.string() } }, () => new Response('hello', { status: 200 }))
    galbe.get('/ctx/str-200', { response: { 200: $T.string() } }, (ctx: Context) => {
      ctx.set.status = 200
      return 'hello'
    })

    // Parity: JSON object body
    galbe.get('/raw/json-201', { response: { 201: $T.json($T.object()) } }, () =>
      new Response(JSON.stringify({ foo: 'bar' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    )
    galbe.get('/ctx/json-201', { response: { 201: $T.json($T.object()) } }, (ctx: Context) => {
      ctx.set.status = 201
      return { foo: 'bar' }
    })

    await galbe.listen(portRaw)
  })

  // Bug reproduction (was returning 500 before fix)
  test('return new Response(null, 304) with null/304 schema — should return 304', async () => {
    const resp = await fetch(`http://localhost:${portRaw}/raw/null-304`)
    expect(resp.status).toBe(304)
  })

  test('ctx.set.status=304 + return null with null/304 schema — should return 304', async () => {
    const resp = await fetch(`http://localhost:${portRaw}/ctx/null-304`)
    expect(resp.status).toBe(304)
  })

  // Parity: string body
  test('return new Response("hello", 200) with string/200 schema — should return 200 with body', async () => {
    const resp = await fetch(`http://localhost:${portRaw}/raw/str-200`)
    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe('hello')
  })

  test('ctx.set.status=200 + return "hello" with string/200 schema — should return 200 with body', async () => {
    const resp = await fetch(`http://localhost:${portRaw}/ctx/str-200`)
    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe('hello')
  })

  // Parity: JSON object body
  test('return new Response(json, 201) with object/201 schema — should return 201 with body', async () => {
    const resp = await fetch(`http://localhost:${portRaw}/raw/json-201`)
    expect(resp.status).toBe(201)
    expect(await resp.json()).toEqual({ foo: 'bar' })
  })

  test('ctx.set.status=201 + return object with object/201 schema — should return 201 with body', async () => {
    const resp = await fetch(`http://localhost:${portRaw}/ctx/json-201`)
    expect(resp.status).toBe(201)
    expect(await resp.json()).toEqual({ foo: 'bar' })
  })
})
