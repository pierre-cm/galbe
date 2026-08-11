import { describe, test, expect } from 'bun:test'
import { $T, Galbe } from '../src'
import { Kind, type STSchema } from '../src/schema'
import { validate } from '../src/validator'
import { compile, runCompiled, Compiled } from '../src/validator.compile'

const run = (fn: (elt: any, opt?: { parse?: boolean }) => any, input: any, opt?: { parse?: boolean }) => {
  try {
    return { ok: fn(input, opt) }
  } catch (err) {
    return { err }
  }
}

// compiled validators must accept/reject exactly the same inputs and throw the
// same payloads as the interpreter
const expectParity = (schema: STSchema, inputs: any[], opt?: { parse?: boolean }) => {
  const compiled = compile(schema)
  expect(compiled).toBeDefined()
  for (const input of inputs)
    expect(run(compiled!, input, opt)).toEqual(run(elt => validate(elt, schema, opt), input, opt))
}

describe('validator.compile: parity with the interpreter', () => {
  test('null', () => {
    expectParity($T.null(), [null, 0, '', 'null', undefined, false, {}])
  })

  test('boolean', () => {
    const inputs = [true, false, 'true', 'false', 'yes', 1, 0, '', null, undefined]
    expectParity($T.boolean(), inputs)
    expectParity($T.boolean(), inputs, { parse: true })
  })

  test('integer', () => {
    const inputs = [3, 1, 6, '3', '3.5', 'x', 2.5, '', null, NaN, undefined]
    expectParity($T.integer(), inputs)
    expectParity($T.integer(), inputs, { parse: true })
    expectParity($T.integer({ min: 2, max: 5 }), inputs, { parse: true })
    // fails exclusiveMin and max at once: the interpreter throws an array of messages
    expectParity($T.integer({ exclusiveMin: 5, max: 1 }), [3], { parse: true })
    expectParity($T.integer({ exclusiveMax: 5 }), [5, 4])
  })

  test('number', () => {
    const inputs = [3.5, 1, 6, '3.5', 'x', '', null, NaN, Infinity, undefined]
    expectParity($T.number(), inputs)
    expectParity($T.number(), inputs, { parse: true })
    expectParity($T.number({ min: 2, max: 5 }), inputs, { parse: true })
  })

  test('string', () => {
    const inputs = ['ab', 'abcde', 'a', 'aaa', '', 5, null, undefined]
    expectParity($T.string(), inputs)
    expectParity($T.string({ minLength: 2, maxLength: 4 }), inputs)
    expectParity($T.string({ pattern: /^a+$/ }), inputs)
    // fails minLength and pattern at once: array of messages
    expectParity($T.string({ minLength: 5, pattern: /^a+$/ }), ['ab'])
  })

  test('literal', () => {
    expectParity($T.literal('x'), ['x', 'y', 42, true, undefined])
    expectParity($T.literal(42), [42, '42', 43])
    expectParity($T.literal(true), [true, 'true', false])
  })

  test('object', () => {
    const schema = $T.object({ name: $T.string(), age: $T.optional($T.integer()) })
    const inputs = [
      { name: 'a', age: 1 },
      { name: 'a' },
      { name: 'a', extra: true },
      { age: 1 },
      { name: 5 },
      { name: 5, age: 'x' },
      {},
      null,
      [],
      42,
      'str',
      undefined,
    ]
    expectParity(schema, inputs)
    expectParity(schema, ['{"name":"a","age":"1"}', '{"name":5}', 'not json', ...inputs], { parse: true })
  })

  test('object: nested errors keep their shape', () => {
    const schema = $T.object({ a: $T.object({ b: $T.string() }), c: $T.number({ min: 2 }) })
    expectParity(schema, [{ a: { b: 'x' }, c: 2 }, { a: { b: 1 }, c: 1 }, { a: null, c: 1 }, { a: {} }])
  })

  test('array', () => {
    const inputs = [[1, 2], [], ['1'], [1, 'x'], 'not json', '[1,2]', 5, null, undefined]
    expectParity($T.array($T.number()), inputs)
    expectParity($T.array($T.number()), inputs, { parse: true })
    expectParity($T.array($T.string(), { minLength: 2, maxLength: 3 }), [[], ['a'], ['a', 'b'], ['a', 'b', 'c', 'd']])
    expectParity($T.array($T.number(), { unique: true }), [
      [1, 2],
      [1, 1],
    ])
  })

  test('byteArray', () => {
    const schema = $T.byteArray({ minLength: 2, maxLength: 4 })
    const inputs = [new Uint8Array([1, 2]), new Uint8Array([1]), new Uint8Array(5), 'abc', [1, 2, 3, 4, 5], 123, null]
    expectParity(schema, inputs)
    expectParity(schema, inputs, { parse: true })
  })

  test('anyOf / oneOf', () => {
    const union = $T.anyOf([$T.string(), $T.number()])
    expectParity(union, ['a', 1, true, null, undefined])
    expectParity(union, ['a', '5', 1, true], { parse: true })
    expectParity($T.oneOf([$T.literal('a'), $T.literal('b')]), ['a', 'b', 'c'])
    expectParity($T.anyOf([$T.object({ a: $T.string() }), $T.object({ b: $T.number() })]), [
      { a: 'x' },
      { b: 1 },
      { c: true },
    ])
  })

  test('intersection', () => {
    const schema = $T.intersection([$T.object({ a: $T.string() }), $T.object({ b: $T.number() })])
    expectParity(schema, [{ a: 'x', b: 1 }, { a: 'x' }, { b: 1 }, {}, null])
  })

  test('json', () => {
    const schema = $T.json($T.object({ a: $T.string() }))
    expectParity(schema, [{ a: 'x' }, { a: 1 }, {}, null])
    expectParity(schema, ['{"a":"x"}', '{"a":1}', 'not json'], { parse: true })
  })

  test('any', () => {
    expectParity($T.any(), [1, 'a', null, undefined, {}, [], true])
  })
})

