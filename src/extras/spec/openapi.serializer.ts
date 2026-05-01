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

const schemaToMedia = ({ type, format, isJson }: SchemaType, hasComposite = false) =>
  isJson || hasComposite || (type && ['object', 'number', 'boolean', 'array'].includes(type))
    ? 'application/json'
    : format === 'byte' || format === 'binary'
      ? 'application/octet-stream'
      : type === 'string'
        ? 'text/plain'
        : 'application/json'

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
    else if (kind === 'byteArray') s = { type: 'string', format: 'binary' }
    else if (kind === 'number')
      s = {
        type: 'number',
        ...(exclusiveMinimum !== undefined ? { exclusiveMinimum } : {}),
        ...(exclusiveMaximum !== undefined ? { exclusiveMaximum } : {}),
        ...(minimum !== undefined ? { minimum } : {}),
        ...(maximum !== undefined ? { maximum } : {}),
      }
    else if (kind === 'integer')
      s = {
        type: 'integer',
        ...(exclusiveMinimum !== undefined ? { exclusiveMinimum } : {}),
        ...(exclusiveMaximum !== undefined ? { exclusiveMaximum } : {}),
        ...(minimum !== undefined ? { minimum } : {}),
        ...(maximum !== undefined ? { maximum } : {}),
      }
    else if (kind === 'string')
      s = {
        type: 'string',
        ...(schema?.format ? { format: schema.format } : {}),
        ...(pattern ? { pattern } : {}),
        ...(minLength !== undefined ? { minLength } : {}),
        ...(maxLength !== undefined ? { maxLength } : {}),
      }
    else if (kind === 'any') s = {}
    else if (kind === 'literal') {
      let value = (schema as STLiteral).value
      s = { type: 'string', enum: [value] }
    } else if (kind === 'array') {
      s = {
        type: 'array',
        items: schemaToOpenapi((schema as STArray).items).schema,
        ...(minItems !== undefined ? { minItems } : {}),
        ...(maxItems !== undefined ? { maxItems } : {}),
        ...(uniqueItems ? { uniqueItems } : {}),
      }
    } else if (kind === 'object' || kind === 'multipartForm') {
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

      const allStringLiterals =
        anyOf.length > 0 && anyOf.every(e => e[Kind] === 'literal' && typeof (e as STLiteral).value === 'string')
      const useOneOf = (schema as any)?._oneOf === true

      if (anyOf.length === 0) {
        s = {}
      } else if (anyOf.length === 1) {
        s = schemaToOpenapi(anyOf[0]).schema
      } else if (allStringLiterals && !useOneOf) {
        s = { type: 'string', enum: anyOf.map(e => (e as STLiteral).value) }
      } else if (anyOf.length > 1) {
        const variants = anyOf.map(e => schemaToOpenapi(e).schema)
        s = useOneOf ? { oneOf: variants } : { anyOf: variants }
      }

      //@ts-ignore
      if (nullable) s.nullable = nullable
    } else if (kind === 'intersection') {
      let allOf: STSchema[] = (schema as STIntersection<any>).allOf
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

    s = {
      title: schema.title,
      description: schema.description,
      ...s,
      ...(schema?.default !== undefined ? { default: schema.default } : {}),
      ...(schema?.examples !== undefined ? { example: schema.examples } : {}),
    }
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
    let securityExplicitlyEmpty = false

    const metaSecRaw = meta?.security
    if (metaSecRaw !== undefined) {
      const entries = Array.isArray(metaSecRaw) ? metaSecRaw : [metaSecRaw]
      for (const e of entries) {
        if (typeof e !== 'string') continue
        const trimmed = e.trim()
        if (trimmed === 'none' || trimmed === '') {
          securityExplicitlyEmpty = true
        } else {
          const [name, ...scopes] = trimmed.split(/\s+/)
          security.push({ [name]: scopes })
          if (name === 'bearerAuth' && components.securitySchemes && !components.securitySchemes.bearerAuth) {
            components.securitySchemes.bearerAuth = { type: 'http', scheme: 'bearer' }
          }
        }
      }
    }

    let pathParam = r.schema?.params
      ? Object.entries(r.schema?.params as Record<string, STSchema>).map(([k, v]) => parseParam(k, v, 'path'))
      : []
    let queryParam = r.schema?.query
      ? Object.entries(r.schema?.query as Record<string, STSchema>).map(([k, v]) => parseParam(k, v, 'query'))
      : []
    const metaSecuritySet = security.length > 0
    let headerParam = r.schema?.headers
      ? Object.entries(r.schema?.headers as Record<string, STSchema>)
          .map(([k, v]) => {
            let p = parseParam(k, v, 'header')
            if (k.match(/authorization/i)) {
              // TODO: handle other auth methods
              if (v.pattern && v?.pattern?.toString() === '/^Bearer /') {
                if (!metaSecuritySet) security.push({ bearerAuth: [] })
                const scheme: OpenAPIV3.HttpSecurityScheme = { type: 'http', scheme: 'bearer' }
                if (typeof v.format === 'string') scheme.bearerFormat = v.format
                if (typeof v.description === 'string') scheme.description = v.description
                components.securitySchemes = { bearerAuth: scheme }
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
          if (!schema?.[Optional]) required = true
          if (isDefined) {
            if (description === undefined) {
              description = s
            } else if (description !== s) {
              conflictDescription = true
            }
          }
          description = conflictDescription ? undefined : (description ?? undefined)
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
          const noContent = (v as any)?._noContent === true
          const explicitHeaders = (v as any)?._headers as Record<string, STSchema> | undefined
          let response: OpenAPIV3.ResponseObject
          if (noContent) {
            response = {
              description:
                (v as any)?._description ||
                v.description ||
                HttpStatus[s as keyof typeof HttpStatus] ||
                'Response',
            }
          } else {
            let { schema, isJson } = schemaToOpenapi(v)
            let resolved = resolveRef(schema)
            let { type, format } = resolved
            let hasComposite = !!(resolved as any)?.allOf || !!(resolved as any)?.anyOf || !!(resolved as any)?.oneOf
            const explicitMedia = (v as any)?._media as string[] | undefined
            const mediaList =
              explicitMedia && explicitMedia.length
                ? explicitMedia
                : [schemaToMedia({ type, format, isJson } as SchemaType, hasComposite)]
            const explicitExamples = (v as any)?._examples as Record<string, any> | undefined
            const explicitExample = (v as any)?._example
            const content: Record<
              string,
              { schema: typeof schema; example?: any; examples?: Record<string, any> }
            > = {}
            for (const m of mediaList) {
              content[m] = { schema: { ...schema } }
              if (explicitExamples && Object.keys(explicitExamples).length) {
                content[m].examples = explicitExamples
              }
              if (explicitExample !== undefined) {
                content[m].example = explicitExample
              }
            }
            response = {
              description:
                (v as any)?._description ||
                v.description ||
                HttpStatus[s as keyof typeof HttpStatus] ||
                'Response',
              content,
            }
          }
          if (explicitHeaders && Object.keys(explicitHeaders).length) {
            response.headers = {}
            for (const [hName, hSchema] of Object.entries(explicitHeaders)) {
              const isRequired = !(hSchema as any)?.[Optional]
              const stripped = { ...(hSchema as any), [Optional]: false } as STSchema
              const { schema: hSer } = schemaToOpenapi(stripped)
              const headerObj: OpenAPIV3.HeaderObject = {
                ...((hSchema as any)?.description ? { description: (hSchema as any).description } : {}),
                ...(isRequired ? { required: true } : {}),
                schema: hSer,
              }
              // header schema's own description is duplicated above; remove from inner schema for cleanliness
              if ((hSer as any)?.description) delete (hSer as any).description
              response.headers[hName] = headerObj
            }
          }
          const respSchema = r.schema.response?.[s] as any
          const respId = respSchema?._responseId
          if (components.responses && respId) {
            components.responses[respId as string] = response
            //@ts-ignore
            response = { $ref: `#/components/responses/${respId}` }
          }
          return [s, response]
        })
      )
    } else {
      responses = {
        default: { description: HttpStatus[200] },
      }
    }
    const head: string = meta?.head ?? ''
    let summary: string | undefined
    let description: string | undefined
    if (head) {
      const firstBlank = head.indexOf('\n\n')
      if (firstBlank === -1) {
        const nl = head.indexOf('\n')
        summary = (nl === -1 ? head : head.slice(0, nl)).trim() || undefined
      } else {
        summary = head.slice(0, firstBlank).trim() || undefined
        description = head.slice(firstBlank + 2).trim() || undefined
      }
    }
    paths[path][r.method] = {
      tags: tags.length ? tags : undefined,
      summary,
      description,
      operationId: meta?.operationId,
      parameters: parameters.length ? parameters : undefined,
      requestBody,
      responses,
      ...(security.length ? { security } : securityExplicitlyEmpty ? { security: [] } : {}),
      deprecated: meta?.deprecated ? true : undefined,
    }
  })

  // Promote parameters that appear with the exact same shape on more than
  // one operation into components.parameters and replace each occurrence
  // with a $ref. Naming: the parameter's `name`, capitalised; collisions
  // with different shapes get suffixed.
  const stableStringify = (v: any): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v)
    if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
    const keys = Object.keys(v).sort()
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`
  }
  const paramHashes = new Map<string, { count: number; param: any }>()
  for (const path of Object.values(paths) as any[]) {
    for (const m of Object.keys(path)) {
      if (m === 'parameters') continue
      for (const p of path[m]?.parameters || []) {
        if (p.$ref) continue
        const key = stableStringify(p)
        const entry = paramHashes.get(key)
        if (entry) entry.count++
        else paramHashes.set(key, { count: 1, param: p })
      }
    }
  }
  const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
  const promoted = new Map<string, string>() // hash -> component name
  const usedNames = new Set<string>(Object.keys(components.parameters || {}))
  for (const [hash, { count, param }] of paramHashes) {
    if (count < 2) continue
    let base = cap(String(param.name || 'Param')).replace(/[^A-Za-z0-9]/g, '')
    let name = base
    let i = 2
    while (usedNames.has(name)) name = `${base}${i++}`
    usedNames.add(name)
    promoted.set(hash, name)
    components.parameters![name] = param
  }
  if (promoted.size) {
    for (const path of Object.values(paths) as any[]) {
      for (const m of Object.keys(path)) {
        if (m === 'parameters') continue
        const op = path[m]
        if (!op?.parameters) continue
        op.parameters = op.parameters.map((p: any) => {
          if (p.$ref) return p
          const name = promoted.get(stableStringify(p))
          return name ? { $ref: `#/components/parameters/${name}` } : p
        })
      }
    }
  }

  //@ts-ignore
  components = Object.entries(components).reduce(
    (p, [k, v]) => {
      if (Object.keys(v).length) p[k] = v
      return p
    },
    {} as Record<string, OpenAPIV3.ComponentsObject>
  )
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
