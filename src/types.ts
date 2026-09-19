import type { SocketAddress, TLSOptions } from 'bun'
import type { OpenAPIV3 } from 'openapi-types'
import type {
  STAny,
  STArray,
  STBoolean,
  STByteArray,
  STInteger,
  STIntersection,
  STJson,
  STLiteral,
  STMultipartForm,
  STNull,
  STNumber,
  STObject,
  STOptional,
  STSchema,
  STStream,
  STString,
  STUnion,
  Static,
} from './schema'
import type { Galbe } from './index'
import { HttpStatus } from './util'
import type { CookieOptions } from './cookies'

export type MediaType = `${string}/${string}`

export type STResponseValue =
  | STByteArray
  | STString
  | STBoolean
  | STNumber
  | STInteger
  | STLiteral
  | STObject
  | STJson
  | STArray
  | STUnion
  | STIntersection<any>
  | STStream
  | STAny
  | STNull

export type STBodyValue =
  | STByteArray
  | STStream
  | STString
  | STLiteral
  | STBoolean
  | STNumber
  | STInteger
  | STObject
  | STJson
  | STArray
  | STUnion
  | STIntersection<any>
  | STMultipartForm
  | STAny

export type STBodyContent = Partial<Record<MediaType, STBodyValue>>
export type STBody = STNull | STBodyContent
/**
 * Metadata a request body may carry beside its media types — describing the
 * body itself rather than any one of its schemas. Kept out of `STBodyContent`
 * on purpose: `Context` maps over the body's keys to derive `contentType`, so
 * anything intersected there would surface as a bogus content type. `MediaType`
 * is a `${string}/${string}` pattern, so these keys never collide with a body.
 */
export type STBodyMeta = {
  /** Describes the request body itself, as opposed to any one of its schemas. */
  description?: string
  /** Whether the request body is required. Inferred from the schemas when unset. */
  required?: boolean
  /**
   * Names the `components.requestBodies` entry this body came from, so spec
   * generators can emit it once and `$ref` it. Set by `galbe generate code`.
   */
  _requestBodyId?: string
}
export type STBodyType = MediaType

export type STResponseBodyValue =
  | STByteArray
  | STStream
  | STString
  | STLiteral
  | STBoolean
  | STNumber
  | STInteger
  | STObject
  | STJson
  | STArray
  | STUnion
  | STIntersection<any>
  | STAny
  | STNull

export type STResponseContent = Partial<Record<MediaType, STResponseBodyValue>> & {
  description?: string
  responseHeaders?: Record<string, STSchema>
  /** The OpenAPI `links` object for this response, carried verbatim. Documentation only. */
  responseLinks?: Record<string, any>
  /** A single example, applied to every media type this response offers. */
  example?: any
  /** Named examples (OpenAPI `examples`), applied to every media type offered. */
  examples?: Record<string, any>
  /**
   * Names the `components.responses` entry this response came from, so spec
   * generators can emit it once and `$ref` it. Set by `galbe generate code`.
   */
  _responseId?: string
}
export type STResponseBodyKey = MediaType
export type STResponseEntry = STResponseValue | STResponseContent
/**
 * A wildcard status range, spelled as in OpenAPI: `'4XX'` covers every 4xx
 * status. An exact status always wins over the range that contains it, which
 * in turn wins over `'default'` — for response validation, for the content
 * type inferred on a string response, and for the generated spec alike.
 */
export type STResponseRange = '1XX' | '2XX' | '3XX' | '4XX' | '5XX'
export type STResponse = Partial<Record<number | STResponseRange | 'default', STResponseEntry>>

export type MaybeArray<T> = T | T[]
export type MaybeSTArray<T extends STSchema> = T | STArray<T>
export type MaybeSTUnion<T extends STSchema> = T | STUnion<[T, ...T[]]>

export type Method = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head'
type MaybePromise<T> = T | Promise<T>

export type ExtractParams<T extends string> = T extends `/:${infer P}/${infer Rest}`
  ? P | ExtractParams<Rest>
  : T extends `${infer _}:${infer P}/${infer Rest}`
    ? P | ExtractParams<Rest>
    : T extends `${infer _}:${infer P}`
      ? P
      : never

