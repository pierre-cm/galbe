import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { Galbe, $T } from '../src'
import { Kind, schemaToTypeStr, type Static } from '../src/schema'
import { OpenAPISerializer } from '../src/extras/spec/openapi.serializer'

// Type-level checks
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

const json_str = $T.json($T.string())
const json_bool = $T.json($T.boolean())
const json_num = $T.json($T.number())
const json_obj = $T.json($T.object({ a: $T.string(), b: $T.number() }))

type _json_str = Expect<Equal<Static<typeof json_str>, string>>
type _json_bool = Expect<Equal<Static<typeof json_bool>, boolean>>
type _json_num = Expect<Equal<Static<typeof json_num>, number>>
type _json_obj = Expect<Equal<Static<typeof json_obj>, { a: string; b: number }>>

describe('STJson', () => {
  describe('shape', () => {
    test('is a clean wrapper with [Kind]: "json" and a value field', () => {
      const s = $T.json($T.string()) as any
      expect(s[Kind]).toBe('json')
      expect(s.value).toBeDefined()
      expect(s.value[Kind]).toBe('string')
      // Inner schema fields must NOT be spread onto the outer wrapper anymore.
      expect(s.type).toBeUndefined()
    })

    test('preserves outer options on the wrapper', () => {
      const s = $T.json($T.string(), { description: 'a JSON string', id: 'MyJson' }) as any
      expect(s.description).toBe('a JSON string')
      expect(s.id).toBe('MyJson')
      // Inner constraints stay on `value`, not the outer.
      const inner = $T.string({ minLength: 3 })
      const wrapped = $T.json(inner) as any
      expect(wrapped.minLength).toBeUndefined()
      expect(wrapped.value.minLength).toBe(3)
    })

    test('throws on invalid inner schema kinds', () => {
      // arrays, unions, intersections, byteArray, etc. are not allowed inside json
      // @ts-expect-error
      expect(() => $T.json($T.array($T.string()))).toThrow('Invalid Json type definition')
      // @ts-expect-error
      expect(() => $T.json($T.byteArray())).toThrow('Invalid Json type definition')
      // @ts-expect-error
      expect(() => $T.json($T.literal('foo'))).toThrow('Invalid Json type definition')
    })
  })

  describe('schemaToTypeStr', () => {
    test('emits Json<inner> for each supported kind', () => {
      expect(schemaToTypeStr($T.json($T.string()))).toBe('Json<string>')
      expect(schemaToTypeStr($T.json($T.boolean()))).toBe('Json<boolean>')
      expect(schemaToTypeStr($T.json($T.number()))).toBe('Json<number>')
      expect(schemaToTypeStr($T.json($T.object({ a: $T.string() })))).toBe(`Json<{'a':string}>`)
    })
  })

  describe('runtime validation via /body/json route', () => {
    const port = 7365
    const g = new Galbe()

    g.post('/json/str', { body: { json: $T.json($T.string()) } }, ctx => {
      return { body: ctx.body }
    })
    g.post('/json/num', { body: { json: $T.json($T.number()) } }, ctx => {
      return { body: ctx.body }
    })
    g.post(
      '/json/obj',
      { body: { json: $T.json($T.object({ a: $T.string(), b: $T.number() })) } },
      ctx => {
        return { body: ctx.body }
      }
    )

    beforeAll(async () => {
      await g.listen(port)
    })
    afterAll(() => {
      g.stop()
    })

    test('json wrapping a string accepts JSON strings, rejects others', async () => {
      const ok = await fetch(`http://localhost:${port}/json/str`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '"hello"',
      })
      expect(ok.status).toBe(200)
      expect(await ok.json()).toEqual({ body: 'hello' })

      const bad = await fetch(`http://localhost:${port}/json/str`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '42',
      })
      expect(bad.status).toBe(400)
      await bad.body?.cancel()
    })

    test('json wrapping a number accepts numbers, rejects strings', async () => {
      const ok = await fetch(`http://localhost:${port}/json/num`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '42',
      })
      expect(ok.status).toBe(200)
      expect(await ok.json()).toEqual({ body: 42 })

      const bad = await fetch(`http://localhost:${port}/json/num`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '"oops"',
      })
      expect(bad.status).toBe(400)
      await bad.body?.cancel()
    })

    test('json wrapping an object validates props', async () => {
      const ok = await fetch(`http://localhost:${port}/json/obj`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ a: 'x', b: 1 }),
      })
      expect(ok.status).toBe(200)
      expect(await ok.json()).toEqual({ body: { a: 'x', b: 1 } })

      const missing = await fetch(`http://localhost:${port}/json/obj`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ a: 'x' }),
      })
      expect(missing.status).toBe(400)
      await missing.body?.cancel()

      const wrongType = await fetch(`http://localhost:${port}/json/obj`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ a: 'x', b: 'oops' }),
      })
      expect(wrongType.status).toBe(400)
      await wrongType.body?.cancel()
    })
  })

  describe('OpenAPI serialization', () => {
    test('emits inner type for json wrappers', async () => {
      const g = new Galbe()
      g.post(
        '/json',
        { body: { json: $T.json($T.object({ a: $T.string(), b: $T.number() })) } },
        () => 'ok'
      )

      const spec = await OpenAPISerializer(g)
      const op = (spec.paths!['/json'] as any).post
      const schema = op.requestBody.content['application/json'].schema
      expect(schema).toMatchObject({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'number' },
        },
        required: ['a', 'b'],
      })
    })

    test('emits primitive type for primitive json wrappers', async () => {
      const g = new Galbe()
      g.post('/jstr', { body: { json: $T.json($T.string()) } }, () => 'ok')
      g.post('/jnum', { body: { json: $T.json($T.number()) } }, () => 'ok')
      g.post('/jbool', { body: { json: $T.json($T.boolean()) } }, () => 'ok')

      const spec = await OpenAPISerializer(g)
      expect(
        ((spec.paths!['/jstr'] as any).post.requestBody.content['application/json'].schema)
      ).toMatchObject({ type: 'string' })
      expect(
        ((spec.paths!['/jnum'] as any).post.requestBody.content['application/json'].schema)
      ).toMatchObject({ type: 'number' })
      expect(
        ((spec.paths!['/jbool'] as any).post.requestBody.content['application/json'].schema)
      ).toMatchObject({ type: 'boolean' })
    })
  })
})
