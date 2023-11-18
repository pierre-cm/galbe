import {
  TSchema,
  TBoolean,
  TNumber,
  TInteger,
  TString,
  TLiteral,
  TNull,
  TArray,
  TObject,
  TProperties,
  TUnion,
  TAny,
  Static,
  TypeBuilder,
  Kind,
  Optional,
  SchemaOptions,
  TypeClone,
  TOptional,
  ArrayOptions,
  TLiteralValue,
  NumericOptions,
  TypeGuard,
  ObjectOptions,
  StringOptions
} from '@sinclair/typebox'

export class KadreType extends TypeBuilder {
  public Optional<T extends TSchema>(schema: T): TOptional<T> {
    return { ...TypeClone.Clone(schema), [Optional]: 'Optional' }
  }
  public Any(options: SchemaOptions = {}): TAny {
    return this.Create({ ...options, [Kind]: 'Any' })
  }
  public Array<T extends TSchema>(schema: T, options: ArrayOptions = {}): TArray<T> {
    return this.Create({ ...options, [Kind]: 'Array', type: 'array', items: TypeClone.Clone(schema) })
  }
  public Boolean(options: SchemaOptions = {}): TBoolean {
    return this.Create({ ...options, [Kind]: 'Boolean', type: 'boolean' })
  }
  public Integer(options: NumericOptions<number> = {}): TInteger {
    return this.Create({ ...options, [Kind]: 'Integer', type: 'integer' })
  }
  public Literal<T extends TLiteralValue>(value: T, options: SchemaOptions = {}): TLiteral<T> {
    return this.Create({
      ...options,
      [Kind]: 'Literal',
      const: value,
      type: typeof value as 'string' | 'number' | 'boolean'
    })
  }
  public Null(options: SchemaOptions = {}): TNull {
    return this.Create({ ...options, [Kind]: 'Null', type: 'null' })
  }
  public Number(options: NumericOptions<number> = {}): TNumber {
    return this.Create({ ...options, [Kind]: 'Number', type: 'number' })
  }
  public Object<T extends TProperties>(properties: T, options: ObjectOptions = {}): TObject<T> {
    const propertyKeys = Object.getOwnPropertyNames(properties)
    const optionalKeys = propertyKeys.filter(key => TypeGuard.TOptional(properties[key]))
    const requiredKeys = propertyKeys.filter(name => !optionalKeys.includes(name))
    const clonedAdditionalProperties = TypeGuard.TSchema(options.additionalProperties)
      ? { additionalProperties: TypeClone.Clone(options.additionalProperties) }
      : {}
    const clonedProperties = propertyKeys.reduce(
      (acc, key) => ({ ...acc, [key]: TypeClone.Clone(properties[key]) }),
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
  public String(options: StringOptions = {}): TString {
    return this.Create({ ...options, [Kind]: 'String', type: 'string' })
  }
}

export const T = new KadreType()

export type {
  TSchema,
  TBoolean,
  TNumber,
  TInteger,
  TString,
  TLiteral,
  TArray,
  TObject,
  TProperties,
  TUnion,
  TAny,
  Static
}
