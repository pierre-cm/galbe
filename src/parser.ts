import type { MaybeArray, STBody, Context, STResponse, STBodyContent, STBodyValue } from './index'
import type {
  STStream,
  STMultipartForm,
  Static,
  STProps,
  STObject,
  MultipartFormData,
  STMultipartFormValues,
  STLiteral,
  STSchema,
  STNull,
  STPropsValue,
  STUnion,
  STIntersection,
  STArray,
} from './schema'

import { Kind, Optional, Stream } from './schema'
import { runCompiled } from './validator.compile'
import { InternalServerError, PayloadTooLargeError, RequestError } from './index'
import { isIterator, inferBodyType, responseEntryFor, type ParseMode } from './util'

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

// own-property schema lookup: field names come from the request and would
// otherwise hit Object.prototype members (constructor, toString, …)
const getProp = <T extends Record<string, any>>(props: T | undefined, key: string): T[string] | undefined =>
  props && Object.hasOwn(props, key) ? props[key] : undefined

// application/x-www-form-urlencoded encodes spaces as `+`, which
// decodeURIComponent leaves untouched — translate first (a literal plus
// arrives percent-encoded as %2B)
const decodeFormComponent = (raw: string) => decodeURIComponent(raw.replace(/\+/g, ' '))

async function* rsToAsyncIterator(readableStream: ReadableStream) {
  try {
    for await (const chunk of readableStream) yield chunk
  } finally {
    readableStream.cancel()
  }
}

// req.bytes() is untyped and returns ArrayBuffer or Uint8Array depending on
// body chunking (Bun 1.3) — normalize through arrayBuffer. With a limit,
// accumulate manually so chunked clients lying about their size (no or forged
// content-length) are cut off as soon as they cross it.
const reqBytes = async (req: Request, limit?: number) => {
  if (limit === undefined) return new Uint8Array(await req.arrayBuffer())
  const body = req.body
  if (body === null) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of body) {
    total += chunk.length
    if (total > limit) throw new PayloadTooLargeError()
    chunks.push(chunk)
  }
  const res = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    res.set(chunk, offset)
    offset += chunk.length
  }
  return res
}
const reqText = async (req: Request, limit?: number) =>
  limit === undefined ? req.text() : textDecoder.decode(await reqBytes(req, limit))
const reqJson = async (req: Request, limit?: number) =>
  limit === undefined ? req.json() : JSON.parse(await reqText(req, limit))

// Multipart boundary extraction from the content-type header: parameters are
// `;`-separated and extra legal parameters (charset, …) must not leak into
// the boundary value.
const multipartBoundary = (contentType: string | null): string => {
  for (const param of contentType?.split(';') ?? []) {
    const eq = param.indexOf('=')
    if (eq === -1 || param.slice(0, eq).trim().toLowerCase() !== 'boundary') continue
    let value = param.slice(eq + 1).trim()
    if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    if (value) return value
  }
  throw new RequestError({ status: 400, payload: { body: `Missing multipart boundary` } })
}

