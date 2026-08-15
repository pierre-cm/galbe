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

describe('validator: additionalProperties', () => {
  test('$T.record validates every value against one schema', () => {
    const schema = $T.record($T.integer())
    expect(() => validate({ a: 1, b: 2 }, schema)).not.toThrow()
    expect(() => validate({}, schema)).not.toThrow()
    try {
      validate({ a: 1, b: 'x' }, schema)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toEqual({ b: 'Not a valid integer' })
    }
  })

  test('declared properties are exempt from the value schema', () => {
    const schema = $T.object({ id: $T.string() }, { additionalProperties: $T.integer() })
    expect(() => validate({ id: 'a', count: 2 }, schema)).not.toThrow()
    try {
      validate({ id: 'a', count: 'nope' }, schema)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toEqual({ count: 'Not a valid integer' })
    }
  })

  test('additionalProperties: false rejects undeclared properties', () => {
    const schema = $T.object({ id: $T.string() }, { additionalProperties: false })
    expect(() => validate({ id: 'a' }, schema)).not.toThrow()
    try {
      validate({ id: 'a', extra: 1 }, schema)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toEqual({ extra: 'Unexpected property' })
    }
  })

  test('unset additionalProperties keeps the permissive default', () => {
    expect(() => validate({ id: 'a', extra: 1 }, $T.object({ id: $T.string() }))).not.toThrow()
  })

  test('a payload key named like an Object.prototype member is not treated as declared', () => {
    // `k in props` would report `toString` as a declared property and skip it
    const schema = $T.object({ id: $T.string() }, { additionalProperties: false })
    try {
      validate({ id: 'a', toString: 'x' }, schema)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toEqual({ toString: 'Unexpected property' })
    }
  })
})

describe('validator: numeric multipleOf', () => {
  test('rejects a value that is not a multiple', () => {
    const schema = $T.number({ multipleOf: 0.25 })
    expect(() => validate(0.3, schema)).toThrow('Is not a multiple of 0.25')
    expect(() => validate(0.75, schema)).not.toThrow()
    expect(() => validate(0, schema)).not.toThrow()
    expect(() => validate(-1.5, schema)).not.toThrow()
  })

  // an exact `%` test would reject this: 0.3 / 0.1 is 2.9999999999999996
  test('tolerates binary floating-point error on decimal multiples', () => {
    expect(() => validate(0.3, $T.number({ multipleOf: 0.1 }))).not.toThrow()
    expect(() => validate(4.35, $T.number({ multipleOf: 0.05 }))).not.toThrow()
  })

  test('applies to integers too', () => {
    const schema = $T.integer({ multipleOf: 5 })
    expect(() => validate(7, schema)).toThrow('Is not a multiple of 5')
    expect(() => validate(15, schema)).not.toThrow()
  })
})

describe('validator: numeric format', () => {
  test('the machine-integer formats constrain the range', () => {
    expect(() => validate(2147483648, $T.integer({ format: 'int32' }))).toThrow('Is out of int32 range')
    expect(() => validate(2147483647, $T.integer({ format: 'int32' }))).not.toThrow()
    expect(() => validate(-1, $T.integer({ format: 'uint32' }))).toThrow('Is out of uint32 range')
    expect(() => validate(1e30, $T.integer({ format: 'int64' }))).toThrow('Is out of int64 range')
    expect(() => validate(9007199254740991, $T.integer({ format: 'int64' }))).not.toThrow()
  })

  test('float, double and unknown formats are documentation only', () => {
    // every finite JSON number is a valid double, and 0.1 is a valid float:
    // a round-trip check through Math.fround would reject it
    expect(() => validate(0.1, $T.number({ format: 'float' }))).not.toThrow()
    expect(() => validate(1e300, $T.number({ format: 'double' }))).not.toThrow()
    expect(() => validate(1e300, $T.number({ format: 'currency' }))).not.toThrow()
  })

  test('a format violation reports alongside the other constraints', () => {
    // one failure throws the message, several throw the array of them
    expect(() => validate(-1, $T.integer({ format: 'uint32', min: 10 }))).toThrow()
    try {
      validate(-1, $T.integer({ format: 'uint32', min: 10 }))
    } catch (err) {
      expect(err).toEqual(['Is less than 10', 'Is out of uint32 range'])
    }
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

describe('validator: validateResponse status ranges', () => {
  // exact status > the NXX range containing it > default
  const schema: any = {
    404: $T.object({ notFound: $T.string() }),
    '4XX': $T.object({ clientError: $T.string() }),
    default: $T.object({ fallback: $T.string() }),
  }

  test('a range covers every status in its hundred', () => {
    expect(() => validateResponse({ clientError: 'x' }, schema, 400)).not.toThrow()
    expect(() => validateResponse({ clientError: 'x' }, schema, 418)).not.toThrow()
    expect(() => validateResponse({ fallback: 'x' }, schema, 400)).toThrow()
  })

  test('an exact status wins over the range containing it', () => {
    expect(() => validateResponse({ notFound: 'x' }, schema, 404)).not.toThrow()
    expect(() => validateResponse({ clientError: 'x' }, schema, 404)).toThrow()
  })

  test('a status outside every range falls through to default', () => {
    expect(() => validateResponse({ fallback: 'x' }, schema, 500)).not.toThrow()
    expect(() => validateResponse({ clientError: 'x' }, schema, 500)).toThrow()
  })
})

describe('validator: reflected input in error messages', () => {
  // Attacker-controlled input interpolated into error messages must be capped,
  // so a huge string cannot be echoed back verbatim (response amplification).
  const grab = (fn: () => any): any => {
    try {
      fn()
    } catch (e) {
      return e
    }
  }

  test('literal error caps over-long input at 100 chars with an ellipsis', () => {
    const input = 'x'.repeat(500)
    const err = grab(() => validate(input, $T.literal('y')))
    expect(err).toBe(`Not a valid value. Found "${'x'.repeat(100)}…" but expected "y"`)
  })

  test('literal error renders short input uncapped', () => {
    const err = grab(() => validate('toto', $T.literal('bar')))
    expect(err).toBe('Not a valid value. Found "toto" but expected "bar"')
  })

  test('null error caps over-long input', () => {
    const err = grab(() => validate('n'.repeat(500), $T.null()))
    expect(err).toBe(`Expected null value got ${'n'.repeat(100)}…`)
  })

  test('null error stringifies non-string input safely', () => {
    const circular: any = {}
    circular.self = circular
    const err = grab(() => validate(circular, $T.null()))
    expect(err).toBe('Expected null value got [object Object]')
  })
})
