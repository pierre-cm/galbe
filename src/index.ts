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
  MiddlewareDef,
  MiddlewareSchema,
  PreParseHook,
} from './types'

import { existsSync, readdirSync, statSync } from 'fs'
import { resolve as resolvePath } from 'path'
import server from './server'
import { joinPath, matchMiddleware, mergeMiddlewareSchema, parseMiddlewarePattern, walkRoutes } from './util'
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

// The pre-parse slot is a sequence, not an onion: no next(), each hook either
// returns a Response — which short-circuits the request before a byte of body
// is read — or falls through to the next one. Composed once at registration,
// alongside the hook chain; undefined when the slot is empty so the request
// path can skip it outright.
const composePreParse = (hooks: PreParseHook[]): Route['composedPre'] => {
  if (!hooks.length) return undefined
  return async context => {
    for (const hook of hooks) {
      const r = await hook(context)
      if (r) return r
    }
  }
}

// group prefixes may contain ':params', middleware patterns may not: a param
// segment matches like '*'
const patternFromPath = (path: string) => path.replace(/:[^/]+/g, '*')

// a bare hook (or hook array) is sugar for { hooks }
const toMiddlewareDef = (arg?: MaybeArray<Hook> | MiddlewareDef): Omit<GalbeMiddleware, 'pattern' | 'segments'> => {
  const def: MiddlewareDef = typeof arg === 'function' || Array.isArray(arg) ? { hooks: arg } : (arg ?? {})
  if (def.afterHandle) console.warn("middleware: 'afterHandle' is a reserved slot name and is not run yet")
  return {
    beforeParse: def.beforeParse ? [def.beforeParse].flat() : [],
    hooks: def.hooks ? [def.hooks].flat() : [],
    schema: def.schema,
    security: def.security,
    securitySchemes: def.securitySchemes,
  }
}

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
 * #### Middleware
 * Define a middleware as a value: hooks, the request contract they impose, and
 * the security scheme they enforce, in one exportable thing. Identity at
 * runtime — it exists so the `schema` fragment types the def's own handlers,
 * which a bare object literal cannot do.
 *
 * ---
 * @example
 * ```typescript
 * // src/api/tenant.middleware.ts — the directory is the scope
 * export default middleware({
 *   schema: { headers: { 'x-tenant-id': $T.string() } },
 *   hooks: ctx => {
 *     ctx.state.tenant = ctx.headers['x-tenant-id'] // string
 *   }
 * })
 * ```
 */
