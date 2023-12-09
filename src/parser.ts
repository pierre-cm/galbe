import {
  Kind,
  Optional,
  Static,
  TBoolean,
  TInteger,
  TLiteral,
  TNumber,
  TObject,
  TProperties,
  TSchema,
  TUnion
} from '@sinclair/typebox'
import {
  MultipartFormData,
  MaybeArray,
  RequestError,
  TBody,
  TMultipartForm,
  TUrlForm,
  Stream,
  TUrlFormParam,
  TMultipartFormParam,
  TStream
} from 'index'
import { validate } from 'validator'

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

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

const CONTENT_SCHEMA_COMPATIBILITY = {
  text: ['String', 'Boolean', 'Number', 'Object', 'Array'],
  json: ['String', 'Boolean', 'Number', 'Object', 'Array'],
  urlForm: ['UrlForm'],
  multipartForm: ['MultipartForm']
}

export const requestBodyParser = async (
  body: ReadableStream | null,
  headers: { 'content-type'?: string; 'content-length'?: string },
  schema?: TBody
) => {
  const { 'content-type': contentType, 'content-length': _contentLength } = headers
  const isStream = schema && Stream in schema
  try {
    if (body === null) return undefined
    if (contentType?.match(/^text\//)) {
      if (schema && !CONTENT_SCHEMA_COMPATIBILITY['text'].includes(schema[Kind]))
        throw new RequestError({ status: 400, error: { body: `Expected ${schema[Kind]}` } })
      return isStream ? $streamToString(body) : await streamToString(body, schema)
    } else if (contentType?.match(/^application\/json/)) {
      if (schema && !CONTENT_SCHEMA_COMPATIBILITY['json'].includes(schema[Kind]))
        throw new RequestError({ status: 400, error: { body: `Expected ${schema[Kind]}` } })
      return await streamToString(body, schema)
    } else if (contentType?.match(/^application\/x-www-form-urlencoded/)) {
      if (schema && !CONTENT_SCHEMA_COMPATIBILITY['urlForm'].includes(schema[Kind]))
        throw new RequestError({ status: 400, error: { body: `Expected ${schema[Kind]}` } })
      return isStream ? $streamToUrlForm(body, schema as TStream<TUrlForm>) : streamToUrlForm(body, schema as TUrlForm)
    } else if (contentType?.match(/^multipart\/form-data/)) {
      if (schema && !CONTENT_SCHEMA_COMPATIBILITY['multipartForm'].includes(schema[Kind]))
        throw new RequestError({ status: 400, error: { body: `Expected ${schema[Kind]}` } })
      const boundary = contentType.match(/boundary\=(.*);?.*$/)?.[1] || ''
      return isStream
        ? $streamToMultipartForm(body, boundary, schema as TStream<TMultipartForm>)
        : streamToMultipartForm(body, boundary, schema as TMultipartForm)
    } else return body
  } catch (error) {
    if (error instanceof RequestError) throw error
    else throw new RequestError({ status: 400, error: { body: error } })
  }
}
async function* $streamToString(body: ReadableStream) {
  for await (const chunk of body) yield textDecoder.decode(chunk)
}
const streamToString = async (body: ReadableStream, schema?: TBody) => {
  let res = ''
  for await (const chunk of $streamToString(body)) res += chunk
  if (schema) return validate(res, schema, true)
  return res
}
async function* $streamToUrlForm(
  body: ReadableStream<Uint8Array>,
  schema?: TStream<TUrlForm>
): AsyncGenerator<[string, any]> {
  let rest: Uint8Array = new Uint8Array()
  let bK: Uint8Array = new Uint8Array()
  let bV: Uint8Array = new Uint8Array()
  let start = 0
  const required = new Set(
    Object.entries(schema?.properties || {})
      .filter(([_, v]: [string, any]) => !(Optional in v))
      .map(([k, _]) => k)
  )
  for await (const chunk of body) {
    start = 0
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === 0x26) {
        bV = new Uint8Array(rest.length + i - start)
        bV.set(rest)
        bV.set(chunk.slice(start, i), rest.length)
        let [key, val]: [string, any] = [
          decodeURIComponent(textDecoder.decode(bK)),
          decodeURIComponent(textDecoder.decode(bV))
        ]
        try {
          val = schema?.properties && key in schema?.properties ? paramParser(val, schema?.properties[key]) : val
        } catch (error) {
          throw new RequestError({ status: 400, error: { body: { [key]: error } } })
        }
        required.delete(key)
        yield [key, val]
        bK = new Uint8Array()
        bV = new Uint8Array()
        start = i + 1
        rest = new Uint8Array()
      } else if (chunk[i] === 0x3d) {
        bK = new Uint8Array(rest.length + i - start)
        bK.set(rest)
        bK.set(chunk.slice(start, i), rest.length)
        start = i + 1
        rest = new Uint8Array()
      }
      if (i === chunk.length - 1) {
        const newRest = new Uint8Array(rest.length + i + 1 - start)
        newRest.set(rest)
        newRest.set(chunk.slice(start, i + 1), rest.length)
        rest = newRest
      }
    }
  }
  let [key, val]: [string, any] = [
    decodeURIComponent(textDecoder.decode(bK)),
    decodeURIComponent(textDecoder.decode(rest))
  ]
  try {
    val = schema?.properties && key in schema?.properties ? paramParser(val, schema?.properties[key]) : val
  } catch (error) {
    throw new RequestError({ status: 400, error: { body: { [key]: error } } })
  }
  required.delete(key)
  yield [key, val]
  if (required.size > 0)
    throw new RequestError({
      status: 400,
      error: { body: `Missing field${required.size > 1 ? 's' : ''} ${[...required]}` }
    })
}
const streamToUrlForm = async (body: ReadableStream<Uint8Array>, schema?: TUrlForm) => {
  let entries = []
  const required = new Set(
    Object.entries(schema?.properties || {})
      .filter(([_, v]: [string, any]) => !(Optional in v))
      .map(([k, _]) => k)
  )
  let errors: Record<string, any> = {}
  for await (const chunk of $streamToUrlForm(body)) entries.push(chunk)
  const object: Record<string, any> = {}
  for (let e of entries) {
    if (e[0] in object) {
      if (Array.isArray(object[e[0]])) object[e[0]].push(e[1])
      else object[e[0]] = [object[e[0]], e[1]]
    } else object[e[0]] = e[1]
  }
  if (schema?.properties)
    for (let [k, v] of Object.entries(object)) {
      required.delete(k)
      try {
        object[k] = schema?.properties && k in schema?.properties ? paramParser(v, schema?.properties[k]) : v
      } catch (error) {
        errors[k] = k in errors ? [...errors[k], error] : error
      }
    }
  if (Object.keys(errors).length) throw new RequestError({ status: 400, error: { body: errors } })
  if (required.size > 0)
    throw new RequestError({
      status: 400,
      error: { body: `Missing field${required.size > 1 ? 's' : ''} ${[...required]}` }
    })
  return object
}
async function* $streamToMultipartForm(data: ReadableStream<Uint8Array>, boundary: string, schema?: TMultipartForm) {
  const bound = textEncoder.encode(boundary)
  let rest = new Uint8Array()
  let bK: Uint8Array = new Uint8Array()
  let bV: Uint8Array = new Uint8Array()
  let start = 0
  const required = new Set(
    Object.entries(schema?.properties || {})
      .filter(([_, v]: [string, any]) => !(Optional in v))
      .map(([k, _]) => k)
  )
  for await (const chunk of data) {
    start = 0
    for (let i = 0; i < chunk.length; i++) {
      let matchBound = true
      for (let b = 0; b < bound.length; b++) {
        if (chunk[i + b] === bound[b]) continue
        else {
          matchBound = false
          break
        }
      }
      if (matchBound) {
        bV = new Uint8Array(rest.length + i - start)
        bV.set(rest)
        bV.set(chunk.slice(start, i), rest.length)
        const headers = parseMultipartHeader(textDecoder.decode(bK))
        if (headers)
          try {
            required.delete(headers.name)
            yield {
              headers,
              content: parseMultipartContent(bV, headers, schema)
            }
          } catch (err) {
            if (err instanceof RequestError) throw err
            throw new RequestError({ status: 400, error: { body: { [headers.name]: err } } })
          }
        bK = new Uint8Array()
        bV = new Uint8Array()
        start = i + bound.length
        rest = new Uint8Array()
        i = start
      } else if (chunk[i] === 0x0d && chunk[i + 1] === 0x0a && chunk[i + 2] === 0x0d) {
        bK = new Uint8Array(rest.length + i - start)
        bK.set(rest)
        bK.set(chunk.slice(start, i), rest.length)
        start = i + 3
        rest = new Uint8Array()
        i = start
      }
      if (i === chunk.length - 1) {
        const newRest = new Uint8Array(rest.length + i + 1 - start)
        newRest.set(rest)
        newRest.set(chunk.slice(start, i + 1), rest.length)
        rest = newRest
      }
    }
  }
  const headers = parseMultipartHeader(textDecoder.decode(bK))
  if (headers)
    try {
      required.delete(headers.name)
      yield {
        headers,
        content: parseMultipartContent(bV, headers, schema)
      }
    } catch (err) {
      throw new RequestError({ status: 400, error: { body: { [headers.name]: err } } })
    }
  if (required.size > 0)
    throw new RequestError({
      status: 400,
      error: { body: `Missing field${required.size > 1 ? 's' : ''} ${[...required]}` }
    })
}
const parseMultipartHeader = (header: string): { name: string; [key: string]: string } | null => {
  if (!header) return null
  let disposition = 'form-data'
  const multipartHeader = [
    ...header.matchAll(/\s*([\w-]+)\s*:\s*([^;]*);?/g),
    ...header.matchAll(/;?\s*(\w+)\s*=\s*\"([^"]*)\";?/g)
  ].reduce((acc: Record<string, string>, v: string[]) => {
    const key = v[1].toLowerCase().replace(/^content-/, '')
    if (key === 'disposition') {
      disposition = v[2]
      return acc
    }
    acc[key] = v[2]
    return acc
  }, {})
  if (disposition !== 'form-data') null
  //@ts-ignore
  return multipartHeader
}
const parseMultipartContent = (
  content: Uint8Array,
  headers: { name: string; type?: string },
  schema?: TMultipartForm
) => {
  const type = headers?.type ?? 'text/plain'
  let result: any = content
  content = content.slice(1, content.length - 4)
  if (type === 'text/plain') {
    const str = textDecoder.decode(content).trim()
    return schema?.properties && headers.name in schema?.properties
      ? paramParser(str, schema?.properties[headers.name])
      : str
  } else if (type === 'application/json') {
    if (!schema?.properties || !(headers.name in schema?.properties))
      try {
        result = JSON.parse(textDecoder.decode(content).trim())
      } catch (err: any) {
        throw new RequestError({ status: 400, error: { body: { [headers.name]: err?.message || 'Parsing error' } } })
      }
    else if (schema?.properties) {
      if (schema?.properties[headers.name][Kind] === 'Object') {
        try {
          result = JSON.parse(textDecoder.decode(content).trim())
        } catch (err: any) {
          throw new RequestError({ status: 400, error: { body: { [headers.name]: err?.message || 'Parsing error' } } })
        }
        try {
          validate(result, schema?.properties[headers.name])
        } catch (err) {
          throw new RequestError({ status: 400, error: { body: { [headers.name]: err } } })
        }
      } else if (schema?.properties[headers.name][Kind] === 'ByteArray') {
        return content
      } else if (schema?.properties[headers.name][Kind] === 'String') {
        result = textDecoder.decode(content).trim()
      } else {
        throw new RequestError({
          status: 400,
          error: { body: { [headers.name]: `Expect ${schema?.properties[headers.name][Kind]} found json` } }
        })
      }
    }
  } else if (schema?.properties?.[headers.name]) {
    try {
      validate(result, schema?.properties[headers.name])
    } catch (err) {
      throw new RequestError({ status: 400, error: { body: { [headers.name]: err } } })
    }
  }
  return result
}
const streamToMultipartForm = async (data: ReadableStream<Uint8Array>, boundary: string, schema?: TMultipartForm) => {
  const res: Record<string, MultipartFormData> = {}
  const errors: Record<string, any> = {}
  const required = new Set(
    Object.entries(schema?.properties || {})
      .filter(([_, v]: [string, any]) => !(Optional in v))
      .map(([k, _]) => k)
  )
  for await (const chunk of $streamToMultipartForm(data, boundary)) {
    res[chunk.headers.name] = chunk
    required.delete(chunk.headers.name)
    if (schema?.properties && chunk.headers.name in schema?.properties) {
      try {
        validate(chunk.content, schema?.properties[chunk.headers.name], true)
      } catch (err) {
        errors[chunk.headers.name] = err
      }
    }
  }
  if (Object.keys(errors).length)
    throw new RequestError({
      status: 400,
      error: { body: errors }
    })
  if (required.size > 0)
    throw new RequestError({
      status: 400,
      error: { body: `Missing field${required.size > 1 ? 's' : ''} ${[...required]}` }
    })
  return res
}
const paramParser = (value: string | string[] | null, type: TMultipartFormParam): MaybeArray<Static<TUrlFormParam>> => {
  if (value === null) {
    if (type[Kind] === 'Any') return undefined
    if (type[Optional]) return undefined
    if (type[Kind] === 'Union' && unionHas(type, 'Null')) return null
    else throw `Required`
  } else if (Array.isArray(value)) {
    if (type[Kind] !== 'Array') throw `Multiple values found`
    validate(value, type)
    let pv = []
    let errors: Record<number, any> = {}
    for (let [idx, v] of value.entries()) {
      try {
        pv.push(paramParser(v, type.items as TMultipartFormParam) as Static<TUrlFormParam>)
      } catch (error) {
        errors[idx] = error
      }
    }
    if (Object.keys(errors).length) throw errors
    return pv
  } else {
    if (type[Kind] === 'Boolean') {
      if (value === 'true') return true
      if (value === 'false') return false
      else throw `${value} is not a valid boolean. Should be 'true' or 'false'`
    } else if (type[Kind] === 'Integer') {
      if (value === null || value === undefined) throw `${value} is not a valid integer`
      const parsedValue = parseInt(value, 10)
      if (isNaN(parsedValue) || String(parsedValue) !== String(value)) throw `${value} is not a valid integer`
      validate(parsedValue, type)
      return parsedValue
    } else if (type[Kind] === 'Number') {
      if (value === null || value === undefined) throw `${value} is not a valid number`
      const parsedValue = Number(value)
      if (isNaN(parsedValue) || String(parsedValue) !== String(value)) throw `${value} is not a valid number`
      validate(parsedValue, type)
      return parsedValue
    } else if (type[Kind] === 'String') {
      validate(value, type)
      return value
    } else if (type[Kind] === 'Literal') {
      if (value !== type.const) throw `${value} is not a valid value`
      return value
    } else if (type[Kind] === 'Any') return value
    else if (type[Kind] === 'Array') {
      return [paramParser(value, type.items as TMultipartFormParam) as Static<TUrlFormParam>]
    } else if (type[Kind] === 'ByteArray') {
      return textEncoder.encode(value)
    } else if (type[Kind] === 'Union') {
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

export const requestPathParser = (input: string, path: string) => {
  let pPath = path.replace(/^\/$(.*)\/?$/, '$1').split('/')
  let pInput = input.replace(/^\/$(.*)\/?$/, '$1').split('/')
  let params: Record<string, any> = {}
  pPath.shift()
  pInput.shift()
  for (const [i, p] of pPath.entries()) {
    const match = p.match(/^:(.*)/)
    if (match) params[match[1]] = pInput[i]
  }
  return params
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
      let p = paramParser(v, s as TMultipartFormParam)
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

export const responseParser = (response: any) => {
  if (typeof response !== 'string') {
    try {
      return { response: JSON.stringify(response), type: 'application/json' }
    } catch (error) {
      console.error(error)
      throw new RequestError({ status: 500, error: 'Internal Server Error' })
    }
  }
  return { response, type: 'text/plain' }
}
