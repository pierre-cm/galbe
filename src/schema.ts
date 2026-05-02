export const Kind = Symbol.for('Galbe.SchemaType.Kind')
export const Optional = Symbol.for('Galbe.SchemaType.Optional')
export const Stream = Symbol.for('Galbe.SchemaType.Stream')

export interface Options {
  id?: string
  title?: string
  description?: string
  default?: any
  example?: any
  /**
   * On a response schema: a map of named examples (OpenAPI content-level
   * `examples`). On any other schema: a single example value.
   */
  examples?: any
  /**
   * Response-only: declares response headers. Each value is a Galbe schema
   * describing the header's value type.
   */
  headers?: Record<string, any>
  /** Marks the schema as deprecated. Surfaced by spec generators (e.g. OpenAPI). */
  deprecated?: boolean
  /**
   * Response-only: declares response headers emitted in the OpenAPI `responses` object.
   * Distinct from the request-level `headers` field.
   */
  responseHeaders?: Record<string, any>
}
export interface ByteArrayOptions extends Options {
  minLength?: number
  maxLength?: number
}
export interface StringOptions extends Options {
  minLength?: number
  maxLength?: number
  pattern?: RegExp
  format?: string
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
    | 'anyOf'
    | 'oneOf'
    | 'intersection'
  [Optional]?: boolean
  [Stream]?: boolean
  params: unknown[]
  static: unknown
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
export interface STString extends STSchema, StringOptions {
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
  static: Static<T>
  value: T
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
function _Json<T extends STBoolean | STNumber | STString | STObject>(value: T, options: Options = {}): STJson<T> {
  const k = value?.[Kind]
  if (k !== 'boolean' && k !== 'number' && k !== 'string' && k !== 'object') {
    throw new Error('Invalid Json type definition')
  }
  return {
    ...options,
    [Kind]: 'json',
    value,
  } as unknown as STJson<T>
}

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
export interface STArray<T extends STSchema = STSchema> extends STSchema, ArrayOptions {
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
  [Kind]: 'anyOf' | 'oneOf'
  static: UnionStatic<T, this['params']>
  members: T
}
export function _Union<T extends NonEmptyArray<STSchema>>(
  kind: 'anyOf' | 'oneOf',
  schemas: [...T],
  options: Options
): STUnion<T> {
  const s = {
    ...options,
    [Kind]: kind,
    members: schemas as T,
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
// type Intersecs = NonEmptyArray<STObject | STUnion | STIntersection>
export interface STIntersection<T extends NonEmptyArray<STObject | STUnion | STIntersection<any>>> extends STSchema {
  [Kind]: 'intersection'
  static: IntersectionStatic<T, this['params']>
  allOf: T
}

export function _Intersection<T extends NonEmptyArray<STObject | STUnion | STIntersection<any>>>(
  schemas: [...T],
  options: Options
): STIntersection<T> {
  const s = {
    ...options,
    [Kind]: 'intersection',
    allOf: schemas as T,
    optional: () => ({ ...s, [Optional]: true }),
  }
  return s as unknown as STIntersection<T>
}

// Stream
type STStreamable = STByteArray | STString | STMultipartForm | STObject | STUnion | STIntersection<any>
export function _Stream<T extends STStreamable>(schema: T): STStream<T> {
  return {
    ...schema,
    [Stream]: true,
  } as unknown as STStream<T>
}
// Nullable
type STNullable<T extends STSchema> = STUnion<[T, STNull]>
// Nullish
type STNullish<T extends STSchema> = (T | STNull) & { [Kind]: 'anyOf'; members: [T, STNull]; [Optional]: true }
export class SchemaType {
  /** Creates an Optional Schema Type Wrapper */
  public optional<T extends STSchema>(schema: T): STOptional<T> {
    return { ...schema, [Optional]: true }
  }
  /** Creates an Nullable Schema Type Wrapper */
  public nullable<T extends STSchema>(schema: T): STNullable<T> {
    return { ..._Union('anyOf', [schema, _Null()], {}) }
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
  /** Creates a MultipartForm Schema Type */
  public multipartForm<T extends STProps>(properties?: T, options: Options = {}): STMultipartForm<T> {
    return _MultipartForm(properties, options)
  }
  /** Creates an Array Schema Type */
  public array<T extends STSchema>(schema?: T, options: ArrayOptions = {}): STArray<T> {
    return _Array(schema, options)
  }
  /** Creates an anyOf Schema Type (alias: `union`) */
  public anyOf<T extends NonEmptyArray<STSchema>>(schemas: [...T], options: Options = {}): STUnion<T> {
    return _Union('anyOf', schemas, options)
  }
  /** Creates a oneOf Schema Type */
  public oneOf<T extends NonEmptyArray<STSchema>>(schemas: [...T], options: Options = {}): STUnion<T> {
    return _Union('oneOf', schemas, options)
  }
  /** @deprecated Use `anyOf` instead */
  public union<T extends NonEmptyArray<STSchema>>(schemas: [...T], options: Options = {}): STUnion<T> {
    return _Union('anyOf', schemas, options)
  }
  /** Creates an Intersection Schema Type */
  public intersection<T extends NonEmptyArray<STObject | STUnion | STIntersection<any>>>(
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
        [P in KeysOfUnion<MemberProps<T['members'][number]>> as ValueAt<
          MemberProps<T['members'][number]>,
          P
        > extends STSchema
          ? P
          : never]: Static<ValueAt<MemberProps<T['members'][number]>, P>>
      }>
    >
    params: unknown[]
  }
  public stream<T extends STIntersection<any>>(
    schema: T
  ): Omit<STStream<T>, 'static'> & {
    static: AsyncGenerator<
      MemberProps<T['allOf'][number]> extends undefined
        ? never
        : MemberProps<T['allOf'][number]> extends STProps
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
type MemberProps<U> = U extends { props: infer P } ? P : never

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
    type = `Json<${schemaToTypeStr((schema as STJson).value)}>`
  } else if (kind === 'anyOf' || kind === 'oneOf') {
    let members = (schema as STUnion).members
    type = members.map(s => schemaToTypeStr(s)).join('|')
  } else if (kind === 'intersection') {
    let allOf = (schema as STIntersection<any>).allOf
    type = allOf.map((s: STSchema) => schemaToTypeStr(s)).join('&')
  }

  // if (schema[Optional]) type = `${type}|undefined`

  return type
}
