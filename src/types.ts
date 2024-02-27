import type {
  TSchema,
  TBoolean,
  TNumber,
  TInteger,
  TString,
  TLiteral,
  TArray,
  TObject,
  TUnion,
  Static,
  OptionalPropertyKeys,
  ReadonlyOptionalPropertyKeys,
  ReadonlyPropertyKeys,
  RequiredPropertyKeys,
  TAny,
  Readonly
} from '@sinclair/typebox'

import { Kind } from '@sinclair/typebox'
import { Galbe } from './index'
import type { ServeOptions, TLSServeOptions } from 'bun'

export const Stream = Symbol.for('Galbe.Stream')
export type TStream<T extends TSchema = TSchema> = T & {
  [Stream]: 'Stream'
}

export type TBody =
  | TByteArray
  | TString
  | TBoolean
  | TNumber
  | TInteger
  | TObject
  | TArray
  | TUrlForm
  | TMultipartForm
  | TUnion
  | TStream
export type TStreamable = TByteArray | TString | TUrlForm | TMultipartForm
export type TUrlFormParam = TString | TByteArray | TBoolean | TNumber | TInteger | TLiteral | TArray | TAny | TUnion
export type TMultipartFormParam = TByteArray | TUrlFormParam | TObject | TArray
export type MaybeArray<T> = T | T[]

export interface MultipartFormData<
  K extends string | number | symbol = string,
  V extends Static<TMultipartFormParam> = any
> {
  headers: { type?: string; name: K; filename?: string }
  content: V
}

export interface TByteArray extends TSchema {
  [Kind]: 'ByteArray'
  static: Uint8Array
  type: 'byteArray'
}
export interface TMultipartForm<T extends TMultipartProperties = TMultipartProperties> extends TSchema {
  [Kind]: 'MultipartForm'
  static: MultipartPropertiesReduce<T, this['params']>
  type: 'multipartForm'
}
export interface TUrlForm<T extends TUrlFormProperties = TUrlFormProperties> extends TSchema {
  [Kind]: 'UrlForm'
  static: UrlFormPropertiesReduce<T, this['params']>
  type: 'urlForm'
}

export type TMultipartProperties<V = TMultipartFormParam> = Record<string, V>
export type MultipartPropertiesReduce<T extends TMultipartProperties, P extends unknown[]> = MultipartPropertiesReducer<
  T,
  {
    [K in keyof T]: Static<T[K], P>
  }
>
export type MultipartPropertiesReducer<
  T extends TMultipartProperties,
  R extends Record<keyof any, unknown>
> = MultipartEvaluate<
  Readonly<Partial<Pick<R, ReadonlyOptionalPropertyKeys<T>>>> &
    Readonly<Pick<R, ReadonlyPropertyKeys<T>>> &
    Partial<Pick<R, OptionalPropertyKeys<T>>> &
    Required<Pick<R, RequiredPropertyKeys<T>>>
>
export type MultipartEvaluate<T> = T extends infer O
  ? {
      [K in keyof O]: O[K] extends Static<TMultipartFormParam> ? MultipartFormData<K, O[K]> : never
    }
  : never

export type TUrlFormProperties = Record<string, TUrlFormParam>
export type UrlFormPropertiesReduce<T extends TUrlFormProperties, P extends unknown[]> = UrlFormPropertiesReducer<
  T,
  {
    [K in keyof T]: Static<T[K], P>
  }
>
export type UrlFormPropertiesReducer<
  T extends TUrlFormProperties,
  R extends Record<keyof any, unknown>
> = UrlFormEvaluate<
  Readonly<Partial<Pick<R, ReadonlyOptionalPropertyKeys<T>>>> &
    Readonly<Pick<R, ReadonlyPropertyKeys<T>>> &
    Partial<Pick<R, OptionalPropertyKeys<T>>> &
    Required<Pick<R, RequiredPropertyKeys<T>>>
>
export type UrlFormEvaluate<T> = T extends infer O
  ? {
      [K in keyof O]: O[K] extends Static<TUrlFormParam> ? O[K] : never
    }
  : never

export type Method = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options'
type MaybePromise<T> = T | Promise<T>

export type ExtractParams<T extends string> = T extends `/:${infer P}/${infer Rest}`
  ? P | ExtractParams<Rest>
  : T extends `${infer _}:${infer P}/${infer Rest}`
  ? P | ExtractParams<Rest>
  : T extends `${infer _}:${infer P}`
  ? P
  : never

