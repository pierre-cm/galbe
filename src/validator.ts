import { InternalServerError, type STResponse } from './index'
import type {
  STSchema,
  STProps,
  STUnion,
  STIntersection,
  STJson,
  STLiteral,
  STArray,
  STNumber,
  STInteger,
  STString,
  STObject,
} from './schema'
import { Kind, Optional, Stream } from './schema'
import { isIterator } from './util'

export const validate = (elt: any, schema: STSchema, opt?: { parse?: boolean }): any => {
  type ValidationError = string | string[] | { [key: string]: ValidationError }
  const errors: ValidationError[] = []
  const iElt = elt

  if (schema[Kind] === 'null') {
    if (elt !== null) throw `Expected null value got ${iElt}`
  } else if (schema[Kind] === 'boolean') {
    if (typeof elt === 'string') {
      if (opt?.parse) elt = elt === 'true' ? true : elt === 'false' ? false : null
      else throw `Expected boolean, got string.`
    }
    if (elt !== true && elt !== false) throw `Not a valid boolean. Should be 'true' or 'false'`
  } else if (schema[Kind] === 'integer') {
    if (elt === '') throw `Not a valid integer`
    if (opt?.parse && typeof elt === 'string') elt = Number(elt)
    if (!Number.isInteger(elt)) throw `Not a valid integer`
    schemaValidation(elt, schema)
  } else if (schema[Kind] === 'number') {
    if (elt === '') throw `Not a valid number`
    if (opt?.parse && typeof elt === 'string') elt = Number(elt)
    if (!Number.isFinite(elt)) throw `Not a valid number`
    schemaValidation(elt, schema)
  } else if (schema[Kind] === 'string') {
    if (!(typeof elt === 'string')) throw `Not a valid string`
    schemaValidation(elt, schema)
  } else if (schema[Kind] === 'literal') {
    const lit = schema as STLiteral
    if (elt !== lit.value) throw `Not a valid value. Found "${elt}" but expected "${lit.value}"`
  } else if (schema[Kind] === 'object') {
    if (opt?.parse && typeof elt === 'string') {
      try {
        elt = JSON.parse(elt)
      } catch {
        throw `Not a valid object`
      }
    }
    if (typeof elt !== 'object') throw `Not a valid object`
    if (Array.isArray(elt)) throw `Expected an object, not an array`
    const err: ValidationError = {}
    Object.entries((schema as STObject).props as STProps).forEach(([k, s]) => {
      if (elt === null || !(k in elt)) {
        if (!s?.[Optional]) err[k] = 'Required'
        return
      }
      try {
        validate(elt[k], s, opt)
      } catch (e) {
        err[k] = e as ValidationError
      }
    })
    if (Object.keys(err).length) errors.push(err)
  } else if (schema[Kind] === 'json') {
    elt = validate(elt, (schema as STJson).value, opt)
  } else if (schema[Kind] === 'array') {
    if (opt?.parse && typeof elt === 'string') {
      try {
        elt = JSON.parse(elt)
      } catch (error) {
        throw 'Not a valid array'
      }
    }
    if (!Array.isArray(elt)) throw 'Not a valid array'
    for (const i of elt) validate(i, (schema as STArray).items)
    schemaValidation(elt, schema)
  } else if (schema[Kind] === 'byteArray') {
    if (opt?.parse && typeof elt === 'string') elt = Uint8Array.from(elt, c => c.charCodeAt(0))
    else if (opt?.parse && Array.isArray(elt)) elt = new Uint8Array(elt)
    if (!(elt instanceof Uint8Array)) throw 'Not a valid byteArray'
  } else if (schema[Kind] === 'union') {
    const union = Object.values((schema as STUnion).anyOf)
    let valid = false
    for (const s of union) {
      try {
        elt = validate(elt, s as STSchema, opt)
        valid = true
        break
      } catch (err) {
        continue
      }
    }
    // @ts-ignore
    if (!valid) throw `Could not be parsed to any of [${union.map(u => u?.value ?? u[Kind]).join(', ')}]`
  } else if (schema[Kind] === 'intersection') {
    const intersection = Object.values((schema as STIntersection<any>).allOf)
    for (const s of intersection) validate(elt, s as STSchema, opt)
  } else if (schema[Kind] === 'any') {
  } else {
    throw `Unsupported schema type ${schema[Kind]}`
  }

  if (Object.keys(errors).length === 1) throw errors[0]
  if (Object.keys(errors).length > 1) throw errors

  return elt
}

export const validateResponse = (response: any, schema: STResponse, status: number) => {
  const s = schema?.[status] ?? schema?.['default']
  if (!s) return
  if (response instanceof ReadableStream) {
    if (!s[Stream]) throw new InternalServerError(`Expected ${s[Kind]} response, but got ReadableStream`)
  } else if (isIterator(response)) {
    if (!s[Stream]) throw new InternalServerError(`Expected ${s[Kind]} response, but got Iterator`)
  } else {
    try {
      validate(response, s)
    } catch (error) {
      throw new InternalServerError({ ResponseValidationError: error })
    }
  }
}

const schemaValidation = (value: any, schema: STSchema) => {
  const errors = []
  if (schema[Kind] === 'integer' || schema[Kind] === 'number') {
    const n = schema as STNumber | STInteger
    if (n.exclusiveMin !== undefined)
      if ((value as number) <= n.exclusiveMin) errors.push(`Is less or equal to ${n.exclusiveMin}`)
    if (n.exclusiveMax !== undefined)
      if ((value as number) >= n.exclusiveMax) errors.push(`Is greater or equal to ${n.exclusiveMax}`)
    if (n.min !== undefined) if ((value as number) < n.min) errors.push(`Is less than ${n.min}`)
    if (n.max !== undefined) if ((value as number) > n.max) errors.push(`Is greater than ${n.max}`)
  } else if (schema[Kind] === 'string') {
    const str = schema as STString
    if (str.minLength !== undefined && (value as string).length < str.minLength)
      errors.push(`Length is too small (${str.minLength} char min)`)
    if (str.maxLength !== undefined && (value as string).length > str.maxLength)
      errors.push(`Length is too large (${str.maxLength} char max)`)
    if (str.pattern !== undefined && !(value as string).match(str.pattern))
      errors.push(`Does not match pattern ${str.pattern}`)
  } else if (schema[Kind] === 'array') {
    const arr = schema as STArray
    if (arr.minLength !== undefined && (value as any[]).length < arr.minLength)
      errors.push(`Must contain at least ${arr.minLength} item${arr.minLength > 1 ? 's' : ''}`)
    if (arr.maxLength !== undefined && (value as any[]).length > arr.maxLength)
      errors.push(`Must contain at most ${arr.maxLength} item${arr.maxLength > 1 ? 's' : ''}`)
    if (arr.unique === true && new Set(value as any[]).size !== (value as any[]).length)
      errors.push(`Has duplicate values`)
  }
  if (errors.length) throw Array.isArray(errors) && errors.length === 1 ? errors[0] : errors
}