type STHeadersPrimaryValue = STString | STBoolean | STNumber | STInteger | STLiteral
type STHeadersValue = MaybeSTUnion<STHeadersPrimaryValue>
export type STHeaders = Record<string, STHeadersValue>

type STParamsPrimaryValue = STString | STBoolean | STNumber | STInteger | STLiteral
type STParamsValue = MaybeSTUnion<STParamsPrimaryValue>
export type STParams<Path extends string = string> = Record<ExtractParams<Path>, STParamsValue>

type STQueryPrimaryValue = STString | STBoolean | STNumber | STInteger | STLiteral
// An object query parameter is OpenAPI's `deepObject`: `?filter[lat]=1&filter[lon]=2`.
// A JSON-encoded value is accepted for it too.
type STQueryValue = MaybeSTArray<MaybeSTUnion<STQueryPrimaryValue>> | STObject
export type STQuery = Record<string, STQueryValue>

// A cookie arrives as one string; like headers and query params it is parsed
// into the declared primitive, so the same value shapes apply.
type STCookiesPrimaryValue = STString | STBoolean | STNumber | STInteger | STLiteral
type STCookiesValue = MaybeSTUnion<STCookiesPrimaryValue>
export type STCookies = Record<string, STCookiesValue>

/**
 * #### GalbeConfig
 * Instanciate a Galbe web server
 *
 * ---
 * @example
 * ```typescript
 * import { Galbe } from 'galbe'
 * const config : GalbeConfig = {
 *   port: 8080,
 *   basePath: "/v1",
 *   routes: "src/**­/*.route.ts"
 * }
 *
 * export default new Galbe(config)
 * ```
 */
/**
 * #### OpenAPIConfig
 * Customize the top-level document fields (`info`, `servers`) of the OpenAPI
 * specification produced by `OpenAPISerializer` (`galbe/extras`).
 *
 * Explicit values set here take precedence over the package.json inference
 * applied by `galbe generate spec`, which itself takes precedence over the
 * built-in defaults (`title: 'Galbe app'`, `version: '0.1.0'`).
 */
export type OpenAPIConfig = {
  /** Overrides for the spec's `info` object (`title`, `version`, `description`, `contact`, `license`, `termsOfService`). Defaults to `{ title: 'Galbe app', version: '0.1.0' }`. */
  info?: Partial<OpenAPIV3.InfoObject>
  /** The spec's `servers` list. Unset by default. */
  servers?: OpenAPIV3.ServerObject[]
  /**
   * The spec's `components.securitySchemes`. Route-level `@security <name>` tags
   * name a scheme; this is where the scheme itself is defined. A scheme declared
   * here always wins over the `bearerAuth` the serializer infers from an
   * `Authorization: Bearer` header.
   */
  securitySchemes?: Record<string, OpenAPIV3.SecuritySchemeObject | OpenAPIV3.ReferenceObject>
  /** The document's `externalDocs`. Route-level docs come from the `@externalDocs` tag instead. */
  externalDocs?: OpenAPIV3.ExternalDocumentationObject
  /**
   * The document's `tags` list — the descriptions behind the names operations
   * use. Operations name their tags through `@tags`; this is where a tag is
   * described.
   */
  tags?: OpenAPIV3.TagObject[]
  /**
   * The document-level `security` requirement, applied to every operation that
   * does not declare its own through `@security`.
   */
  security?: OpenAPIV3.SecurityRequirementObject[]
}

