import { Static, TSchema, TArray, TObject, TProperties } from '@sinclair/typebox'
import { Kadre } from './index.ts'

export type Method = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options'
type Without<T, U> = T extends any[]
  ? U extends any[]
    ? {}
    : U
  : U extends any[]
  ? {}
  : { [P in Exclude<keyof T, keyof U>]?: never }
type XOR<T, U> = T | U extends object ? (Without<T, U> & U) | (Without<U, T> & T) : T | U
type XORRecursive<T extends any[]> = T extends [infer First, infer Second, ...infer Rest]
  ? XOR<First, XORRecursive<[Second, ...Rest]>>
  : T extends [infer Only]
  ? Only
  : never
type MaybePromise<T> = T | Promise<T>
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never
type LastOf<T> = UnionToIntersection<T extends any ? () => T : never> extends () => infer R ? R : never
type Push<T extends any[], V> = [...T, V]
type TuplifyUnion<T, L = LastOf<T>, N = [T] extends [never] ? true : false> = true extends N
  ? []
  : Push<TuplifyUnion<Exclude<T, L>>, L>
type ExtractedResponses<S extends { response?: unknown }> = Exclude<S['response'], undefined>
type StaticPropertiesOfResponse<R> = {
  [K in keyof R]: R[K] extends TSchema ? Static<R[K]> : never
}[keyof R]
export type KadreConfig = {
  port?: number
  basePath?: string
  routes?: string | string[]
  doc?: {
    // TODO
  }
}
export type Schema<
  H extends TProperties = TProperties,
  P extends TProperties = TProperties,
  Q extends TProperties = TProperties,
  B extends TSchema = TSchema,
  R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
> = {
  headers?: H
  params?: P
  query?: Q
  body?: B
  response?: R
}
export type Context<S extends Schema = any> = {
  headers: Static<TObject<Exclude<S['headers'], undefined>>>
  params: Static<TObject<Exclude<S['params'], undefined>>>
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
export type Hook<S extends Schema = Schema> = (ctx: Context<S>, next: Next) => any | Promise<any>
export type Handler<S extends Schema = Schema> = (
  ctx: Context<S>
) => MaybePromise<XORRecursive<TuplifyUnion<StaticPropertiesOfResponse<ExtractedResponses<S>>>>>
export type Endpoint = {
  <
    H extends TProperties,
    P extends TProperties,
    Q extends TProperties,
    B extends TSchema,
    R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
  >(
    path: string,
    schema: Schema<H, P, Q, B, R>,
    hooks: Hook<Schema<H, P, Q, B, R>>[],
    handler: Handler<Schema<H, P, Q, B, R>>
  ): void
  <
    H extends TProperties,
    P extends TProperties,
    Q extends TProperties,
    B extends TSchema,
    R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
  >(
    path: string,
    schema: Schema<H, P, Q, B, R>,
    handler: Handler<Schema<H, P, Q, B, R>>
  ): void
  <
    H extends TProperties,
    P extends TProperties,
    Q extends TProperties,
    B extends TSchema,
    R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
  >(
    path: string,
    hooks: Hook<Schema<H, P, Q, B, R>>[],
    handler: Handler<Schema<H, P, Q, B, R>>
  ): void
  <
    H extends TProperties,
    P extends TProperties,
    Q extends TProperties,
    B extends TSchema,
    R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
  >(
    path: string,
    handler: Handler<Schema<H, P, Q, B, R>>
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
  H extends TProperties = TProperties,
  P extends TProperties = TProperties,
  Q extends TProperties = TProperties,
  B extends TSchema = TSchema,
  R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
> = {
  method: Method
  path: string
  schema: Schema<H, P, Q, B, R>
  context: Context<Schema<H, P, Q, B, R>>
  handler: Handler<Schema<H, P, Q, B, R>>
}

export type RouteTree = {
  [key: string]: RouteNode
}

export class NotFoundError extends RequestError {
  constructor(message?: string) {
    super({ status: 404, error: message ?? 'Not found' })
  }
}

export type KadrePlugin = {
  fetch?: (request: Request, app: { kadre: Kadre; context: Context }) => Response | void
}

export { Kadre } from './index.ts'
