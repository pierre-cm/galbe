import { $T, type Context } from '../src'

export type Case = {
  body?: any
  type?: string
  schema: string
  expected: { status: number; type?: string; resp?: any }
}

export const formdata = (data: Record<string, string | string[] | Blob>): FormData => {
  const form = new FormData()
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) for (const v2 of v) form.append(k, v2)
    else form.append(k, v)
  }
  return form
}
export const fileHash = async (ba: any) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', ba)))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
export const decoder = new TextDecoder()

export const schema_objectBase = {
  ba: $T.byteArray(),
  string: $T.string(),
  number: $T.number(),
  bool: $T.boolean(),
  any: $T.any(),
  optional: $T.optional($T.any())
}
export const schema_object = {
  ...schema_objectBase,
  object: $T.object($T.any()),
  array: $T.array($T.any())
}

export const isAsyncIterator = (obj: any) => {
  if (Object(obj) !== obj) return false
  const method = obj[Symbol.asyncIterator]
  if (typeof method != 'function') return false
  const aIter = method.call(obj)
  return aIter === obj
}

const parseAsyncIterator = async (body: any): Promise<any> => {
  const chunks = []
  let type
  for await (const chunk of body) {
    if (chunk instanceof Uint8Array) type = 'byteArray'
    else if (typeof chunk === 'string') type = 'string'
    // @ts-ignore
    chunks.push(chunk)
  }
  // @ts-ignore
  if (type === 'byteArray') return new Uint8Array(chunks.map(c => Array.from(c)).flat())
  if (type === 'string') return chunks.join('')
  return chunks
}
const parseBody = async (body: any): Promise<any> =>
  typeof body === 'object' && body !== null && !Array.isArray(body)
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(body).map(async ([k, v]) => {
            if (v instanceof Uint8Array) return [k, await fileHash(v)]
            else return [k, await parseBody(v)]
          })
        )
      )
    : body
export const handleBody = async (ctx: any) => {
  if (ctx.body === undefined) {
    return { type: 'undefined' }
  }
  if (ctx?.body instanceof ReadableStream) {
    let content = ''
    for await (const chunk of ctx.body) {
      if (typeof chunk === 'string') content += chunk
      else content += decoder.decode(chunk)
    }
    return { type: 'ReadableStream', content }
  }
  if (Array.isArray(ctx.body)) {
    return { type: 'array', content: ctx.body }
  }
  if (ctx?.body instanceof Uint8Array) {
    return { type: 'byteArray', content: decoder.decode(ctx.body) }
  }
  if (isAsyncIterator(ctx.body)) {
    return { type: 'AsyncIterator', content: await parseAsyncIterator(ctx.body) }
  } else {
    return { type: typeof ctx.body, content: await parseBody(ctx.body) }
  }
}
export const handleUrlFormStream = async (ctx: Context) => {
  let resp: Record<string, any> = {}
  // @ts-ignore
  for await (const [k, v] of ctx.body) {
    if (k in resp) {
      resp[k] = Array.isArray(resp[k]) ? [...resp[k], v] : [resp[k], v]
    } else resp[k] = v
  }
  return { type: 'object', content: resp }
}