export type GalbeConfig = {
  /** The port number that the server will be listening on. */
  port?: number
  /** Allow to share the same port across processes (Linux only). */
  reusePort?: boolean
  /** The hostname of the server. */
  hostname?: string
  /** The base path is added as a prefix to all the routes created. */
  basePath?: string
  /** Enable or disable TLS support. */
  tls?: TLSOptions
  /**
   * How many hops in front of the app are yours, so `ctx.clientAddress` can be resolved from
   * `X-Forwarded-For`: a hop count, or the addresses/CIDR ranges your proxies connect from.
   * Default `false` — the header is ignored entirely and the client is the socket peer. Set it
   * to match the real topology: too high is a spoofing hole, too low buckets every client together.
   */
  trustProxy?: false | number | string[]
  /** Extra options passed through to `Bun.serve` (e.g. `maxRequestBodySize`, `idleTimeout`). `port`, `fetch` and `error` are ignored, and the dedicated `hostname`, `reusePort` and `tls` config keys take precedence. */
  server?: Partial<Omit<Parameters<typeof Bun.serve>[0], 'port' | 'fetch' | 'error'>> | TLSOptions
  /**
   * Route files picked up by the Automatic Route Analyzer: a glob pattern (or list of), `false` to
   * disable the analyzer, or an object form to also control directory groups. By default a route
   * file's directory relative to its glob's static base becomes its path prefix
   * (`src/api/users.route.ts` → `/api`); set `dirPrefix: false` to opt out.
   */
  routes?: boolean | string | string[] | { pattern?: string | string[]; dirPrefix?: boolean }
  /**
   * Middleware files discovered by the Automatic Route Analyzer (default `src/**­/*.middleware.{js,ts}`).
   * Files default-export `Hook | Hook[] | MiddlewareDef`, scoped to their directory subtree. `false`
   * disables middleware discovery only; `routes: false` disables the whole analyzer.
   */
  middleware?: boolean | string | string[]
  router?: { cacheEnabled: boolean; cacheLimit?: number; warn?: (message: string) => void }
  /** A property that can be used by plugins to add plugin's specific configuration. */
  plugin?: Record<string, any>
  /** Enable or disable the request schema validation.*/
  requestValidator?: { enabled: boolean }
  /** Enable or disable the response schema validation.*/
  responseValidator?: { enabled: boolean }
  /** Maximum request body size in bytes; larger bodies are rejected with a 413 error. Can be overridden per route with the schema's `bodyLimit`. Unset by default: only Bun's `maxRequestBodySize` (128 MB, see `server`) applies. */
  bodyLimit?: number
  /** Customize the document-level blocks (`info`, `servers`, `tags`, `security`, `externalDocs`, `securitySchemes`) of the OpenAPI spec generated by `OpenAPISerializer` (`galbe/extras`). */
  openapi?: OpenAPIConfig
}
/**
 * #### Schema
 * Define a request Schema with constraint upon
 *
 * ---
 * @example
 * ```typescript
 * import { $T } from 'galbe'
 * const MyRequestSchema = {
 *   params: {
 *    id: $T.number(),
 *   },
 *   body: $T.object({
 *     name: $T.string()
 *     age: $T.optional($T.number({min: 0})),
 *   })
 * }
 * ```
 */
export type RequestSchema<
  M extends Method = Method,
  Path extends string = string,
  H extends STHeaders = STHeaders,
  P extends Partial<STParams<Path>> = Partial<STParams<Path>>,
  Q extends STQuery = STQuery,
  B extends STBody = STBody,
  R extends Partial<STResponse> = STResponse,
  C extends STCookies = STCookies,
> = {
  headers?: H
  params?: P
  query?: Q
  /**
   * Declares the request cookies. Each one is parsed out of the `Cookie` header
   * and validated like a query parameter, so `ctx.cookies` comes back typed and
   * coerced. Undeclared cookies are still present, as strings.
   */
  cookies?: C
  body?: B
  response?: R
  /** Maximum request body size in bytes for this route; overrides the global `bodyLimit` config. Larger bodies are rejected with a 413 error. */
  bodyLimit?: number
}

/** The route's declared path params, with the `params?:` optionality peeled off. */
type STParamsOf<S extends RequestSchema> = Exclude<S['params'], undefined>
/** What `params` infers to, before the not-declared keys are dropped. */
type StaticParams<S extends RequestSchema> = Static<STObject<STParamsOf<S>>>
/**
 * The declared params, minus the ones the schema itself marks optional
 * (`params: { id?: $T.integer() }`) — those fall back to `string` in the
 * context, like an undeclared param. `keyof StaticParams<S>` is `keyof
 * STParamsOf<S>` by construction, so the `K extends keyof` guard on the value
 * only exists to keep the indexed access provable while `S` is still generic.
 */
