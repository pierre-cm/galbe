export const Kind = Symbol.for('Galbe.SchemaType.Kind')
export const Optional = Symbol.for('Galbe.SchemaType.Optional')
export const Stream = Symbol.for('Galbe.SchemaType.Stream')

export interface Options {
  id?: string
  title?: string
  description?: string
  default?: any
  examples?: any
}
export interface ByteArrayOptions extends Options {
  minLength?: number
  maxLength?: number
}
export interface StringOptions extends Options {
  minLength?: number
  maxLength?: number
  pattern?: RegExp
}
export interface NumberOptions extends Options {
  min?: number
  max?: number
  exclusiveMin?: number
  exclusiveMax?: number
}
export interface ArrayOptions extends Options {
  minLength?: number
  maxLength?: number
  unique?: boolean
}
export interface STSchema extends Options {
  [Kind]:
    | 'null'
    | 'boolean'
    | 'byteArray'
    | 'number'
    | 'integer'
    | 'string'
    | 'literal'
    | 'array'
    | 'object'
    | 'json'
    | 'urlForm'
    | 'multipartForm'
    | 'any'
    | 'union'
    | 'intersection'
  [Optional]?: boolean
  [Stream]?: boolean
  params: unknown[]
  static: unknown
  props?: STProps
  [key: string]: any
}
export type STPropsValue =
  | STBoolean
  | STByteArray
  | STNumber
  | STInteger
  | STString
  | STLiteral
  | STArray
  | STObject
  | STUnion
  | STAny
  | STNull
export type STProps = Record<string | number, STPropsValue>

type Evaluate<T> = T extends infer O ? { [K in keyof O]: O[K] } : never

type Entries<T extends object> = {
  [K in keyof T]-?: [K, T[K]]
}[keyof T]

/**
 * Infer the static TypeScript type from a {@link https://galbe.dev/documentation/schemas#schema-types Schema Type}
 * @example
 * ```ts
 * const schema = $T.object({ foo: $T.string() })
 * type T = Static<typeof schema>
 * //   ^? type T = { foo: string }
 * ```
 */
export type Static<T extends STSchema, P extends unknown[] = unknown[]> = T[typeof Optional] extends true
  ? (T & { params: P })['static'] | undefined
  : (T & { params: P })['static']

// Utils
export type STOptional<T extends STSchema> = T & {
  [Optional]: true
}
export type STStream<T extends STSchema = STSchema> = T & {
  [Stream]: true
}

// Null
export interface STNull extends STSchema, Options {
  [Kind]: 'null'
  static: null
}
export function _Null(options: Options = {}): STNull {
  return {
    ...options,
    [Kind]: 'null',
  } as unknown as STNull
}
// ByteArray
export interface STByteArray extends STSchema, ByteArrayOptions {
  [Kind]: 'byteArray'
  static: Uint8Array
}
export function _ByteArray(options: ByteArrayOptions = {}): STByteArray {
  return {
    ...options,
    [Kind]: 'byteArray',
  } as unknown as STByteArray
}
// Boolean
export interface STBoolean extends STSchema, Options {
  [Kind]: 'boolean'
  static: boolean
}
export function _Bool(options: Options = {}): STBoolean {
  return {
    ...options,
    [Kind]: 'boolean',
  } as unknown as STBoolean
}
// String
export interface STString extends STSchema, NumberOptions {
  [Kind]: 'string'
  static: string
}
export function _String(options: StringOptions = {}): STString {
  return {
    ...options,
    [Kind]: 'string',
  } as unknown as STString
}
// Number
export interface STNumber extends STSchema, NumberOptions {
  [Kind]: 'number'
  static: number
}
export function _Number(options: NumberOptions = {}): STNumber {
  return {
    ...options,
    [Kind]: 'number',
  } as unknown as STNumber
}
// Integer
export interface STInteger extends STSchema, NumberOptions {
  [Kind]: 'integer'
  static: number
}
export function _Integer(options: NumberOptions = {}): STInteger {
  return {
    ...options,
    [Kind]: 'integer',
  } as unknown as STInteger
}
// Literal
type STLiteralValue = string | number | boolean
export interface STLiteral<T extends STLiteralValue = STLiteralValue> extends STSchema, Options {
  [Kind]: 'literal'
  static: T
  value: T
}
export function _Literal<T extends STLiteralValue>(value: T, options: Options = {}): STLiteral<T> {
  return {
    ...options,
    [Kind]: 'literal',
    static: value,
    value,
  } as unknown as STLiteral<T>
}
// Any
export interface STAny extends STSchema, Options {
  [Kind]: 'any'
  static: any
  [key: string]: any
}
export function _Any(options: Options = {}): STAny {
  return {
    ...options,
    [Kind]: 'any',
  } as unknown as STAny
}

