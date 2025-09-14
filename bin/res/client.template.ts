export type GalbeClientConfig = {
  server?: { url?: string }
}

export const Kind = Symbol.for('json.string')
type Json<T> = { T: T }

interface GR<S extends number | 'default' = 'default', B = any, OKS extends number = OKStatusCode> {
  status: Exclude<S, 'default'>
  ok: S extends OKS ? true : false
  redirected: boolean
  statusText: string
  type: 'basic' | 'cors' | 'default' | 'error' | 'opaque' | 'opaqueredirect'
  url: string
  headers: Headers
  body: <ST extends boolean = false>(
    stream?: ST
  ) => B extends Uint8Array
    ? ST extends true
      ? Promise<AsyncGenerator<Uint8Array, void, unknown>>
      : B extends Json<infer T>
      ? Promise<T>
      : Promise<B>
    : B extends string
    ? ST extends true
      ? Promise<AsyncGenerator<string, void, unknown>>
      : B extends Json<infer T>
      ? Promise<T>
      : Promise<B>
    : B extends Json<infer T>
    ? Promise<T>
    : Promise<B>
}

export type OKStatusCode = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226
// prettier-ignore
export type HttpStatusCode = 100 | 101 | 102 | 103 | OKStatusCode | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 421 | 422 | 423 | 424 | 426 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 506 | 507 | 508 | 510 | 511
type PGR<
  S extends number | 'default' = 'default',
  B = any,
  O extends number = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226
> = Promise<GR<S, B, O>>

type ContentType = 'byteArray' | 'text' | 'json' | 'urlForm' | 'multipart' | 'default'
type RequestOptions<
  H = any,
  Q = any,
  B extends Partial<Record<ContentType, any>> = Partial<Record<ContentType, any>>,
  C extends keyof B = keyof B
> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'
  headers?: H
  query?: Q
  contentType?: C
  body?: B[C]
}

const decoder = new TextDecoder()
const DEFAULT_HEADERS = {
  'user-agent': 'Galbe//*%(()=>version)()%*/',
}

const formdata = (data: Record<string, string | string[] | Blob>): FormData => {
  const form = new FormData()
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) for (const v2 of v) form.append(String(k), String(v2))
    else form.append(String(k), String(v))
  }
  return form
}

// Typescript types
/*%
Object.entries(types).map(([tk, t])=>{
  return `export type ${tk} = ${t}`
})
%*/

export default class GalbeClient {
  /*%
  Object.entries(routes).map(([method, list])=>{
    return`${method} = {\n${list.map( r => {
      let p = Object.entries(r.params)
      let schemas = Object.keys(r.schemas).length ?
        `<${r.schemas.headers??'any'},${r.schemas.query??'any'},${r.schemas.body??'any'},CT>`: 
        ''
      let oks = Object.keys(r.schemas?.response||{}).filter(s=>s>=200&&s<300)
      let responses = Object.keys(r.schemas?.response||{}).length ?
        `${Object.entries(r.schemas.response).filter(([s,_])=>s!=='"default"').map(([k,v])=>`PGR<${k},${v}${oks?.length?`,${oks.join('|')}`:''}>`).join('|')}|PGR<Exclude<HttpStatusCode,${Object.keys(r.schemas.response).filter(s=>s!=='"default"').join('|')}>,${'"default"' in r.schemas.response ? r.schemas.response['"default"'] : 'any'}${oks?.length?`,${oks.join('|')}`:''}>`: 
        `PGR<HttpStatusCode,any${oks?.length?`,${oks.join('|')}`:',any'}>`
      return `  '${r.path}':<CT extends ${r.contentTypes}>(${p.length?p.map(([k,v])=>`${k}:${v.type}`).join(',')+', ':''}options:RequestOptions${schemas}={})=>this.fetch(\`${r.pathT}\`,{...options,method:'${r.method.toUpperCase()}'}) as ${responses}`
    }).join(',\n')}\n}`
  }).join('\n')
  %*/

  constructor(private readonly config?: GalbeClientConfig) {}

