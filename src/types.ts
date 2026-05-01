import type { ServeOptions, SocketAddress, TLSOptions, TLSServeOptions } from 'bun'
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
export type STBodyContent = {
  byteArray?: STByteArray | STStream
  text?: STString | STLiteral | STBoolean | STNumber | STInteger | STUnion | STStream
  json?: STJson | STObject | STBoolean | STInteger | STNumber | STString | STArray | STUnion | STIntersection<any>
  urlForm?: STObject | STStream | STUnion
  multipart?: STMultipartForm | STStream | STUnion
  default?: STString | STByteArray | STStream | STAny
}
export type STBody = STNull | Partial<STBodyContent>
export type STBodyType = keyof STBodyContent
export type STBodyValue = STBodyContent[STBodyType]

export type STResponse = Partial<Record<number | 'default', STResponseValue>>

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
  server?: Exclude<ServeOptions, 'port'> | TLSServeOptions
  /** A Glob Pattern or a list of Glob patterns defining the route files to be analyzed by the Automatic Route Analyzer. */
  routes?: boolean | string | string[]
  router?: { cacheEnabled: boolean }
  /** A property that can be used by plugins to add plugin's specific configuration. */
  plugin?: Record<string, any>
  /** Enable or disable the request schema validation.*/
  requestValidator?: { enabled: boolean }
  /** Enable or disable the response schema validation.*/
  responseValidator?: { enabled: boolean }
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
> = {
  [K in STBodyType]: K extends keyof Exclude<S['body'], undefined | STNull>
    ? {
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
            : K extends keyof Exclude<S['body'], undefined | STNull>
              ? StaticBody<Exclude<Exclude<S['body'], undefined | STNull>[K], undefined>>
              : never
        request: Request
        remoteAddress: SocketAddress | null
        route?: Route
        state: Record<string, any>
        set: ContextSet
        cookies: Record<string, string>
      }
    : never
}[STBodyType]
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
export type Endpoint<M extends Method> = {
  <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders = any,
    Q extends STQuery = any,
    B extends STBody = any,
    R extends STResponse = STResponse,
  >(
    path: Path,
    schema: RequestSchema<M, Path, H, P, Q, B, R>,
    hooks: Hook<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>[],
    handler: Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>
  ): Route<M, Path, P, H, Q, B, R>
  <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders = any,
    Q extends STQuery = any,
    B extends STBody = any,
    R extends STResponse = STResponse,
  >(
    path: Path,
    schema: RequestSchema<M, Path, H, P, Q, B, R>,
    handler: Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>
  ): Route<M, Path, P, H, Q, B, R>
  <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders = any,
    Q extends STQuery = any,
    B extends STBody = any,
    R extends STResponse = STResponse,
  >(
    path: Path,
    hooks: Hook<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>[],
    handler: Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>
  ): Route<M, Path, P, H, Q, B, R>
  <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders = any,
    Q extends STQuery = any,
    B extends STBody = any,
    R extends STResponse = STResponse,
  >(
    path: Path,
    handler: Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>
  ): Route<M, Path, P, H, Q, B, R>
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
        : HttpStatus[status as keyof typeof HttpStatus] ?? 'Request Error'
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
  arguments?: { name: string; type: string; description: string }[]
  options?: { name: string; short: string; type: string; description: string; default: any }[]
  action?: (props: any) => MaybePromise<void>
}