// `contentType` is the normalized media type (no parameters); the raw header is
// read from the request only where its parameters matter (multipart boundary),
// so body parsing never needs the materialized header map
export const requestBodyParser = async (
  req: Request,
  schemas?: STBody | STNull,
  contentType?: string,
  limit?: number
) => {
  const body = req.body
  const normalizedCT = contentType?.split(';')[0]?.trim()
  let parseMode: ParseMode = inferBodyType(contentType)
  let schema: STBodyValue | STNull | undefined =
    (schemas as STNull)?.[Kind] === 'null'
      ? (schemas as STNull)
      : normalizedCT
        ? ((schemas as STBodyContent)?.[normalizedCT as `${string}/${string}`] ?? (schemas as STBodyContent)?.['*/*'])
        : (schemas as STBodyContent)?.['*/*']
  let kind = schema?.[Kind]
  let isStream = schema && Stream in schema
  try {
    if (kind === 'null') {
      if (body === null) return null
      throw new RequestError({ status: 400, payload: { body: `Expected null body` } })
    }
    if (!schemas || !Object.keys(schemas).length) {
      // No schema defined, we base parsing on parseMode only
      if (parseMode === 'byteArray') {
        if (body === null) return new Uint8Array()
        return await reqBytes(req, limit)
      } else if (parseMode === 'json') {
        if (body === null) return null
        try {
          return await reqJson(req, limit)
        } catch (err: any) {
          if (err instanceof RequestError) throw err
          throw new RequestError({
            status: 400,
            payload: { body: 'Not a valid JSON body' },
          })
        }
      } else if (parseMode === 'text') {
        if (body === null) return ''
        return await reqText(req, limit)
      } else if (parseMode === 'urlForm') {
        if (body === null) return {}
        return parseUrlForm(await reqText(req, limit))
      } else if (parseMode === 'multipart') {
        if (body === null) return {}
        const boundary = multipartBoundary(req.headers.get('content-type'))
        return await streamToMultipartForm(oneChunkStream(await reqBytes(req, limit)), boundary)
      } else return body === null ? null : rsToAsyncIterator(body)
    } else {
      // Schemas found
      if (parseMode === 'default' && (schema || Object.values(schemas).every(s => s?.[Optional]))) {
        if (kind === 'byteArray') parseMode = 'byteArray'
        else if (kind === 'string') parseMode = 'text'
        else return body === null ? null : rsToAsyncIterator(body)
      }
      if (parseMode === 'byteArray') {
        if (kind !== 'byteArray') throw new RequestError({ status: 400, payload: { body: `Not a valid body` } })
        if (body === null) {
          return isStream
            ? new ReadableStream({
                start(controller) {
                  controller.enqueue(new Uint8Array())
                  controller.close()
                },
              })
            : new Uint8Array()
        }
        if (isStream) return rsToAsyncIterator(body)
        return await reqBytes(req, limit)
      } else if (parseMode === 'text') {
        if (!kind || !['string', 'boolean', 'number', 'integer', 'anyOf', 'oneOf', 'literal'].includes(kind))
          throw new RequestError({ status: 400, payload: { body: `Not a valid body` } })
        if (body === null)
          return isStream
            ? new ReadableStream({
                start(controller) {
                  controller.enqueue('')
                  controller.close()
                },
              })
            : runCompiled('', schema as STSchema, { parse: true })
        if (isStream) return $streamToString(body)
        const str = await reqText(req, limit)
        if (kind === 'anyOf' || kind === 'oneOf') return unionize(str, schema as STUnion)
        return runCompiled(str, schema as STSchema, { parse: true })
      } else if (parseMode === 'json') {
        if (
          !kind ||
          ![
            'object',
            'json',
            'boolean',
            'number',
            'integer',
            'string',
            'array',
            'anyOf',
            'oneOf',
            'intersection',
          ].includes(kind)
        )
          throw new RequestError({ status: 400, payload: { body: `Not a valid body` } })
        // an absent body parses as `null`, matching JSON.parse('null')
        if (kind === 'anyOf' || kind === 'oneOf')
          return unionize(body === null ? null : await reqJson(req, limit), schema as STUnion)
        if (kind === 'intersection')
          return intersectionize(body === null ? null : await reqJson(req, limit), schema as STIntersection<any>)
        let json
        try {
          json = body === null ? null : await reqJson(req, limit)
        } catch (err: any) {
          if (err instanceof RequestError) throw err
          throw new RequestError({
            status: 400,
            payload: { body: 'Not a valid JSON body' },
          })
        }
        return runCompiled(json, schema as STSchema, { parse: true })
      } else if (parseMode === 'urlForm') {
        if (!kind || !['object', 'anyOf', 'oneOf'].includes(kind))
          throw new RequestError({ status: 400, payload: { body: `Not a valid body` } })
        if (body === null)
          return isStream
            ? new ReadableStream({
                start(controller) {
                  controller.enqueue([])
                  controller.close()
                },
              })
            : parseUrlForm('', schema as STObject)
        if (kind === 'anyOf' || kind === 'oneOf')
          return unionize(parseUrlForm(await reqText(req, limit)), schema as STUnion)
        if (isStream) return $streamToUrlForm(body, schema as STStream<STObject>)
        else return parseUrlForm(await reqText(req, limit), schema as STObject)
      } else if (parseMode === 'multipart') {
        if (kind !== 'multipartForm' && kind !== 'anyOf' && kind !== 'oneOf')
          throw new RequestError({ status: 400, payload: { body: `Not a valid body` } })
        if (body === null)
          return isStream
            ? new ReadableStream({
                start(controller) {
                  controller.enqueue({ headers: {} })
                  controller.close()
                },
              })
            : {}
        const boundary = multipartBoundary(req.headers.get('content-type'))
        if (kind === 'anyOf' || kind === 'oneOf') {
          let mp = await streamToMultipartForm(oneChunkStream(await reqBytes(req, limit)), boundary, undefined, limit)
          return unionize(mp, schema as STUnion)
        }
        if (isStream) return $streamToMultipartForm(body, boundary, schema as STStream<STMultipartForm>, limit)
        return streamToMultipartForm(
          oneChunkStream(await reqBytes(req, limit)),
          boundary,
          schema as STMultipartForm,
          limit
        )
      } else if (parseMode === 'default') {
        throw new RequestError({ status: 400, payload: { body: `Not a valid content-type` } })
      }
    }
  } catch (error) {
    if (error instanceof RequestError) throw error
    else throw new RequestError({ status: 400, payload: { body: error } })
  }
}
async function* $streamToString(body: ReadableStream) {
  // per-call decoder: streaming decode is stateful (multibyte code points can
  // straddle chunks), so the shared module-level decoder must not be used here
  const decoder = new TextDecoder()
  for await (const chunk of body) yield decoder.decode(chunk, { stream: true })
  const tail = decoder.decode()
  if (tail) yield tail
}
async function* $streamToUrlForm(
  body: ReadableStream<Uint8Array>,
  schema?: STStream<STObject>
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
          decodeFormComponent(textDecoder.decode(bK)),
          decodeFormComponent(textDecoder.decode(bV)),
        ]
        try {
          const propSchema = getProp(schema?.props, key)
          let s = propSchema?.[Kind] === 'array' ? (propSchema as STArray).items : propSchema
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
    decodeFormComponent(textDecoder.decode(bK)),
    decodeFormComponent(textDecoder.decode(rest)),
  ]
  try {
    const propSchema = getProp(schema?.props, key)
    let s = propSchema?.[Kind] === 'array' ? (propSchema as STArray).items : propSchema
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
      payload: { body: `Missing field${reqKeys.length > 1 ? 's' : ''}: ${reqKeys.join(', ')}` },
    })
}
// Buffered counterpart of $streamToUrlForm with the same pair semantics:
// segments split on `&`, key/value on the first `=`; bare tokens yield an
// empty key and are filtered out below.
const parseUrlForm = (text: string, schema?: STObject) => {
  const entries: [string, any][] = text.split('&').map(seg => {
    const eq = seg.indexOf('=')
    return eq === -1
      ? ['', decodeFormComponent(seg)]
      : [decodeFormComponent(seg.slice(0, eq)), decodeFormComponent(seg.slice(eq + 1))]
  })
  const required = Object.fromEntries(
    Object.entries(schema?.props || {}).filter(([_, v]: [string, any]) => !v?.[Optional])
  )
  let errors: Record<string, any> = Object.create(null)
  const object: Record<string, any> = Object.create(null)
  for (let e of entries.filter(([k]) => k)) {
    if (e[0] in object) {
      if (Array.isArray(object[e[0]])) object[e[0]].push(e[1])
      else object[e[0]] = [object[e[0]], e[1]]
    } else object[e[0]] = getProp(schema?.props, e[0])?.[Kind] === 'array' ? [e[1]] : e[1]
  }
  if (schema?.props)
    for (let [k, v] of Object.entries(object)) {
      delete required[k]
      try {
        const propSchema = getProp(schema.props, k)
        object[k] = propSchema ? paramParser(v, propSchema) : v
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
      payload: { body: `Missing field${reqKeys.length > 1 ? 's' : ''}: ${reqKeys.join(', ')}` },
    })
  return object
}
// First index >= `from` where `needle` fully occurs in `hay`, -1 if none. The
// native indexOf skips to candidate positions (the needle's first byte) so only
// candidates are compared byte by byte, instead of every offset of the scan.
const indexOfSeq = (hay: Uint8Array, needle: Uint8Array, from: number) => {
  if (!needle.length) return -1
  const last = hay.length - needle.length
  for (let i = hay.indexOf(needle[0]!, from); i !== -1 && i <= last; i = hay.indexOf(needle[0]!, i + 1)) {
    let b = 1
    while (b < needle.length && hay[i + b] === needle[b]) b++
    if (b === needle.length) return i
  }
  return -1
}

