import Elysia from 'elysia'
import { Type, Static, TSchema, TArray, TObject, TProperties } from '@sinclair/typebox'
import { parseQueryParams } from './parser'

type Method = 'get' | 'post' | 'put' | 'delete' | 'patch'
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

type ExtractedResponses<S extends { response?: unknown }> = Exclude<S['response'], undefined>

type StaticPropertiesOfResponse<R> = {
  [K in keyof R]: R[K] extends TSchema ? Static<R[K]> : never
}[keyof R]

export type KadreSchema<
  H extends TProperties = TProperties,
  P extends TProperties = TProperties,
  Q extends TProperties = TProperties,
  B extends TProperties = TProperties,
  R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
> = {
  headers?: TObject<H>
  params?: P
  query?: Q
  body?: TObject<B>
  response?: R
}

export type KadreContext<S extends KadreSchema> = {
  headers: Static<Exclude<S['headers'], undefined>>
  params: Static<TObject<Exclude<S['params'], undefined>>>
  query: Static<TObject<Exclude<S['query'], undefined>>>
  body: Static<Exclude<S['body'], undefined>>
  request: Request
}

export type KadreHook<S extends KadreSchema> = (ctx: KadreContext<S>) => any | Promise<any>
export type KadreHandler<S extends KadreSchema> = (
  ctx: KadreContext<S>
) => XORRecursive<TuplifyUnion<StaticPropertiesOfResponse<ExtractedResponses<S>>>>

export type KadreEndpoint = <
  H extends TProperties,
  P extends TProperties,
  Q extends TProperties,
  B extends TProperties,
  R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
>(
  path: string,
  schema: KadreSchema<H, P, Q, B, R>,
  hooks: KadreHook<KadreSchema<H, P, Q, B, R>>[],
  handler: KadreHandler<KadreSchema<H, P, Q, B, R>>
) => void

const kadreMethod = <
  H extends TProperties,
  P extends TProperties,
  Q extends TProperties,
  B extends TProperties,
  R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
>(
  kadre: Kadre,
  method: Method,
  path: string,
  schema: KadreSchema<H, P, Q, B, R>,
  hooks: KadreHook<KadreSchema<H, P, Q, B, R>>[],
  handler: KadreHandler<KadreSchema<H, P, Q, B, R>>
) => {
  const context: KadreContext<typeof schema> = {
    headers: {} as Static<Exclude<(typeof schema)['headers'], undefined>>,
    params: {} as Static<TObject<Exclude<(typeof schema)['params'], undefined>>>,
    query: {} as Static<TObject<Exclude<(typeof schema)['query'], undefined>>>,
    body: {} as Static<Exclude<(typeof schema)['body'], undefined>>,
    request: {} as Request
  }
  kadre.elysia[method](
    path,
    (ctx: any) => {
      context.request = ctx.request
      let query = ctx.query

      try {
        if (schema.query) query = parseQueryParams(ctx.query, schema.query)
        context.query = query
        return handler(context)
      } catch (error) {
        if (error instanceof RequestError) {
          return kadre.errorHandler({ set: ctx.set, payload: error })
        } else {
          console.error(error)
          return kadre.errorHandler({
            set: ctx.set,
            payload: new RequestError({ status: 500, error: 'Internal Server error.' })
          })
        }
      }
    },
    {
      // TODO setup request details (doc etc.)
      detail: {},
      beforeHandle: async (ctx: any) => {
        context.request = ctx.request
        for (const hook of hooks) await hook(context)
      }
    }
  )
}

type RequestErrorHandler = {
  set: {
    headers: {
      [header: string]: string
    } & {
      ['Set-Cookie']?: string | string[]
    }
    status?: number
    redirect?: string
  }
  payload: RequestError
}
export class RequestError {
  status: number
  error: any
  constructor(options: { status: number; error: any }) {
    this.status = options.status ?? 500
    this.error = options.error ?? 'Internal server error.'
  }
}

export default class Kadre {
  elysia: Elysia
  errorHandler: (err: RequestErrorHandler) => any
  constructor() {
    this.elysia = new Elysia()
    this.errorHandler = ({ set, payload }) => {
      set.status = payload?.status || 500
      return payload?.error || 'Internal Server Error.'
    }
  }
  use(plugin: Elysia) {
    this.elysia.use(plugin)
    return this.elysia
  }
  listen(port: number) {
    port = port || 3000
    return this.elysia.listen(port)
  }
  onError(handler: (err: RequestErrorHandler) => any) {
    this.errorHandler = handler
  }
  get: KadreEndpoint = (path, schema, hooks, handler) => kadreMethod(this, 'get', path, schema, hooks, handler)
  post: KadreEndpoint = (path, schema, hooks, handler) => kadreMethod(this, 'post', path, schema, hooks, handler)
  put: KadreEndpoint = (path, schema, hooks, handler) => kadreMethod(this, 'put', path, schema, hooks, handler)
  delete: KadreEndpoint = (path, schema, hooks, handler) => kadreMethod(this, 'delete', path, schema, hooks, handler)
  patch: KadreEndpoint = (path, schema, hooks, handler) => kadreMethod(this, 'patch', path, schema, hooks, handler)
}

const kadre = new Kadre()

const schema = {
  params: Type.Object({
    userId: Type.Number(),
    name: Type.String(),
    dhushdyeudgeygd: Type.String()
  }),
  query: Type.Object({
    name: Type.String(),
    age: Type.Number()
  }),
  body: Type.Object({
    name: Type.String(),
    age: Type.Number()
  }),
  response: {
    200: Type.Array(
      Type.Object({
        name: Type.String(),
        age: Type.Number()
      })
    ),
    400: Type.Object({
      message: Type.String()
    })
  }
}

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never
type LastOf<T> = UnionToIntersection<T extends any ? () => T : never> extends () => infer R ? R : never
type Push<T extends any[], V> = [...T, V]
type TuplifyUnion<T, L = LastOf<T>, N = [T] extends [never] ? true : false> = true extends N
  ? []
  : Push<TuplifyUnion<Exclude<T, L>>, L>

type Check1 = ExtractedResponses<typeof schema>
type Check2 = StaticPropertiesOfResponse<Check1>
type Check3 = TuplifyUnion<Check2>
type Check4 = XORRecursive<Check3>

const ok: Check2 = [
  {
    name: 'test',
    age: 21
  }
]

kadre.post(
  '/users/:userId',
  schema,
  [
    ctx => {
      let params = ctx.params
    }
  ],
  ctx => {
    return {
      message: 'test'
    }
  }
)

kadre.post('/users/:userId', schema, [], ctx => {
  const toto = ctx.params
  return [
    {
      name: 'toto',
      age: 42
    }
  ]
})

// detail: {
//   tags: tags,
//   summary: 'quick summary', // Infer from file comment ?
//   description: 'descritpion', // Infer from file comment ?
//   parameters: parseParams(request),
//   requestBody: parseBody(request),
//   responses: parseResponses(response),
//   deprecated: false // infer from file comment ?
//   // security: SecurityRequirementObject[],
//   // servers: ServerObject[]
// },
