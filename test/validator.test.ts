import { describe, test, expect } from 'bun:test'
import { $T } from '../src'
import { validate, validateResponse } from '../src/validator'

describe('validator: array length constraints', () => {
  // ArrayOptions exposes minLength/maxLength on $T.array(); historically the
  // validator looked for schema.minItems/maxItems which never exist, so the
  // constraint was silently ignored.
  test('rejects arrays shorter than minLength', () => {
    const schema = $T.array($T.string(), { minLength: 2 })
    expect(() => validate(['a'], schema)).toThrow()
    expect(() => validate(['a', 'b'], schema)).not.toThrow()
  })

  test('rejects arrays longer than maxLength', () => {
    const schema = $T.array($T.string(), { maxLength: 2 })
    expect(() => validate(['a', 'b', 'c'], schema)).toThrow()
    expect(() => validate(['a', 'b'], schema)).not.toThrow()
  })

  test('rejects arrays with duplicate values when unique', () => {
    const schema = $T.array($T.number(), { unique: true })
    expect(() => validate([1, 2, 2], schema)).toThrow()
    expect(() => validate([1, 2, 3], schema)).not.toThrow()
  })
})

describe('validator: object schema with non-object input', () => {
  // `typeof null === 'object'`, so null needs an explicit rejection — a JSON
  // null body must never reach a handler typed as an object.
  test('rejects null input on object with required props', () => {
    const schema = $T.object({ a: $T.string() })
    let err: any
    try {
      validate(null, schema)
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
    expect(err).not.toBeInstanceOf(TypeError)
    expect(err).toBe('Not a valid object')
  })

  test('rejects null input on object with no required props', () => {
    const schema = $T.object({ a: $T.optional($T.string()) })
    let err: any
    try {
      validate(null, schema)
    } catch (e) {
      err = e
    }
    expect(err).toBe('Not a valid object')
  })

  test('rejects null input on prop-less object schema', () => {
    let err: any
    try {
      validate(null, $T.object())
    } catch (e) {
      err = e
    }
    expect(err).toBe('Not a valid object')
  })

  test('throws a clean error for primitive input on object schema', () => {
    const schema = $T.object({ a: $T.string() })
    let err: any
    try {
      validate(42, schema)
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
    expect(err).not.toBeInstanceOf(TypeError)
    expect(err).toBe('Not a valid object')
  })

  test('rejects array input on object schema', () => {
    const schema = $T.object({ a: $T.string() })
    let err: any
    try {
      validate([], schema)
    } catch (e) {
      err = e
    }
    expect(err).toBe('Expected an object, not an array')
  })
})

describe('validator: validateResponse default fallback', () => {
  // `validateResponse` previously short-circuited on
  // `if (!(status in schema)) return`, never reaching the
  // `schema?.[status] || schema?.['default']` fallback.
  test('uses default schema when status is not explicitly defined', () => {
    const schema: any = { default: $T.object({ ok: $T.string() }) }
    expect(() => validateResponse({ ok: 'yes' }, schema, 200)).not.toThrow()
    expect(() => validateResponse({ ok: 123 }, schema, 200)).toThrow()
  })

  test('still uses explicit status schema when defined', () => {
    const schema: any = {
      200: $T.object({ ok: $T.string() }),
      default: $T.object({ err: $T.string() }),
    }
    expect(() => validateResponse({ ok: 'yes' }, schema, 200)).not.toThrow()
    expect(() => validateResponse({ ok: 'yes' }, schema, 500)).toThrow()
  })

  test('does nothing when neither status nor default is defined', () => {
    const schema: any = { 200: $T.object({ ok: $T.string() }) }
    expect(() => validateResponse({ anything: true }, schema, 404)).not.toThrow()
  })
})
