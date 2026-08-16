import type { MiddlewareFileMeta, RouteFileMeta } from './routes'
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
  STQuery,
  STCookies,
  StaticEndpoint,
  Route,
  StaticEndpointOptions,
  GalbeMiddleware,
  MaybeArray,
} from './types'

import { existsSync, readdirSync, statSync } from 'fs'
import { resolve as resolvePath } from 'path'
import server from './server'
import { joinPath, matchMiddleware, parseMiddlewarePattern, walkRoutes } from './util'
import { GalbeRouter } from './router'
import { SchemaType } from './schema'
import { compileRoute } from './validator.compile'

const overloadDiscriminer = <
  M extends Method,
  Path extends string,
  H extends STHeaders,
  P extends Partial<STParams<Path>>,
  Q extends STQuery,
  B extends STBody,
  R extends STResponse,
  C extends STCookies,
>(
  galbe: Galbe,
  method: M,
  path: Path,
  arg2:
    | RequestSchema<M, Path, H, P, Q, B, R, C>
    | Hook<M, Path, RequestSchema<M, Path, H, P, Q, B, R, C>>[]
    | Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R, C>>,
  arg3?:
    | Hook<M, Path, RequestSchema<M, Path, H, P, Q, B, R, C>>[]
    | Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R, C>>,
  arg4?: Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R, C>>
): Route<M, Path, P, H, Q, B, R, C> => {
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
type HookChainState = { handlerCalled: boolean; response: any }

// Compose the hook/handler chain once, at registration: a route's chain is
// immutable after `add()`, so rebuilding it per request is pure allocation
// churn. Per-request semantics are unchanged: fresh `handlerCalled`/`nextCalled`
// state per invocation, `Hook already called - ignored` on a double-next(), a
// truthy hook return short-circuits and becomes the response, and a hook that
// neither called next() nor returned a value triggers an implicit next().
// The composed function resolves to the handler's response (or the
// short-circuit value), starting from '' exactly like the historical chain.
const composeHooks = <M extends Method, Path extends string, S extends RequestSchema>(
  hooks: Hook<M, Path, S>[],
  handler: Handler<M, Path, S>
): ((context: Context<M, Path, S>) => Promise<any>) => {
  // terminal entry: run the handler and settle the response status
  let downstream: (context: Context<M, Path, S>, state: HookChainState) => Promise<any> = async (context, state) => {
    state.handlerCalled = true
    state.response = await handler(context)
    context.set.status = state.response instanceof Response ? state.response.status : context.set.status || 200
  }
  for (let i = hooks.length - 1; i >= 0; i--) {
    const hook = hooks[i]!
    const next = downstream
    downstream = async (context, state) => {
      let nextCalled = false
      const nextFn = async () => {
        if (nextCalled) console.error('Hook already called - ignored')
        else {
          nextCalled = true
          return await next(context, state)
        }
      }
      const r = await hook(context, nextFn)
      if (r) return r
      if (!nextCalled && !state.handlerCalled) return await nextFn()
    }
  }
  const chain = downstream
  return async context => {
    const state: HookChainState = { handlerCalled: false, response: '' }
    const r = await chain(context, state)
    if (r) state.response = r
    return state.response
  }
}

// group prefixes may contain ':params', middleware patterns may not: a param
// segment matches like '*'
const patternFromPath = (path: string) => path.replace(/:[^/]+/g, '*')

const galbeMethod = <
  M extends Method,
  Path extends string,
  H extends STHeaders,
  P extends Partial<STParams<Path>>,
  Q extends STQuery,
  B extends STBody,
  R extends STResponse,
  C extends STCookies,
>(
  _galbe: Galbe,
  method: M,
  path: Path,
  schema: RequestSchema<M, Path, H, P, Q, B, R, C> | undefined,
  hooks: Hook<M, Path, RequestSchema<M, Path, H, P, Q, B, R, C>>[] | undefined,
  handler: Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R, C>>
): Route<M, Path, P, H, Q, B, R, C> => {
  schema = schema ?? {}
  hooks = hooks || []
  return {
    method,
    path,
    schema,
    hooks,
    handler,
    composed: composeHooks(hooks, handler),
  }
}

/** Galbe Schema Type builder. See {@link https://galbe.dev/documentation/schemas#schema-types Schema Types} */
export const $T = new SchemaType()

export { RequestError } from './types'
export type { STResponseContent, STResponseBodyKey, STResponseEntry } from './types'

export const config = (config: GalbeConfig) => config

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
  /** Header metadata of middleware files discovered by the Automatic Route Analyzer. */
  metaMiddleware: Array<MiddlewareFileMeta> = []
  router: GalbeRouter
  startCb: (() => void)[] = []
  stopCb: (() => void)[] = []
  errorCb: ErrorHandler[] = []
  routeAddedCb: ((event: { route: Route }) => void)[] = []
  listening: boolean = false
  server?: Awaited<ReturnType<typeof server>>
  plugins: GalbePlugin[] = []
  middlewares: GalbeMiddleware[] = []
  /** User-supplied `static(path, target)` pairs, recorded so `galbe build` can copy the assets next to the bundle. */
  staticTargets: Array<{ path: string; target: string }> = []
  constructor(config?: GalbeConfig) {
    this.config = config ?? {}
    this.router = new GalbeRouter({
      prefix: this.config?.basePath || '',
      cacheEnabled: this.config?.router?.cacheEnabled,
      cacheLimit: this.config?.router?.cacheLimit,
      warn: this.config?.router?.warn,
    })
  }
  private add(route: any) {
    // schemas are immutable once the route is added: compile their validators now
    if (route?.schema) compileRoute(route.schema)
    this.router.add(route)
    const segments = this.routeSegments(route)
    if (this.middlewares.some(m => matchMiddleware(m.segments, segments))) this.composeMiddleware(route)
    for (const cb of this.routeAddedCb) cb({ route })
    return route
  }
  // route.path carries the basePath prefix once registered: strip it, patterns
  // are written relative to basePath like route paths
  private routeSegments(route: Route): string[] {
    const path = this.router.prefix ? route.path.slice(this.router.prefix.length) : route.path
    return path.split('/').filter(s => s !== '')
  }
  private composeMiddleware(route: Route) {
    const segments = this.routeSegments(route)
    const matched = this.middlewares.filter(m => matchMiddleware(m.segments, segments)).flatMap(m => m.hooks)
    route.composed = composeHooks([...matched, ...route.hooks], route.handler)
  }
  async use(plugin: GalbePlugin) {
    this.plugins.push(plugin)
  }
  /**
   * #### Middleware
   * Register hooks that run for every route whose path matches the given
   * pattern, ahead of the route's own hooks. Pattern segments are literals or
   * `*` (any single segment); a trailing `*` matches the whole subtree,
   * including the prefix itself. Patterns match registered route paths (not
   * request URLs) and are resolved at registration time: matched hooks are
   * composed into the route chain, adding no per-request matching cost.
   *
   * ---
   * @example
   * ```typescript
   * galbe.middleware(logger)              // every route
   * galbe.middleware('/api/*', authHook)  // the /api subtree
   * ```
   */
  middleware(hooks: MaybeArray<Hook>): void
  middleware(pattern: string, hooks: MaybeArray<Hook>): void
  middleware(arg1: string | MaybeArray<Hook>, arg2?: MaybeArray<Hook>): void {
    const pattern = typeof arg1 === 'string' ? arg1 : '*'
    const hooks = typeof arg1 === 'string' ? arg2 : arg1
    const hookList = Array.isArray(hooks) ? hooks : hooks ? [hooks] : []
    if (!hookList.length) return
    const entry = { pattern, segments: parseMiddlewarePattern(pattern), hooks: hookList }
    this.middlewares.push(entry)
    // routes registered before this call: recompose the ones the new entry matches
    walkRoutes(this.router.routes, route => {
      if (matchMiddleware(entry.segments, this.routeSegments(route))) this.composeMiddleware(route)
    })
  }
  /**
   * #### Route group
   * Register routes under a shared path prefix. Optional hooks apply to the
   * whole `<prefix>/*` subtree — they are prefix middleware, so they also
   * cover matching routes registered outside the group.
   *
   * ---
   * @example
   * ```typescript
   * galbe.group('/v1', [authHook], g => {
   *   g.get('/users', listUsers)      // GET /v1/users
   *   g.group('/admin', a => { ... }) // /v1/admin/...
   * })
   * ```
   */
  group<P extends string>(prefix: P, cb: (group: GalbeGroup<P>) => void): GalbeGroup<P>
  group<P extends string>(prefix: P, hooks: Hook[], cb: (group: GalbeGroup<P>) => void): GalbeGroup<P>
  group<P extends string>(
    prefix: P,
    arg2: Hook[] | ((group: GalbeGroup<P>) => void),
    arg3?: (group: GalbeGroup<P>) => void
  ): GalbeGroup<P> {
    const cb = typeof arg2 === 'function' ? arg2 : arg3
    if (Array.isArray(arg2) && arg2.length) this.middleware(patternFromPath(joinPath(prefix, '/*')), arg2)
    const group = new GalbeGroup<P>(this, prefix)
    cb?.(group)
    return group
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
  /**
   * #### Route registration event
   * Subscribe to route registrations: the callback fires synchronously for
   * every route added to the router, right after its hook chain is composed,
   * with the final (prefixed) path. Listener errors propagate to the
   * registration site. Returns an unsubscribe function.
   */
  onRouteAdded(callback: (event: { route: Route }) => void): () => void {
    this.routeAddedCb.push(callback)
    return () => {
      const idx = this.routeAddedCb.indexOf(callback)
      if (idx >= 0) this.routeAddedCb.splice(idx, 1)
    }
  }
  get: Endpoint<'get'> = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse,
    C extends STCookies,
  >(
    path: Path,
    arg2:
      | RequestSchema<'get', Path, H, P, Q, B, R, C>
      | Hook<'get', Path, RequestSchema<'get', Path, H, P, Q, B, R, C>>[]
      | Handler<'get', Path, RequestSchema<'get', Path, H, P, Q, B, R, C>>,
    arg3?:
      | Hook<'get', Path, RequestSchema<'get', Path, H, P, Q, B, R, C>>[]
      | Handler<'get', Path, RequestSchema<'get', Path, H, P, Q, B, R, C>>,
    arg4?: Handler<'get', Path, RequestSchema<'get', Path, H, P, Q, B, R, C>>
  ) => this.add(overloadDiscriminer(this, 'get', path, arg2, arg3, arg4))
  post: Endpoint<'post'> = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse,
    C extends STCookies,
  >(
    path: Path,
    arg2:
      | RequestSchema<'post', Path, H, P, Q, B, R, C>
      | Hook<'post', Path, RequestSchema<'post', Path, H, P, Q, B, R, C>>[]
      | Handler<'post', Path, RequestSchema<'post', Path, H, P, Q, B, R, C>>,
    arg3?:
      | Hook<'post', Path, RequestSchema<'post', Path, H, P, Q, B, R, C>>[]
      | Handler<'post', Path, RequestSchema<'post', Path, H, P, Q, B, R, C>>,
    arg4?: Handler<'post', Path, RequestSchema<'post', Path, H, P, Q, B, R, C>>
  ) => this.add(overloadDiscriminer(this, 'post', path, arg2, arg3, arg4))
  put: Endpoint<'put'> = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse,
    C extends STCookies,
  >(
    path: Path,
    arg2:
      | RequestSchema<'put', Path, H, P, Q, B, R, C>
      | Hook<'put', Path, RequestSchema<'put', Path, H, P, Q, B, R, C>>[]
      | Handler<'put', Path, RequestSchema<'put', Path, H, P, Q, B, R, C>>,
    arg3?:
      | Hook<'put', Path, RequestSchema<'put', Path, H, P, Q, B, R, C>>[]
      | Handler<'put', Path, RequestSchema<'put', Path, H, P, Q, B, R, C>>,
    arg4?: Handler<'put', Path, RequestSchema<'put', Path, H, P, Q, B, R, C>>
  ) => this.add(overloadDiscriminer(this, 'put', path, arg2, arg3, arg4))
  patch: Endpoint<'patch'> = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse,
    C extends STCookies,
  >(
    path: Path,
    arg2:
      | RequestSchema<'patch', Path, H, P, Q, B, R, C>
      | Hook<'patch', Path, RequestSchema<'patch', Path, H, P, Q, B, R, C>>[]
      | Handler<'patch', Path, RequestSchema<'patch', Path, H, P, Q, B, R, C>>,
    arg3?:
      | Hook<'patch', Path, RequestSchema<'patch', Path, H, P, Q, B, R, C>>[]
      | Handler<'patch', Path, RequestSchema<'patch', Path, H, P, Q, B, R, C>>,
    arg4?: Handler<'patch', Path, RequestSchema<'patch', Path, H, P, Q, B, R, C>>
  ) => this.add(overloadDiscriminer(this, 'patch', path, arg2, arg3, arg4))
  delete: Endpoint<'delete'> = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse,
    C extends STCookies,
  >(
    path: Path,
    arg2:
      | RequestSchema<'delete', Path, H, P, Q, B, R, C>
      | Hook<'delete', Path, RequestSchema<'delete', Path, H, P, Q, B, R, C>>[]
      | Handler<'delete', Path, RequestSchema<'delete', Path, H, P, Q, B, R, C>>,
    arg3?:
      | Hook<'delete', Path, RequestSchema<'delete', Path, H, P, Q, B, R, C>>[]
      | Handler<'delete', Path, RequestSchema<'delete', Path, H, P, Q, B, R, C>>,
    arg4?: Handler<'delete', Path, RequestSchema<'delete', Path, H, P, Q, B, R, C>>
  ) => this.add(overloadDiscriminer(this, 'delete', path, arg2, arg3, arg4))
  options: Endpoint<'options'> = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse,
    C extends STCookies,
  >(
    path: Path,
    arg2:
      | RequestSchema<'options', Path, H, P, Q, B, R, C>
      | Hook<'options', Path, RequestSchema<'options', Path, H, P, Q, B, R, C>>[]
      | Handler<'options', Path, RequestSchema<'options', Path, H, P, Q, B, R, C>>,
    arg3?:
      | Hook<'options', Path, RequestSchema<'options', Path, H, P, Q, B, R, C>>[]
      | Handler<'options', Path, RequestSchema<'options', Path, H, P, Q, B, R, C>>,
    arg4?: Handler<'options', Path, RequestSchema<'options', Path, H, P, Q, B, R, C>>
  ) => this.add(overloadDiscriminer(this, 'options', path, arg2, arg3, arg4))
  head: Endpoint<'head'> = <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders,
    Q extends STQuery,
    B extends STBody,
    R extends STResponse,
    C extends STCookies,
  >(
    path: Path,
    arg2:
      | RequestSchema<'head', Path, H, P, Q, B, R, C>
      | Hook<'head', Path, RequestSchema<'head', Path, H, P, Q, B, R, C>>[]
      | Handler<'head', Path, RequestSchema<'head', Path, H, P, Q, B, R, C>>,
    arg3?:
      | Hook<'head', Path, RequestSchema<'head', Path, H, P, Q, B, R, C>>[]
      | Handler<'head', Path, RequestSchema<'head', Path, H, P, Q, B, R, C>>,
    arg4?: Handler<'head', Path, RequestSchema<'head', Path, H, P, Q, B, R, C>>
  ) => this.add(overloadDiscriminer(this, 'head', path, arg2, arg3, arg4))
  static: StaticEndpoint = (path: string, target: string, options?: StaticEndpointOptions) => {
    let { resolve } = options ?? {}
    const rootPath = path
    const rootTarget = target
    this.staticTargets.push({ path, target })

    const walkStatic = (path: string, target: string) => {
      path = path?.[0] === '/' ? path : `/${path}`
      path = path.endsWith('/') ? path.slice(0, -1) : path

      let t = target
      if (Bun.env.BUN_ENV === 'production') {
        t = resolvePath(import.meta.dir, `static-${Bun.env.GALBE_BUILD}/${target}`)
      }

      if (!existsSync(t)) throw new Error(`galbe.static('${rootPath}', '${rootTarget}'): target does not exist: ${t}`)

      if (!statSync(t).isDirectory()) {
        let ut: string | null | undefined | void = t
        if (path.endsWith('.html')) path = path.slice(0, -5)
        if (resolve) ut = resolve(path, ut)
        if (ut) {
          let handler = () => new Response(Bun.file(ut))
          const isIndex = /index\.html$/.test(ut)
          this.add({ ...galbeMethod(this, 'get', path, {}, undefined, handler), static: { path: ut, root: rootPath } })
          if (isIndex)
            this.add({
              ...galbeMethod(this, 'get', `${path}/index.html`, {}, undefined, handler),
              static: { path: ut, root: rootPath },
            })
        }
      } else {
        let root = readdirSync(t)
        for (let f of root) {
          let p = f === 'index.html' ? path : `${path}/${f}`
          walkStatic(p, `${target}/${f}`)
        }
      }

      return { ...galbeMethod(this, 'get', path, {}, undefined, () => {}), static: { path: t, root: rootPath } }
    }

    return walkStatic(path, target)
  }
}

/**
 * #### GalbeGroup
 * Route sub-registrar created by {@link Galbe.group}. Paths are prefixed at
 * registration time: router matching and precedence are unchanged, and the
 * prefixed paths flow as-is into the generated OpenAPI spec.
 */
export class GalbeGroup<Prefix extends string = string> {
  #galbe: Galbe
  #prefix: string
  constructor(galbe: Galbe, prefix: string) {
    this.#galbe = galbe
    this.#prefix = joinPath('', prefix).replace(/\/+$/, '')
  }
  #route(method: Method, path: string, args: any[]): any {
    // indexing by a Method union yields a union of Endpoint overload sets, which
    // has no common call signature — the dispatch is checked at the call sites
    return (this.#galbe[method] as (path: string, ...args: any[]) => any)(joinPath(this.#prefix, path), ...args)
  }
  get: Endpoint<'get', Prefix> = (path: any, ...args: any[]): any => this.#route('get', path, args)
  post: Endpoint<'post', Prefix> = (path: any, ...args: any[]): any => this.#route('post', path, args)
  put: Endpoint<'put', Prefix> = (path: any, ...args: any[]): any => this.#route('put', path, args)
  patch: Endpoint<'patch', Prefix> = (path: any, ...args: any[]): any => this.#route('patch', path, args)
  delete: Endpoint<'delete', Prefix> = (path: any, ...args: any[]): any => this.#route('delete', path, args)
  options: Endpoint<'options', Prefix> = (path: any, ...args: any[]): any => this.#route('options', path, args)
  head: Endpoint<'head', Prefix> = (path: any, ...args: any[]): any => this.#route('head', path, args)
  static: StaticEndpoint = (path: any, target: any, options?: any): any =>
    this.#galbe.static(joinPath(this.#prefix, path), target, options)
  /** Register middleware scoped to the group: bare hooks cover the group subtree, patterns are relative to the group prefix. */
  middleware(hooks: MaybeArray<Hook>): void
  middleware(pattern: string, hooks: MaybeArray<Hook>): void
  middleware(arg1: string | MaybeArray<Hook>, arg2?: MaybeArray<Hook>): void {
    const prefix = patternFromPath(this.#prefix)
    if (typeof arg1 === 'string') this.#galbe.middleware(joinPath(prefix, arg1), arg2!)
    else this.#galbe.middleware(joinPath(prefix, '/*'), arg1)
  }
  group<P extends string>(prefix: P, cb: (group: GalbeGroup<`${Prefix}${P}`>) => void): GalbeGroup<`${Prefix}${P}`>
  group<P extends string>(
    prefix: P,
    hooks: Hook[],
    cb: (group: GalbeGroup<`${Prefix}${P}`>) => void
  ): GalbeGroup<`${Prefix}${P}`>
  group(prefix: string, arg2: any, arg3?: any): any {
    return this.#galbe.group(joinPath(this.#prefix, prefix), arg2, arg3)
  }
}

export * from './types'
