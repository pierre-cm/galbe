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
  STUrlForm,
  Static
} from './schema'
import type { Galbe } from './index'

export type STBody =
  | STByteArray
  | STString
  | STBoolean
  | STNumber
  | STInteger
  | STLiteral
  | STObject
  | STArray
  | STUrlForm
  | STMultipartForm
  | STUnion
  | STStream
  | undefined

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
export type STResponse = Record<number, STResponseValue>

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
  port?: number
  hostname?: string
  basePath?: string
  tls?: TLSOptions
  server?: Exclude<ServeOptions, 'port'> | TLSServeOptions
  routes?: boolean | string | string[]
  router?: { cacheEnabled: boolean }
  plugin?: Record<string, any>
  requestValidator?: { enabled: boolean }
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
  R extends STResponse = STResponse
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
  headers: Static<STObject<Exclude<S['headers'], undefined>>>
  params: {
    [K in ExtractParams<Path>]: K extends keyof OmitNotDefined<S> ? OmitNotDefined<S>[K] : string
  }
  query: Static<STObject<Exclude<S['query'], undefined>>>
  body: M extends 'get' | 'options' | 'head' ? null : StaticBody<Exclude<S['body'], undefined>>
  request: Request
  remoteAddress: SocketAddress | null
  route?: Route
  state: Record<string, any>
  set: {
    headers: {
      [header: string]: string
    }
    status?: number
  }
}
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
  ): void
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
  ): void
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
  ): void
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
  ): void
}

export class RequestError {
  status: number
  payload: any
  constructor(options: { status?: number; payload?: any }) {
    this.status = options.status ?? 500
    this.payload = options.payload
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
  R extends STResponse = STResponse
> = {
  method: M
  path: Path
  schema: RequestSchema<M, Path, H, P, Q, B, R>
  context: Context<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>
  hooks: Hook[]
  handler: Handler<M, Path, RequestSchema<M, Path, H, P, Q, B, R>>
}

export class NotFoundError extends RequestError {
  constructor(message?: any) {
    super({ status: 404, payload: message ?? 'Not found' })
  }
}

export class MethodNotAllowedError extends RequestError {
  constructor(message?: any) {
    super({ status: 405, payload: message ?? 'Method not allowed' })
  }
}

export class InternalError extends RequestError {
  constructor(message?: any) {
    super({ status: 500, payload: message ?? 'Internal Server Error' })
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
  description?: string
  route: Route
  arguments?: { name: string; type: string; description: string }[]
  options?: { name: string; short: string; type: string; description: string; default: any }[]
  action?: (props: any) => MaybePromise<void>
}