type OmitNotDefined<S extends RequestSchema> = {
  [
    K in keyof STParamsOf<S> as STParamsOf<S>[K] extends Required<STParamsOf<S>>[K] ? K : never
  ]: K extends keyof StaticParams<S> ? StaticParams<S>[K] : never
}
type StaticBody<T extends STSchema> = T extends STOptional<STSchema> ? Static<T> | null : Static<T>
export type ContextSet = {
  headers: {
    'set-cookie': string[]
    [header: string]: string | string[]
  }
  status?: number
  cookie: (name: string, value: string, opt?: CookieOptions) => void
}
/** Methods whose request carries no body: `contentType` and `body` collapse regardless of the schema. */
type EmptyBodyMethod = 'get' | 'options' | 'head'
/**
 * `Fallback` when `T` is `any`, `T` otherwise — the `0 extends 1 & T` trick,
 * which only ever holds for `any`. A route registered without a body schema
 * leaves `B` at its `any` default, and `keyof any` is `string | number |
 * symbol`: mapping over it would type `ctx.contentType` as `string` instead of
 * a media type. Falling back to the `STBody` constraint types such a route
 * exactly like the unparameterized {@link Context}, which is also what keeps a
 * shared `(ctx: Context) => …` handler assignable to every route.
 */
type IfAny<T, Fallback> = 0 extends 1 & T ? Fallback : T
/** The declared body's media-type map. `never` when the route declares no body, or declares `$T.null()`. */
type STBodyOf<S extends RequestSchema> = Exclude<IfAny<S['body'], STBody>, undefined | STNull>
/**
 * `contentType` and `body` are the only two context fields the request's media
 * type reaches, so they are the only ones derived per media type: one member
 * per key of the body map, which is what makes `ctx.contentType` a discriminant
 * for `ctx.body`. Everything else lives in the single object literal below.
 */
type ContextBody<M extends Method, S extends RequestSchema> = [STBodyOf<S>] extends [never]
  ? { contentType: undefined; body: null }
  : {
      [K in keyof STBodyOf<S>]: {
        contentType: M extends EmptyBodyMethod ? undefined : K
        body: M extends EmptyBodyMethod ? null : StaticBody<Extract<Exclude<STBodyOf<S>[K], undefined>, STSchema>>
      }
    }[keyof STBodyOf<S>]
/**
 * The context shape, written once. `B` is a naked type parameter so the
 * conditional distributes over {@link ContextBody}'s union — one context per
 * media type — and resolves to a bare object literal, which is what keeps
 * `ctx` hovering as its expanded shape rather than as an alias reference.
 */
type ContextOf<Path extends string, S extends RequestSchema, B> = B extends {
  contentType: infer CT
  body: infer Body
}
  ? {
      headers: Static<STObject<Exclude<S['headers'], undefined>>>
      params: {
        [P in ExtractParams<Path>]: P extends keyof OmitNotDefined<S> ? OmitNotDefined<S>[P] : string
      }
      query: Static<STObject<Exclude<S['query'], undefined>>>
      contentType: CT
      body: Body
      request: Request
      remoteAddress: SocketAddress | null
      clientAddress: string | null
      route?: Route
      state: Record<string, any>
      set: ContextSet
      cookies: Static<STObject<Exclude<S['cookies'], undefined>>>
    }
  : never
export type Context<
  M extends Method = Method,
  Path extends string = string,
  S extends RequestSchema = RequestSchema,
> = ContextOf<Path, S, ContextBody<M, S>>
export type Next = () => void | Promise<any>
export type Hook<M extends Method = Method, Path extends string = string, S extends RequestSchema = RequestSchema> = (
  ctx: Context<M, Path, S>,
  next: Next
) => any | Promise<any>
export type Handler<
  M extends Method = Method,
  Path extends string = string,
  S extends RequestSchema = RequestSchema,
> = (ctx: Context<M, Path, S>) => any
/** Request contract a middleware imposes, merged into the schema of every route it matches. */
export type MiddlewareSchema = Pick<RequestSchema, 'headers' | 'query' | 'params'>
type IsAny<T> = 0 extends 1 & T ? true : false
type FragHeaders<F extends MiddlewareSchema> = F['headers'] extends STHeaders ? F['headers'] : {}
type FragQuery<F extends MiddlewareSchema> = F['query'] extends STQuery ? F['query'] : {}
/**
 * Fragment keys merged under route-declared ones — route wins, as at runtime.
 * A route that declares no schema of its own keeps today's permissive `any`
 * when there is no fragment, and gets exactly the fragment's keys when there is.
 */
