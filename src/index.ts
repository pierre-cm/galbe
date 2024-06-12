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
  Path extends string,
  H extends STHeaders,
  P extends Partial<STParams<Path>>,
  Q extends STQuery,
  B extends STBody,
  R extends STResponse
>(
  galbe: Galbe,
  method: Method,
  path: Path,
  arg2:
    | RequestSchema<Path, H, P, Q, B, R>
    | Hook<Path, RequestSchema<Path, H, P, Q, B, R>>[]
    | Handler<Path, RequestSchema<Path, H, P, Q, B, R>>,
  arg3?: Hook<Path, RequestSchema<Path, H, P, Q, B, R>>[] | Handler<Path, RequestSchema<Path, H, P, Q, B, R>>,
  arg4?: Handler<Path, RequestSchema<Path, H, P, Q, B, R>>
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
  Path extends string,
  H extends STHeaders,
  P extends Partial<STParams<Path>>,
  Q extends STQuery,
  B extends STBody,
  R extends STResponse
>(
  _galbe: Galbe,
  method: Method,
  path: Path,
  schema: RequestSchema<Path, H, P, Q, B, R> | undefined,
  hooks: Hook<Path, RequestSchema<Path, H, P, Q, B, R>>[] | undefined,
  handler: Handler<Path, RequestSchema<Path, H, P, Q, B, R>>
) => {
  schema = schema ?? {}
  hooks = hooks || []
  const context: Context<Path, typeof schema> = {
    headers: {} as Static<STObject<Exclude<(typeof schema)['headers'], undefined>>>,
    params: {} as any,
    query: {} as Static<STObject<Exclude<(typeof schema)['query'], undefined>>>,
    body: {} as Static<Exclude<(typeof schema)['body'], undefined>>,
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
  errorHandler?: ErrorHandler
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
      if (p.init) await p.init(this.config?.plugin?.[p.name], this)
    }
  }
  async listen(port?: number) {
    port = port || this.config?.port || 3000
    this.config.port = port
    if (this.listening) this.stop()
    await this.init()
    this.server = await server(this, port)
    if (Bun.env.BUN_ENV === 'development') {
      const url = `http://localhost:${port}${this.config?.basePath || ''}`
      console.log(`\x1b[1;30m🚀 Server running at\x1b[0m \x1b[4;34m${url}\x1b[0m\n`)
    }
    this.listening = true
    return this.server
  }
  stop() {
    this.server?.stop(true)
  }
  onError(handler: ErrorHandler) {
    this.errorHandler = handler
  }
  get: Endpoint = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse
  >(
    path: Path,
    arg2:
      | RequestSchema<Path, H, P, Q, B, R>
      | Hook<Path, RequestSchema<Path, H, P, Q, B, R>>[]
      | Handler<Path, RequestSchema<Path, H, P, Q, B, R>>,
    arg3?: Hook<Path, RequestSchema<Path, H, P, Q, B, R>>[] | Handler<Path, RequestSchema<Path, H, P, Q, B, R>>,
    arg4?: Handler<Path, RequestSchema<Path, H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'get', path, arg2, arg3, arg4))
  post: Endpoint = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse
  >(
    path: Path,
    arg2:
      | RequestSchema<Path, H, P, Q, B, R>
      | Hook<Path, RequestSchema<Path, H, P, Q, B, R>>[]
      | Handler<Path, RequestSchema<Path, H, P, Q, B, R>>,
    arg3?: Hook<Path, RequestSchema<Path, H, P, Q, B, R>>[] | Handler<Path, RequestSchema<Path, H, P, Q, B, R>>,
    arg4?: Handler<Path, RequestSchema<Path, H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'post', path, arg2, arg3, arg4))
  put: Endpoint = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse
  >(
    path: Path,
    arg2:
      | RequestSchema<Path, H, P, Q, B, R>
      | Hook<Path, RequestSchema<Path, H, P, Q, B, R>>[]
      | Handler<Path, RequestSchema<Path, H, P, Q, B, R>>,
    arg3?: Hook<Path, RequestSchema<Path, H, P, Q, B, R>>[] | Handler<Path, RequestSchema<Path, H, P, Q, B, R>>,
    arg4?: Handler<Path, RequestSchema<Path, H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'put', path, arg2, arg3, arg4))
  patch: Endpoint = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse
  >(
    path: Path,
    arg2:
      | RequestSchema<Path, H, P, Q, B, R>
      | Hook<Path, RequestSchema<Path, H, P, Q, B, R>>[]
      | Handler<Path, RequestSchema<Path, H, P, Q, B, R>>,
    arg3?: Hook<Path, RequestSchema<Path, H, P, Q, B, R>>[] | Handler<Path, RequestSchema<Path, H, P, Q, B, R>>,
    arg4?: Handler<Path, RequestSchema<Path, H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'patch', path, arg2, arg3, arg4))
  delete: Endpoint = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse
  >(
    path: Path,
    arg2:
      | RequestSchema<Path, H, P, Q, B, R>
      | Hook<Path, RequestSchema<Path, H, P, Q, B, R>>[]
      | Handler<Path, RequestSchema<Path, H, P, Q, B, R>>,
    arg3?: Hook<Path, RequestSchema<Path, H, P, Q, B, R>>[] | Handler<Path, RequestSchema<Path, H, P, Q, B, R>>,
    arg4?: Handler<Path, RequestSchema<Path, H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'delete', path, arg2, arg3, arg4))
  options: Endpoint = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse
  >(
    path: Path,
    arg2:
      | RequestSchema<Path, H, P, Q, B, R>
      | Hook<Path, RequestSchema<Path, H, P, Q, B, R>>[]
      | Handler<Path, RequestSchema<Path, H, P, Q, B, R>>,
    arg3?: Hook<Path, RequestSchema<Path, H, P, Q, B, R>>[] | Handler<Path, RequestSchema<Path, H, P, Q, B, R>>,
    arg4?: Handler<Path, RequestSchema<Path, H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'options', path, arg2, arg3, arg4))
}

export * from './types'
