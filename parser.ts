import {
  TSchema,
  TBoolean,
  TNumber,
  TInteger,
  TString,
  TLiteral,
  TArray,
  TObject,
  TProperties,
  TUnion,
  TAny,
  Static
} from './typebox'
import { Kind, Optional } from '@sinclair/typebox'
import { RequestError } from '.'

type PrimitiveType = TBoolean | TInteger | TNumber | TString
export type PType = PrimitiveType | TLiteral | TObject | TArray | TUnion | TAny
type ParamType = boolean | number | string | null | undefined
type OrArray<T> = T | T[]

const unionHas = (union: TUnion, type: string): TSchema | null => {
  let has = null
  for (let u of Object.values(union.anyOf)) {
    if (u[Kind] === type) {
      has = u
      break
    }
  }
  return has
}

const validate = (value: any, type: PType) => {
  const validator = schemaValidator(value, type)
  if (!validator.valid) throw validator.errors
}

const schemaValidator = (value: OrArray<ParamType>, type: PType): { valid: boolean; errors: string | string[] } => {
  let errors = []
  if (type[Kind] === 'Integer' || type[Kind] === 'Number') {
    if (type.exclusiveMinimum !== undefined)
      if ((value as number) <= type.exclusiveMinimum)
        errors.push(`${value} is less or equal to ${type.exclusiveMinimum}`)
    if (type.exclusiveMaximum !== undefined)
      if ((value as number) >= type.exclusiveMaximum)
        errors.push(`${value} is greater or equal to ${type.exclusiveMaximum}`)
    if (type.minimum !== undefined)
      if ((value as number) < type.minimum) errors.push(`${value} is less than ${type.minimum}`)
    if (type.maximum !== undefined)
      if ((value as number) > type.maximum) errors.push(`${value} is greater than ${type.maximum}`)
  } else if (type[Kind] === 'String') {
    if (type.minLength !== undefined && (value as string).length < type.minLength)
      errors.push(`${value} length is too small (${type.minLength} char min)`)
    if (type.maxLength !== undefined && (value as string).length > type.maxLength)
      errors.push(`${value} length is too large (${type.maxLength} char max)`)
    if (type.pattern !== undefined && !(value as string).match(type.pattern))
      errors.push(`${value} does not match pattern ${type.pattern}`)
  } else if (type[Kind] === 'Array') {
    if (type.minItems !== undefined && (value as any[]).length < type.minItems)
      errors.push(`Must contain at least ${type.minItems} item${type.minItems > 1 ? 's' : ''}`)
    if (type.maxItems !== undefined && (value as any[]).length > type.maxItems)
      errors.push(`Must contain at most (${type.maxItems} item${type.maxItems > 1 ? 's' : ''}`)
    if (type.uniqueItems === true && new Set(value as any[]).size !== (value as any[]).length)
      errors.push(`Has duplicate values`)
  }
  return { valid: !errors.length, errors: Array.isArray(errors) && errors.length === 1 ? errors[0] : errors }
}

const paramParser = (value: string | string[] | null, type: PType): OrArray<ParamType> => {
  if (value === null) {
    if (type[Kind] === 'Any') return undefined
    if (type[Optional]) return undefined
    if (type[Kind] === 'Union' && unionHas(type, 'Null')) return null
    else throw `Required`
  } else if (Array.isArray(value)) {
    if (type[Kind] !== 'Array') throw `Multiple values found`
    validate(value, type)
    let pv = []
    for (let v of value) pv.push(paramParser(v, type.items as PType) as ParamType)
    return pv
  } else {
    if (type[Kind] === 'Boolean') {
      if (value === 'true') return true
      if (value === 'false') return false
      else throw `${value} is not a valid boolean. Should be 'true' or 'false'`
    }
    if (type[Kind] === 'Integer') {
      if (value === null || value === undefined) throw `${value} is not a valid integer`
      const parsedValue = parseInt(value, 10)
      if (isNaN(parsedValue) || String(parsedValue) !== String(value)) throw `${value} is not a valid integer`
      validate(value, type)
      return parsedValue
    }
    if (type[Kind] === 'Number') {
      if (value === null || value === undefined) throw `${value} is not a valid number`
      const parsedValue = Number(value)
      if (isNaN(parsedValue) || String(parsedValue) !== String(value)) throw `${value} is not a valid number`
      validate(value, type)
      return parsedValue
    }
    if (type[Kind] === 'String') {
      validate(value, type)
      return value
    }
    if (type[Kind] === 'Literal') {
      if (value !== type.const) throw `${value} is not a valid value`
      return value
    }
    if (type[Kind] === 'Any') return value
    if (type[Kind] === 'Array') {
      const validator = schemaValidator([value], type)
      if (!validator.valid) throw validator.errors
      return paramParser(value, type.items as PrimitiveType)
    }
    if (type[Kind] === 'Union') {
      let t = unionHas(type, 'Boolean')
      if (t) return paramParser(value, t as TBoolean)
      t = unionHas(type, 'Integer')
      if (t) return paramParser(value, t as TInteger)
      t = unionHas(type, 'Number')
      if (t) return paramParser(value, t as TNumber)
      t = unionHas(type, 'Literal')
      if (t) return paramParser(value, t as TLiteral)
    }
    throw `Unknown parsing type ${type[Kind]}`
  }
}