type MergeFragment<Frag, Declared> = [keyof Frag] extends [never]
  ? Declared
  : IsAny<Declared> extends true
    ? Frag
    : Omit<Frag, keyof Declared> & Declared
/** The request schema a fragment implies for the middleware's own hooks. */
type FragmentRequest<F extends MiddlewareSchema> = RequestSchema<Method, string, FragHeaders<F>, {}, FragQuery<F>>
/**
 * The context a {@link PreParseHook} receives. It deliberately lacks `body`,
 * `params` and the parsed `query`: none of them exist yet at that point. Raw
 * headers and search params remain reachable through `ctx.request`.
 */
export type PreParseContext = Pick<
  Context,
  'request' | 'set' | 'state' | 'route' | 'cookies' | 'remoteAddress' | 'clientAddress'
>
/**
 * A `beforeParse` hook: runs once the route is known but before the body is
 * read or the request validated. No `next()` — hooks run sequentially and
 * short-circuit by returning a `Response`, like a plugin's `onRoute`.
 */
export type PreParseHook = (ctx: PreParseContext) => MaybePromise<Response | void>
/**
 * A route-scoped response hook — the `afterHandle` slot. It runs once the
 * request has a `Response`, whatever it ended on, and transforms it: return a
 * `Response` to replace it, return nothing to keep it. Not an onion — by the
 * time a `Response` exists the hook chain has unwound, so there is nothing left
 * to wrap. `error` is what the request ended on, and is `undefined` on success.
 */
export type ResponseHook = (response: Response, ctx: Context, error?: unknown) => MaybePromise<Response | void>
/**
 * #### MiddlewareDef
 * Middleware as a value: the hooks to run, plus the request contract they
 * impose. Accepted everywhere a hook is — `galbe.middleware`, `group.middleware`
 * and middleware files — so a packaged middleware is one exportable thing.
 *
 * The `schema` fragment types the def's own `hooks`: declaring a header means
 * reading it back typed, with no annotation. Wrap the def in `middleware()` to
 * get that inference — a bare object literal has nothing to contextually type
 * its handlers against.
 *
 * ---
 * @example
 * ```typescript
 * galbe.middleware('/api/*', middleware({
 *   schema: { headers: { authorization: $T.string() } },
 *   hooks: ctx => { ctx.headers.authorization }, // string
 *   security: 'bearerAuth',
 *   securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }
 * }))
 * ```
 */
export type MiddlewareDef<F extends MiddlewareSchema = any> = {
  /**
   * Hooks run on every matched route after routing and before the body is
   * parsed — the point where auth or rate limiting can reject a request
   * without reading it. See {@link PreParseHook}.
   */
  beforeParse?: MaybeArray<PreParseHook>
  /** Hooks composed into the chain of every matched route, ahead of the route's own hooks. */
  hooks?: MaybeArray<Hook<Method, string, FragmentRequest<F>>>
  /**
   * Hooks run on every matched route once its response is parsed — on success
   * and on failure alike, the error response included — ahead of the plugins'
   * `afterHandle`. They transform the `Response`. See {@link ResponseHook}.
   */
  afterHandle?: MaybeArray<ResponseHook>
  /**
   * Headers, query and params the hooks require, merged into matched routes.
   * Route-declared keys win. `params` is merged and validated at runtime but
   * cannot type the hooks: a middleware pattern is not a typed route path.
   */
  schema?: F
  /**
   * OpenAPI security scheme name(s) enforced by the hooks, applied to every
   * matched operation exactly like a middleware file's `@security` header.
   * Scopes follow the name, space-separated (`'oauth2 read write'`); `'none'`
   * documents the scope as public. Metadata only — never affects runtime.
   */
  security?: string | string[]
  /**
   * Definitions for the schemes {@link MiddlewareDef.security} names, merged
   * into `components.securitySchemes`. A packaged middleware that is not bearer
   * auth needs this: `apiKey` and `basic` cannot be expressed by a name alone.
   * Same shape as `config.openapi.securitySchemes`, which wins on conflict.
   */
  securitySchemes?: Record<string, OpenAPIV3.SecuritySchemeObject | OpenAPIV3.ReferenceObject>
}
/**
 * Prefix middleware entry registered via `galbe.middleware`. Patterns match
 * registered route paths (not request URLs) and are resolved at registration:
 * matched hooks are composed into the route's hook chain and the schema
 * fragment is merged into the route's schema.
 */