async function* $streamToMultipartForm(
  data: ReadableStream<Uint8Array>,
  boundary: string,
  schema?: STMultipartForm,
  limit?: number
) {
  const bound = textEncoder.encode(boundary)
  const delimiter = textEncoder.encode('\r\n\r\n')
  // A match straddling two chunks is undetectable within a single chunk: carry
  // the tail of the unprocessed bytes into each chunk's scan window so the
  // lookahead never stops at the chunk seam.
  const lookahead = Math.max(bound.length, delimiter.length) - 1
  let rest = new Uint8Array()
  let bK: Uint8Array = new Uint8Array()
  let bV: Uint8Array = new Uint8Array()
  let start = 0
  const required = Object.fromEntries(
    Object.entries(schema?.props || {}).filter(([_, v]: [string, any]) => !v?.[Optional])
  )
  for await (const chunk of data) {
    const carry = rest.subarray(Math.max(0, rest.length - lookahead))
    const scan = new Uint8Array(carry.length + chunk.length)
    scan.set(carry)
    scan.set(chunk, carry.length)
    rest = rest.slice(0, rest.length - carry.length)
    start = 0
    // jump from match to match: whichever of boundary/delimiter comes first
    // (boundary wins a tie, as in the byte-wise scan this replaces)
    for (let p = 0; p < scan.length;) {
      const iB = indexOfSeq(scan, bound, p)
      const iD = indexOfSeq(scan, delimiter, p)
      if (iB === -1 && iD === -1) break
      const isBound = iB !== -1 && (iD === -1 || iB <= iD)
      const i = isBound ? iB : iD
      if (isBound) {
        bV = new Uint8Array(rest.length + i - start)
        bV.set(rest)
        bV.set(scan.slice(start, i), rest.length)
        if (limit !== undefined && bV.length > limit) throw new PayloadTooLargeError()
        bV = bV.slice(1, bV.length - 4)
        const headers = parseMultipartHeader(textDecoder.decode(bK))
        if (headers) {
          try {
            delete required[headers.name]
            yield {
              headers,
              content: parseMultipartContent(bV, headers, schema),
            }
          } catch (err) {
            if (err instanceof RequestError) throw err
            throw new RequestError({ status: 400, payload: { body: { [headers.name]: err } } })
          }
        }
        bK = new Uint8Array()
        bV = new Uint8Array()
        start = i + bound.length
      } else {
        bK = new Uint8Array(rest.length + i - start)
        bK.set(rest)
        bK.set(scan.slice(start, i), rest.length)
        start = i + 3
      }
      rest = new Uint8Array()
      p = start
    }
    if (start < scan.length) {
      const newRest = new Uint8Array(rest.length + scan.length - start)
      newRest.set(rest)
      newRest.set(scan.subarray(start), rest.length)
      // rest accumulates the current part across chunks — cap its growth
      if (limit !== undefined && newRest.length > limit) throw new PayloadTooLargeError()
      rest = newRest
    }
  }
  const headers = parseMultipartHeader(textDecoder.decode(bK))
  if (headers) {
    try {
      delete required[headers.name]
      yield {
        headers,
        content: parseMultipartContent(bV, headers, schema),
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
      payload: { body: `Missing field${reqKeys.length > 1 ? 's' : ''}: ${reqKeys.join(', ')}` },
    })
}
const parseMultipartHeader = (header: string): { name: string; [key: string]: string } | null => {
  if (!header) return null
  let disposition = 'form-data'
  const multipartHeader = [
    ...header.matchAll(/\s*([\w-]+)\s*:\s*([^;]*);?/g),
    ...header.matchAll(/;?\s*(\w+)\s*=\s*\"([^"]*)\";?/g),
  ].reduce((acc: Record<string, string>, v: string[]) => {
    const key = (v[1] ?? '').toLowerCase().replace(/^content-/, '')
    if (key === 'disposition') {
      disposition = v[2] ?? 'form-data'
      return acc
    }
    acc[key] = v[2] ?? ''
    return acc
  }, Object.create(null))
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
    let s = getProp(schema?.props, headers.name)
    return s ? paramParser(str, s?.[Kind] === 'array' ? s?.items : s) : str
  } else if (type === 'application/json') {
    if (!schema?.props || !Object.hasOwn(schema.props, headers.name)) {
      try {
        result = JSON.parse(textDecoder.decode(content).trim())
      } catch (err: any) {
        throw new RequestError({ status: 400, payload: { body: { [headers.name]: 'Not a valid JSON part' } } })
      }
    } else if (schema?.props) {
      const prop = schema.props[headers.name]!
      if (prop[Kind] === 'object') {
        try {
          result = JSON.parse(textDecoder.decode(content).trim())
        } catch (err: any) {
          throw new RequestError({
            status: 400,
            payload: { body: { [headers.name]: 'Not a valid JSON part' } },
          })
        }
        try {
          runCompiled(result, prop)
        } catch (err) {
          throw new RequestError({ status: 400, payload: { body: { [headers.name]: err } } })
        }
      } else if (prop[Kind] === 'byteArray') {
        try {
          return runCompiled(content, prop)
        } catch (err) {
          throw new RequestError({ status: 400, payload: { body: { [headers.name]: err } } })
        }
      } else if (prop[Kind] === 'string') {
        result = textDecoder.decode(content).trim()
      } else {
        throw new RequestError({
          status: 400,
          payload: { body: { [headers.name]: `Expected ${prop[Kind]} found json` } },
        })
      }
    }
  } else {
    const s = getProp(schema?.props, headers.name)
    if (s) {
      try {
        runCompiled(result, s[Kind] === 'array' ? s.items : s)
      } catch (err) {
        throw new RequestError({ status: 400, payload: { body: { [headers.name]: err } } })
      }
    }
  }
  return result
}
// Feeding the whole buffer as a single chunk keeps the streaming scanner's
// semantics while skipping per-network-chunk generator overhead.
const oneChunkStream = (buf: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(buf)
      controller.close()
    },
  })
