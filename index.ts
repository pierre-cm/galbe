import Elysia from 'elysia'
import { swagger } from '@elysiajs/swagger'

import { Static, TSchema, TArray, TObject, TProperties } from './typebox'
import { parseEntry, validateBody, PType } from './parser'
import { Optional, Kind } from '@sinclair/typebox'

import { OpenAPIV3 } from 'openapi-types'
import { SwaggerUIOptions } from 'swagger-ui'
import { RouteMetadata, defineRoutes } from './routes'
import { Server } from 'bun'

export type Method = 'get' | 'post' | 'put' | 'delete' | 'patch'

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
    enabled?: boolean
    documentation?: Omit<
      Partial<OpenAPIV3.Document>,
      'x-express-openapi-additional-middleware' | 'x-express-openapi-validation-strict'
    >
    version?: string
    excludeStaticFile?: boolean
    path?: string
    exclude?: string | RegExp | (string | RegExp)[]
    swaggerOptions?: Omit<
      Partial<SwaggerUIOptions>,
      | 'dom_id'
      | 'dom_node'
      | 'spec'
      | 'url'
      | 'urls'
      | 'layout'
      | 'pluginsOptions'
      | 'plugins'
      | 'presets'
      | 'onComplete'
      | 'requestInterceptor'
      | 'responseInterceptor'
      | 'modelPropertyMacro'
      | 'parameterMacro'
    >
    theme?:
      | string
      | {
          light: string
          dark: string
        }
    autoDarkMode?: boolean
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
export type Context<S extends Schema = {}> = {
  headers: Static<TObject<Exclude<S['headers'], undefined>>>
  params: Static<TObject<Exclude<S['params'], undefined>>>
  query: Static<TObject<Exclude<S['query'], undefined>>>
  body: Static<Exclude<S['body'], undefined>>
  request: Request
  state: Record<string, any>
  set: {
    headers: {
      [header: string]: string
    } & {
      ['Set-Cookie']?: string | string[]
    }
    status?: number
    redirect?: string
  }
}
export type Next = () => void | Promise<void>
export type Hook<S extends Schema> = (ctx: Context<S>, next: Next) => any | Promise<any>
export type Handler<S extends Schema> = (
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

export type RequestErrorHandler = {
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
  constructor(options: { status?: number; error?: any }) {
    this.status = options.status ?? 500
    this.error = options.error ?? 'Internal server error'
  }
}

const DEFAULT_DOC_OPTIONS: KadreConfig['doc'] = {
  enabled: true,
  path: '/doc',
  autoDarkMode: true
}
const PARSE_PARAM_RGX = /^\s*\{(\w+)\}\s*(\w+)\s*(@deprecated)?\s+(.*)$/
const parseStringParam = (
  params: string | string[]
): { [key: string]: Record<string, { description: string; deprecated?: boolean }> } => {
  if (!params) return {}
  if (typeof params === 'string') {
    const match = params.match(PARSE_PARAM_RGX)
    if (!match) return {}
    return { [match[1]]: { [match[2]]: { deprecated: !!match[3], description: match[4] } } }
  } else {
    const res: { [key: string]: Record<string, { description: string; deprecated?: boolean }> } = {}
    for (const p of params) {
      const match = p.match(PARSE_PARAM_RGX)
      if (!match) continue

      if (!(match[1] in res)) res[match[1]] = {}
      res[match[1]][match[2]] = { deprecated: !!match[3], description: match[4] }
    }
    return res
  }
}
const parseDocParams: (
  schema: Record<string, any>,
  meta: Record<string, string | string[]>
) => OpenAPIV3.ParameterObject[] = (schema, meta) => {
  let params = schema.params as TSchema
  let query = schema.query as TSchema
  let docParams = parseStringParam(meta.param)
  return [
    ...Object.entries(params || []).map(([k, v]) => ({
      name: k,
      in: 'path',
      description: docParams?.['path']?.[k]?.description ?? '',
      required: !(Optional in v),
      deprecated: docParams?.['path']?.[k]?.deprecated ?? false
    })),
    ...Object.entries(query || []).map(([k, v]) => {
      return {
        name: k,
        in: 'query',
        description: docParams?.['query']?.[k].description ?? '',
        required: !(Optional in v),
        deprecated: docParams?.['query']?.[k]?.deprecated ?? false
      }
    })
  ]
}
const parseBody: (schema?: TSchema, description?: string) => OpenAPIV3.RequestBodyObject | undefined = (
  schema,
  description
) => {
  if (!schema) return undefined
  return {
    description: description,
    content: {
      'application/json': { schema }
    },
    required: !(Optional in schema)
  }
}
const parseResponseSchema = (schema?: TSchema) => {
  if (!schema) return schema
  if (schema[Kind] === 'Literal') schema['enum'] = [schema.const]
  else if (schema[Kind] === 'Object') {
    Object.keys(schema.properties).forEach(k => {
      schema.properties[k] = parseResponseSchema(schema.properties[k])
    })
  } else if (schema[Kind] === 'Array') schema.items = parseResponseSchema(schema.items)
  return schema
}
const parseResponse: (schemas?: Record<number, TSchema>) => OpenAPIV3.ResponsesObject | undefined = schemas => {
  if (!schemas) return undefined
  return Object.fromEntries(
    Object.entries(schemas).map(([code, schema]) => [
      code,
      {
        description: '',
        content: {
          'application/json': { schema: parseResponseSchema(schema) }
        }
      }
    ])
  )
}
const overloadDiscriminer = <
  H extends TProperties,
  P extends TProperties,
  Q extends TProperties,
  B extends TSchema,
  R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
>(
  kadre: Kadre,
  method: Method,
  path: string,
  arg2: Schema<H, P, Q, B, R> | Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
  arg3?: Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
  arg4?: Handler<Schema<H, P, Q, B, R>>
) => {
  if (typeof arg2 === 'function') {
    return kadreMethod(kadre, method, path, undefined, undefined, arg2)
  } else {
    if (Array.isArray(arg2)) {
      if (typeof arg3 === 'function') return kadreMethod(kadre, method, path, undefined, arg2, arg3)
    } else {
      if (Array.isArray(arg3) && arg4) return kadreMethod(kadre, method, path, arg2, arg3, arg4)
      else if (typeof arg3 === 'function') return kadreMethod(kadre, method, path, arg2, undefined, arg3)
    }
  }
  throw new Error('Undefined endpoint signature')
}
const kadreMethod = <
  H extends TProperties,
  P extends TProperties,
  Q extends TProperties,
  B extends TSchema,
  R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
>(
  kadre: Kadre,
  method: Method,
  path: string,
  schema: Schema<H, P, Q, B, R> | undefined,
  hooks: Hook<Schema<H, P, Q, B, R>>[] | undefined,
  handler: Handler<Schema<H, P, Q, B, R>>
) => {
  schema = schema ?? {}
  hooks = hooks || []
  const context: Context<typeof schema> = {
    headers: {} as Static<TObject<Exclude<(typeof schema)['headers'], undefined>>>,
    params: {} as Static<TObject<Exclude<(typeof schema)['params'], undefined>>>,
    query: {} as Static<TObject<Exclude<(typeof schema)['query'], undefined>>>,
    body: {} as Static<Exclude<(typeof schema)['body'], undefined>>,
    request: {} as Request,
    state: {},
    set: {} as {
      headers: {
        [header: string]: string
      } & {
        ['Set-Cookie']?: string | string[]
      }
      status?: number
      redirect?: string
    }
  }
  const metadata = kadre.routesMetadata && path in kadre?.routesMetadata ? kadre?.routesMetadata[path][method] : {}
  kadre.elysia[method](
    path,
    async (ctx: any) => {
      context.request = ctx.request
      context.set = ctx.set
      let { headers, params, query, body } = ctx
      // Request validation
      let errors = []
      try {
        if (schema?.headers)
          headers = { ...headers, ...parseEntry(ctx.headers, schema.headers, { name: 'headers', i: true }) }
        context.headers = headers
      } catch (error) {
        errors.push(error)
      }
      try {
        if (schema?.query) query = parseEntry(ctx.query, schema.query, { name: 'query' })
        context.query = query
      } catch (error) {
        errors.push(error)
      }
      try {
        if (schema?.params) params = parseEntry(ctx.params, schema.params, { name: 'params' })
        context.params = params
      } catch (error) {
        errors.push(error)
      }
      try {
        if (schema?.body) body = validateBody(ctx.body, schema.body as PType) ? ctx.body : undefined
        context.body = body
      } catch (error) {
        errors.push(error)
      }
      if (errors.length) {
        ctx.set.status = 400
        //@ts-ignore
        return errors.reduce((acc, c) => ({ ...acc, ...c.error }), {})
      }
      // Call chain
      let response = null
      const callStack: number[] = []
      let callStackError: boolean = false
      const callChain = (hooks || []).map((hook, idx) => ({
        call: async () => {
          callStack.push(idx)
          await hook(context, async () => {
            await callChain[idx + 1].call()
          })
          if (callStack.pop() !== idx && !callStackError) {
            console.error('Call stack error')
            callStackError = true
          }
        }
      }))
      callChain.push({
        call: async () => {
          callStack.push(callChain.length - 1)
          response = await handler(context)
          callStack.pop()
        }
      })
      if (callChain.length > 1) await callChain[0].call()
      else response = await handler(context)
      if (callStackError) {
        ctx.set.status = 500
        return 'Internal server error'
      }

      return response
    },
    {
      detail: {
        tags: metadata?.tags
          ? Array.isArray(metadata?.tags)
            ? metadata?.tags.join(' ').split(' ')
            : metadata?.tags.split(' ')
          : [],
        summary: Array.isArray(metadata?.summary) ? metadata?.summary[0] : metadata?.summary,
        description: Array.isArray(metadata?.description) ? metadata?.description[0] : metadata?.description,
        deprecated: !!metadata?.deprecated,
        parameters: parseDocParams(schema, metadata),
        requestBody: parseBody(schema.body, Array.isArray(metadata?.body) ? metadata?.body[0] : metadata?.body),
        responses: parseResponse(schema.response)
      }
    }
  )
}

export default class Kadre {
  elysia: Elysia<string, any>
  options?: KadreConfig
  routesMetadata?: RouteMetadata
  listening: boolean = false
  errorHandler: (err: RequestErrorHandler) => any
  constructor(options?: KadreConfig) {
    this.options = options
    const { basePath = '', doc: docOptions } = options || {}
    const excludeRegex = new RegExp(`^${options?.basePath || ''}${this.options?.doc?.path ?? '/doc'}(\/|$)`)
    const doc: KadreConfig['doc'] = {
      ...DEFAULT_DOC_OPTIONS,
      ...docOptions,
      exclude: docOptions?.exclude
        ? Array.isArray(docOptions?.exclude)
          ? [...docOptions?.exclude, excludeRegex]
          : [docOptions?.exclude, excludeRegex]
        : excludeRegex,
      swaggerOptions: {
        // supportedSubmitMethods: [],
        ...(docOptions?.swaggerOptions || {})
      }
    }
    this.elysia = new Elysia({ prefix: basePath })

    this.errorHandler = ({ set, payload }) => {
      set.status = payload?.status || 500
      return payload?.error || 'Internal server error'
    }
    this.elysia.onError(reqError => {
      if (reqError.error instanceof SyntaxError) {
        return this.errorHandler({
          set: reqError.set,
          payload: { status: 400, error: { message: reqError.error.message } }
        })
      } else if (reqError.error.message === 'NOT_FOUND') {
        return this.errorHandler({
          set: reqError.set,
          payload: { status: 404, error: { message: 'Not found' } }
        })
      } else {
        return this.errorHandler({
          set: reqError.set,
          payload: { status: 500, error: { message: 'Internal server error' } }
        })
      }
    })

    //@ts-ignore
    if (doc?.enabled) this.elysia.use(swagger(doc))
  }
  use(plugin: (app: Elysia) => Elysia<string, any>) {
    this.elysia.use(plugin)
    return this.elysia
  }
  async listen(port?: number) {
    if (this.listening) await this.stop()
    if (Bun.env.BUN_ENV === 'development') {
      console.log('🏗️  \x1b[1;30mConstructing routes\x1b[0m')
      await defineRoutes(this.options || {}, this)
      console.log('\n✅ \x1b[1;30mdone\x1b[0m')
    }
    return new Promise<Server>(r =>
      this.elysia.listen(port || this.options?.port || 3000, s => {
        const url = `http://localhost:${s.port}${this.options?.basePath || ''}`
        console.log(`\n\x1b[1;30m🚀 API running at\x1b[0m \x1b[4;34m${url}\x1b[0m`)

        this.listening = true
        r(s)
      })
    )
  }
  stop() {
    this.listening = false
    return this.elysia.stop()
  }
  onError(handler: (err: RequestErrorHandler) => any) {
    this.errorHandler = handler
  }
  get: Endpoint = <
    H extends TProperties,
    P extends TProperties,
    Q extends TProperties,
    B extends TSchema,
    R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
  >(
    path: string,
    arg2: Schema<H, P, Q, B, R> | Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg3?: Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg4?: Handler<Schema<H, P, Q, B, R>>
  ) => overloadDiscriminer(this, 'get', path, arg2, arg3, arg4)
  post: Endpoint = <
    H extends TProperties,
    P extends TProperties,
    Q extends TProperties,
    B extends TSchema,
    R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
  >(
    path: string,
    arg2: Schema<H, P, Q, B, R> | Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg3?: Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg4?: Handler<Schema<H, P, Q, B, R>>
  ) => overloadDiscriminer(this, 'post', path, arg2, arg3, arg4)
  put: Endpoint = <
    H extends TProperties,
    P extends TProperties,
    Q extends TProperties,
    B extends TSchema,
    R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
  >(
    path: string,
    arg2: Schema<H, P, Q, B, R> | Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg3?: Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg4?: Handler<Schema<H, P, Q, B, R>>
  ) => overloadDiscriminer(this, 'put', path, arg2, arg3, arg4)
  patch: Endpoint = <
    H extends TProperties,
    P extends TProperties,
    Q extends TProperties,
    B extends TSchema,
    R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
  >(
    path: string,
    arg2: Schema<H, P, Q, B, R> | Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg3?: Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg4?: Handler<Schema<H, P, Q, B, R>>
  ) => overloadDiscriminer(this, 'patch', path, arg2, arg3, arg4)
  delete: Endpoint = <
    H extends TProperties,
    P extends TProperties,
    Q extends TProperties,
    B extends TSchema,
    R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
  >(
    path: string,
    arg2: Schema<H, P, Q, B, R> | Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg3?: Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg4?: Handler<Schema<H, P, Q, B, R>>
  ) => overloadDiscriminer(this, 'delete', path, arg2, arg3, arg4)
}

export { T } from './typebox'