type THeadersValue = TString | TBoolean | TNumber | TInteger | TLiteral | TUnion
export type THeaders = Record<string, THeadersValue>

type TParamsValue = TString | TBoolean | TNumber | TInteger | TLiteral | TUnion
export type TParams<Path extends string = string> = Record<ExtractParams<Path>, TParamsValue>

type TQueryValue = TString | TBoolean | TNumber | TInteger | TLiteral | TUnion
export type TQuery = Record<string, TQueryValue>

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
 * import { T, Schema } from 'galbe'
 * const MyRequestSchema = {
 *   params: {
 *    id: T.Number(),
 *   },
 *   body: T.Object({
 *     name: T.String()
 *     age: T.Optional(T.Number({minimum: 0})),
 *   })
 * }
 * ```
 */
export type Schema<
  Path extends string = string,
  H extends THeaders = {},
  P extends Partial<TParams<Path>> = {},
  Q extends TQuery = {},
  B extends TBody = TBody
> = {
  headers?: H
  params?: P
  query?: Q
  body?: B
}

type OmitNotDefined<S extends Schema> = {
  [K in keyof Exclude<S['params'], undefined> as Exclude<S['params'], undefined>[K] extends Required<
    Exclude<S['params'], undefined>
  >[K]
    ? K
    : //@ts-ignore
      never]: Static<TObject<Exclude<S['params'], undefined>>>[K]
}

export type Context<Path extends string = string, S extends Schema = Schema> = {
  headers: Static<TObject<Exclude<S['headers'], undefined>>>
  params: {
    [K in ExtractParams<Path>]: K extends keyof OmitNotDefined<S> ? OmitNotDefined<S>[K] : string
  }
  query: Static<TObject<Exclude<S['query'], undefined>>>
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
export type Hook<Path extends string = string, S extends Schema = Schema> = (
  ctx: Context<Path, S>,
  next: Next
) => any | Promise<any>
export type Handler<Path extends string = string, S extends Schema = Schema> = (ctx: Context<Path, S>) => any
export type Endpoint = {
  <
    Path extends string,
    H extends THeaders,
    P extends Partial<TParams<Path>>,
    Q extends TQuery,
    B extends TBody = TObject
  >(
    path: Path,
    schema: Schema<Path, H, P, Q, B>,
    hooks: Hook<Path, Schema<Path, H, P, Q, B>>[],
    handler: Handler<Path, Schema<Path, H, P, Q, B>>
  ): void
  <
    Path extends string,
    H extends THeaders,
    P extends Partial<TParams<Path>>,
    Q extends TQuery,
    B extends TBody = TObject
  >(
    path: Path,
    schema: Schema<Path, H, P, Q, B>,
    handler: Handler<Path, Schema<Path, H, P, Q, B>>
  ): void
  <
    Path extends string,
    H extends THeaders,
    P extends Partial<TParams<Path>>,
    Q extends TQuery,
    B extends TBody = TObject
  >(
    path: Path,
    hooks: Hook<Path, Schema<Path, H, P, Q, B>>[],
    handler: Handler<Path, Schema<Path, H, P, Q, B>>
  ): void
  <
    Path extends string,
    H extends THeaders,
    P extends Partial<TParams<Path>>,
    Q extends TQuery,
    B extends TBody = TObject
  >(
    path: Path,
    handler: Handler<Path, Schema<Path, H, P, Q, B>>
  ): void
}

export class RequestError {
  status: number
  error: any
  constructor(options: { status?: number; error?: any }) {
    this.status = options.status ?? 500
    this.error = options.error ?? 'Internal server error'
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
  H extends THeaders = {},
  P extends Partial<TParams<Path>> = {},
  Q extends TQuery = {},
  B extends TBody = TBody
> = {
  method: Method
  path: Path
  schema: Schema<Path, H, P, Q, B>
  context: Context<Path, Schema<Path, H, P, Q, B>>
  hooks: Hook[]
  handler: Handler<Path, Schema<Path, H, P, Q, B>>
}

export type RouteTree = {
  [key: string]: RouteNode
}

export class NotFoundError extends RequestError {
  constructor(message?: string) {
    super({ status: 404, error: message ?? 'Not found' })
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
