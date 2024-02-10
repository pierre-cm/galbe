import type { Server } from 'bun'
import type {
  ArrayOptions,
  NumericOptions,
  ObjectOptions,
  SchemaOptions,
  Static,
  StringOptions,
  TAny,
  TArray,
  TBoolean,
  TInteger,
  TLiteral,
  TLiteralValue,
  TNever,
  TNumber,
  TObject,
  TOptional,
  TProperties,
  TSchema,
  TString,
  TUnion
} from '@sinclair/typebox'
import type { RouteFileMeta } from './routes'
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

import { TypeClone, Kind, TypeBuilder, Optional, TypeGuard } from '@sinclair/typebox'
import server from './server'
import { KadreRouter } from './router'
import { defineRoutes } from './routes'
import { Stream } from './types'

const overloadDiscriminer = <H extends TProperties, P extends TProperties, Q extends TProperties, B extends TBody>(
  kadre: Kadre,
  method: Method,
  path: string,
  arg2: Schema<H, P, Q, B> | Hook<Schema<H, P, Q, B>>[] | Handler<Schema<H, P, Q, B>>,
  arg3?: Hook<Schema<H, P, Q, B>>[] | Handler<Schema<H, P, Q, B>>,
  arg4?: Handler<Schema<H, P, Q, B>>
) => {
  const defaultSchema = {}
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
const kadreMethod = <H extends TProperties, P extends TProperties, Q extends TProperties, B extends TBody>(
  _kadre: Kadre,
  method: Method,
  path: string,
  schema: Schema<H, P, Q, B> | undefined,
  hooks: Hook<Schema<H, P, Q, B>>[] | undefined,
  handler: Handler<Schema<H, P, Q, B>>
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
  //@ts-ignore
  return {
    method,
    path,
    schema,
    context,
    hooks,
    handler
  }
}

export class TypeboxTypeBuilder extends TypeBuilder {
  /** `[Json]` Creates an Optional property */
  public Optional<T extends TSchema>(schema: T): TOptional<T> {
    return { ...TypeClone.Type(schema), [Optional]: 'Optional' }
  }
  /** `[Json]` Creates an Any type */
  public Any(options: SchemaOptions = {}): TAny {
    return this.Create({ ...options, [Kind]: 'Any' })
  }
  /** `[Json]` Creates an Array type */
  public Array<T extends TSchema>(schema: T, options: ArrayOptions = {}): TArray<T> {
    return this.Create({ ...options, [Kind]: 'Array', type: 'array', items: TypeClone.Type(schema) })
  }
  /** `[Json]` Creates a Boolean type */
  public Boolean(options: SchemaOptions = {}): TBoolean {
    return this.Create({ ...options, [Kind]: 'Boolean', type: 'boolean' })
  }
  /** `[Json]` Creates an Integer type */
  public Integer(options: NumericOptions<number> = {}): TInteger {
    return this.Create({ ...options, [Kind]: 'Integer', type: 'integer' })
  }
  /** `[Json]` Creates a Literal type */
  public Literal<T extends TLiteralValue>(value: T, options: SchemaOptions = {}): TLiteral<T> {
    return this.Create({
      ...options,
      [Kind]: 'Literal',
      const: value,
      type: typeof value as 'string' | 'number' | 'boolean'
    })
  }
  /** `[Json]` Creates a Number type */
  public Number(options: NumericOptions<number> = {}): TNumber {
    return this.Create({ ...options, [Kind]: 'Number', type: 'number' })
  }
  /** `[Json]` Creates an Object type */
  public Object<T extends TProperties>(properties: T, options: ObjectOptions = {}): TObject<T> {
    const propertyKeys = Object.getOwnPropertyNames(properties)
    const optionalKeys = propertyKeys.filter(key => TypeGuard.TOptional(properties[key]))
    const requiredKeys = propertyKeys.filter(name => !optionalKeys.includes(name))
    const clonedAdditionalProperties = TypeGuard.TSchema(options.additionalProperties)
      ? { additionalProperties: TypeClone.Type(options.additionalProperties) }
      : {}
    const clonedProperties = propertyKeys.reduce(
      (acc, key) => ({ ...acc, [key]: TypeClone.Type(properties[key]) }),
      {} as TProperties
    )
    return requiredKeys.length > 0
      ? this.Create({
          ...options,
          ...clonedAdditionalProperties,
          [Kind]: 'Object',
          type: 'object',
          properties: clonedProperties,
          required: requiredKeys
        })
      : this.Create({
          ...options,
          ...clonedAdditionalProperties,
          [Kind]: 'Object',
          type: 'object',
          properties: clonedProperties
        })
  }
  /** `[Json]` Creates a String type */
  public String(options: StringOptions = {}): TString {
    return this.Create({ ...options, [Kind]: 'String', type: 'string' })
  }
  /** `[Json]` Creates a Union type */
  public Union(anyOf: [], options?: SchemaOptions): TNever
  /** `[Json]` Creates a Union type */
  public Union<T extends [TSchema]>(anyOf: [...T], options?: SchemaOptions): T[0]
  /** `[Json]` Creates a Union type */
  public Union<T extends TSchema[]>(anyOf: [...T], options?: SchemaOptions): TUnion<T>
  /** `[Json]` Creates a Union type */
  public Union(union: TSchema[], options: SchemaOptions = {}) {
    // prettier-ignore
    return (() => {
        const anyOf = union
        if (anyOf.length === 0) throw new Error("Union type must decalre at least one schema")
        if (anyOf.length === 1) return this.Create(TypeClone.Type(anyOf[0], options))
        const clonedAnyOf = TypeClone.Rest(anyOf)
        return this.Create({ ...options, [Kind]: 'Union', anyOf: clonedAnyOf })
      })()
  }
}

class KadreTypeBuilder extends TypeboxTypeBuilder {
  /** `[Kadre]` Creates an Stream type */
  public Stream<T extends TUrlForm>(
    schema: T
  ): Omit<TStream<T>, 'static'> & { static: AsyncGenerator<[string, string | number | boolean]>; params: unknown[] }
  public Stream<T extends TMultipartForm>(
    schema: T
  ): Omit<TStream<T>, 'static'> & { static: AsyncGenerator<MultipartFormData, void, unknown>; params: unknown[] }
  public Stream<T extends TByteArray>(
    schema: T
  ): Omit<TStream<T>, 'static'> & { static: AsyncGenerator<Uint8Array>; params: unknown[] }
  public Stream<T extends TString>(
    schema: T
  ): Omit<TStream<T>, 'static'> & { static: AsyncGenerator<string>; params: unknown[] }
  public Stream<T extends TStreamable>(schema: T): TStream<T> {
    return {
      ...TypeClone.Type(schema),
      [Stream]: 'Stream'
    }
  }
  /** `[Kadre]` Creates an ByteArray type */
  public ByteArray(): TByteArray {
    return this.Create({ [Kind]: 'ByteArray', type: 'byteArray', params: {} })
  }
  /** `[Kadre]` Creates an MultipartForm type */
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
  /** `[Kadre]` Creates an UrlForm type */
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
  meta?: Array<RouteFileMeta> = []
  router: KadreRouter
  errorHandler?: ErrorHandler
  listening: boolean = false
  server?: Server
  plugins: KadrePlugin[] = []
  constructor(config?: KadreConfig) {
    this.config = config
    const { basePath = '' } = config || {}
    this.router = new KadreRouter(basePath)
  }
  private add(route: any) {
    this.router.add(route)
  }
  async use(plugin: KadrePlugin) {
    if (plugin.init) await plugin?.init(this, this?.config?.plugin?.[plugin?.name])
    this.plugins.push(plugin)
  }
  async listen(port?: number) {
    port = port || this.config?.port || 3000
    if (this.listening) this.stop()
    if (Bun.env.BUN_ENV === 'development' && !!this.config?.routes) {
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
  get: Endpoint = <H extends TProperties, P extends TProperties, Q extends TProperties, B extends TBody>(
    path: string,
    arg2: Schema<H, P, Q, B> | Hook<Schema<H, P, Q, B>>[] | Handler<Schema<H, P, Q, B>>,
    arg3?: Hook<Schema<H, P, Q, B>>[] | Handler<Schema<H, P, Q, B>>,
    arg4?: Handler<Schema<H, P, Q, B>>
  ) => this.add(overloadDiscriminer(this, 'get', path, arg2, arg3, arg4))
  post: Endpoint = <H extends TProperties, P extends TProperties, Q extends TProperties, B extends TBody>(
    path: string,
    arg2: Schema<H, P, Q, B> | Hook<Schema<H, P, Q, B>>[] | Handler<Schema<H, P, Q, B>>,
    arg3?: Hook<Schema<H, P, Q, B>>[] | Handler<Schema<H, P, Q, B>>,
    arg4?: Handler<Schema<H, P, Q, B>>
  ) => this.add(overloadDiscriminer(this, 'post', path, arg2, arg3, arg4))
  put: Endpoint = <H extends TProperties, P extends TProperties, Q extends TProperties, B extends TBody>(
    path: string,
    arg2: Schema<H, P, Q, B> | Hook<Schema<H, P, Q, B>>[] | Handler<Schema<H, P, Q, B>>,
    arg3?: Hook<Schema<H, P, Q, B>>[] | Handler<Schema<H, P, Q, B>>,
    arg4?: Handler<Schema<H, P, Q, B>>
  ) => this.add(overloadDiscriminer(this, 'put', path, arg2, arg3, arg4))
  patch: Endpoint = <H extends TProperties, P extends TProperties, Q extends TProperties, B extends TBody>(
    path: string,
    arg2: Schema<H, P, Q, B> | Hook<Schema<H, P, Q, B>>[] | Handler<Schema<H, P, Q, B>>,
    arg3?: Hook<Schema<H, P, Q, B>>[] | Handler<Schema<H, P, Q, B>>,
    arg4?: Handler<Schema<H, P, Q, B>>
  ) => this.add(overloadDiscriminer(this, 'patch', path, arg2, arg3, arg4))
  delete: Endpoint = <H extends TProperties, P extends TProperties, Q extends TProperties, B extends TBody>(
    path: string,
    arg2: Schema<H, P, Q, B> | Hook<Schema<H, P, Q, B>>[] | Handler<Schema<H, P, Q, B>>,
    arg3?: Hook<Schema<H, P, Q, B>>[] | Handler<Schema<H, P, Q, B>>,
    arg4?: Handler<Schema<H, P, Q, B>>
  ) => this.add(overloadDiscriminer(this, 'delete', path, arg2, arg3, arg4))
  options: Endpoint = <H extends TProperties, P extends TProperties, Q extends TProperties, B extends TBody>(
    path: string,
    arg2: Schema<H, P, Q, B> | Hook<Schema<H, P, Q, B>>[] | Handler<Schema<H, P, Q, B>>,
    arg3?: Hook<Schema<H, P, Q, B>>[] | Handler<Schema<H, P, Q, B>>,
    arg4?: Handler<Schema<H, P, Q, B>>
  ) => this.add(overloadDiscriminer(this, 'options', path, arg2, arg3, arg4))
}

export * from './types'