  async fetch(path: string, options: RequestOptions) {
    let url = `${this?.config?.server?.url ?? ''}${path}`
    const params = new URLSearchParams(options?.query || {})
    url = `${url}?${params.toString()}`
    let res = await fetch(url, {
      method: options?.method || 'GET',
      headers: {
        ...DEFAULT_HEADERS,
        ...(options?.contentType && ['byteArray', 'text', 'json', 'urlForm'].includes(options.contentType)
          ? {
              'content-type': {
                byteArray: 'application/octet-stream',
                text: 'text/plain',
                json: 'application/json',
                urlForm: 'application/x-www-form-urlencoded',
              }[options.contentType],
            }
          : {}),
        ...(options?.headers || {}),
      },
      ...(options?.body
        ? { body: options?.contentType === 'multipart' ? formdata(options?.body) : JSON.stringify(options.body) }
        : {}),
    })
    return {
      headers: res.headers,
      ok: res.ok,
      redirected: res.redirected,
      status: res.status,
      statusText: res.statusText,
      type: res.type,
      url: res.url,
      body: async (stream = false) => {
        if (res.headers.get('content-type') === 'application/json') return res.json()
        else if (res.headers.get('content-type') === 'text/event-stream') {
          const reader = res.body?.getReader()
          return async function* () {
            while (reader) {
              const { value, done } = await reader.read()
              if (done) break
              yield decoder.decode(value)
            }
          }
        } else if (res.headers.get('content-type')?.match(/^text\//)) {
          if (stream) {
            const reader = res.body?.getReader()
            return (async function* () {
              while (reader) {
                const { value, done } = await reader.read()
                if (done) break
                yield decoder.decode(value)
              }
            })()
          } else return res.text()
        } else if (res.headers.get('content-type') === 'application/octet-stream') {
          const reader = res.body?.getReader()
          if (stream) {
            return (async function* () {
              while (reader) {
                const { value, done } = await reader.read()
                if (done) break
                yield value
              }
            })()
          } else {
            let body = new Uint8Array()
            while (reader) {
              const { value, done } = await reader.read()
              if (done) break
              let buff = new Uint8Array(body.length + value.length)
              buff.set(body)
              buff.set(value, body.length)
              body = buff
            }
            return body
          }
        }
        return res.body
      },
    }
  }

  // Aliases
  /*%
  Object.entries(routes).map(([method, list])=>{
    return list.filter(r=>r.alias).map(r => {
      let p = Object.entries(r.params)
      let schemas = Object.keys(r.schemas).length ?
        `<${r.schemas.headers??'any'},${r.schemas.query??'any'},${r.schemas.body??'any'},CT>`: 
        ''
      let oks = Object.keys(r.schemas?.response||{}).filter(s=>s>=200&&s<300)
      let responses = Object.keys(r.schemas?.response||{}).length ?
        `${Object.entries(r.schemas.response).filter(([s,_])=>s!=='"default"').map(([k,v])=>`PGR<${k},${v}${oks?.length?`,${oks.join('|')}`:''}>`).join('|')}|PGR<Exclude<HttpStatusCode,${Object.keys(r.schemas.response).filter(s=>s!=='"default"').join('|')}>,${'"default"' in r.schemas.response ? r.schemas.response['"default"'] : 'any'}${oks?.length?`,${oks.join('|')}`:''}>`: 
        `PGR<HttpStatusCode,any${oks?.length?`,${oks.join('|')}`:',any'}>`
      let summary = r.summary ? `   * ${r.summary || ''}\n   *\n` : ''
      let description = r.description ? `   * ${r.description.replace(/\n/g,'\n   * ')}` : ''
      let params = Object.entries(r.schema.params || {}).map( ([k,v])=>`\n   * @param ${k} - ${v.description?.replace(/\n/g,'\n     ')}` ).join('')
      let query = Object.entries(r.schema.query || {}).map( ([k,v])=>`\n   * @param options.query.${k} - ${v.description?.replace(/\n/g,'\n     ')}` ).join('')
      return `/**\n${summary}${description}\n   *${params}${query}\n   *\/\n  ${r.alias}<CT extends ${r.contentTypes}>(${p.length ? p.map(([k,v])=>`${k}: ${v.type}`).join(', ')+', ':''}options: RequestOptions${schemas} = {}){return this.fetch(\`${r.pathT}\`, {...options, method: '${r.method.toUpperCase()}'}) as ${responses}}\n`
    }).join('  ')
  })
  %*/
}
