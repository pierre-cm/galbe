import { describe, test, expect } from 'bun:test'
import { $T } from '../src'
import type { STSchema, STArray, STString, STUnion, STIntersection, STObject } from '../src/schema'
import type { STBodyContent, STBodyType } from '../src/types'

// Type-level regression tests for the dropped `[key: string]: any` index
// signature on STSchema and the STBody/STBodyType decoupling.

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

describe('schema typing', () => {
  test('STSchema does not accept arbitrary fields', () => {
    const s = $T.string() satisfies STSchema
    // @ts-expect-error — STSchema must not have an open index signature anymore.
    const bad: STSchema = { ...s, randomField: 'whatever' }
    void bad
    expect(true).toBe(true)
  })

  test('STArray exposes ArrayOptions on its type', () => {
    const arr = $T.array($T.string(), { minLength: 1, maxLength: 3, unique: true })
    type _arr_minLength = Expect<Equal<typeof arr.minLength, number | undefined>>
    type _arr_maxLength = Expect<Equal<typeof arr.maxLength, number | undefined>>
    type _arr_unique = Expect<Equal<typeof arr.unique, boolean | undefined>>
    expect(arr.minLength).toBe(1)
    expect(arr.maxLength).toBe(3)
    expect(arr.unique).toBe(true)
  })

  test('STString exposes StringOptions on its type', () => {
    const s = $T.string({ minLength: 2, maxLength: 5, pattern: /^[a-z]+$/, format: 'email' })
    type _str_minLength = Expect<Equal<typeof s.minLength, number | undefined>>
    type _str_pattern = Expect<Equal<typeof s.pattern, RegExp | undefined>>
    type _str_format = Expect<Equal<typeof s.format, string | undefined>>
    expect(s.minLength).toBe(2)
    expect(s.format).toBe('email')
  })

  test('STBodyType is MediaType and STBodyContent uses full media type keys', () => {
    // STBodyType is now `\`${string}/${string}\`` (MediaType).
    // Full media type strings are valid STBodyType values.
    type _json = Extract<STBodyType, 'application/json'>
    type _text = Extract<STBodyType, 'text/plain'>
    type _ba = Extract<STBodyType, 'application/octet-stream'>
    type _form = Extract<STBodyType, 'application/x-www-form-urlencoded'>
    type _mp = Extract<STBodyType, 'multipart/form-data'>
    type _def = Extract<STBodyType, '*/*'>
    const all: STBodyType[] = [
      'application/json',
      'text/plain',
      'application/octet-stream',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      '*/*',
    ]
    expect(all.length).toBe(6)
    type _content = Expect<Equal<keyof STBodyContent, STBodyType>>
    void (null as unknown as _json | _text | _ba | _form | _mp | _def)
  })

  test('Options.deprecated is part of every schema', () => {
    const s = $T.string({ deprecated: true })
    expect(s.deprecated).toBe(true)
  })

  test('reading a typed constraint requires the typed schema', () => {
    // Generic STSchema must NOT expose constraint fields directly.
    const fn = (s: STSchema) => {
      // @ts-expect-error — `pattern` belongs to STString, not STSchema.
      void s.pattern
      // @ts-expect-error — `minLength` belongs to STString/STArray/STByteArray.
      void s.minLength
      // @ts-expect-error — `min` belongs to STNumber/STInteger.
      void s.min
    }
    fn($T.string())
    fn($T.array() as unknown as STArray)
    fn($T.string() as unknown as STString)
    expect(true).toBe(true)
  })

  describe('STUnion / STIntersection have no `props` field', () => {
    test('STUnion only exposes members at the type and runtime levels', () => {
      const u: STUnion = $T.union([$T.string(), $T.number()])
      // Runtime: `.members` is the schema array; `.props` was a phantom field
      // and is no longer claimed at the type level.
      expect(Array.isArray(u.members)).toBe(true)
      expect(u.members.length).toBe(2)
      // @ts-expect-error — STUnion no longer declares a `props` field.
      void u.props
      // Reading at runtime should be undefined (the constructor never set it).
      expect((u as any).props).toBeUndefined()
    })

    test('STIntersection only exposes allOf at the type and runtime levels', () => {
      const i: STIntersection<[STObject, STObject]> = $T.intersection([
        $T.object({ a: $T.string() }),
        $T.object({ b: $T.number() }),
      ])
      expect(Array.isArray(i.allOf)).toBe(true)
      expect(i.allOf.length).toBe(2)
      // @ts-expect-error — STIntersection no longer declares a `props` field.
      void i.props
      // The previous broken merge that silently dropped conflicting keys
      // is removed; the constructor no longer computes `.props`.
      expect((i as any).props).toBeUndefined()
    })

    test('intersectionize still validates by walking allOf', async () => {
      // Behavioral check that runtime validation works without a precomputed
      // `props` on the intersection — sanity confirmation for the removal.
      const { Galbe } = await import('../src')
      const g = new Galbe()
      g.post(
        '/inter',
        {
          body: {
            'application/json': $T.intersection([
              $T.object({ a: $T.string() }),
              $T.object({ b: $T.number() }),
            ]),
          },
        },
        ctx => ctx.body
      )
      const port = 7366
      await g.listen(port)
      try {
        const ok = await fetch(`http://localhost:${port}/inter`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ a: 'x', b: 1 }),
        })
        expect(ok.status).toBe(200)
        await ok.body?.cancel()

        const bad = await fetch(`http://localhost:${port}/inter`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ a: 'x' }),
        })
        expect(bad.status).toBe(400)
        await bad.body?.cancel()
      } finally {
        g.stop()
      }
    })
  })
})