export type GalbeMiddleware = {
  /** the pattern as registered, e.g. `/api/*` */
  pattern: string
  /** pattern split into segments, precomputed at registration */
  segments: string[]
  beforeParse: PreParseHook[]
  hooks: Hook[]
  afterHandle: ResponseHook[]
  schema?: MiddlewareSchema
  security?: string | string[]
  securitySchemes?: Record<string, OpenAPIV3.SecuritySchemeObject | OpenAPIV3.ReferenceObject>
}
// Prefix is prepended to Path at the type level (route groups): context params,
// schemas and the returned Route are typed against the full, joined path. F is
// the schema fragment of the group's middleware def, merged under the route's
// own declarations so handlers read fragment-declared entries typed.
export type Endpoint<M extends Method, Prefix extends string = '', F extends MiddlewareSchema = {}> = {
  <
    Path extends string,
    P extends Partial<STParams<`${Prefix}${Path}`>>,
    H extends STHeaders = any,
    Q extends STQuery = any,
    B extends STBody = any,
    R extends STResponse = STResponse,
    C extends STCookies = any,
    MH extends STHeaders = MergeFragment<FragHeaders<F>, H>,
    MQ extends STQuery = MergeFragment<FragQuery<F>, Q>,
  >(
    path: Path,
    schema: RequestSchema<M, `${Prefix}${Path}`, H, P, Q, B, R, C>,
    hooks: Hook<M, `${Prefix}${Path}`, RequestSchema<M, `${Prefix}${Path}`, MH, P, MQ, B, R, C>>[],
    handler: Handler<M, `${Prefix}${Path}`, RequestSchema<M, `${Prefix}${Path}`, MH, P, MQ, B, R, C>>
  ): Route<M, `${Prefix}${Path}`, P, MH, MQ, B, R, C>
  <
    Path extends string,
    P extends Partial<STParams<`${Prefix}${Path}`>>,
    H extends STHeaders = any,
    Q extends STQuery = any,
    B extends STBody = any,
    R extends STResponse = STResponse,
    C extends STCookies = any,
    MH extends STHeaders = MergeFragment<FragHeaders<F>, H>,
    MQ extends STQuery = MergeFragment<FragQuery<F>, Q>,
  >(
    path: Path,
    schema: RequestSchema<M, `${Prefix}${Path}`, H, P, Q, B, R, C>,
    handler: Handler<M, `${Prefix}${Path}`, RequestSchema<M, `${Prefix}${Path}`, MH, P, MQ, B, R, C>>
  ): Route<M, `${Prefix}${Path}`, P, MH, MQ, B, R, C>
  <
    Path extends string,
    P extends Partial<STParams<`${Prefix}${Path}`>>,
    H extends STHeaders = any,
    Q extends STQuery = any,
    B extends STBody = any,
    R extends STResponse = STResponse,
    C extends STCookies = any,
    MH extends STHeaders = MergeFragment<FragHeaders<F>, H>,
    MQ extends STQuery = MergeFragment<FragQuery<F>, Q>,
  >(
    path: Path,
    hooks: Hook<M, `${Prefix}${Path}`, RequestSchema<M, `${Prefix}${Path}`, MH, P, MQ, B, R, C>>[],
    handler: Handler<M, `${Prefix}${Path}`, RequestSchema<M, `${Prefix}${Path}`, MH, P, MQ, B, R, C>>
  ): Route<M, `${Prefix}${Path}`, P, MH, MQ, B, R, C>
  <
    Path extends string,
    P extends Partial<STParams<`${Prefix}${Path}`>>,
    H extends STHeaders = any,
    Q extends STQuery = any,
    B extends STBody = any,
    R extends STResponse = STResponse,
    C extends STCookies = any,
    MH extends STHeaders = MergeFragment<FragHeaders<F>, H>,
    MQ extends STQuery = MergeFragment<FragQuery<F>, Q>,
  >(
    path: Path,
    handler: Handler<M, `${Prefix}${Path}`, RequestSchema<M, `${Prefix}${Path}`, MH, P, MQ, B, R, C>>
  ): Route<M, `${Prefix}${Path}`, P, MH, MQ, B, R, C>
}

