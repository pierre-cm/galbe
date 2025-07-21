import type { MaybeArray, STBody, Context, STResponse } from './index'
import type {
  STStream,
  STUrlForm,
  STMultipartForm,
  Static,
  STProps,
  STObject,
  MultipartFormData,
  STUrlFormValues,
  STMultipartFormValues,
  STLiteral,
  STSchema
} from './schema'

import { readableStreamToArrayBuffer } from 'bun'
import { Kind, Optional, Stream } from './schema'
import { validate } from './validator'
import { InternalError, RequestError } from './index'
import { isIterator } from './util'

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

async function* rsToAsyncIterator(readableStream: ReadableStream) {
  try {
    for await (const chunk of readableStream) yield chunk
  } finally {
    readableStream.cancel()
  }
}

const BA_HEADER = 'application/octet-stream'
const JSON_HEADER = 'application/json'
const TXT_HEADER_RX = /^text\//
const FORM_HEADER_RX = /^application\/x-www-form-urlencoded/
const MP_HEADER_RX = /^multipart\/form-data/

export const requestBodyParser = async (
  body: ReadableStream | null,
  headers: Record<string, string>,
  schema?: STBody
) => {
  const contentType = headers?.['content-type']
  const kind = schema?.[Kind]
  const isStream = schema && Stream in schema
  try {
    if (body === null) {
      if (schema) {
        if (kind === 'byteArray') {
          if (Stream in schema) {
            return new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array())
                controller.close()
              }
            })
          } else return new Uint8Array()
        } else if (schema?.[Optional] || kind === 'null') {
          return null
        } else {
          throw new RequestError({ status: 400, payload: { body: `Not a valid ${kind}` } })
        }
      } else {
        if (contentType === BA_HEADER) {
          return new Uint8Array()
        } else if (contentType === JSON_HEADER) {
          throw new RequestError({ status: 400, payload: { body: 'Not a valid json' } })
        } else if (contentType?.match(TXT_HEADER_RX)) {
          throw new RequestError({ status: 400, payload: { body: 'Not a valid text' } })
        } else if (contentType?.match(FORM_HEADER_RX)) {
          throw new RequestError({ status: 400, payload: { body: 'Not a valid form' } })
        } else if (contentType?.match(MP_HEADER_RX)) {
          throw new RequestError({ status: 400, payload: { body: 'Not a valid multipart form' } })
        } else return null
      }
    } else {
      if (kind === 'null') throw new RequestError({ status: 400, payload: { body: `Expected null body` } })
      else if (kind === 'byteArray') {
        if (isStream) return rsToAsyncIterator(body)
        const bytes = await readableStreamToArrayBuffer(body)
        return new Uint8Array(bytes)
      } else if (kind === 'string' && isStream) {
        return $streamToString(body)
      } else if (
        (!contentType?.match(FORM_HEADER_RX) && kind === 'urlForm') ||
        (!contentType?.match(MP_HEADER_RX) && kind === 'multipartForm')
      ) {
        let received = contentType?.match(FORM_HEADER_RX)
          ? 'urlForm'
          : contentType?.match(MP_HEADER_RX)
            ? 'multipartForm'
            : contentType
        throw new RequestError({ status: 400, payload: { body: `Expected ${kind}, received ${received}` } })
      } else if (!contentType || contentType === BA_HEADER) {
        if (!schema) {
          if (isStream) return rsToAsyncIterator(body)
          const bytes = []
          for await (const b of body) bytes.push(...b)
          return new Uint8Array(bytes)
        } else {
          if (isStream) return rsToAsyncIterator(body)
          else return await streamToString(body, schema)
        }
      } else if (contentType === JSON_HEADER) {
        if (!schema) {
          try {
            return JSON.parse(await streamToString(body))
          } catch (err: any) {
            throw new RequestError({
              status: 400,
              payload: { body: err?.message ?? 'Parsing error' }
            })
          }
        } else {
          const str = await streamToString(body)
          let json
          try {
            json = JSON.parse(str)
          } catch (err: any) {
            throw new RequestError({
              status: 400,
              payload: { body: err?.message ?? 'Parsing error' }
            })
          }
          return validate(json, schema, true)
        }
      } else if (contentType.match(TXT_HEADER_RX)) {
        if (!schema) {
          return await streamToString(body)
        } else {
          return await streamToString(body, schema)
        }
      } else if (contentType.match(FORM_HEADER_RX)) {
        if (!schema) {
          return await streamToUrlForm(body)
        } else {
          if (kind !== 'urlForm')
            throw new RequestError({ status: 400, payload: { body: `Expected ${kind}, received urlForm` } })
          if (isStream) return $streamToUrlForm(body, schema as STStream<STUrlForm>)
          else return await streamToUrlForm(body, schema as STUrlForm)
        }
      } else if (contentType.match(MP_HEADER_RX)) {
        const boundary = contentType.match(/boundary\="?([^"]*)"?;?.*$/)?.[1] || ''
        if (!schema) {
          return await streamToMultipartForm(body, boundary)
        } else {
          if (kind !== 'multipartForm')
            throw new RequestError({ status: 400, payload: { body: `Expected ${kind}, received MultipartForm` } })
          if (isStream) return $streamToMultipartForm(body, boundary, schema as STStream<STMultipartForm>)
          else {
            return streamToMultipartForm(body, boundary, schema as STMultipartForm)
          }
        }
      } else {
        return rsToAsyncIterator(body)
      }
    }
  } catch (error) {
    if (error instanceof RequestError) throw error
    else throw new RequestError({ status: 400, payload: { body: error } })
  }
}
async function* $streamToString(body: ReadableStream) {
  for await (const chunk of body) yield textDecoder.decode(chunk)
}
const streamToString = async (body: ReadableStream, schema?: STBody): Promise<any> => {
  let res = ''
  for await (const chunk of $streamToString(body)) res += chunk
  if (schema) return validate(res, schema, true)
  return res
}
async function* $streamToUrlForm(
  body: ReadableStream<Uint8Array>,
  schema?: STStream<STUrlForm>
): AsyncGenerator<[string, any]> {
  let rest: Uint8Array = new Uint8Array()
  let bK: Uint8Array = new Uint8Array()
  let bV: Uint8Array = new Uint8Array()
  let start = 0
  const required = Object.fromEntries(
    Object.entries(schema?.props || {}).filter(([_, v]: [string, any]) => !v?.[Optional])
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
          let s = schema?.props?.[key]?.[Kind] === 'array' ? schema?.props?.[key].items : schema?.props?.[key]
          val = s ? paramParser(val, s) : val
        } catch (error) {
          throw new RequestError({ status: 400, payload: { body: { [key]: error } } })
        }
        delete required[key]
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
    let s = schema?.props?.[key]?.[Kind] === 'array' ? schema?.props?.[key].items : schema?.props?.[key]
    val = s ? paramParser(val, s) : val
  } catch (error) {
    throw new RequestError({ status: 400, payload: { body: { [key]: error } } })
  }
  delete required[key]
  yield [key, val]
  for (const [k, s] of Object.entries(required)) {
    if (s[Kind] === 'array') {
      yield [k, []]
      delete required[k]
    }
  }
  const reqKeys = Object.keys(required)
  if (reqKeys.length > 0)
    throw new RequestError({
      status: 400,
      payload: { body: `Missing field${reqKeys.length > 1 ? 's' : ''}: ${reqKeys.join(', ')}` }
    })
}
const streamToUrlForm = async (body: ReadableStream<Uint8Array>, schema?: STUrlForm) => {
  let entries = []
  const required = Object.fromEntries(
    Object.entries(schema?.props || {}).filter(([_, v]: [string, any]) => !v?.[Optional])
  )
  let errors: Record<string, any> = {}
  for await (const chunk of $streamToUrlForm(body)) entries.push(chunk)
  const object: Record<string, any> = {}
  for (let e of entries) {
    if (e[0] in object) {
      if (Array.isArray(object[e[0]])) object[e[0]].push(e[1])
      else object[e[0]] = [object[e[0]], e[1]]
    } else object[e[0]] = schema?.props?.[e[0]]?.[Kind] === 'array' ? [e[1]] : e[1]
  }
  if (schema?.props)
    for (let [k, v] of Object.entries(object)) {
      delete required[k]
      try {
        object[k] = schema?.props && k in schema?.props ? paramParser(v, schema?.props[k]) : v
      } catch (error) {
        errors[k] = k in errors ? [...errors[k], error] : error
      }
    }
  if (Object.keys(errors).length) throw new RequestError({ status: 400, payload: { body: errors } })
  for (const [k, s] of Object.entries(required)) {
    if (s[Kind] === 'array') {
      object[k] = []
      delete required[k]
    }
  }
  const reqKeys = Object.keys(required)
  if (reqKeys.length > 0)
    throw new RequestError({
      status: 400,
      payload: { body: `Missing field${reqKeys.length > 1 ? 's' : ''}: ${reqKeys.join(', ')}` }
    })
  return object
}
async function* $streamToMultipartForm(data: ReadableStream<Uint8Array>, boundary: string, schema?: STMultipartForm) {
  const bound = textEncoder.encode(boundary)
  const delimiter = textEncoder.encode('\r\n\r\n')
  let rest = new Uint8Array()
  let bK: Uint8Array = new Uint8Array()
  let bV: Uint8Array = new Uint8Array()
  let start = 0
  const required = Object.fromEntries(
    Object.entries(schema?.props || {}).filter(([_, v]: [string, any]) => !v?.[Optional])
  )
  for await (const chunk of data) {
    start = 0
    for (let i = 0; i < chunk.length; i++) {
      let matchBound = true
      let matchDelimiter = true
      for (let b = 0; b < bound.length; b++) {
        if (chunk[i + b] === bound[b]) continue
        else {
          matchBound = false
          break
        }
      }
      if (!matchBound) {
        for (let b = 0; b < delimiter.length; b++) {
          if (chunk[i + b] === delimiter[b]) continue
          else {
            matchDelimiter = false
            break
          }
        }
      }
      if (matchBound) {
        bV = new Uint8Array(rest.length + i - start)
        bV.set(rest)
        bV.set(chunk.slice(start, i), rest.length)
        bV = bV.slice(1, bV.length - 4)
        const headers = parseMultipartHeader(textDecoder.decode(bK))
        if (headers) {
          try {
            delete required[headers.name]
            yield {
              headers,
              content: parseMultipartContent(bV, headers, schema)
            }
          } catch (err) {
            if (err instanceof RequestError) throw err
            throw new RequestError({ status: 400, payload: { body: { [headers.name]: err } } })
          }
        }
        bK = new Uint8Array()
        bV = new Uint8Array()
        start = i + bound.length
        rest = new Uint8Array()
        i = start
      } else if (matchDelimiter) {
        bK = new Uint8Array(rest.length + i - start)
        bK.set(rest)
        bK.set(chunk.slice(start, i), rest.length)
        start = i + 3
        rest = new Uint8Array()
        i = start
      }
      if (i === chunk.length - 1) {
        const newRest = new Uint8Array(rest.length + i - start + 1)
        newRest.set(rest)
        newRest.set(chunk.slice(start, i + 1), rest.length)
        rest = newRest
      }
    }
  }
  const headers = parseMultipartHeader(textDecoder.decode(bK))
  if (headers) {
    try {
      delete required[headers.name]
      yield {
        headers,
        content: parseMultipartContent(bV, headers, schema)
      }
    } catch (err) {
      throw new RequestError({ status: 400, payload: { body: { [headers.name]: err } } })
    }
  }
  for (const [k, s] of Object.entries(required)) {
    if (s[Kind] === 'array') {
      yield { headers: { name: k }, content: [] }
      delete required[k]
    }
  }
  const reqKeys = Object.keys(required)
  if (reqKeys.length > 0)
    throw new RequestError({
      status: 400,
      payload: { body: `Missing field${reqKeys.length > 1 ? 's' : ''}: ${reqKeys.join(', ')}` }
    })
}
const parseMultipartHeader = (header: string): { name: string;[key: string]: string } | null => {
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
  if (disposition !== 'form-data') return null
  //@ts-ignore
  return multipartHeader
}
const parseMultipartContent = (
  content: Uint8Array,
  headers: { name: string; type?: string },
  schema?: STMultipartForm
) => {
  const type = headers?.type ?? 'text/plain'
  let result: any = content
  if (type === 'text/plain') {
    const str = textDecoder.decode(content).trim()
    let s = schema?.props?.[headers.name]
    return s ? paramParser(str, s?.[Kind] === 'array' ? s?.items : s) : str
  } else if (type === 'application/json') {
    if (!schema?.props || !(headers.name in schema?.props)) {
      try {
        result = JSON.parse(textDecoder.decode(content).trim())
      } catch (err: any) {
        throw new RequestError({ status: 400, payload: { body: { [headers.name]: err?.message || 'Parsing error' } } })
      }
    } else if (schema?.props) {
      if (schema?.props[headers.name][Kind] === 'object') {
        try {
          result = JSON.parse(textDecoder.decode(content).trim())
        } catch (err: any) {
          throw new RequestError({
            status: 400,
            payload: { body: { [headers.name]: err?.message || 'Parsing error' } }
          })
        }
        try {
          validate(result, schema?.props[headers.name])
        } catch (err) {
          throw new RequestError({ status: 400, payload: { body: { [headers.name]: err } } })
        }
      } else if (schema?.props[headers.name][Kind] === 'byteArray') {
        return content
      } else if (schema?.props[headers.name][Kind] === 'string') {
        result = textDecoder.decode(content).trim()
      } else {
        throw new RequestError({
          status: 400,
          payload: { body: { [headers.name]: `Expected ${schema?.props[headers.name][Kind]} found json` } }
        })
      }
    }
  } else if (schema?.props?.[headers.name]) {
    try {
      let s = schema?.props[headers.name]
      validate(result, s?.[Kind] === 'array' ? s?.items : s)
    } catch (err) {
      throw new RequestError({ status: 400, payload: { body: { [headers.name]: err } } })
    }
  }
  return result
}
const streamToMultipartForm = async (data: ReadableStream<Uint8Array>, boundary: string, schema?: STMultipartForm) => {
  const res: Record<string, MultipartFormData> = {}
  const errors: Record<string, any> = {}
  const required = Object.fromEntries(
    Object.entries(schema?.props || {}).filter(([_, v]: [string, any]) => !v?.[Optional])
  )
  for await (const chunk of $streamToMultipartForm(data, boundary)) {
    if (chunk.headers.name in res) {
      if (!Array.isArray(res[chunk.headers.name].content))
        res[chunk.headers.name].content = [res[chunk.headers.name].content]
      res[chunk.headers.name].content.push(chunk.content)
    } else {
      if (schema?.props?.[chunk.headers.name]?.[Kind] === 'array')
        res[chunk.headers.name] = { ...chunk, content: [chunk.content] }
      else res[chunk.headers.name] = chunk
    }
    delete required[chunk.headers.name]

    if (schema?.props && chunk?.headers?.name in schema.props) {
      try {
        if (Array.isArray(res[chunk.headers.name].content) && schema?.props?.[chunk.headers.name]?.[Kind] !== 'array')
          throw `Multiple values found`
        res[chunk.headers.name].content = validate(
          res[chunk.headers.name].content,
          schema?.props[chunk.headers.name],
          true
        )
        if (schema.props[chunk.headers.name][Kind] === 'array')
          for (let [k, v] of Object.entries(res[chunk.headers.name].content)) {
            try {
              //@ts-ignore
              res[chunk.headers.name].content[k] = paramParser(v, schema.props[chunk.headers.name].items)
            } catch (error) {
              errors[chunk.headers.name] = chunk.headers.name in errors ? [...errors[chunk.headers.name], error] : error
            }
          }
      } catch (err) {
        errors[chunk.headers.name] = err
      }
    }
  }
  if (Object.keys(errors).length)
    throw new RequestError({
      status: 400,
      payload: { body: errors }
    })
  for (const [k, s] of Object.entries(required)) {
    if (s[Kind] === 'array') {
      res[k] = { headers: { name: k }, content: [] }
      delete required[k]
    }
  }
  const reqKeys = Object.keys(required)
  if (reqKeys.length > 0)
    throw new RequestError({
      status: 400,
      payload: { body: `Missing field${reqKeys.length > 1 ? 's' : ''}: ${reqKeys.join(', ')}` }
    })
  return res
}
const paramParser = (
  value: string | string[] | null,
  type: STMultipartFormValues
): MaybeArray<Static<STUrlFormValues>> => {
  if (value === undefined) {
    if (type?.[Optional]) return type?.default
    else throw `Required`
  } else if (value === null) return null
  else if (Array.isArray(value)) {
    if (type[Kind] !== 'array') throw `Multiple values found`
    validate(value, type)
    let pv = []
    let errors: Record<number, any> = {}
    for (let [idx, v] of value.entries()) {
      try {
        pv.push(paramParser(v, type.items as STMultipartFormValues) as Static<STUrlFormValues>)
      } catch (error) {
        errors[idx] = error
      }
    }
    if (Object.keys(errors).length) throw errors
    return pv
  } else {
    if (type[Kind] === 'boolean') {
      if (typeof value === 'boolean') return value
      if (value === 'true') return true
      if (value === 'false') return false
      else throw `Not a valid boolean. Should be 'true' or 'false'`
    } else if (type[Kind] === 'integer') {
      if (value === null || value === undefined) throw `Not a valid integer`
      const parsedValue = parseInt(value, 10)
      if (isNaN(parsedValue) || String(parsedValue) !== String(value)) throw `Not a valid integer`
      validate(parsedValue, type)
      return parsedValue
    } else if (type[Kind] === 'number') {
      if (value === null || value === undefined) throw `Not a valid number`
      const parsedValue = Number(value)
      if (isNaN(parsedValue) || String(parsedValue) !== String(value)) throw `Not a valid number`
      validate(parsedValue, type)
      return parsedValue
    } else if (type[Kind] === 'string') {
      validate(value, type)
      return value
    } else if (type[Kind] === 'literal') {
      if (value !== type.value) throw `Not a valid value`
      return value
    } else if (type[Kind] === 'array') {
      return [paramParser(value, type.items as STMultipartFormValues) as Static<STUrlFormValues>]
    } else if (type[Kind] === 'byteArray') {
      return Uint8Array.from(value, c => c.charCodeAt(0))
    } else if (type[Kind] === 'union') {
      const union = Object.values(type.anyOf)
      for (const elt of union) {
        try {
          return paramParser(value, elt as STMultipartFormValues)
        } catch (err) {
          continue
        }
      }
      throw `Could not be parsed to any of [${union
        .map(u => (u as STLiteral)?.value ?? (u as STSchema)[Kind])
        .join(', ')}]`
    } else if (type[Kind] === 'any') {
      return value
    }
    throw `Unknown parsing type ${type[Kind]}`
  }
}

