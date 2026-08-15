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
export type STResponse = Partial<Record<number | 'default', STResponseEntry>>

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
type STQueryValue = MaybeSTArray<MaybeSTUnion<STQueryPrimaryValue>>
export type STQuery = Record<string, STQueryValue>

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
   * Files default-export `Hook | Hook[]`, scoped to their directory subtree. `false` disables
   * middleware discovery only; `routes: false` disables the whole analyzer.
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
  /** Customize the `info` and `servers` blocks of the OpenAPI spec generated by `OpenAPISerializer` (`galbe/extras`). */
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
> = {
  headers?: H
  params?: P
  query?: Q
  body?: B
  response?: R
  /** Maximum request body size in bytes for this route; overrides the global `bodyLimit` config. Larger bodies are rejected with a 413 error. */
  bodyLimit?: number
}

type OmitNotDefined<S extends RequestSchema> = {
  [K in keyof Exclude<S['params'], undefined> as Exclude<S['params'], undefined>[K] extends Required<
    Exclude<S['params'], undefined>
  >[K]
    ? K
    : //@ts-ignore
      never]: Static<STObject<Exclude<S['params'], undefined>>>[K]
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
export type Context<
  M extends Method = Method,
  Path extends string = string,
  S extends RequestSchema = RequestSchema,
> = 0 extends 1 & Exclude<S['body'], undefined | STNull>
  ? {
      [K in keyof Exclude<S['body'], undefined | STNull>]: {
        headers: Static<STObject<Exclude<S['headers'], undefined>>>
        params: {
          [P in ExtractParams<Path>]: P extends keyof OmitNotDefined<S> ? OmitNotDefined<S>[P] : string
        }
        query: Static<STObject<Exclude<S['query'], undefined>>>
        contentType: M extends 'get' | 'options' | 'head' ? undefined : K
        body: M extends 'get' | 'options' | 'head'
          ? null
          : Exclude<S['body'], undefined> extends STNull
            ? null
            : StaticBody<Extract<Exclude<Exclude<S['body'], undefined | STNull>[K], undefined>, STSchema>>
        request: Request
        remoteAddress: SocketAddress | null
        route?: Route
        state: Record<string, any>
        set: ContextSet
        cookies: Record<string, string>
      }
    }[keyof Exclude<S['body'], undefined | STNull>]
  : [Exclude<S['body'], undefined | STNull>] extends [never]
    ? {
        headers: Static<STObject<Exclude<S['headers'], undefined>>>
        params: {
          [P in ExtractParams<Path>]: P extends keyof OmitNotDefined<S> ? OmitNotDefined<S>[P] : string
        }
        query: Static<STObject<Exclude<S['query'], undefined>>>
        contentType: undefined
        body: null
        request: Request
        remoteAddress: SocketAddress | null
        route?: Route
        state: Record<string, any>
        set: ContextSet
        cookies: Record<string, string>
      }
    : {
        [K in keyof Exclude<S['body'], undefined | STNull>]: {
          headers: Static<STObject<Exclude<S['headers'], undefined>>>
          params: {
            [P in ExtractParams<Path>]: P extends keyof OmitNotDefined<S> ? OmitNotDefined<S>[P] : string
          }
          query: Static<STObject<Exclude<S['query'], undefined>>>
          contentType: M extends 'get' | 'options' | 'head' ? undefined : K
          body: M extends 'get' | 'options' | 'head'
            ? null
            : StaticBody<Extract<Exclude<Exclude<S['body'], undefined | STNull>[K], undefined>, STSchema>>
          request: Request
          remoteAddress: SocketAddress | null
          route?: Route
          state: Record<string, any>
          set: ContextSet
          cookies: Record<string, string>
        }
      }[keyof Exclude<S['body'], undefined | STNull>]
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
/**
 * Prefix middleware entry registered via `galbe.middleware`. Patterns match
 * registered route paths (not request URLs) and are resolved at registration:
 * matched hooks are composed into the route's hook chain.
 */
export type GalbeMiddleware = {
  /** the pattern as registered, e.g. `/api/*` */
  pattern: string
  /** pattern split into segments, precomputed at registration */
  segments: string[]
  hooks: Hook[]
}
// Prefix is prepended to Path at the type level (route groups): context params,
// schemas and the returned Route are typed against the full, joined path.
export type Endpoint<M extends Method, Prefix extends string = ''> = {
  <
    Path extends string,
    P extends Partial<STParams<`${Prefix}${Path}`>>,
    H extends STHeaders = any,
    Q extends STQuery = any,
    B extends STBody = any,
    R extends STResponse = STResponse,
  >(
    path: Path,
    schema: RequestSchema<M, `${Prefix}${Path}`, H, P, Q, B, R>,
    hooks: Hook<M, `${Prefix}${Path}`, RequestSchema<M, `${Prefix}${Path}`, H, P, Q, B, R>>[],
    handler: Handler<M, `${Prefix}${Path}`, RequestSchema<M, `${Prefix}${Path}`, H, P, Q, B, R>>
  ): Route<M, `${Prefix}${Path}`, P, H, Q, B, R>
  <
    Path extends string,
    P extends Partial<STParams<`${Prefix}${Path}`>>,
    H extends STHeaders = any,
    Q extends STQuery = any,
    B extends STBody = any,
    R extends STResponse = STResponse,
  >(
    path: Path,
    schema: RequestSchema<M, `${Prefix}${Path}`, H, P, Q, B, R>,
    handler: Handler<M, `${Prefix}${Path}`, RequestSchema<M, `${Prefix}${Path}`, H, P, Q, B, R>>
  ): Route<M, `${Prefix}${Path}`, P, H, Q, B, R>
  <
    Path extends string,
    P extends Partial<STParams<`${Prefix}${Path}`>>,
    H extends STHeaders = any,
    Q extends STQuery = any,
    B extends STBody = any,
    R extends STResponse = STResponse,
  >(
    path: Path,
    hooks: Hook<M, `${Prefix}${Path}`, RequestSchema<M, `${Prefix}${Path}`, H, P, Q, B, R>>[],
    handler: Handler<M, `${Prefix}${Path}`, RequestSchema<M, `${Prefix}${Path}`, H, P, Q, B, R>>
  ): Route<M, `${Prefix}${Path}`, P, H, Q, B, R>
  <
    Path extends string,
    P extends Partial<STParams<`${Prefix}${Path}`>>,
    H extends STHeaders = any,
    Q extends STQuery = any,
    B extends STBody = any,
    R extends STResponse = STResponse,
  >(
    path: Path,
    handler: Handler<M, `${Prefix}${Path}`, RequestSchema<M, `${Prefix}${Path}`, H, P, Q, B, R>>
  ): Route<M, `${Prefix}${Path}`, P, H, Q, B, R>
}

export type StaticEndpointOptions = {
  resolve?: (path: string, target: string) => string | null | undefined | void
}
export type StaticEndpoint<P extends string = string, T extends string = string> = (
  path: P,
  target: T,
  options?: StaticEndpointOptions
) => Route<'get', P, {}, {}, {}, STBody, STResponse, T>

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
  SP extends string = string,
  SR extends string = string,
> = {
  method: M
  path: Path
  schema: RequestSchema<M, Path, H, P, Q, B, R>
  context: Context<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>
  hooks: Hook<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>[]
  handler: Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>
  /**
   * Hook/handler chain composed at registration — and recomposed if a later
   * `middleware()` call matches the route — never per request. Runs matched
   * middleware, then the hooks, then the handler and resolves to the handler's
   * response — or a hook's short-circuit value.
   */
  composed: (context: Context<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>) => Promise<any>
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