export type StaticEndpointOptions = {
  resolve?: (path: string, target: string) => string | null | undefined | void
}
export type StaticEndpoint<P extends string = string, T extends string = string> = (
  path: P,
  target: T,
  options?: StaticEndpointOptions
) => Route<'get', P, {}, {}, {}, STBody, STResponse, {}, T>

export class RequestError extends Error {
  status: number
  payload?: any
  headers?: Record<string, string>
  constructor(options: { status?: number; payload?: any; headers?: Record<string, string> } = {}) {
    const status = options.status ?? 400
    const message =
      typeof options.payload === 'string'
        ? options.payload
        : (HttpStatus[status as keyof typeof HttpStatus] ?? 'Request Error')
    super(message)
    this.name = new.target?.name ?? 'RequestError'
    this.status = status
    this.payload = options.payload
    this.headers = options.headers
  }
}

export type ErrorHandler = (error: any, context: Context) => any

export type RouteNode = {
  routes: { [K in Method]?: Route }
  param?: RouteNode
  /** name of the first param registered on this node, e.g. 'id' for /user/:id */
  paramName?: string
  children?: Record<string, RouteNode>
}

export type Route<
  M extends Method = Method,
  Path extends string = string,
  P extends Partial<STParams<Path>> = {},
  H extends STHeaders = STHeaders,
  Q extends STQuery = STQuery,
  B extends STBody = STBody,
  R extends STResponse = STResponse,
  C extends STCookies = STCookies,
  SP extends string = string,
  SR extends string = string,
> = {
  method: M
  path: Path
  schema: RequestSchema<M, Path, H, P, Q, B, R, C>
  hooks: Hook<M, Path, RequestSchema<M, Path, H, P, Q, B, R, C>>[]
  handler: Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R, C>>
  /**
   * Hook/handler chain composed at registration — and recomposed if a later
   * `middleware()` call matches the route — never per request. Runs matched
   * middleware, then the hooks, then the handler and resolves to the handler's
   * response — or a hook's short-circuit value.
   */
  composed: (context: Context<M, Path, RequestSchema<M, Path, H, P, Q, B, R, C>>) => Promise<any>
  /**
   * Matched middleware `beforeParse` hooks, composed at registration like
   * {@link Route.composed}. Left `undefined` when no matched middleware fills
   * the slot, so the request path skips the stage with a single check. Runs
   * after the plugins' `onRoute` and before the body is read; a returned
   * `Response` short-circuits the request.
   */
  composedPre?: (context: PreParseContext) => Promise<Response | void>
  /**
   * Matched middleware `afterHandle` hooks, composed at registration like
   * {@link Route.composedPre}, and left `undefined` when no matched middleware
   * fills the slot. Runs on the parsed `Response` — the error response
   * included — ahead of the plugins' `afterHandle`; a returned `Response`
   * replaces it.
   */
  composedPost?: (response: Response, context: Context, error?: unknown) => Promise<Response>
  static?: { path: SP; root: SR }
}

const mkErr = (status: number) =>
  class extends RequestError {
    constructor(payload?: any, headers?: Record<string, string>) {
      super({ status, payload: payload ?? HttpStatus[status as keyof typeof HttpStatus], headers })
    }
  }

