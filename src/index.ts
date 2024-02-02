import type { Server } from 'bun'
import type { Static, TSchema, TArray, TObject, TProperties, TString } from '@sinclair/typebox'
import type { RouteMetadata } from './routes'
import type {
  KadreConfig,
  Method,
  Schema,
  Hook,
  Handler,
  Endpoint,
  Context,
  ErrorHandler,
  KadrePlugin,
  TStream,
  TMultipartProperties,
  TMultipartForm,
  TUrlFormProperties,
  TUrlForm,
  TBody,
  TByteArray,
  TStreamable,
  MultipartFormData
} from './types'

import { Type, JavaScriptTypeBuilder, TypeClone, Optional, Kind } from '@sinclair/typebox'
import { OpenAPIV3 } from 'openapi-types'
import server from './server'
import { KadreRouter } from './router'
import { defineRoutes } from './routes'
import { Stream, RequestError } from './types'

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
  B extends TBody,
  R extends Record<number, TSchema | TArray<TSchema>> = Record<number, TSchema | TArray<TSchema>>
>(
  kadre: Kadre,
  method: Method,
  path: string,
  arg2: Schema<H, P, Q, B, R> | Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
  arg3?: Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
  arg4?: Handler<Schema<H, P, Q, B, R>>
) => {
  const defaultSchema = {
    response: {
      200: Type.Any()
    }
  }
  if (typeof arg2 === 'function') {
    return kadreMethod(kadre, method, path, defaultSchema, undefined, arg2)
  } else {
    if (Array.isArray(arg2)) {
      if (typeof arg3 === 'function') return kadreMethod(kadre, method, path, defaultSchema, arg2, arg3)
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
  B extends TBody,
  R extends Record<number, TSchema | TArray<TSchema>> = Record<number, TSchema | TArray<TSchema>>
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
      }
      status?: number
      redirect?: string
    }
  }
  const metadata = kadre.routesMetadata && path in kadre?.routesMetadata ? kadre?.routesMetadata[path][method] : {}
  return {
    method,
    path,
    schema,
    context,
    handler,
    details: {
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
}

// type PropertyKey<T extends TProperties> = T extends Record<infer F, TSchema> ? F : never
// type PropertyValue<T extends TProperties> = T extends Record<TPropertyKey, infer F> ? F : never

class KadreTypeBuilder extends JavaScriptTypeBuilder {
  public Stream<T extends TUrlForm>(
    schema: T
  ): Omit<TStream<T>, 'static'> & { static: AsyncGenerator<[string, string | number | boolean]>; params: unknown[] }
  public Stream<T extends TMultipartForm>(
    schema: T
  ): Omit<TStream<T>, 'static'> & { static: AsyncGenerator<MultipartFormData, void, unknown>; params: unknown[] }
  public Stream<T extends TByteArray>(
    schema: T
  ): Omit<TStream<T>, 'static'> & { static: ReadableStream<Uint8Array>; params: unknown[] }
  public Stream<T extends TString>(
    schema: T
  ): Omit<TStream<T>, 'static'> & { static: AsyncGenerator<string>; params: unknown[] }
  public Stream<T extends TStreamable>(schema: T): TStream<T> {
    return {
      ...TypeClone.Type(schema),
      [Stream]: 'Stream'
    }
  }
  public ByteArray(): TByteArray {
    return this.Create({ [Kind]: 'ByteArray', type: 'byteArray', params: {} })
  }
  public MultipartForm<T extends TMultipartProperties>(properties?: T): TMultipartForm {
    if (!properties) return this.Create({ [Kind]: 'MultipartForm', type: 'multipartForm' })
    const propertyKeys = Object.getOwnPropertyNames(properties)
    const clonedProperties = propertyKeys.reduce(
      //@ts-ignore
      (acc, key) => ({ ...acc, [key]: TypeClone.Type(properties[key]) }),
      {} as TProperties
    )
    return this.Create({
      [Kind]: 'MultipartForm',
      type: 'multipartForm',
      properties: clonedProperties
    })
  }
  public UrlForm<T extends TUrlFormProperties>(properties?: T): TUrlForm {
    if (!properties) return this.Create({ [Kind]: 'UrlForm', type: 'urlForm' })
    const propertyKeys = Object.getOwnPropertyNames(properties)
    const clonedProperties = propertyKeys.reduce(
      //@ts-ignore
      (acc, key) => ({ ...acc, [key]: TypeClone.Type(properties[key]) }),
      {} as TProperties
    )
    return this.Create({ [Kind]: 'UrlForm', type: 'urlForm', properties: clonedProperties })
  }
}

export const T = new KadreTypeBuilder()

const TestStream: TBody = T.UrlForm({ toto: T.String(), titi: T.Number() })
const TestStatic: TBody = T.Stream(T.UrlForm({ stream: T.String() }))

// const Tetfstfs = T.Optional(T.Stream())

type TypeTest1 = (typeof TestStream)['static']
type TypeTest2 = (typeof TestStatic)['static']
// type TypeTest3 = (typeof Tetfstfs)['static']

export { RequestError } from './types'
/**
 * #### Kadre Server
 * Instanciate a Kadre web server
 *
 * ---
 * @example
 * ```typescript
 * import { Kadre } from 'kadre'
 * import config from "./kadre.config"
 *
 * export default new Kadre(config)
 * ```
 */
export class Kadre {
  config?: KadreConfig
  routesMetadata?: RouteMetadata
  router: KadreRouter
  errorHandler: ErrorHandler
  listening: boolean = false
  server?: Server
  plugins: KadrePlugin[] = []
  constructor(config?: KadreConfig) {
    this.config = config
    const { basePath = '' } = config || {}

    this.errorHandler = (error, context) => {
      if (error instanceof RequestError) {
        context.set.status = error.status
        return error.error
      } else {
        console.error(error)
        return 'Internal Server Error'
      }
    }
    this.router = new KadreRouter(basePath)
  }
  private add(route: any) {
    this.router.add(route)
  }
  async use(plugin: KadrePlugin) {
    if (plugin.init) await plugin?.init(this)
    this.plugins.push(plugin)
  }
  async listen(port?: number) {
    if (this.listening) this.stop()
    if (Bun.env.BUN_ENV === 'development') {
      console.log('🏗️  \x1b[1;30mConstructing routes\x1b[0m')
      await defineRoutes(this.config || {}, this)
      console.log('\n✅ \x1b[1;30mdone\x1b[0m')
    }
    this.server = server(this, port)
    const url = `http://localhost:${port}${this.config?.basePath || ''}`
    console.log(`\n\x1b[1;30m🚀 API running at\x1b[0m \x1b[4;34m${url}\x1b[0m`)
    this.listening = true
    return this.server
  }
  stop() {
    this.server?.stop(true)
  }
  onError(handler: ErrorHandler) {
    this.errorHandler = handler
  }
  get: Endpoint = <
    H extends TProperties,
    P extends TProperties,
    Q extends TProperties,
    B extends TBody,
    R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
  >(
    path: string,
    arg2: Schema<H, P, Q, B, R> | Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg3?: Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg4?: Handler<Schema<H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'get', path, arg2, arg3, arg4))
  post: Endpoint = <
    H extends TProperties,
    P extends TProperties,
    Q extends TProperties,
    B extends TBody,
    R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
  >(
    path: string,
    arg2: Schema<H, P, Q, B, R> | Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg3?: Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg4?: Handler<Schema<H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'post', path, arg2, arg3, arg4))
  put: Endpoint = <
    H extends TProperties,
    P extends TProperties,
    Q extends TProperties,
    B extends TBody,
    R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
  >(
    path: string,
    arg2: Schema<H, P, Q, B, R> | Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg3?: Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg4?: Handler<Schema<H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'put', path, arg2, arg3, arg4))
  patch: Endpoint = <
    H extends TProperties,
    P extends TProperties,
    Q extends TProperties,
    B extends TBody,
    R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
  >(
    path: string,
    arg2: Schema<H, P, Q, B, R> | Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg3?: Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg4?: Handler<Schema<H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'patch', path, arg2, arg3, arg4))
  delete: Endpoint = <
    H extends TProperties,
    P extends TProperties,
    Q extends TProperties,
    B extends TBody,
    R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
  >(
    path: string,
    arg2: Schema<H, P, Q, B, R> | Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg3?: Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg4?: Handler<Schema<H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'delete', path, arg2, arg3, arg4))
  options: Endpoint = <
    H extends TProperties,
    P extends TProperties,
    Q extends TProperties,
    B extends TBody,
    R extends Record<number, TObject<any> | TArray<TObject<any>>> = Record<number, TObject<any> | TArray<TObject<any>>>
  >(
    path: string,
    arg2: Schema<H, P, Q, B, R> | Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg3?: Hook<Schema<H, P, Q, B, R>>[] | Handler<Schema<H, P, Q, B, R>>,
    arg4?: Handler<Schema<H, P, Q, B, R>>
  ) => this.add(overloadDiscriminer(this, 'options', path, arg2, arg3, arg4))
}

export * from './types'
