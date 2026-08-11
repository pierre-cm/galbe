import type {
  STArray,
  STByteArray,
  STInteger,
  STIntersection,
  STJson,
  STLiteral,
  STMultipartForm,
  STNumber,
  STObject,
  STSchema,
  STString,
  STUnion,
} from './schema'
import type { RequestSchema, STBody } from './types'
import { Kind, Optional } from './schema'
import { validate } from './validator'

/** A validator specialized to a single schema, with the same contract as `validate`. */
export type CompiledValidator = (elt: any, opt?: { parse?: boolean }) => any

// Compiled validators live on their schema object under a symbol key, so they
// stay invisible to Object.entries, JSON.stringify and the spec serializers.
export const Compiled = Symbol.for('Galbe.Validator.Compiled')

/** Runs the compiled validator attached to `schema`, falling back to the `validate` interpreter. */
export const runCompiled = (elt: any, schema: STSchema, opt?: { parse?: boolean }): any => {
  const c = (schema as any)[Compiled] as CompiledValidator | undefined
  return c ? c(elt, opt) : validate(elt, schema, opt)
}

/**
 * Compiles `schema` into a specialized validator, cached on the schema object
 * itself. Nested schemas are compiled recursively, so per-prop parsers
 * (paramParser, multipart) find compiled validators too. Returns undefined for
 * kinds the compiler doesn't support — callers fall back to the interpreter.
 */
export const compile = (schema?: STSchema): CompiledValidator | undefined => {
  if (!schema?.[Kind]) return undefined
  const cached = (schema as any)[Compiled] as CompiledValidator | undefined
  if (cached) return cached
  let fn: CompiledValidator | undefined
  try {
    fn = build(schema)
  } catch {
    // a malformed schema must not break boot — the interpreter reports it at request time
    fn = undefined
  }
  if (fn) (schema as any)[Compiled] = fn
  return fn
}

/** Compiles every schema reachable from a route's request schema. Called at route registration time. */
export const compileRoute = (schema: RequestSchema) => {
  for (const props of [schema.headers, schema.params, schema.query])
    if (props) for (const s of Object.values(props)) compile(s as STSchema)
  const body = schema.body as STBody | undefined
  if (body) {
    if ((body as STSchema)[Kind]) compile(body as STSchema)
    else for (const s of Object.values(body)) compile(s as STSchema)
  }
  for (const entry of Object.values(schema.response ?? {})) {
    if (!entry) continue
    if ((entry as STSchema)[Kind]) compile(entry as STSchema)
    // response content maps also carry non-schema keys (description, responseHeaders) — compile ignores them
    else for (const s of Object.values(entry)) compile(s as STSchema)
  }
}