// Object
export interface STObject<T extends STProps = STProps> extends STSchema {
  [Kind]: 'object'
  static: ObjectStatic<T, this['params']>
  props: T
}
export interface STJson<T extends STBoolean | STNumber | STString | STObject = any> extends STSchema {
  [Kind]: 'json'
  type: 'boolean' | 'number' | 'string' | 'object' | 'unknown'
  static: Static<T>
}
type ObjectStatic<T extends STProps, P extends unknown[]> = ObjectStaticProps<T, { [K in keyof T]: Static<T[K], P> }>
type OptionalPropertyKeys<T extends STProps> = {
  [K in keyof T]: T[K] extends STOptional<STSchema> ? K : never
}[keyof T]
type RequiredPropertyKeys<T extends STProps> = keyof Omit<T, OptionalPropertyKeys<T>>
type ObjectStaticProps<T extends STProps, R extends Record<keyof any, unknown>> = Evaluate<
  Partial<Pick<R, OptionalPropertyKeys<T>>> & Required<Pick<R, RequiredPropertyKeys<T>>>
>
function _Object<T extends STProps>(properties?: T, options: Options = {}): STObject<T> {
  if (!properties) return { ...options, [Kind]: 'object' } as unknown as STObject<T>
  const propertyKeys = globalThis.Object.getOwnPropertyNames(properties)
  const optionalKeys = propertyKeys.filter(key => properties[key]?.[Optional])
  const requiredKeys = propertyKeys.filter(name => !optionalKeys.includes(name))
  const clonedProperties = propertyKeys.reduce((acc, key) => ({ ...acc, [key]: { ...properties[key] } }), {} as STProps)
  return (requiredKeys.length > 0
    ? { ...options, [Kind]: 'object', props: clonedProperties, required: requiredKeys }
    : { ...options, [Kind]: 'object', props: clonedProperties }) as unknown as STObject<T>
}
function _Json<T extends STBoolean | STNumber | STString | STObject>(value?: T, options: Options = {}): STJson<T> {
  if (value?.[Kind] === 'boolean') return { ..._Bool(options), [Kind]: 'json', type: 'boolean' }
  if (value?.[Kind] === 'number') return { ..._Number(options), [Kind]: 'json', type: 'number' }
  if (value?.[Kind] === 'string') return { ..._String(options), [Kind]: 'json', type: 'string' }
  if (value?.[Kind] === 'object') return { ..._Object(value.props, options), [Kind]: 'json', type: 'object' }
  throw Error('Invalid Json type definition')
}

// UrlForm
// export type STUrlFormValues =
//   | STByteArray
//   | STBoolean
//   | STNumber
//   | STInteger
//   | STString
//   | STLiteral
//   | STObject
//   | STUnion
//   | STAny
//   | STArray
// export type STUrlFormProps = Record<string, STUrlFormValues>
// export interface STUrlForm<T extends STUrlFormProps = STUrlFormProps> extends STSchema {
//   [Kind]: 'urlForm'
//   static: T extends undefined ? Record<string, any> : ObjectStatic<T, this['params']>
//   props: T
// }
// function _UrlForm<T extends STUrlFormProps>(properties?: T, options: Options = {}): STUrlForm<T> {
//   if (!properties) return { ...options, [Kind]: 'urlForm' } as unknown as STUrlForm<T>
//   const propertyKeys = globalThis.Object.getOwnPropertyNames(properties)
//   const optionalKeys = propertyKeys.filter(key => properties[key]?.[Optional])
//   const requiredKeys = propertyKeys.filter(name => !optionalKeys.includes(name))
//   const clonedProperties = propertyKeys.reduce(
//     (acc, key) => ({ ...acc, [key]: { ...properties[key] } }),
//     {} as STUrlFormProps
//   )
//   return (requiredKeys.length > 0
//     ? { ...options, [Kind]: 'urlForm', props: clonedProperties, required: requiredKeys }
//     : { ...options, [Kind]: 'urlForm', props: clonedProperties }) as unknown as STUrlForm<T>
// }

