import { InternalError, type STResponse } from './index'
import type { STSchema, STProps, STUnion } from './schema'
import { Kind, Optional, Stream } from './schema'
import { isIterator } from './util'

export const validate = (elt: any, schema: STSchema, parse = false): any => {
  type ValidationError = string | string[] | { [key: string]: ValidationError }
  const errors: ValidationError[] = []
  const iElt = elt

  if (schema[Kind] === 'boolean') {
    if (typeof elt === 'string') {
      if (parse) elt = elt === 'true' ? true : elt === 'false' ? false : null
      else throw `Expected boolean, got string.`
    }
    if (elt !== true && elt !== false) throw `${iElt} is not a valid boolean. Should be 'true' or 'false'`
  } else if (schema[Kind] === 'integer') {
    if (parse && typeof elt === 'string') elt = Number(elt)
    if (!Number.isInteger(elt)) throw `${iElt} is not a valid integer`
    schemaValidation(elt, schema)
  } else if (schema[Kind] === 'number') {
    if (parse && typeof elt === 'string') elt = Number(elt)
    if (!Number.isFinite(elt)) throw `${iElt} is not a valid number`
    schemaValidation(elt, schema)
  } else if (schema[Kind] === 'string') {
    if (!(typeof elt === 'string')) throw `${iElt} is not a valid string`
    schemaValidation(elt, schema)
  } else if (schema[Kind] === 'literal') {
    if (elt !== schema.value) throw `${iElt} is not a valid value`
  } else if (schema[Kind] === 'object') {
    if (parse && typeof elt === 'string') {
      try {
        elt = JSON.parse(elt)
      } catch {
        throw `${iElt} is not a valid object`
      }
    }
    if (typeof elt !== 'object') throw `${iElt} is not a valid object`
    if (Array.isArray(elt)) throw `Expected an object, not an array`
    const err: ValidationError = {}
    Object.entries(schema.props as STProps).forEach(([k, s]) => {
      if (!(k in elt)) {
        if (!s?.[Optional]) err[k] = 'Required'
        return
      }
      try {
        validate(elt[k], s, parse)
      } catch (e) {
        err[k] = e as ValidationError
      }
    })
    if (Object.keys(err).length) errors.push(err)
  } else if (schema[Kind] === 'array') {
    if (parse && typeof elt === 'string') {
      try {
        elt = JSON.parse(elt)
      } catch (error) {
        throw 'Not a valid array'
      }
    }
    if (!Array.isArray(elt)) throw 'Not a valid array'
    schemaValidation(elt, schema)
  } else if (schema[Kind] === 'byteArray') {
    if (parse && typeof elt === 'string') elt = Uint8Array.from(elt, c => c.charCodeAt(0))
    else if (parse && Array.isArray(elt)) elt = new Uint8Array(elt)
    if (!(elt instanceof Uint8Array)) throw 'Not a valid byteArray'
  } else if (schema[Kind] === 'union') {
    const union = Object.values((schema as STUnion).anyOf)
    let valid = false
    for (const u of union) {
      try {
        elt = validate(elt, u as STSchema, parse)
        valid = true
        break
      } catch (err) {
        continue
      }
    }
    // @ts-ignore
    if (!valid) throw `${elt} could not be parsed to any of: ${union.map(u => u?.value ?? u[Kind]).join(', ')}`
  } else if (schema[Kind] === 'any') {
  } else {
    throw `Unsupported schema type ${schema[Kind]}`
  }

  if (Object.keys(errors).length === 1) throw errors[0]
  if (Object.keys(errors).length > 1) throw errors

  return elt
}

export const validateResponse = (response: any, schema: STResponse, status: number) => {
  if (!(status in schema)) return
  const s = schema[status]
  if (response instanceof ReadableStream) {
    if (!s[Stream]) throw new InternalError(`Expected ${s[Kind]} response, but got ReadableStream`)
  } else if (isIterator(response)) {
    if (!s[Stream]) throw new InternalError(`Expected ${s[Kind]} response, but got Iterator`)
  } else {
    try {
      validate(response, s)
    } catch (error) {
      throw new InternalError({ ResponseValidationError: error })
    }
  }
}

const schemaValidation = (value: any, schema: STSchema) => {
  const errors = []
  if (schema[Kind] === 'integer' || schema[Kind] === 'number') {
    if (schema.exclusiveMin !== undefined)
      if ((value as number) <= schema.exclusiveMin) errors.push(`${value} is less or equal to ${schema.exclusiveMin}`)
    if (schema.exclusiveMax !== undefined)
      if ((value as number) >= schema.exclusiveMax)
        errors.push(`${value} is greater or equal to ${schema.exclusiveMax}`)
    if (schema.min !== undefined) if ((value as number) < schema.min) errors.push(`${value} is less than ${schema.min}`)
    if (schema.max !== undefined)
      if ((value as number) > schema.max) errors.push(`${value} is greater than ${schema.max}`)
  } else if (schema[Kind] === 'string') {
    if (schema.minLength !== undefined && (value as string).length < schema.minLength)
      errors.push(`${value} length is too small (${schema.minLength} char min)`)
    if (schema.maxLength !== undefined && (value as string).length > schema.maxLength)
      errors.push(`${value} length is too large (${schema.maxLength} char max)`)
    if (schema.pattern !== undefined && !(value as string).match(schema.pattern))
      errors.push(`${value} does not match pattern ${schema.pattern}`)
  } else if (schema[Kind] === 'array') {
    if (schema.minItems !== undefined && (value as any[]).length < schema.minItems)
      errors.push(`Must contain at least ${schema.minItems} item${schema.minItems > 1 ? 's' : ''}`)
    if (schema.maxItems !== undefined && (value as any[]).length > schema.maxItems)
      errors.push(`Must contain at most (${schema.maxItems} item${schema.maxItems > 1 ? 's' : ''}`)
    if (schema.unique === true && new Set(value as any[]).size !== (value as any[]).length)
      errors.push(`Has duplicate values`)
  }
  if (errors.length) throw Array.isArray(errors) && errors.length === 1 ? errors[0] : errors
}