describe('validator.compile: caching and fallback', () => {
  test('caches the compiled validator on the schema object, recursively', () => {
    const schema = $T.object({ n: $T.number() })
    const c = compile(schema)
    expect((schema as any)[Compiled]).toBe(c)
    expect(compile(schema)).toBe(c)
    expect((schema.props.n as any)[Compiled]).toBeDefined()
  })

  test('declines schemas without a known Kind', () => {
    expect(compile(undefined)).toBeUndefined()
    expect(compile({} as STSchema)).toBeUndefined()
    expect(compile({ [Kind]: 'urlForm' } as STSchema)).toBeUndefined()
  })

  test('runCompiled falls back to the interpreter for declined schemas', () => {
    const schema = { [Kind]: 'futureKind' } as unknown as STSchema
    expect(compile(schema)).toBeUndefined()
    // both reject with the same interpreter error
    expect(run(elt => runCompiled(elt, schema), 1)).toEqual(run(elt => validate(elt, schema), 1))
    expect(() => runCompiled(1, schema)).toThrow('Unsupported schema type futureKind')
  })

  test('multipartForm compiles its props but not itself', () => {
    const schema = $T.multipartForm({ file: $T.byteArray({ minLength: 2 }) })
    expect(compile(schema as unknown as STSchema)).toBeUndefined()
    expect((schema.props.file as any)[Compiled]).toBeDefined()
    expect(run(elt => runCompiled(elt, schema.props.file), new Uint8Array([1]))).toEqual({
      err: 'Length is too small (2 bytes min)',
    })
  })
})

describe('validator.compile: route registration', () => {
  test('Galbe.add compiles the route schemas', () => {
    const app = new Galbe()
    const body = $T.object({ n: $T.number() })
    const query = { page: $T.integer() }
    const response = { 200: $T.object({ ok: $T.boolean() }) }
    app.post('/x', { body: { 'application/json': body }, query, response }, () => ({}))
    expect((body as any)[Compiled]).toBeDefined()
    expect((query.page as any)[Compiled]).toBeDefined()
    expect((response[200] as any)[Compiled]).toBeDefined()
  })
})