// MultipartForm
export type STMultipartFormValues = STSchema
export interface MultipartFormData<K extends string = string, V extends Static<STMultipartForm> = any> {
  headers: { type?: string; name: K; filename?: string }
  content: V
}
export interface STMultipartForm<T extends STProps = STProps> extends STSchema {
  [Kind]: 'multipartForm'
  static: T extends undefined
    ? {
        [k: string]: {
          headers: { type?: string; name: string; filename?: string }
          content: Static<STMultipartFormValues>
        }
      }
    : {
        [K in keyof T]: {
          headers: { type?: string; name: K; filename?: string }
          content: Static<T[K]>
        }
      }
  props: T
}
function _MultipartForm<T extends STProps>(properties?: T, options: Options = {}): STMultipartForm<T> {
  if (!properties) return { ...options, [Kind]: 'multipartForm' } as unknown as STMultipartForm<T>
  const propertyKeys = globalThis.Object.getOwnPropertyNames(properties)
  const optionalKeys = propertyKeys.filter(key => properties[key]?.[Optional])
  const requiredKeys = propertyKeys.filter(name => !optionalKeys.includes(name))
  const clonedProperties = propertyKeys.reduce((acc, key) => ({ ...acc, [key]: { ...properties[key] } }), {} as STProps)
  return (requiredKeys.length > 0
    ? { ...options, [Kind]: 'multipartForm', props: clonedProperties, required: requiredKeys }
    : { ...options, [Kind]: 'multipartForm', props: clonedProperties }) as unknown as STMultipartForm<T>
}

// Array
type NonEmptyArray<T> = [T, ...T[]]
export interface STArray<T extends STSchema = STSchema> extends STSchema {
  [Kind]: 'array'
  static: Static<T>[]
  items: T
}
export function _Array<T extends STSchema>(schema?: T, options: ArrayOptions = {}): STArray<T> {
  return {
    ...options,
    [Kind]: 'array',
    items: schema ?? _Any(),
  } as unknown as STArray<T>
}

// Union
type UnionStatic<T extends STSchema[], P extends unknown[]> = {
  [K in keyof T]: T[K] extends STSchema ? Static<T[K], P> : never
}[number]
export interface STUnion<T extends NonEmptyArray<STSchema> = NonEmptyArray<STSchema>> extends STSchema {
  [Kind]: 'union'
  static: UnionStatic<T, this['params']>
  props: T[number]['props']
  anyOf: T
}
export function _Union<T extends NonEmptyArray<STSchema>>(schemas: [...T], options: Options): STUnion<T> {
  const s = {
    ...options,
    [Kind]: 'union',
    anyOf: schemas as T,
    optional: () => ({ ...s, [Optional]: true }),
  }
  return s as unknown as STUnion<T>
}

// Intersection
type IntersectionStatic<T extends readonly STSchema[], P extends unknown[]> = T extends readonly [infer H, ...infer R]
  ? H extends STSchema
    ? R extends readonly STSchema[]
      ? Static<H, P> & IntersectionStatic<R, P>
      : never
    : never
  : unknown
export interface STIntersection<T extends NonEmptyArray<STObject | STUnion | STIntersection> = NonEmptyArray<STObject>>
  extends STSchema {
  [Kind]: 'intersection'
  static: IntersectionStatic<T, this['params']>
  props: T[number]['props']
  allOf: T
}

