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
  Static,
  Kind,
  Optional
} from '@sinclair/typebox'
import { RequestError } from '.'

type PrimitiveType = TBoolean | TInteger | TNumber | TString
type Type = PrimitiveType | TLiteral | TArray | TUnion | TAny
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

const schemaValidator = (value: OrArray<ParamType>, type: Type): { valid: boolean; errors: string | string[] } => {
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
      errors.push(`length is too small (${type.minItems} items min)`)
    if (type.maxItems !== undefined && (value as any[]).length > type.maxItems)
      errors.push(`length is too large (${type.maxItems} items max)`)
    if (type.uniqueItems === true && new Set(value as any[]).size !== (value as any[]).length)
      errors.push(`has duplicate values`)
  }
  return { valid: !errors.length, errors: Array.isArray(errors) && errors.length === 1 ? errors[0] : errors }
}

const typeParser = (value: string | string[] | null, type: Type): OrArray<ParamType> => {
  if (value === null) {
    if (type[Kind] === 'Any') return undefined
    if (type[Optional]) return undefined
    if (type[Kind] === 'Union' && unionHas(type, 'Null')) return null
    else throw `Required`
  } else if (Array.isArray(value)) {
    if (type[Kind] !== 'Array') throw `Multiple values found`
    const validator = schemaValidator(value, type)
    if (!validator.valid) throw validator.errors
    let pv = []
    for (let v of value) pv.push(typeParser(v, type.items as Type) as ParamType)
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
      const validator = schemaValidator(value, type)
      if (!validator.valid) throw validator.errors
      return parsedValue
    }
    if (type[Kind] === 'Number') {
      if (value === null || value === undefined) throw `${value} is not a valid number`
      const parsedValue = Number(value)
      if (isNaN(parsedValue) || String(parsedValue) !== String(value)) throw `${value} is not a valid number`
      const validator = schemaValidator(value, type)
      if (!validator.valid) throw validator.errors
      return parsedValue
    }
    if (type[Kind] === 'String') return value
    if (type[Kind] === 'Literal') {
      if (value !== type.const) throw `${value} is not a valid value`
      return value
    }
    if (type[Kind] === 'Any') return value
    if (type[Kind] === 'Array') {
      const validator = schemaValidator([value], type)
      if (!validator.valid) throw validator.errors
      return typeParser(value, type.items as PrimitiveType)
    }
    if (type[Kind] === 'Union') {
      let t = unionHas(type, 'Boolean')
      if (t) return typeParser(value, t as TBoolean)
      t = unionHas(type, 'Integer')
      if (t) return typeParser(value, t as TInteger)
      t = unionHas(type, 'Number')
      if (t) return typeParser(value, t as TNumber)
      t = unionHas(type, 'Literal')
      if (t) return typeParser(value, t as TLiteral)
    }
    throw `Unknown parsing type ${type[Kind]}`
  }
}

export const parseQueryParams = <T extends TProperties>(
  params: { [key: string]: string | string[] },
  schema: T
): Static<TObject<T>> => {
  const parsedParams: Partial<Static<TObject<T>>> = {}
  const errors: { [key: string]: string | string[] } = {}

  Object.entries(schema).forEach(([k, s]) => {
    const v = params[k] || null
    try {
      let p = typeParser(v, s as Type)
      //@ts-ignore
      if (p !== undefined) parsedParams[k] = p
    } catch (errMsg) {
      //@ts-ignore
      errors[k] = errMsg
    }
  })

  if (Object.keys(errors).length) {
    throw new RequestError({ status: 400, error: { query: errors } })
  }

  console.log(parsedParams)

  return parsedParams as Static<TObject<T>>
}
