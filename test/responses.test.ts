import { expect, test, describe, beforeAll } from 'bun:test'
import { Kadre, T } from '../src'
import { decoder } from './test.utils'

const port = 7359

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
    }
  })
}

describe('responses', () => {
  beforeAll(async () => {
    const kadre = new Kadre()

    kadre.post(
      '/response',
      {
        body: T.Optional(T.Object(T.Any())),
        query: { text: T.Optional(T.String()), stream: T.Optional(T.String()) }
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

    kadre.get('/error', _ => {
      return { next: () => {} }
    })

    kadre.onError(_ => {
      throw new Error()
    })

    await kadre.listen(port)
  })

  test('response, string', async () => {
    const reqTxt = 'Hello Mom!'
    let resp = await fetch(`http://localhost:${port}/response?text=${reqTxt}`, {
      method: 'POST'
    })

    const body = await resp.text()

    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toBe('text/plain')
    expect(body).toBe(reqTxt)
  })

  test('response, object', async () => {
    const reqBody = { foo: 'bar' }
    let resp = await fetch(`http://localhost:${port}/response`, {
      method: 'POST',
      body: JSON.stringify(reqBody),
      headers: {
        'content-type': 'application/json'
      }
    })

    const body = await resp.json()

    expect(resp.status).toBe(200)
    expect(resp.headers.get('content-type')).toBe('application/json')
    expect(body).toEqual(reqBody)
  })

  test('response, stream', async () => {
    const reqTxt = 'Hello Mom!'
    const cases = [{ stream: 'generatorFunction' }, { stream: 'readableStream' }]

    for (const c of cases) {
      let resp = await fetch(`http://localhost:${port}/response?text=${reqTxt}&stream=${c.stream}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        }
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
})
