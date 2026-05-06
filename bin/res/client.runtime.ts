// Inlined into the generated client — no exports
import type { BodyInit } from 'bun'

type GalbeClientConfig = {
  server?: { url?: string }
  headers?: Record<string, string>
  fetch?: (req: Request) => Promise<Response>
}

class GalbeClientError extends Error {
  readonly status: number
  readonly headers: Headers
  readonly body: string
  constructor(status: number, headers: Headers, body: string) {
    super(`HTTP ${status}`)
    this.name = 'GalbeClientError'
    this.status = status
    this.headers = headers
    this.body = body
  }
}

const _parseResponse = async (res: Response): Promise<any> => {
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return res.json()
  if (ct.includes('application/octet-stream')) return new Uint8Array(await res.arrayBuffer())
  return res.text()
}

const _buildUrl = (base: string | undefined, path: string, query?: Record<string, any>): string => {
  let url = `${base ?? ''}${path}`
  if (query) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue
      if (Array.isArray(v)) for (const item of v) params.append(k, String(item))
      else params.set(k, String(v))
    }
    const qs = params.toString()
    if (qs) url += `?${qs}`
  }
  return url
}

const _formdata = (data: Record<string, string | string[] | Blob>): FormData => {
  const form = new FormData()
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) for (const item of v) form.append(k, String(item))
    else form.append(k, v instanceof Blob ? v : String(v))
  }
  return form
}

type _RequestOptions = {
  query?: Record<string, any>
  headers?: Record<string, string>
  contentType?: string
}

const _doFetch = (
  config: GalbeClientConfig,
  method: string,
  path: string,
  body?: any,
  options?: _RequestOptions
): Promise<Response> => {
  const url = _buildUrl(config.server?.url, path, options?.query)
  let bodyInit: BodyInit | undefined
  const bodyHeaders: Record<string, string> = {}

  if (body !== undefined && body !== null) {
    const ct = options?.contentType
    if (ct === 'urlForm') {
      bodyInit = new URLSearchParams(body).toString()
      bodyHeaders['content-type'] = 'application/x-www-form-urlencoded'
    } else if (ct === 'multipart') {
      bodyInit = _formdata(body)
    } else if (ct === 'byteArray' || body instanceof Uint8Array) {
      bodyInit = body
      bodyHeaders['content-type'] = 'application/octet-stream'
    } else if (ct === 'text') {
      bodyInit = String(body)
      bodyHeaders['content-type'] = 'text/plain'
    } else {
      bodyInit = JSON.stringify(body)
      bodyHeaders['content-type'] = 'application/json'
    }
  }

  const req = new Request(url, {
    method,
    headers: { ...config.headers, ...bodyHeaders, ...options?.headers },
    ...(bodyInit !== undefined ? { body: bodyInit } : {}),
  })

  return (config.fetch ?? fetch)(req)
}

class GalbeRequest<T, E = any> {
  #promise: Promise<[Response, Response]>
  #main?: Promise<T>

  constructor(fetchPromise: Promise<Response>) {
    this.#promise = fetchPromise.then(res => [res, res.clone()] as [Response, Response])
  }

  #getMain(): Promise<T> {
    if (!this.#main) {
      this.#main = this.#promise.then(async ([res]) => {
        if (!res.ok) throw new GalbeClientError(res.status, res.headers, await res.text())
        return _parseResponse(res) as T
      })
    }
    return this.#main
  }

  then<R1 = T, R2 = never>(
    onfulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return this.#getMain().then(onfulfilled, onrejected)
  }

  catch<R = never>(onrejected?: ((reason: any) => R | PromiseLike<R>) | null): Promise<T | R> {
    return this.#getMain().then(undefined, onrejected)
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.#getMain().finally(onfinally)
  }

  async safe(): Promise<{ ok: true; data: T } | { ok: false; error: E }> {
    const [mainRes, cloneRes] = await this.#promise
    if (mainRes.ok) {
      return { ok: true, data: (await _parseResponse(cloneRes)) as T }
    } else {
      const body = await _parseResponse(cloneRes)
      return { ok: false, error: { status: mainRes.status, headers: mainRes.headers, body } as E }
    }
  }
}

const _createRequest = <T, E = any>(
  config: GalbeClientConfig,
  method: string,
  path: string,
  body?: any,
  options?: _RequestOptions
): GalbeRequest<T, E> => new GalbeRequest<T, E>(_doFetch(config, method, path, body, options))

const _createRawRequest = async (
  config: GalbeClientConfig,
  method: string,
  path: string,
  body?: any,
  options?: _RequestOptions
): Promise<any> => {
  const res = await _doFetch(config, method, path, body, options)
  return {
    status: res.status,
    ok: res.ok,
    redirected: res.redirected,
    statusText: res.statusText,
    type: res.type,
    url: res.url,
    headers: res.headers,
    body: {
      json: () => res.json(),
      text: () => res.text(),
      byteArray: () => res.arrayBuffer().then((b: ArrayBuffer) => new Uint8Array(b)),
      stream: (): AsyncGenerator<Uint8Array, void, unknown> => {
        const reader = res.body?.getReader()
        return (async function* () {
          if (!reader) return
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            yield value!
          }
        })()
      },
    },
  }
}