export const requestPathParser = (input: string, path: string) => {
  let pInput = input.split('/')
  let params: Record<string, any> = {}
  let idx = 0
  for (let i = 0; i < path.length; i++) {
    let c = path[i]
    if (c === '/') {
      idx++
      continue
    }
    if (c === ':') {
      let name = ''
      while (true) {
        i++
        c = path[i]
        if (c === '/' || i >= path.length) {
          i--
          break
        }
        name += c
      }
      params[name] = pInput[idx]
    }
  }
  return params
}

export const parseEntry = <T extends STProps>(
  params: { [key: string]: any },
  schema: T,
  options?: { name?: string; i?: boolean }
): Static<STObject<T>> => {
  const parsedParams: Partial<Static<STObject<T>>> = {}
  const errors: { [key: string]: string | string[] } = {}

  if (options?.i === true) {
    params = Object.keys(params).reduce((acc, key) => {
      acc[key.toLowerCase()] = params[key]
      return acc
    }, {} as { [key: string]: string | string[] })
  }

  Object.entries(schema).forEach(([key, s]) => {
    const k = options?.i === true ? key.toLowerCase() : key
    let v = params[k]
    if (s[Kind] === 'array' && options?.name === 'query' && typeof v === 'string') v = v.split(',')
    try {
      let p = paramParser(v, s as STMultipartFormValues)
      //@ts-ignore
      if (p !== undefined) parsedParams[k] = p
    } catch (errMsg) {
      //@ts-ignore
      errors[k] = errMsg
    }
  })

  if (Object.keys(errors).length) {
    throw new RequestError({ status: 400, payload: options?.name ? { [options.name]: errors } : errors })
  }

  return parsedParams as Static<STObject<T>>
}