export const parseEntry = <T extends TProperties>(
  params: { [key: string]: string | string[] },
  schema: T,
  options?: { name?: string; i?: boolean }
): Static<TObject<T>> => {
  const parsedParams: Partial<Static<TObject<T>>> = {}
  const errors: { [key: string]: string | string[] } = {}

  if (options?.i === true) {
    params = Object.keys(params).reduce((acc, key) => {
      acc[key.toLowerCase()] = params[key]
      return acc
    }, {} as { [key: string]: string | string[] })
  }

  Object.entries(schema).forEach(([key, s]) => {
    const k = options?.i === true ? key.toLowerCase() : key
    const v = params[k] || null
    try {
      let p = paramParser(v, s as PType)
      //@ts-ignore
      if (p !== undefined) parsedParams[k] = p
    } catch (errMsg) {
      //@ts-ignore
      errors[k] = errMsg
    }
  })

  if (Object.keys(errors).length) {
    throw new RequestError({ status: 400, error: options?.name ? { [options.name]: errors } : errors })
  }

  return parsedParams as Static<TObject<T>>
}

export const validateSchema = <T extends PType>(elt: any, schema: T): boolean => {
  type ValidationError = string | string[] | { [key: string]: ValidationError }
  const errors: ValidationError[] = []

  if (schema[Kind] === 'Boolean') {
    if (elt !== true && elt !== false) throw 'Not a valid boolean'
    validate(elt, schema as TBoolean)
  } else if (schema[Kind] === 'Integer') {
    if (!Number.isInteger(elt)) throw 'Not a valid integer'
    validate(elt, schema as TInteger)
  } else if (schema[Kind] === 'Number') {
    if (Number.isNaN(elt)) throw 'Not a valid number'
    validate(elt, schema as TNumber)
  } else if (schema[Kind] === 'String') {
    if (!(typeof elt === 'string')) throw 'Not a valid string'
    validate(elt, schema as TString)
  } else if (schema[Kind] === 'Object') {
    if (typeof elt !== 'object') throw 'Not a valid object'
    const err: ValidationError = {}
    Object.entries(schema.properties).forEach(([k, s]) => {
      if (!(k in elt)) {
        if (!s[Optional]) err[k] = 'Required'
        return
      }
      try {
        validateSchema(elt[k], s as PType)
      } catch (e) {
        err[k] = e as ValidationError
      }
    })
    if (Object.keys(err).length) errors.push(err)
  } else if (schema[Kind] === 'Array') {
    if (!Array.isArray(elt)) throw 'Not a valid array'
    validate(elt, schema)
    const err: ValidationError = {}
    for (let [idx, v] of elt.entries()) {
      try {
        validateSchema(v, schema.items as PType)
      } catch (e) {
        console.log(e)
        err[idx] = e as ValidationError
      }
    }
    if (Object.keys(err).length) errors.push(err)
  } else {
    throw `Unsupported schema type ${schema[Kind]}`
  }

  if (Object.keys(errors).length === 1) throw errors[0]
  if (Object.keys(errors).length > 1) throw errors

  return true
}

export const validateBody = <T extends PType>(body: any, schema: T): boolean => {
  try {
    return validateSchema(body, schema)
  } catch (err) {
    throw new RequestError({ status: 400, error: { body: err } })
  }
}
