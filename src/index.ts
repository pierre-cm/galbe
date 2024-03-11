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
  STParams,
  STHeaders,
  STQuery
} from './types'

import server from './server'
import { GalbeRouter } from './router'
import { defineRoutes } from './routes'
import { logRoute } from './util'
import { SchemaType, type STObject, type Static } from './schema'

const overloadDiscriminer = <
  Path extends string,
  H extends STHeaders,
  P extends Partial<STParams<Path>>,
  Q extends STQuery,
  B extends STBody
>(
  galbe: Galbe,
  method: Method,
  path: Path,
  arg2:
    | RequestSchema<Path, H, P, Q, B>
    | Hook<Path, RequestSchema<Path, H, P, Q, B>>[]
    | Handler<Path, RequestSchema<Path, H, P, Q, B>>,
  arg3?: Hook<Path, RequestSchema<Path, H, P, Q, B>>[] | Handler<Path, RequestSchema<Path, H, P, Q, B>>,
  arg4?: Handler<Path, RequestSchema<Path, H, P, Q, B>>
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
  B extends STBody
>(
  _galbe: Galbe,
  method: Method,
  path: Path,
  schema: RequestSchema<Path, H, P, Q, B> | undefined,
  hooks: Hook<Path, RequestSchema<Path, H, P, Q, B>>[] | undefined,
  handler: Handler<Path, RequestSchema<Path, H, P, Q, B>>
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

export const $T = new SchemaType()

export { RequestError } from './types'

const indexRoutes: { method: string; path: string }[] = []
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
  #prepare: boolean = false
  server?: Server
  plugins: GalbePlugin[] = []
  constructor(config?: GalbeConfig) {
    this.config = config ?? {}
    this.config.routes = this.config.routes ?? true
    this.router = new GalbeRouter({
      prefix: this.config?.basePath || '',
      cacheEnabled: this.config?.router?.cacheEnabled
    })
  }
  private add(route: any) {
    this.router.add(route)
    if (Bun.env.BUN_ENV === 'development') {
      if (!this.#prepare) indexRoutes.push({ method: route.method, path: route.path })
      else logRoute(route)
    }
  }
  async use(plugin: GalbePlugin) {
    this.plugins.push(plugin)
  }
  async listen(port?: number) {
    port = port || this.config?.port || 3000
    this.config.port = port
    if (this.listening) this.stop()
    if (Bun.env.BUN_ENV === 'development') {
      this.#prepare = true
      console.log('🏗️  \x1b[1;30mConstructing routes\x1b[0m')
      for (const r of indexRoutes) logRoute(r)
      await defineRoutes(this.config || {}, this)
      console.log('\n✅ \x1b[1;30mdone\x1b[0m')
      this.server = await server(this, port)
      const url = `http://localhost:${port}${this.config?.basePath || ''}`
      console.log(`\n\x1b[1;30m🚀 API running at\x1b[0m \x1b[4;34m${url}\x1b[0m`)
    } else {
      this.server = await server(this, port)
    }
    this.listening = true
    this.#prepare = false
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
    H extends STHeaders,
    P extends Partial<STParams<Path>>,
    Q extends STQuery,
    B extends STBody
  >(
    path: Path,
    arg2:
      | RequestSchema<Path, H, P, Q, B>
      | Hook<Path, RequestSchema<Path, H, P, Q, B>>[]
      | Handler<Path, RequestSchema<Path, H, P, Q, B>>,
    arg3?: Hook<Path, RequestSchema<Path, H, P, Q, B>>[] | Handler<Path, RequestSchema<Path, H, P, Q, B>>,
    arg4?: Handler<Path, RequestSchema<Path, H, P, Q, B>>
  ) => this.add(overloadDiscriminer(this, 'get', path, arg2, arg3, arg4))
  post: Endpoint = <
    Path extends string,
    H extends STHeaders,
    P extends Partial<STParams<Path>>,
    Q extends STQuery,
    B extends STBody
  >(
    path: Path,
    arg2:
      | RequestSchema<Path, H, P, Q, B>
      | Hook<Path, RequestSchema<Path, H, P, Q, B>>[]
      | Handler<Path, RequestSchema<Path, H, P, Q, B>>,
    arg3?: Hook<Path, RequestSchema<Path, H, P, Q, B>>[] | Handler<Path, RequestSchema<Path, H, P, Q, B>>,
    arg4?: Handler<Path, RequestSchema<Path, H, P, Q, B>>
  ) => this.add(overloadDiscriminer(this, 'post', path, arg2, arg3, arg4))
  put: Endpoint = <
    Path extends string,
    H extends STHeaders,
    P extends Partial<STParams<Path>>,
    Q extends STQuery,
    B extends STBody
  >(
    path: Path,
    arg2:
      | RequestSchema<Path, H, P, Q, B>
      | Hook<Path, RequestSchema<Path, H, P, Q, B>>[]
      | Handler<Path, RequestSchema<Path, H, P, Q, B>>,
    arg3?: Hook<Path, RequestSchema<Path, H, P, Q, B>>[] | Handler<Path, RequestSchema<Path, H, P, Q, B>>,
    arg4?: Handler<Path, RequestSchema<Path, H, P, Q, B>>
  ) => this.add(overloadDiscriminer(this, 'put', path, arg2, arg3, arg4))
  patch: Endpoint = <
    Path extends string,
    H extends STHeaders,
    P extends Partial<STParams<Path>>,
    Q extends STQuery,
    B extends STBody
  >(
    path: Path,
    arg2:
      | RequestSchema<Path, H, P, Q, B>
      | Hook<Path, RequestSchema<Path, H, P, Q, B>>[]
      | Handler<Path, RequestSchema<Path, H, P, Q, B>>,
    arg3?: Hook<Path, RequestSchema<Path, H, P, Q, B>>[] | Handler<Path, RequestSchema<Path, H, P, Q, B>>,
    arg4?: Handler<Path, RequestSchema<Path, H, P, Q, B>>
  ) => this.add(overloadDiscriminer(this, 'patch', path, arg2, arg3, arg4))
  delete: Endpoint = <
    Path extends string,
    H extends STHeaders,
    P extends Partial<STParams<Path>>,
    Q extends STQuery,
    B extends STBody
  >(
    path: Path,
    arg2:
      | RequestSchema<Path, H, P, Q, B>
      | Hook<Path, RequestSchema<Path, H, P, Q, B>>[]
      | Handler<Path, RequestSchema<Path, H, P, Q, B>>,
    arg3?: Hook<Path, RequestSchema<Path, H, P, Q, B>>[] | Handler<Path, RequestSchema<Path, H, P, Q, B>>,
    arg4?: Handler<Path, RequestSchema<Path, H, P, Q, B>>
  ) => this.add(overloadDiscriminer(this, 'delete', path, arg2, arg3, arg4))
  options: Endpoint = <
    Path extends string,
    H extends STHeaders,
    P extends Partial<STParams<Path>>,
    Q extends STQuery,
    B extends STBody
  >(
    path: Path,
    arg2:
      | RequestSchema<Path, H, P, Q, B>
      | Hook<Path, RequestSchema<Path, H, P, Q, B>>[]
      | Handler<Path, RequestSchema<Path, H, P, Q, B>>,
    arg3?: Hook<Path, RequestSchema<Path, H, P, Q, B>>[] | Handler<Path, RequestSchema<Path, H, P, Q, B>>,
    arg4?: Handler<Path, RequestSchema<Path, H, P, Q, B>>
  ) => this.add(overloadDiscriminer(this, 'options', path, arg2, arg3, arg4))
}

export * from './types'