export const middleware = <F extends MiddlewareSchema>(def: MiddlewareDef<F>): MiddlewareDef<F> => def

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
    const matched = this.middlewares.filter(m => matchMiddleware(m.segments, segments))
    // merged fragments bring in schemas that were never compiled; compile()
    // caches per schema object, so only the new ones are built
    if (mergeMiddlewareSchema(route, matched)) compileRoute(route.schema)
    route.composed = composeHooks([...matched.flatMap(m => m.hooks), ...route.hooks], route.handler)
    route.composedPre = composePreParse(matched.flatMap(m => m.beforeParse))
  }
  async use(plugin: GalbePlugin) {
    this.plugins.push(plugin)
  }
  /**
   * #### Middleware
   * Register hooks — or a {@link MiddlewareDef} — that apply to every route
   * whose path matches the given pattern, ahead of the route's own hooks.
   * Pattern segments are literals or `*` (any single segment); a trailing `*`
   * matches the whole subtree, including the prefix itself. Patterns match
   * registered route paths (not request URLs) and are resolved at registration
   * time: matched hooks are composed into the route chain and the def's schema
   * fragment is merged into the route schema, adding no per-request cost.
   *
   * ---
   * @example
   * ```typescript
   * galbe.middleware(logger)              // every route
   * galbe.middleware('/api/*', authHook)  // the /api subtree
   * galbe.middleware('/api/*', middleware({ schema: { headers: { authorization: $T.string() } }, hooks: authHook }))
   * ```
   */
  middleware(hooks: MaybeArray<Hook>): void
  middleware<F extends MiddlewareSchema>(def: MiddlewareDef<F>): void
  middleware(pattern: string, hooks: MaybeArray<Hook>): void
  middleware<F extends MiddlewareSchema>(pattern: string, def: MiddlewareDef<F>): void
  middleware(arg1: string | MaybeArray<Hook> | MiddlewareDef, arg2?: MaybeArray<Hook> | MiddlewareDef): void {
    const pattern = typeof arg1 === 'string' ? arg1 : '*'
    const def = toMiddlewareDef(typeof arg1 === 'string' ? arg2 : arg1)
    if (!def.hooks.length && !def.beforeParse.length && !def.schema && !def.security && !def.securitySchemes) return
    const entry = { pattern, segments: parseMiddlewarePattern(pattern), ...def }
    this.middlewares.push(entry)
    // routes registered before this call: recompose the ones the new entry matches
    walkRoutes(this.router.routes, route => {
      if (matchMiddleware(entry.segments, this.routeSegments(route))) this.composeMiddleware(route)
    })
  }
  /**
   * #### Route group
   * Register routes under a shared path prefix. Optional hooks — or a
   * middleware def — apply to the whole `<prefix>/*` subtree: they are prefix
   * middleware, so they also cover matching routes registered outside the
   * group. A def's schema fragment types the routes registered through the
   * group registrar, on top of merging into their schemas.
   *
   * ---
   * @example
   * ```typescript
   * galbe.group('/v1', [authHook], g => {
   *   g.get('/users', listUsers)      // GET /v1/users
   *   g.group('/admin', a => { ... }) // /v1/admin/...
   * })
   *
   * galbe.group('/v1', middleware({ schema: { headers: { authorization: $T.string() } } }), g => {
   *   g.get('/users', ctx => ctx.headers.authorization) // string
   * })
   * ```
   */
  group<P extends string>(prefix: P, cb: (group: GalbeGroup<P>) => void): GalbeGroup<P>
  group<P extends string>(prefix: P, hooks: Hook[], cb: (group: GalbeGroup<P>) => void): GalbeGroup<P>
  group<P extends string, F extends MiddlewareSchema>(
    prefix: P,
    def: MiddlewareDef<F>,
    cb: (group: GalbeGroup<P, F>) => void
  ): GalbeGroup<P, F>
  group(prefix: string, arg2: any, arg3?: any): any {
    const cb = typeof arg2 === 'function' ? arg2 : arg3
    const scoped = Array.isArray(arg2) ? arg2.length > 0 : !!arg2 && typeof arg2 === 'object'
    if (scoped) this.middleware(patternFromPath(joinPath(prefix, '/*')), arg2)
    const group = new GalbeGroup(this, prefix)
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
 * prefixed paths flow as-is into the generated OpenAPI spec. `F` carries the
 * schema fragment of the group's middleware def, so routes registered here are
 * typed with it — route-declared keys win, as they do at runtime.
 */
export class GalbeGroup<Prefix extends string = string, F extends MiddlewareSchema = {}> {
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
  get: Endpoint<'get', Prefix, F> = (path: any, ...args: any[]): any => this.#route('get', path, args)
  post: Endpoint<'post', Prefix, F> = (path: any, ...args: any[]): any => this.#route('post', path, args)
  put: Endpoint<'put', Prefix, F> = (path: any, ...args: any[]): any => this.#route('put', path, args)
  patch: Endpoint<'patch', Prefix, F> = (path: any, ...args: any[]): any => this.#route('patch', path, args)
  delete: Endpoint<'delete', Prefix, F> = (path: any, ...args: any[]): any => this.#route('delete', path, args)
  options: Endpoint<'options', Prefix, F> = (path: any, ...args: any[]): any => this.#route('options', path, args)
  head: Endpoint<'head', Prefix, F> = (path: any, ...args: any[]): any => this.#route('head', path, args)
  static: StaticEndpoint = (path: any, target: any, options?: any): any =>
    this.#galbe.static(joinPath(this.#prefix, path), target, options)
  /**
   * Register middleware scoped to the group: bare hooks or a def cover the
   * group subtree, patterns are relative to the group prefix. The fragment is
   * merged and validated, but only `group(prefix, def, cb)` can type the
   * routes — a mutating call has no value to carry the type on.
   */
  middleware(hooks: MaybeArray<Hook>): void
  middleware<G extends MiddlewareSchema>(def: MiddlewareDef<G>): void
  middleware(pattern: string, hooks: MaybeArray<Hook>): void
  middleware<G extends MiddlewareSchema>(pattern: string, def: MiddlewareDef<G>): void
  middleware(arg1: string | MaybeArray<Hook> | MiddlewareDef, arg2?: MaybeArray<Hook> | MiddlewareDef): void {
    const prefix = patternFromPath(this.#prefix)
    // the overloads discriminate hooks from defs; the implementation forwards the union
    const scope = typeof arg1 === 'string' ? joinPath(prefix, arg1) : joinPath(prefix, '/*')
    this.#galbe.middleware(scope, (typeof arg1 === 'string' ? arg2! : arg1) as MaybeArray<Hook>)
  }
  group<P extends string>(
    prefix: P,
    cb: (group: GalbeGroup<`${Prefix}${P}`, F>) => void
  ): GalbeGroup<`${Prefix}${P}`, F>
  group<P extends string>(
    prefix: P,
    hooks: Hook[],
    cb: (group: GalbeGroup<`${Prefix}${P}`, F>) => void
  ): GalbeGroup<`${Prefix}${P}`, F>
  // nested defs stack: the inner fragment merges over the outer one
  group<P extends string, G extends MiddlewareSchema>(
    prefix: P,
    def: MiddlewareDef<G>,
    cb: (group: GalbeGroup<`${Prefix}${P}`, F & G>) => void
  ): GalbeGroup<`${Prefix}${P}`, F & G>
  group(prefix: string, arg2: any, arg3?: any): any {
    return this.#galbe.group(joinPath(this.#prefix, prefix), arg2, arg3)
  }
}

export * from './types'