// 4xx
export class BadRequestError extends mkErr(400) {}
export class UnauthorizedError extends mkErr(401) {}
export class PaymentRequiredError extends mkErr(402) {}
export class ForbiddenError extends mkErr(403) {}
export class NotFoundError extends mkErr(404) {}
export class MethodNotAllowedError extends mkErr(405) {}
export class NotAcceptableError extends mkErr(406) {}
export class ProxyAuthenticationRequiredError extends mkErr(407) {}
export class RequestTimeoutError extends mkErr(408) {}
export class ConflictError extends mkErr(409) {}
export class GoneError extends mkErr(410) {}
export class LengthRequiredError extends mkErr(411) {}
export class PreconditionFailedError extends mkErr(412) {}
export class PayloadTooLargeError extends mkErr(413) {}
export class URITooLongError extends mkErr(414) {}
export class UnsupportedMediaTypeError extends mkErr(415) {}
export class RangeNotSatisfiableError extends mkErr(416) {}
export class ExpectationFailedError extends mkErr(417) {}
export class ImATeapotError extends mkErr(418) {}
export class MisdirectedRequestError extends mkErr(421) {}
export class UnprocessableEntityError extends mkErr(422) {}
export class LockedError extends mkErr(423) {}
export class FailedDependencyError extends mkErr(424) {}
export class UpgradeRequiredError extends mkErr(426) {}
export class PreconditionRequiredError extends mkErr(428) {}
export class TooManyRequestsError extends mkErr(429) {}
export class RequestHeaderFieldsTooLargeError extends mkErr(431) {}
export class UnavailableForLegalReasonsError extends mkErr(451) {}

// 5xx
export class InternalServerError extends mkErr(500) {}
export class NotImplementedError extends mkErr(501) {}
export class BadGatewayError extends mkErr(502) {}
export class ServiceUnavailableError extends mkErr(503) {}
export class GatewayTimeoutError extends mkErr(504) {}
export class HTTPVersionNotSupportedError extends mkErr(505) {}
export class InsufficientStorageError extends mkErr(507) {}
export class NetworkAuthenticationRequiredError extends mkErr(511) {}

/** @deprecated use {@link InternalServerError} */
export const InternalError = InternalServerError
/** @deprecated use {@link InternalServerError} */
export type InternalError = InternalServerError

/**
 * #### GalbePlugin
 * Define a plugin for a Galbe application
 *
 * ---
 * @example
 * ```typescript
 * import { GalbePlugin } from 'galbe'
 * const MyPlugin : GalbePlugin = {
 *   name: 'com.example.plugin.name',
 *   init: (config, galbe) => {
 *     console.log('Plugin initialization')
 *   },
 *   onRoute: (route) => {
 *     if(route.path === '/myPlugin') {
 *       return new Response('Hello Mom!')
 *     }
 *   }
 * }
 * ```
 */
export type GalbePlugin = {
  name: string
  init?: (config: any, galbe: Galbe) => MaybePromise<void>
  onFetch?: (context: Pick<Context, 'request' | 'set' | 'state'>) => MaybePromise<Response | void>
  onRoute?: (context: Pick<Context, 'request' | 'set' | 'state' | 'route'>) => MaybePromise<Response | void>
  beforeHandle?: (context: Context) => MaybePromise<Response | void>
  afterHandle?: (response: Response, context: Context) => MaybePromise<Response | void>
  cli?: (commands: GalbeCLICommand[]) => MaybePromise<GalbeCLICommand[] | void>
}

export type GalbeCLICommand = {
  name: string
  tags: string[]
  description?: string
  route: Route
  pathT: string
  arguments?: { name: string; type: string; description: string }[]
  options?: { name: string; short: string; type: string; description: string; default: any }[]
  action?: (props: any) => MaybePromise<void>
  hideOptions?: ('header' | 'query' | 'body' | 'body-file')[]
}

export type GalbeCLIOptions = {
  baseUrl?: string | (() => string)
  headers?: Record<string, string>
  requestInterceptor?: (
    req: Request,
    command: GalbeCLICommand,
    args: Record<string, string>,
    options: Record<string, any>
  ) => MaybePromise<Request>
  responseFormatter?: (
    res: Response,
    command: GalbeCLICommand,
    args: Record<string, string>,
    options: Record<string, any>
  ) => MaybePromise<string>
}

export type GalbeClientRoute = {
  method: string
  path: string
  operationId: string
  autoDerived: boolean
  params: Record<string, { type: string; description?: string }>
  query: Record<string, { type: string; optional: boolean; description?: string }>
  headers: Record<string, { type: string; optional: boolean; description?: string }>
  body: Record<string, STSchema> | null
  response: STResponse | null
  summary?: string
  description?: string
  tags: string[]
}

export type GalbeClientOptions = {
  className?: string
}