export function _Intersection<T extends NonEmptyArray<STObject | STUnion | STIntersection>>(
  schemas: [...T],
  options: Options
): STIntersection<T> {
  const s = {
    ...options,
    [Kind]: 'intersection',
    allOf: schemas as T,
    props: schemas.reduce(
      (b, c) => ({
        ...b,
        ...(c.props || {}),
        ...Object.fromEntries(
          Object.entries(b).filter(([_, v]) => (v as STSchema)[Kind] === 'literal' || !(v as STSchema)[Optional])
          // TODO: handle cases where left != right
        ),
      }),
      {}
    ) as STProps,
    optional: () => ({ ...s, [Optional]: true }),
  }
  return s as unknown as STIntersection<T>
}

// Stream
type STStreamable = STByteArray | STString | STMultipartForm | STObject | STUnion | STIntersection
export function _Stream<T extends STStreamable>(schema: T): STStream<T> {
  return {
    ...schema,
    [Stream]: true,
  } as unknown as STStream<T>
}
// Nullable
type STNullable<T extends STSchema> = STUnion<[T, STNull]>
// Nullish
type STNullish<T extends STSchema> = (T | STNull) & { [Kind]: 'union'; anyOf: [T, STNull]; [Optional]: true }
export class SchemaType {
  /** Creates an Optional Schema Type Wrapper */
  public optional<T extends STSchema>(schema: T): STOptional<T> {
    return { ...schema, [Optional]: true }
  }
  /** Creates an Nullable Schema Type Wrapper */
  public nullable<T extends STSchema>(schema: T): STNullable<T> {
    return { ..._Union([schema, _Null()], {}) }
  }
  /** Creates an Nullish Schema Type Wrapper */
  public nullish<T extends STSchema>(schema: T): STOptional<STNullable<T>> {
    return this.optional(this.nullable(schema)) as STOptional<STNullable<T>>
  }
  /** Creates a Null Schema Type */
  public null(options: Options = {}): STNull {
    return _Null(options)
  }
  /** Creates a ByteArray Schema Type */
  public byteArray(options: ByteArrayOptions = {}): STByteArray {
    return _ByteArray(options)
  }
  /** Creates a Boolean Schema Type */
  public boolean(options: Options = {}): STBoolean {
    return _Bool(options)
  }
  /** Creates a String Schema Type */
  public string(options: StringOptions = {}): STString {
    return _String(options)
  }
  /** Creates a Number Schema Type */
  public number(options: NumberOptions = {}): STNumber {
    return _Number(options)
  }
  /** Creates an Integer Schema Type */
  public integer(options: NumberOptions = {}): STInteger {
    return _Integer(options)
  }
  /** Creates a Literal Schema Type */
  public literal<T extends STLiteralValue>(value: T, options: Options = {}): STLiteral<T> {
    return _Literal(value, options)
  }
  /** Creates an Any Schema Type */
  public any(options: Options = {}): STAny {
    return _Any(options)
  }
  /** Creates an Object Schema Type */
  public object<T extends STProps>(properties?: T, options: Options = {}): STObject<T> {
    return _Object(properties, options)
  }
  /** Creates a JSON Schema Type */
  public json<T extends STString | STBoolean | STNumber | STObject<STProps>>(
    value: T,
    options: Options = {}
  ): STJson<T> {
    return _Json(value, options)
  }
  /** Creates an UrlForm Schema Type */
  // public urlForm<T extends STUrlFormProps>(properties?: T, options: Options = {}): STUrlForm<T> {
  //   return _UrlForm(properties, options)
  // }
  /** Creates a MultipartForm Schema Type */
  public multipartForm<T extends STProps>(properties?: T, options: Options = {}): STMultipartForm<T> {
    return _MultipartForm(properties, options)
  }
  /** Creates an Array Schema Type */
  public array<T extends STSchema>(schema?: T, options: Options = {}): STArray<T> {
    return _Array(schema, options)
  }
  /** Creates an Union Schema Type */
  public union<T extends NonEmptyArray<STSchema>>(schemas: [...T], options: Options = {}): STUnion<T> {
    return _Union(schemas, options)
  }
  /** Creates an Intersection Schema Type */
  public intersection<T extends NonEmptyArray<STObject | STUnion | STIntersection>>(
    schemas: [...T],
    options: Options = {}
  ): STIntersection<T> {
    return _Intersection(schemas, options)
  }
  /** Creates a Stream Schema Type */
  public stream<T extends STObject>(
    schema: T
  ): Omit<STStream<T>, 'static'> & {
    static: AsyncGenerator<
      T['props'] extends undefined
        ? { [k: string]: Static<STPropsValue> }
        : T['props'] extends STProps
        ? { [K in keyof T['props']]: [K, Static<T['props'][K]>] }[keyof T['props']]
        : never
    >
    params: unknown[]
  }
  public stream<T extends STUnion>(
    schema: T
  ): Omit<STStream<T>, 'static'> & {
    static: AsyncGenerator<
      Entries<{
        [P in KeysOfUnion<T['props']> as ValueAt<T['props'], P> extends STSchema ? P : never]: Static<
          ValueAt<T['props'], P>
        >
      }>
    >
    params: unknown[]
  }
  public stream<T extends STIntersection>(
    schema: T
  ): Omit<STStream<T>, 'static'> & {
    static: AsyncGenerator<
      T['props'] extends undefined
        ? never
        : T['props'] extends STProps
        ? Entries<{
            [K in keyof Static<T>]: Static<T>[K]
          }>
        : never
    >
    params: unknown[]
  }
  public stream<T extends STMultipartForm>(
    schema: T
  ): Omit<STStream<T>, 'static'> & {
    static: AsyncGenerator<
      T['props'] extends undefined
        ? {
            [k: string]: {
              headers: { type?: string; name: string; filename?: string }
              content: Static<STMultipartFormValues>
            }
          }
        : {
            [K in keyof T['props']]: {
              headers: { type?: string; name: K; filename?: string }
              content: Static<T['props'][K]>
            }
          }[keyof T['props']],
      void,
      unknown
    >
    params: unknown[]
  }
  public stream<T extends STByteArray>(
    schema: T
  ): Omit<STStream<T>, 'static'> & { static: AsyncGenerator<Uint8Array>; params: unknown[] }
  public stream<T extends STString>(
    schema: T
  ): Omit<STStream<T>, 'static'> & { static: AsyncGenerator<string>; params: unknown[] }
  public stream<T extends STStreamable>(schema: T): STStream<T> {
    return _Stream(schema)
  }
}
type KeysOfUnion<U> = U extends unknown ? keyof U : never
type ValueAt<U, K extends PropertyKey> = U extends unknown ? (K extends keyof U ? U[K] : never) : never

