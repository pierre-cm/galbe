import type { TProperties, TSchema } from '@sinclair/typebox'

import { Kind, Optional } from '@sinclair/typebox'

export const validate = (elt: any, schema: TSchema, parse = false): any => {
  type ValidationError = string | string[] | { [key: string]: ValidationError }
  const errors: ValidationError[] = []
  if (schema[Kind] === 'Boolean') {
    if (parse && typeof elt === 'string') elt = elt === 'true' ? true : elt === 'false' ? false : null
    if (elt !== true && elt !== false) throw 'Not a valid boolean'
  } else if (schema[Kind] === 'Integer') {
    if (parse && typeof elt === 'string') elt = Number(elt)
    if (!Number.isInteger(elt)) throw 'Not a valid integer'
    schemaValidation(elt, schema)
  } else if (schema[Kind] === 'Number') {
    if (parse && typeof elt === 'string') elt = Number(elt)
    if (!Number.isFinite(elt)) throw 'Not a valid number'
    schemaValidation(elt, schema)
  } else if (schema[Kind] === 'String') {
    if (!(typeof elt === 'string')) throw 'Not a valid string'
    schemaValidation(elt, schema)
  } else if (schema[Kind] === 'Object') {
    if (parse && typeof elt === 'string') {
      try {
        elt = JSON.parse(elt)
      } catch {
        throw 'Not a valid object'
      }
    }
    if (typeof elt !== 'object') throw 'Not a valid object'
    if (Array.isArray(elt)) throw 'Not a valid object'
    const err: ValidationError = {}
    Object.entries(schema.properties as TProperties).forEach(([k, s]) => {
      if (!(k in elt)) {
        if (!s[Optional]) err[k] = 'Required'
        return
      }
      try {
        validate(elt[k], s, parse)
      } catch (e) {
        err[k] = e as ValidationError
      }
    })
    if (Object.keys(err).length) errors.push(err)
  } else if (schema[Kind] === 'Array') {
    if (parse && typeof elt === 'string') {
      try {
        elt = JSON.parse(elt)
      } catch (error) {
        throw 'Not a valid array'
      }
    }
    if (!Array.isArray(elt)) throw 'Not a valid array'
    schemaValidation(elt, schema)
  } else if (schema[Kind] === 'ByteArray') {
    if (parse && typeof elt === 'string') elt = Uint8Array.from(elt, c => c.charCodeAt(0))
    else if (parse && Array.isArray(elt)) elt = new Uint8Array(elt)
    if (!(elt instanceof Uint8Array)) throw 'Not a valid ByteArray'
  } else if (schema[Kind] === 'Any') {
  } else {
    throw `Unsupported schema type ${schema[Kind]}`
  }

  if (Object.keys(errors).length === 1) throw errors[0]
  if (Object.keys(errors).length > 1) throw errors

  return elt
}

const schemaValidation = (value: any, schema: TSchema): { valid: boolean; errors: string | string[] } => {
  const errors = []
  if (schema[Kind] === 'Integer' || schema[Kind] === 'Number') {
    if (schema.exclusiveMinimum !== undefined)
      if ((value as number) <= schema.exclusiveMinimum)
        errors.push(`${value} is less or equal to ${schema.exclusiveMinimum}`)
    if (schema.exclusiveMaximum !== undefined)
      if ((value as number) >= schema.exclusiveMaximum)
        errors.push(`${value} is greater or equal to ${schema.exclusiveMaximum}`)
    if (schema.minimum !== undefined)
      if ((value as number) < schema.minimum) errors.push(`${value} is less than ${schema.minimum}`)
    if (schema.maximum !== undefined)
      if ((value as number) > schema.maximum) errors.push(`${value} is greater than ${schema.maximum}`)
  } else if (schema[Kind] === 'String') {
    if (schema.minLength !== undefined && (value as string).length < schema.minLength)
      errors.push(`${value} length is too small (${schema.minLength} char min)`)
    if (schema.maxLength !== undefined && (value as string).length > schema.maxLength)
      errors.push(`${value} length is too large (${schema.maxLength} char max)`)
    if (schema.pattern !== undefined && !(value as string).match(schema.pattern))
      errors.push(`${value} does not match pattern ${schema.pattern}`)
  } else if (schema[Kind] === 'Array') {
    if (schema.minItems !== undefined && (value as any[]).length < schema.minItems)
      errors.push(`Must contain at least ${schema.minItems} item${schema.minItems > 1 ? 's' : ''}`)
    if (schema.maxItems !== undefined && (value as any[]).length > schema.maxItems)
      errors.push(`Must contain at most (${schema.maxItems} item${schema.maxItems > 1 ? 's' : ''}`)
    if (schema.uniqueItems === true && new Set(value as any[]).size !== (value as any[]).length)
      errors.push(`Has duplicate values`)
  }
  return { valid: !errors.length, errors: Array.isArray(errors) && errors.length === 1 ? errors[0] : errors }
}