export const responseParser = (response: any, ctx: Context, schema?: STResponse) => {
  const details = {
    status: ctx.set.status || 200,
    headers: new Headers()
  }
  for (const [key, value] of Object.entries(ctx.set.headers)) {
    if (Array.isArray(value)) {
      value.forEach(v => details.headers.append(key, v))
    } else details.headers.set(key, value)
  }
  if (response instanceof Response) return response
  else if (typeof response === 'string') {
    if (!details?.headers?.has('content-type')) {
      if (schema?.[details.status]?.[Kind] === 'json') {
        details?.headers?.set('content-type', 'application/json')
        response = `"${response}"`
      } else details?.headers?.set('content-type', 'text/plain')
    }
    return new Response(response, details)
  } else if (response instanceof Uint8Array) {
    if (!details?.headers?.has('content-type')) {
      details?.headers?.set('content-type', 'application/octet-stream')
    }
    return new Response(response, details)
  }
  if (response instanceof ReadableStream) {
    response = rsToAsyncIterator(response)
  }
  if (isIterator(response)) {
    const rs = new ReadableStream({
      type: 'direct',
      async pull(controller) {
        let id = ctx.request.headers.get('last-event-id') ?? crypto.randomUUID()
        for await (const r of response) {
          let data = `id:${id}\ndata:${r}\n\n`
          try {
            await controller.write(data)
            await controller.flush()
          } catch (err) {
            console.error(err)
          }
          id = crypto.randomUUID()
        }
        controller.close()
      }
    })
    details.headers.set('Content-Type', 'text/event-stream')
    return new Response(rs, details)
  } else {
    try {
      if (!details?.headers?.has('content-type')) details?.headers?.set('content-type', 'application/json')
      if (details.headers.get('content-type') === 'application/json') response = JSON.stringify(response)
      return new Response(response, details)
    } catch (error) {
      console.error(error)
      throw new InternalError()
    }
  }
}