// Compiled equivalents of schemaValidation(): bounds and messages are closed
// over at compile time. Like the interpreter, a single failure throws the
// message, several throw an array of messages.
const constraintRunner = (checks: ((v: any) => string | undefined)[]) => {
  if (!checks.length) return undefined
  return (v: any) => {
    const errors: string[] = []
    for (const check of checks) {
      const msg = check(v)
      if (msg !== undefined) errors.push(msg)
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw errors
  }
}

const numberConstraints = (n: STNumber | STInteger) => {
  const checks: ((v: number) => string | undefined)[] = []
  if (n.exclusiveMin !== undefined) {
    const b = n.exclusiveMin
    checks.push(v => (v <= b ? `Is less or equal to ${b}` : undefined))
  }
  if (n.exclusiveMax !== undefined) {
    const b = n.exclusiveMax
    checks.push(v => (v >= b ? `Is greater or equal to ${b}` : undefined))
  }
  if (n.min !== undefined) {
    const b = n.min
    checks.push(v => (v < b ? `Is less than ${b}` : undefined))
  }
  if (n.max !== undefined) {
    const b = n.max
    checks.push(v => (v > b ? `Is greater than ${b}` : undefined))
  }
  return constraintRunner(checks)
}

const stringConstraints = (s: STString) => {
  const checks: ((v: string) => string | undefined)[] = []
  if (s.minLength !== undefined) {
    const b = s.minLength
    checks.push(v => (v.length < b ? `Length is too small (${b} char min)` : undefined))
  }
  if (s.maxLength !== undefined) {
    const b = s.maxLength
    checks.push(v => (v.length > b ? `Length is too large (${b} char max)` : undefined))
  }
  if (s.pattern !== undefined) {
    const p = s.pattern
    const msg = `Does not match pattern ${p}`
    checks.push(v => (!v.match(p) ? msg : undefined))
  }
  return constraintRunner(checks)
}

const byteArrayConstraints = (ba: STByteArray) => {
  const checks: ((v: Uint8Array) => string | undefined)[] = []
  if (ba.minLength !== undefined) {
    const b = ba.minLength
    checks.push(v => (v.length < b ? `Length is too small (${b} bytes min)` : undefined))
  }
  if (ba.maxLength !== undefined) {
    const b = ba.maxLength
    checks.push(v => (v.length > b ? `Length is too large (${b} bytes max)` : undefined))
  }
  return constraintRunner(checks)
}

const arrayConstraints = (arr: STArray) => {
  const checks: ((v: any[]) => string | undefined)[] = []
  if (arr.minLength !== undefined) {
    const b = arr.minLength
    checks.push(v => (v.length < b ? `Must contain at least ${b} item${b > 1 ? 's' : ''}` : undefined))
  }
  if (arr.maxLength !== undefined) {
    const b = arr.maxLength
    checks.push(v => (v.length > b ? `Must contain at most ${b} item${b > 1 ? 's' : ''}` : undefined))
  }
  if (arr.unique === true) checks.push(v => (new Set(v).size !== v.length ? `Has duplicate values` : undefined))
  return constraintRunner(checks)
}

// Builds the specialized validator for one schema. Must accept/reject exactly
// the same inputs and throw the same plain-string errors as `validate`.
const build = (schema: STSchema): CompiledValidator | undefined => {
  switch (schema[Kind]) {
    case 'null':
      return elt => {
        if (elt !== null) throw `Expected null value got ${elt}`
        return elt
      }
    case 'boolean':
      return (elt, opt) => {
        if (typeof elt === 'string') {
          if (opt?.parse) elt = elt === 'true' ? true : elt === 'false' ? false : null
          else throw `Expected boolean, got string.`
        }
        if (elt !== true && elt !== false) throw `Not a valid boolean. Should be 'true' or 'false'`
        return elt
      }
    case 'integer': {
      const constraints = numberConstraints(schema as STInteger)
      return (elt, opt) => {
        if (elt === '') throw `Not a valid integer`
        if (opt?.parse && typeof elt === 'string') elt = Number(elt)
        if (!Number.isInteger(elt)) throw `Not a valid integer`
        constraints?.(elt)
        return elt
      }
    }
    case 'number': {
      const constraints = numberConstraints(schema as STNumber)
      return (elt, opt) => {
        if (elt === '') throw `Not a valid number`
        if (opt?.parse && typeof elt === 'string') elt = Number(elt)
        if (!Number.isFinite(elt)) throw `Not a valid number`
        constraints?.(elt)
        return elt
      }
    }
    case 'string': {
      const constraints = stringConstraints(schema as STString)
      return elt => {
        if (typeof elt !== 'string') throw `Not a valid string`
        constraints?.(elt)
        return elt
      }
    }
    case 'literal': {
      const value = (schema as STLiteral).value
      return elt => {
        if (elt !== value) throw `Not a valid value. Found "${elt}" but expected "${value}"`
        return elt
      }
    }
    case 'object': {
      const props = Object.entries((schema as STObject).props ?? {}).map(([k, s]) => ({
        k,
        s: s as STSchema,
        c: compile(s as STSchema),
        required: !(s as STSchema)?.[Optional],
      }))
      return (elt, opt) => {
        if (opt?.parse && typeof elt === 'string') {
          try {
            elt = JSON.parse(elt)
          } catch {
            throw `Not a valid object`
          }
        }
        if (elt === null || typeof elt !== 'object') throw `Not a valid object`
        if (Array.isArray(elt)) throw `Expected an object, not an array`
        let err: Record<string, any> | undefined
        for (const { k, s, c, required } of props) {
          if (!(k in elt)) {
            if (required) (err ??= {})[k] = 'Required'
            continue
          }
          try {
            if (c) c(elt[k], opt)
            else validate(elt[k], s, opt)
          } catch (e) {
            ;(err ??= {})[k] = e
          }
        }
        if (err) throw err
        return elt
      }
    }
    case 'json': {
      const value = (schema as STJson).value as STSchema
      const c = compile(value)
      return (elt, opt) => (c ? c(elt, opt) : validate(elt, value, opt))
    }
    case 'array': {
      const arr = schema as STArray
      const items = arr.items
      const c = compile(items)
      const constraints = arrayConstraints(arr)
      return (elt, opt) => {
        if (opt?.parse && typeof elt === 'string') {
          try {
            elt = JSON.parse(elt)
          } catch {
            throw 'Not a valid array'
          }
        }
        if (!Array.isArray(elt)) throw 'Not a valid array'
        // the interpreter validates items without parse mode — keep parity
        for (const i of elt) {
          if (c) c(i)
          else validate(i, items)
        }
        constraints?.(elt)
        return elt
      }
    }
    case 'byteArray': {
      const constraints = byteArrayConstraints(schema as STByteArray)
      return (elt, opt) => {
        if (opt?.parse && typeof elt === 'string') elt = Uint8Array.from(elt, chr => chr.charCodeAt(0))
        else if (opt?.parse && Array.isArray(elt)) elt = new Uint8Array(elt)
        if (!(elt instanceof Uint8Array)) throw 'Not a valid byteArray'
        constraints?.(elt)
        return elt
      }
    }
    case 'anyOf':
    case 'oneOf': {
      const members = Object.values((schema as STUnion).members) as STSchema[]
      const failMsg = `Could not be parsed to any of [${members.map(u => (u as any)?.value ?? u[Kind]).join(', ')}]`
      const pairs = members.map(m => ({ m, c: compile(m) }))
      return (elt, opt) => {
        for (const { m, c } of pairs) {
          try {
            return c ? c(elt, opt) : validate(elt, m, opt)
          } catch {
            continue
          }
        }
        throw failMsg
      }
    }
    case 'intersection': {
      const allOf = Object.values((schema as STIntersection<any>).allOf) as STSchema[]
      const pairs = allOf.map(m => ({ m, c: compile(m) }))
      return (elt, opt) => {
        for (const { m, c } of pairs) {
          if (c) c(elt, opt)
          else validate(elt, m, opt)
        }
        return elt
      }
    }
    case 'any':
      return elt => elt
    case 'multipartForm':
      // validate() has no multipartForm branch — its props are validated
      // individually by the multipart parser, so only compile those
      for (const s of Object.values((schema as STMultipartForm).props ?? {})) compile(s as STSchema)
      return undefined
    default:
      return undefined
  }
}