export const schemaToTypeStr = (schema: STSchema): string => {
  let type = 'unknown'
  let kind = schema[Kind]

  if (kind === 'null') type = 'null'
  else if (kind === 'boolean') type = 'boolean'
  else if (kind === 'byteArray') type = 'Uint8Array'
  else if (kind === 'number') type = 'number'
  else if (kind === 'integer') type = 'number'
  else if (kind === 'string') type = 'string'
  else if (kind === 'any') type = 'any'
  else if (kind === 'literal') {
    let value = (schema as STLiteral).value
    if (typeof value === 'string') type = `'${value}'`
    else type = String(value)
  } else if (kind === 'array') {
    type = `Array<${schemaToTypeStr((schema as STArray).items)}>`
  } else if (kind === 'object') {
    let props = (schema as STObject).props
    type = `{${Object.entries(props)
      .map(([k, v]) => `${typeof k === 'string' ? `'${k}'` : k}${v?.[Optional] ? '?' : ''}:${schemaToTypeStr(v)}`)
      .join(';')}}`
  } else if (kind === 'json') {
    type = `Json<${schemaToTypeStr({ ...schema, [Kind]: schema.type })}>`
  } else if (kind === 'union') {
    let anyOf = (schema as STUnion).anyOf
    type = anyOf.map(s => schemaToTypeStr(s)).join('|')
  } else if (kind === 'intersection') {
    let allOf = (schema as STIntersection).allOf
    type = allOf.map(s => schemaToTypeStr(s)).join('&')
  }

  // if (schema[Optional]) type = `${type}|undefined`

  return type
}