const streamToMultipartForm = async (
  data: ReadableStream<Uint8Array>,
  boundary: string,
  schema?: STMultipartForm,
  limit?: number
) => {
  const res: Record<string, MultipartFormData> = Object.create(null)
  const errors: Record<string, any> = Object.create(null)
  const required = Object.fromEntries(
    Object.entries(schema?.props || {}).filter(([_, v]: [string, any]) => !v?.[Optional])
  )
  for await (const chunk of $streamToMultipartForm(data, boundary, undefined, limit)) {
    const name = chunk.headers.name
    if (name in res) {
      const existing = res[name]!
      if (!Array.isArray(existing.content)) existing.content = [existing.content]
      existing.content.push(chunk.content)
    } else {
      if (getProp(schema?.props, name)?.[Kind] === 'array') res[name] = { ...chunk, content: [chunk.content] }
      else res[name] = chunk
    }
    delete required[name]

    if (schema?.props && Object.hasOwn(schema.props, name)) {
      try {
        const prop = schema.props[name]!
        const entry = res[name]!
        if (Array.isArray(entry.content) && prop[Kind] !== 'array') throw `Multiple values found`
        entry.content = runCompiled(entry.content, prop, {
          parse: true,
        })
        if (prop[Kind] === 'array')
          for (let [k, v] of Object.entries(entry.content)) {
            try {
              //@ts-ignore
              entry.content[k] = paramParser(v, prop.items)
            } catch (error) {
              errors[name] = name in errors ? [...errors[name], error] : error
            }
          }
      } catch (err) {
        errors[name] = err
      }
    }
  }
  if (Object.keys(errors).length)
    throw new RequestError({
      status: 400,
      payload: { body: errors },
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
      payload: { body: `Missing field${reqKeys.length > 1 ? 's' : ''}: ${reqKeys.join(', ')}` },
    })
  return res
}
const paramParser = (
  value: string | string[] | null,
  type: STMultipartFormValues
): MaybeArray<Static<STPropsValue>> => {
  if (value === undefined) {
    if (type?.[Optional]) return type?.default
    else throw `Required`
  } else if (value === null) return null
  else if (Array.isArray(value)) {
    if (type[Kind] !== 'array') throw `Multiple values found`
    runCompiled(value, type)
    let pv = []
    let errors: Record<number, any> = {}
    for (let [idx, v] of value.entries()) {
      try {
        pv.push(paramParser(v, (type as STArray).items as STMultipartFormValues) as Static<STPropsValue>)
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
      if (value === null || value === undefined || value === '') throw `Not a valid integer`
      const parsedValue = Number(value)
      if (!Number.isFinite(parsedValue) || !Number.isInteger(parsedValue)) throw `Not a valid integer`
      runCompiled(parsedValue, type)
      return parsedValue
    } else if (type[Kind] === 'number') {
      if (value === null || value === undefined || value === '') throw `Not a valid number`
      const parsedValue = Number(value)
      if (!Number.isFinite(parsedValue)) throw `Not a valid number`
      runCompiled(parsedValue, type)
      return parsedValue
    } else if (type[Kind] === 'string') {
      runCompiled(value, type)
      return value
    } else if (type[Kind] === 'literal') {
      const lit = type as STLiteral
      let val: any = value
      if (typeof lit.value === 'boolean') val = value === 'true' ? true : value === 'false' ? false : value
      if (typeof lit.value === 'number') val = Number(value)
      if (val !== lit.value) throw `Not a valid value`
      return val
    } else if (type[Kind] === 'object') {
      let json
      try {
        json = JSON.parse(value)
      } catch (e) {
        throw `Not a valid object`
      }
      return runCompiled(json, type)
    } else if (type[Kind] === 'array') {
      return [paramParser(value, (type as STArray).items as STMultipartFormValues) as Static<STPropsValue>]
    } else if (type[Kind] === 'byteArray') {
      return Uint8Array.from(value, c => c.charCodeAt(0))
    } else if (type[Kind] === 'anyOf' || type[Kind] === 'oneOf') {
      const union = Object.values((type as STUnion).members)
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
      const raw = pInput[idx]
      try {
        params[name] = raw === undefined ? raw : decodeURIComponent(raw)
      } catch {
        params[name] = raw
      }
    }
  }
  return params
}

/**
 * OpenAPI's `deepObject`: `?filter[lat]=1&filter[lon]=2` is one object
 * parameter. Gathers the bracketed keys belonging to `key` and coerces each
 * value against the property schema governing it — `additionalProperties`
 * included, so a `$T.record` query parameter works too. Returns undefined when
 * the query carries no bracketed key for `key`, leaving the JSON-encoded
 * spelling (`?filter={"lat":1}`) to `paramParser`.
 */
const deepObjectParser = (params: { [key: string]: any }, key: string, type: STObject) => {
  const prefix = `${key}[`
  const out: Record<string, any> = {}
  const errors: Record<string, any> = {}
  let found = false
  for (const k of Object.keys(params)) {
    if (!k.startsWith(prefix) || !k.endsWith(']')) continue
    // one level only: OpenAPI leaves nested deepObject undefined
    const prop = k.slice(prefix.length, -1)
    if (!prop || prop.includes('[') || prop.includes(']')) continue
    found = true
    const ps = (type.props?.[prop] ?? type.additionalProperties) as STMultipartFormValues | undefined
    // an undeclared property is kept raw: `additionalProperties: false` rejects
    // it downstream, an open object ignores it, and neither needs a guess here
    if (!ps) {
      out[prop] = params[k]
      continue
    }
    try {
      out[prop] = paramParser(params[k], ps)
    } catch (error) {
      errors[prop] = error
    }
  }
  if (!found) return undefined
  if (Object.keys(errors).length) throw errors
  return out
}

export const parseEntry = <T extends STProps>(
  params: { [key: string]: any },
  schema: T,
  options?: { name?: string; i?: boolean }
): Static<STObject<T>> => {
  const parsedParams: Partial<Static<STObject<T>>> = {}
  const errors: { [key: string]: string | string[] } = {}

  // case-insensitive lookup (headers) without copying the whole map per request:
  // the already-lowercased key usually hits, and the lowercased index — null
  // prototype, the keys are untrusted — is only built when it does not
  let lowercased: Record<string, any> | undefined
  const lookup = (key: string) => {
    const v = params[key]
    if (v !== undefined || options?.i !== true) return v
    if (!lowercased) {
      const index: Record<string, any> = Object.create(null)
      for (const k of Object.keys(params)) index[k.toLowerCase()] = params[k]
      lowercased = index
    }
    return lowercased[key]
  }

  Object.entries(schema).forEach(([key, s]) => {
    const k = options?.i === true ? key.toLowerCase() : key
    let v = lookup(k)
    if (s[Kind] === 'array' && options?.name === 'query' && typeof v === 'string') {
      // a single value may carry several items; repeated keys always may too
      const delimiter = (s as unknown as STArray).split
      if (delimiter !== false) v = v.split(delimiter || ',')
    }
    try {
      if (options?.name === 'query' && s[Kind] === 'object' && v === undefined) {
        const deep = deepObjectParser(params, k, s as unknown as STObject)
        if (deep !== undefined) {
          //@ts-ignore
          parsedParams[k] = runCompiled(deep, s as unknown as STSchema)
          return
        }
      }
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

export const responseParser = (response: any, ctx: Context, cookies: string[], schema?: STResponse) => {
  const details = {
    status: ctx.set.status || 200,
    headers: new Headers(),
  }
  for (const cookie of cookies) {
    details.headers.append('set-cookie', cookie)
  }
  for (const [key, value] of Object.entries(ctx.set.headers)) {
    if (Array.isArray(value)) {
      value.forEach(v => details.headers.append(key, v))
    } else details.headers.set(key, value)
  }
  if (response instanceof Response) {
    // Merge cookies and ctx.set.headers into the raw Response without
    // clobbering headers the user already set on it. `set-cookie` is always
    // appended; other headers are only set when absent on the Response.
    const existing = response.headers
    for (const [key, value] of Object.entries(ctx.set.headers)) {
      if (key.toLowerCase() === 'set-cookie') {
        if (Array.isArray(value)) value.forEach(v => existing.append('set-cookie', v))
        else if (value) existing.append('set-cookie', value as string)
      } else if (!existing.has(key)) {
        if (Array.isArray(value)) value.forEach(v => existing.append(key, v))
        else existing.set(key, value as string)
      }
    }
    for (const cookie of cookies) existing.append('set-cookie', cookie)
    return response
  } else if (typeof response === 'string') {
    if (!details?.headers?.has('content-type')) {
      const statusEntry: any = responseEntryFor(schema as Partial<Record<string | number, any>>, details.status)
      const isJson = statusEntry?.[Kind]
        ? statusEntry[Kind] === 'json'
        : statusEntry?.['application/json'] && !statusEntry?.['text/plain']
      if (isJson) {
        details?.headers?.set('content-type', 'application/json')
        response = JSON.stringify(response)
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
        // ids only need to be unique within the stream: one random prefix per
        // connection plus a counter, instead of a CSPRNG call per event
        const prefix = crypto.randomUUID()
        let n = 0
        let id = ctx.request.headers.get('last-event-id') ?? `${prefix}:${n}`
        for await (const r of response) {
          // multi-line values must be split into one data: field per line (SSE spec)
          let data =
            `id:${id}\n` +
            String(r)
              .split(/\r\n|\r|\n/)
              .map(l => `data:${l}`)
              .join('\n') +
            '\n\n'
          try {
            await controller.write(data)
            await controller.flush()
          } catch (err) {
            console.error(err)
          }
          id = `${prefix}:${++n}`
        }
        controller.close()
      },
    })
    details.headers.set('content-type', 'text/event-stream')
    return new Response(rs, details)
  } else {
    try {
      if (!details?.headers?.has('content-type')) details?.headers?.set('content-type', 'application/json')
      if (details.headers.get('content-type') === 'application/json') response = JSON.stringify(response)
      return new Response(response, details)
    } catch (error) {
      console.error(error)
      throw new InternalServerError()
    }
  }
}

const unionize = (b: any, schema: STUnion) => {
  let res
  let error
  const discriminants = schema.members.reduce(
    (acc, obj) => {
      const props = (obj as STObject).props
      return acc.filter(k => props && k in props && props[k]?.[Kind] === 'literal' && !props[k]?.[Optional])
    },
    Object.keys((schema.members[0] as STObject)?.props || {})
  )
  for (let s of schema.members) {
    try {
      res = runCompiled(b, s, { parse: true })
      if (res !== undefined) break
    } catch (err: any) {
      if (discriminants.every(d => !err?.[d]?.startsWith('Not a valid value'))) error = err
    }
  }
  if (res !== undefined) return res
  else if (error) throw new RequestError({ status: 400, payload: { body: error } })
  else throw new RequestError({ status: 400, payload: { body: `No matching body schema found` } })
}

const intersectionize = (b: any, schema: STIntersection<any>) => {
  let res
  try {
    for (let s of schema.allOf) res = runCompiled(b, s, { parse: true })
    return res
  } catch (e) {
    throw new RequestError({ status: 400, payload: { body: `No matching body schema found` } })
  }
}
