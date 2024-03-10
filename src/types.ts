import type { ServeOptions, TLSServeOptions } from 'bun'
import type {
  STArray,
  STBoolean,
  STByteArray,
  STInteger,
  STLiteral,
  STMultipartForm,
  STNumber,
  STObject,
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
  | STObject
  | STArray
  | STUrlForm
  | STMultipartForm
  | STUnion
  | STStream
export type MaybeArray<T> = T | T[]

export type Method = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options'
type MaybePromise<T> = T | Promise<T>

export type ExtractParams<T extends string> = T extends `/:${infer P}/${infer Rest}`
  ? P | ExtractParams<Rest>
  : T extends `${infer _}:${infer P}/${infer Rest}`
  ? P | ExtractParams<Rest>
  : T extends `${infer _}:${infer P}`
  ? P
  : never

type STHeadersValue = STString | STBoolean | STNumber | STInteger | STLiteral | STUnion
export type STHeaders = Record<string, STHeadersValue>

type STParamsValue = STString | STBoolean | STNumber | STInteger | STLiteral | STUnion
export type STParams<Path extends string = string> = Record<ExtractParams<Path>, STParamsValue>

type STQueryValue = STString | STBoolean | STNumber | STInteger | STLiteral | STUnion
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
  basePath?: string
  server?: Exclude<ServeOptions, 'port'> | TLSServeOptions
  routes?: boolean | string | string[]
  plugin?: Record<string, any>
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
  Path extends string = string,
  H extends STHeaders = {},
  P extends Partial<STParams<Path>> = {},
  Q extends STQuery = {},
  B extends STBody = STBody
> = {
  headers?: H
  params?: P
  query?: Q
  body?: B
}

type OmitNotDefined<S extends RequestSchema> = {
  [K in keyof Exclude<S['params'], undefined> as Exclude<S['params'], undefined>[K] extends Required<
    Exclude<S['params'], undefined>
  >[K]
    ? K
    : //@ts-ignore
      never]: Static<STObject<Exclude<S['params'], undefined>>>[K]
}

export type Context<Path extends string = string, S extends RequestSchema = RequestSchema> = {
  headers: Static<STObject<Exclude<S['headers'], undefined>>>
  params: {
    [K in ExtractParams<Path>]: K extends keyof OmitNotDefined<S> ? OmitNotDefined<S>[K] : string
  }
  query: Static<STObject<Exclude<S['query'], undefined>>>
  body: Static<Exclude<S['body'], undefined>>
  request: Request
  state: Record<string, any>
  set: {
    headers: {
      [header: string]: string
    }
    status?: number
    redirect?: string
  }
}
export type Next = () => void | Promise<void>
export type Hook<Path extends string = string, S extends RequestSchema = RequestSchema> = (
  ctx: Context<Path, S>,
  next: Next
) => any | Promise<any>
export type Handler<Path extends string = string, S extends RequestSchema = RequestSchema> = (
  ctx: Context<Path, S>
) => any
export type Endpoint = {
  <
    Path extends string,
    H extends STHeaders,
    P extends Partial<STParams<Path>>,
    Q extends STQuery,
    B extends STBody = STObject
  >(
    path: Path,
    schema: RequestSchema<Path, H, P, Q, B>,
    hooks: Hook<Path, RequestSchema<Path, H, P, Q, B>>[],
    handler: Handler<Path, RequestSchema<Path, H, P, Q, B>>
  ): void
  <
    Path extends string,
    H extends STHeaders,
    P extends Partial<STParams<Path>>,
    Q extends STQuery,
    B extends STBody = STObject
  >(
    path: Path,
    schema: RequestSchema<Path, H, P, Q, B>,
    handler: Handler<Path, RequestSchema<Path, H, P, Q, B>>
  ): void
  <
    Path extends string,
    H extends STHeaders,
    P extends Partial<STParams<Path>>,
    Q extends STQuery,
    B extends STBody = STObject
  >(
    path: Path,
    hooks: Hook<Path, RequestSchema<Path, H, P, Q, B>>[],
    handler: Handler<Path, RequestSchema<Path, H, P, Q, B>>
  ): void
  <
    Path extends string,
    H extends STHeaders,
    P extends Partial<STParams<Path>>,
    Q extends STQuery,
    B extends STBody = STObject
  >(
    path: Path,
    handler: Handler<Path, RequestSchema<Path, H, P, Q, B>>
  ): void
}

export class RequestError {
  status: number
  payload: any
  constructor(options: { status?: number; payload?: any }) {
    this.status = options.status ?? 500
    this.payload = options.payload ?? 'Internal server error'
  }
}

export type ErrorHandler = (error: any, context: Context) => any

export type RouteNode = {
  route?: Route
  param?: RouteNode
  children?: Record<string, RouteNode>
}

export type Route<
  Path extends string = string,
  H extends STHeaders = {},
  P extends Partial<STParams<Path>> = {},
  Q extends STQuery = {},
  B extends STBody = STBody
> = {
  method: Method
  path: Path
  schema: RequestSchema<Path, H, P, Q, B>
  context: Context<Path, RequestSchema<Path, H, P, Q, B>>
  hooks: Hook[]
  handler: Handler<Path, RequestSchema<Path, H, P, Q, B>>
}

export type RouteTree = {
  [key: string]: RouteNode
}

export class NotFoundError extends RequestError {
  constructor(message?: string) {
    super({ status: 404, payload: message ?? 'Not found' })
  }
}

/**
 * #### GalbePlugin
 * Define a plugin for a Galbe server
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
  onFetch?: (request: Request) => MaybePromise<Response | void>
  onRoute?: (route: Route) => MaybePromise<Response | void>
  beforeHandle?: (context: Context) => MaybePromise<Response | void>
  afterHandle?: (response: Response) => MaybePromise<Response | void>
}
