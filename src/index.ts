import type { Server } from 'bun'
import type { RouteFileMeta } from './routes'
import type {
  GalbeConfig,
  Method,
  RequestSchema,
  Hook,
  Handler,
  Endpoint,
  Context,
  ErrorHandler,
  GalbePlugin,
  STBody,
  STResponse,
  STParams,
  STHeaders,
  STQuery
} from './types'

import server from './server'
import { GalbeRouter } from './router'
import { SchemaType, type STObject, type Static } from './schema'

const overloadDiscriminer = <
  M extends Method,
  Path extends string,
  H extends STHeaders,
  P extends Partial<STParams<Path>>,
  Q extends STQuery,
  B extends STBody,
  R extends STResponse
>(
  galbe: Galbe,
  method: M,
  path: Path,
  arg2:
    | RequestSchema<M, Path, H, P, Q, B, R>
    | Hook<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>[]
    | Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>,
  arg3?:
    | Hook<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>[]
    | Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>,
  arg4?: Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>
) => {
  const defaultSchema = {}
  if (typeof arg2 === 'function') {
    return galbeMethod(galbe, method, path, defaultSchema, undefined, arg2)
  } else {
    if (Array.isArray(arg2)) {
      if (typeof arg3 === 'function') return galbeMethod(galbe, method, path, defaultSchema, arg2, arg3)
    } else {
      if (Array.isArray(arg3) && arg4) return galbeMethod(galbe, method, path, arg2, arg3, arg4)
      else if (typeof arg3 === 'function') return galbeMethod(galbe, method, path, arg2, undefined, arg3)
    }
  }
  throw new Error('Undefined route signature')
}
const galbeMethod = <
  M extends Method,
  Path extends string,
  H extends STHeaders,
  P extends Partial<STParams<Path>>,
  Q extends STQuery,
  B extends STBody,
  R extends STResponse
>(
  _galbe: Galbe,
  method: M,
  path: Path,
  schema: RequestSchema<M, Path, H, P, Q, B, R> | undefined,
  hooks: Hook<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>[] | undefined,
  handler: Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>
) => {
  schema = schema ?? {}
  hooks = hooks || []
  const context: Context<M, Path, typeof schema> = {
    headers: {} as Static<STObject<Exclude<(typeof schema)['headers'], undefined>>>,
    params: {} as any,
    query: {} as Static<STObject<Exclude<(typeof schema)['query'], undefined>>>,
    //@ts-ignore
    body: ['get', 'options', 'head'].includes(method)
      ? null
      : ({} as Static<Exclude<(typeof schema)['body'], undefined>>),
    request: {} as Request,
    state: {},
    set: {} as {
      headers: {
        [header: string]: string
      }
      status?: number
    }
  }
  return {
    method,
    path,
    schema,
    context,
    hooks,
    handler
  }
}

/** Galbe Schema Type builder. See {@link https://galbe.dev/documentation/schemas#schema-types Schema Types} */
export const $T = new SchemaType()

export { RequestError } from './types'

/**
 * #### Galbe Server
 * Instanciate a Galbe web server
 *
 * ---
 * @example
 * ```typescript
 * import { Galbe } from 'galbe'
 * import config from "./galbe.config"
 *
 * export default new Galbe(config)
 * ```
 */
