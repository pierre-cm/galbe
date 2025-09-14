import type {
  STArray,
  STIntersection,
  STJson,
  STLiteral,
  STObject,
  STProps,
  STSchema,
  STUnion,
} from '../../../src/schema'

import { Galbe } from '../../../src'
import { walkRoutes, HttpStatus, inferContentType } from '../../../src/util'
import { Kind, Optional } from '../../../src/schema'

import { OpenAPIV3 } from 'openapi-types'

type SchemaType = { type: string; format: string; isJson: boolean }

const schemaToMedia = ({ type, format, isJson }: SchemaType) =>
  isJson || (type && ['object', 'number', 'boolean', 'array'].includes(type))
    ? 'application/json'
    : format === 'byte'
    ? 'application/octet-stream'
    : type === 'string'
    ? 'text/plain'
    : '*/*'

export const OpenAPISerializer = async (g: Galbe, version = '3.0.3'): Promise<OpenAPIV3.Document> => {
  let paths: any = {}
  let components: OpenAPIV3.ComponentsObject = {
    securitySchemes: {},
    schemas: {},
    parameters: {},
    requestBodies: {},
    responses: {},
  }

  const schemaToOpenapi = (
    schema: STSchema
  ): { schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject; isJson?: boolean } => {
    let s = {}
    let kind = schema[Kind]
    let isJson = false

    let pattern = schema?.pattern?.toString()
    if (pattern) pattern = pattern.substring(1, pattern.length - 1)

    let minLength = schema?.minLength
    let maxLength = schema?.maxLength
    let minimum = schema?.min
    let maximum = schema?.max
    let exclusiveMinimum = schema?.exclusiveMin
    let exclusiveMaximum = schema?.exclusiveMax
    let minItems = schema?.minItems
    let maxItems = schema?.maxItems
    let uniqueItems = schema?.unique

    if (components.schemas && (schema.id as string) in components.schemas) {
      //@ts-ignore
      return { schema: { $ref: `#/components/schemas/${schema.id}` } }
    }

    if (kind === 'null') {
      s = {
        anyOf: ['null'],
      }
    } else if (kind === 'boolean') s = { type: 'boolean' }
    else if (kind === 'byteArray') s = { type: 'string', format: 'byte' }
    else if (kind === 'number')
      s = {
        type: 'number',
        ...(exclusiveMinimum ? { exclusiveMinimum } : {}),
        ...(exclusiveMaximum ? { exclusiveMaximum } : {}),
        ...(minimum ? { minimum } : {}),
        ...(maximum ? { maximum } : {}),
      }
    else if (kind === 'integer')
      s = {
        type: 'integer',
        ...(exclusiveMinimum ? { exclusiveMinimum } : {}),
        ...(exclusiveMaximum ? { exclusiveMaximum } : {}),
        ...(minimum ? { minimum } : {}),
        ...(maximum ? { maximum } : {}),
      }
    else if (kind === 'string')
      s = {
        type: 'string',
        ...(pattern ? { pattern } : {}),
        ...(minLength ? { minLength } : {}),
        ...(maxLength ? { maxLength } : {}),
      }
    else if (kind === 'any') s = { type: 'string' }
    else if (kind === 'literal') {
      let value = (schema as STLiteral).value
      s = { type: 'string', enum: [value] }
    } else if (kind === 'array') {
      s = {
        type: 'array',
        items: schemaToOpenapi((schema as STArray).items).schema,
        ...(minItems ? { minItems } : {}),
        ...(maxItems ? { maxItems } : {}),
        ...(uniqueItems ? { uniqueItems } : {}),
      }
    } else if (kind === 'object') {
      let props = (schema as STObject).props || {}
      let required = Object.entries(props)
        .filter(([_, v]) => !v?.[Optional])
        .map(([k, _]) => k)
      s = {
        type: 'object',
        properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, schemaToOpenapi(v).schema])),
        ...(required.length ? { required } : {}),
      }
    } else if (kind === 'json') {
      let props = ((schema as STJson).props || {}) as STProps
      let type = (schema as STJson).type
      if (type === 'unknown') type = 'object'
      let required = Object.entries(props)
        .filter(([_, v]) => !v?.[Optional])
        .map(([k, _]) => k)
      isJson = true
      s = {
        type: type,
        ...(type === 'object'
          ? {
              properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, schemaToOpenapi(v).schema])),
              ...(required.length ? { required } : {}),
            }
          : {}),
      }
    } else if (kind === 'union') {
      let anyOf: STSchema[] = (schema as STUnion).anyOf
      let nullable = anyOf.some(s => s[Kind] === 'null')
      anyOf = anyOf.filter(s => s[Kind] !== 'null')

      if (anyOf.length === 0) {
        s = {}
      } else if (anyOf.length === 1) {
        s = schemaToOpenapi(anyOf[0]).schema
      } else if (anyOf.length > 1) {
        s = {
          anyOf: anyOf.map(e => schemaToOpenapi(e).schema),
        }
      }

      //@ts-ignore
      if (nullable) s.nullable = nullable
    } else if (kind === 'intersection') {
      let allOf: STSchema[] = (schema as STIntersection).allOf
      if (allOf.length === 0) {
        s = {}
      } else if (allOf.length === 1) {
        s = schemaToOpenapi(allOf[0]).schema
      } else if (allOf.length > 1) {
        s = {
          allOf: allOf.map(s => schemaToOpenapi(s).schema),
        }
      }
    }

    s = { title: schema.title, description: schema.description, ...s }
    if (components.schemas && schema.id) {
      components.schemas[schema.id] = s
      return { schema: { $ref: `#/components/schemas/${schema.id}` } }
    }
    return { schema: s, isJson }
  }

  const resolveRef = (schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject): OpenAPIV3.SchemaObject => {
    if (!(schema as OpenAPIV3.ReferenceObject)?.$ref) return schema as OpenAPIV3.SchemaObject
    let ref = (schema as OpenAPIV3.ReferenceObject)?.$ref
    let match = ref.match('^#/components/(schemas|requestBodies|responses)/(.*)$')
    if (!match) throw new Error(`Invalid schema ref ${ref}`)
    let [_, kind, refPath] = match as [string, keyof typeof components, string]
    //@ts-ignore
    return refPath.split('/').reduce((c, k) => {
      if (c && k in c) return c[k]
      else return undefined
    }, components[kind])
  }

  const parseParam = (key: string, param: STSchema, kind: 'query' | 'header' | 'path' | 'cookie') => {
    let { schema } = schemaToOpenapi({ ...param, [Optional]: false })
    let p: OpenAPIV3.ParameterObject = {
      name: key,
      in: kind,
      description: param?.description,
      required: kind === 'path' ? true : !param[Optional] || undefined,
      deprecated: param.deprecated,
      schema,
    }
    if (components.parameters && param.id) components.parameters[param.id] = p
    return p
  }

  const metaRoutes = g.meta?.reduce(
    (routes, c) => ({ ...routes, ...c.routes }),
    {} as Record<string, Record<string, Record<string, any>>>
  )
  let metaStatic = Object.fromEntries(Object.entries(metaRoutes || {}).filter(([_, d]) => d?.static))

  walkRoutes(g.router.routes, r => {
    let meta = metaRoutes?.[r.path]?.[r.method]
    if (r.static?.root) meta = metaStatic[r.static?.root]?.static
    if (meta?.hide) return
    let path = r.path.replaceAll(/:([^\/]+)/g, '{$1}')
    if (!(path in paths)) paths[path] = {}
    let tags = [
      ...(meta?.tags?.split(' ')?.map((t: string) => t.trim()) || []),
      ...(typeof meta?.tag === 'string' ? [meta?.tag] : meta?.tag || []),
    ]
    let security: Record<string, any> = []

    let pathParam = r.schema?.params
      ? Object.entries(r.schema?.params as Record<string, STSchema>).map(([k, v]) => parseParam(k, v, 'path'))
      : []
    let queryParam = r.schema?.query
      ? Object.entries(r.schema?.query as Record<string, STSchema>).map(([k, v]) => parseParam(k, v, 'query'))
      : []
    let headerParam = r.schema?.headers
      ? Object.entries(r.schema?.headers as Record<string, STSchema>)
          .map(([k, v]) => {
            let p = parseParam(k, v, 'header')
            if (k.match(/authorization/i)) {
              // TODO: handle other auth methods
              if (v.pattern && v?.pattern?.toString() === '/^Bearer /') {
                security.push({ bearerAuth: [] })
                components.securitySchemes = { bearerAuth: { type: 'http', scheme: 'bearer' } }
                return null
              }
            }
            return p
          })
          .filter(p => p)
      : []
    // TODO cookieParam
    let parameters = [...pathParam, ...queryParam, ...headerParam]

    let requestBody
    if (r.schema.body) {
      let description: string | undefined
      let conflictDescription = false
      let required = false
      let content = Object.fromEntries(
        Object.entries(r.schema.body).map(([bodyType, schema]) => {
          const s = schema.description
          const isDefined = typeof s === 'string' && s !== ''
          if (s?.[Optional] === false) required = true
          if (isDefined) {
            if (description === undefined) {
              description = s
            } else if (description !== s) {
              conflictDescription = true
            }
          }
          description = conflictDescription ? undefined : description ?? undefined
          return [inferContentType(bodyType), { schema: schemaToOpenapi(schema).schema }]
        })
      )
      requestBody = {
        description,
        required,
        content,
      }
    }
    let responses
    if (r.schema.response && Object.keys(r.schema.response).length) {
      responses = Object.fromEntries(
        Object.entries(r.schema.response).map(([status, v]) => {
          if (!v) return []
          let s = status as keyof typeof HttpStatus | 'default'
          let { schema, isJson } = schemaToOpenapi(v)
          let { type, format } = resolveRef(schema)
          let media = schemaToMedia({ type, format, isJson } as SchemaType)
          let response: OpenAPIV3.ResponseObject = {
            description: v.description || HttpStatus[s as keyof typeof HttpStatus] || 'Response',
            content: { [media]: { schema: schema } },
          }
          if (components.responses && r.schema.response?.[s]?.id) {
            components.responses[r.schema.response?.[s]?.id as string] = response
            //@ts-ignore
            response = { $ref: `#/components/responses/${r.schema.response?.[s].id}` }
          }
          return [s, response]
        })
      )
    } else {
      responses = {
        default: { description: HttpStatus[200] },
      }
    }
    let summary = meta?.head.match(/^([^\n]+)/)?.[1]
    paths[path][r.method] = {
      tags: tags.length ? tags : undefined,
      summary: summary,
      operationId: meta?.operationId,
      parameters: parameters.length ? parameters : undefined,
      requestBody,
      responses,
      ...(security.length ? { security } : {}),
      deprecated: meta?.deprecated ? true : undefined,
    }
  })

  //@ts-ignore
  components = Object.entries(components).reduce((p, [k, v]) => {
    if (Object.keys(v).length) p[k] = v
    return p
  }, {} as Record<string, OpenAPIV3.ComponentsObject>)
  return {
    openapi: version,
    info: {
      title: 'Galbe app',
      version: '0.1.0',
    },
    paths,
    components: Object.keys(components)?.length ? components : undefined,
  }
}
