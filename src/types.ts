import type { ServeOptions, SocketAddress, TLSOptions, TLSServeOptions } from 'bun'
import type {
  STAny,
  STArray,
  STBoolean,
  STByteArray,
  STInteger,
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
  | STStream
  | STAny
  | STNull
export type STBody =
  | STNull
  | Partial<{
      byteArray?: STByteArray | STStream
      text?: STString | STLiteral | STBoolean | STNumber | STInteger | STUnion | STStream
      json?: STJson | STObject | STBoolean | STInteger | STNumber | STString | STArray | STUnion
      urlForm?: STObject | STStream | STUnion
      multipart?: STMultipartForm | STStream | STUnion
      default?: STString | STByteArray | STStream | STAny
    }>
export type STBodyType = keyof STBody
export type STBodyValue = STBody[STBodyType]

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
  R extends Partial<STResponse> = STResponse
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
export type Context<
  M extends Method = Method,
  Path extends string = string,
  S extends RequestSchema = RequestSchema
> = {
  [K in STBodyType]: K extends keyof Exclude<S['body'], undefined>
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
          : K extends STBodyType
          ? StaticBody<Exclude<Exclude<S['body'], undefined>[K], undefined>>
          : never
        request: Request
        remoteAddress: SocketAddress | null
        route?: Route
        state: Record<string, any>
        set: {
          headers: {
            'set-cookie': string[]
            [header: string]: string | string[]
          }
          status?: number
        }
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
  S extends RequestSchema = RequestSchema
> = (ctx: Context<M, Path, S>) => any
export type Endpoint<M extends Method> = {
  <
    Path extends string,
    P extends Partial<STParams<Path>>,
    H extends STHeaders = any,
    Q extends STQuery = any,
    B extends STBody = any,
    R extends STResponse = STResponse
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
    R extends STResponse = STResponse
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
    R extends STResponse = STResponse
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
    R extends STResponse = STResponse
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

export class RequestError {
  status: number
  payload?: any
  headers?: Record<string, string>
  constructor(options: { status?: number; payload?: any; headers?: Record<string, string> }) {
    this.status = options.status ?? 500
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
  SR extends string = string
> = {
  method: M
  path: Path
  schema: RequestSchema<M, Path, H, P, Q, B, R>
  context: Context<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>
  hooks: Hook<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>[]
  handler: Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>
  static?: { path: SP; root: SR }
}

export class NotFoundError extends RequestError {
  constructor(message?: any) {
    super({ status: 404, payload: message ?? HttpStatus[404] })
  }
}

export class MethodNotAllowedError extends RequestError {
  constructor(message?: any) {
    super({ status: 405, payload: message ?? HttpStatus[405] })
  }
}

export class InternalError extends RequestError {
  constructor(message?: any) {
    super({ status: 500, payload: message ?? HttpStatus[500] })
  }
}

export class NotImplementedError extends RequestError {
  constructor(message?: any) {
    super({ status: 501, payload: message ?? HttpStatus[501] })
  }
}

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