export class Galbe {
  config: GalbeConfig
  meta?: Array<RouteFileMeta> = []
  router: GalbeRouter
  startCb: (() => void)[] = []
  stopCb: (() => void)[] = []
  errorCb: ErrorHandler[] = []
  listening: boolean = false
  server?: Server
  plugins: GalbePlugin[] = []
  constructor(config?: GalbeConfig) {
    this.config = config ?? {}
    this.config.routes = this.config.routes ?? true
    this.router = new GalbeRouter({
      prefix: this.config?.basePath || '',
      cacheEnabled: this.config?.router?.cacheEnabled
    })
    this.config.requestValidator = config?.requestValidator ?? { enabled: true }
    this.config.responseValidator = config?.responseValidator ?? { enabled: true }
  }
  private add(route: any) {
    this.router.add(route)
    return route
  }
  async use(plugin: GalbePlugin) {
    this.plugins.push(plugin)
  }
  async init() {
    for (const p of this.plugins) {
      if (p.init) await p.init(this.config?.plugin?.[p.name] || {}, this)
    }
  }
  async listen(port?: number, hostname?: string) {
    port = port || this.config?.port || 3000
    hostname = hostname || this.config?.hostname || 'localhost'
    this.config.port = port
    this.config.hostname = hostname
    if (this.listening) this.stop()
    await this.init()
    this.server = await server(this, port, hostname)
    if (Bun.env.BUN_ENV === 'development') {
      const url = `http${this.config.tls ? 's' : ''}://${hostname}:${port}${this.config?.basePath || ''}`
      console.log(`\x1b[1m🚀 Server running at\x1b[0m \x1b[4;34m${url}\x1b[0m\n`)
    }
    this.listening = true
    for (let sh of this.startCb) sh()
    return this.server
  }
  stop() {
    this.server?.stop(true)
    for (let sh of this.stopCb) sh()
  }
  onStart(callback: () => void) {
    this.startCb.push(callback)
  }
  onStop(callback: () => void) {
    this.stopCb.push(callback)
  }
  onError(handler: ErrorHandler) {
    this.errorCb.push(handler)
  }
  get: Endpoint<'get'> = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends undefined,
    R extends STResponse
  >(
    path: Path,
    arg2:
      | RequestSchema<'get', Path, H, P, Q, B, R>
      | Hook<'get', Path, RequestSchema<'get', Path, H, P, Q, B, R>>[]
      | Handler<'get', Path, RequestSchema<'get', Path, H, P, Q, B, R>>,
    arg3?:
      | Hook<'get', Path, RequestSchema<'get', Path, H, P, Q, B, R>>[]
      | Handler<'get', Path, RequestSchema<'get', Path, H, P, Q, B, R>>,
    arg4?: Handler<'get', Path, RequestSchema<'get', Path, H, P, Q, B, R>>
    //@ts-ignore
  ) => this.add(overloadDiscriminer(this, 'get', path, arg2, arg3, arg4))
  post: Endpoint<'post'> = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse
  >(
    path: Path,
    arg2:
      | RequestSchema<'post', Path, H, P, Q, B, R>
      | Hook<'post', Path, RequestSchema<'post', Path, H, P, Q, B, R>>[]
      | Handler<'post', Path, RequestSchema<'post', Path, H, P, Q, B, R>>,
    arg3?:
      | Hook<'post', Path, RequestSchema<'post', Path, H, P, Q, B, R>>[]
      | Handler<'post', Path, RequestSchema<'post', Path, H, P, Q, B, R>>,
    arg4?: Handler<'post', Path, RequestSchema<'post', Path, H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'post', path, arg2, arg3, arg4))
  put: Endpoint<'put'> = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse
  >(
    path: Path,
    arg2:
      | RequestSchema<'put', Path, H, P, Q, B, R>
      | Hook<'put', Path, RequestSchema<'put', Path, H, P, Q, B, R>>[]
      | Handler<'put', Path, RequestSchema<'put', Path, H, P, Q, B, R>>,
    arg3?:
      | Hook<'put', Path, RequestSchema<'put', Path, H, P, Q, B, R>>[]
      | Handler<'put', Path, RequestSchema<'put', Path, H, P, Q, B, R>>,
    arg4?: Handler<'put', Path, RequestSchema<'put', Path, H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'put', path, arg2, arg3, arg4))
  patch: Endpoint<'patch'> = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse
  >(
    path: Path,
    arg2:
      | RequestSchema<'patch', Path, H, P, Q, B, R>
      | Hook<'patch', Path, RequestSchema<'patch', Path, H, P, Q, B, R>>[]
      | Handler<'patch', Path, RequestSchema<'patch', Path, H, P, Q, B, R>>,
    arg3?:
      | Hook<'patch', Path, RequestSchema<'patch', Path, H, P, Q, B, R>>[]
      | Handler<'patch', Path, RequestSchema<'patch', Path, H, P, Q, B, R>>,
    arg4?: Handler<'patch', Path, RequestSchema<'patch', Path, H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'patch', path, arg2, arg3, arg4))
  delete: Endpoint<'delete'> = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse
  >(
    path: Path,
    arg2:
      | RequestSchema<'delete', Path, H, P, Q, B, R>
      | Hook<'delete', Path, RequestSchema<'delete', Path, H, P, Q, B, R>>[]
      | Handler<'delete', Path, RequestSchema<'delete', Path, H, P, Q, B, R>>,
    arg3?:
      | Hook<'delete', Path, RequestSchema<'delete', Path, H, P, Q, B, R>>[]
      | Handler<'delete', Path, RequestSchema<'delete', Path, H, P, Q, B, R>>,
    arg4?: Handler<'delete', Path, RequestSchema<'delete', Path, H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'delete', path, arg2, arg3, arg4))
  options: Endpoint<'options'> = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse
  >(
    path: Path,
    arg2:
      | RequestSchema<'options', Path, H, P, Q, B, R>
      | Hook<'options', Path, RequestSchema<'options', Path, H, P, Q, B, R>>[]
      | Handler<'options', Path, RequestSchema<'options', Path, H, P, Q, B, R>>,
    arg3?:
      | Hook<'options', Path, RequestSchema<'options', Path, H, P, Q, B, R>>[]
      | Handler<'options', Path, RequestSchema<'options', Path, H, P, Q, B, R>>,
    arg4?: Handler<'options', Path, RequestSchema<'options', Path, H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'options', path, arg2, arg3, arg4))
  head: Endpoint<'head'> = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse
  >(
    path: Path,
    arg2:
      | RequestSchema<'head', Path, H, P, Q, B, R>
      | Hook<'head', Path, RequestSchema<'head', Path, H, P, Q, B, R>>[]
      | Handler<'head', Path, RequestSchema<'head', Path, H, P, Q, B, R>>,
    arg3?:
      | Hook<'head', Path, RequestSchema<'head', Path, H, P, Q, B, R>>[]
      | Handler<'head', Path, RequestSchema<'head', Path, H, P, Q, B, R>>,
    arg4?: Handler<'head', Path, RequestSchema<'head', Path, H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'head', path, arg2, arg3, arg4))
}

export * from './types'
