import type {
  STArray,
  STIntersection,
  STJson,
  STLiteral,
  STNumber,
  STInteger,
  STObject,
  STSchema,
  STString,
  STUnion,
} from '../../../src/schema'

import { Galbe } from '../../../src'
import { walkRoutes, HttpStatus, matchMiddleware, parseMiddlewarePattern, splitHead } from '../../../src/util'
import { Kind, Optional } from '../../../src/schema'

import type { OpenAPIV3 } from 'openapi-types'

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
  // OpenAPI 3.0 schemas follow JSON Schema draft-4, where `exclusiveMinimum` /
  // `exclusiveMaximum` are booleans modifying `minimum` / `maximum`. 3.1 (JSON
  // Schema 2020-12) makes them the numeric bound itself.
  const draft4Bounds = version.startsWith('3.0')
  let paths: any = {}
  let components: OpenAPIV3.ComponentsObject = {
    securitySchemes: { ...g.config?.openapi?.securitySchemes },
    schemas: {},
    parameters: {},
    requestBodies: {},
    responses: {},
  }
  // A scheme the app declared is authoritative: never overwrite it with one
  // inferred from a route's Authorization header.
  const declaredSchemes = new Set(Object.keys(g.config?.openapi?.securitySchemes ?? {}))

  const schemaToOpenapi = (
    schema: STSchema
  ): { schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject; isJson?: boolean } => {
    let s = {}
    let kind = schema[Kind]
    let isJson = false

    if (components.schemas && (schema.id as string) in components.schemas) {
      //@ts-ignore
      return { schema: { $ref: `#/components/schemas/${schema.id}` } }
    }

    if (kind === 'null') {
      // OpenAPI 3.0 has no first-class null type; the canonical workaround
      // is `nullable: true` with `enum: [null]` to mean "must be null".
      s = { nullable: true, enum: [null] }
    } else if (kind === 'boolean') s = { type: 'boolean' }
    else if (kind === 'byteArray') s = { type: 'string', format: 'binary' }
    else if (kind === 'number' || kind === 'integer') {
      const n = schema as STNumber | STInteger
      // An exclusive bound wins over an inclusive one on the same side: draft-4
      // has a single `minimum`/`maximum` slot, and the exclusive form is the
      // one the parser emits when the source spec marked the bound exclusive.
      const lower = n.exclusiveMin !== undefined ? { value: n.exclusiveMin, exclusive: true } : n.min !== undefined ? { value: n.min, exclusive: false } : undefined
      const upper = n.exclusiveMax !== undefined ? { value: n.exclusiveMax, exclusive: true } : n.max !== undefined ? { value: n.max, exclusive: false } : undefined
      const bound = (b: typeof lower, key: 'minimum' | 'maximum') => {
        if (!b) return {}
        if (!b.exclusive) return { [key]: b.value }
        return draft4Bounds
          ? { [key]: b.value, [`exclusive${key[0]!.toUpperCase()}${key.slice(1)}`]: true }
          : { [`exclusive${key[0]!.toUpperCase()}${key.slice(1)}`]: b.value }
      }
      s = {
        type: kind,
        ...bound(lower, 'minimum'),
        ...bound(upper, 'maximum'),
      }
    } else if (kind === 'string') {
      const str = schema as STString
      let pattern = str.pattern?.toString()
      if (pattern) pattern = pattern.substring(1, pattern.length - 1)
      s = {
        type: 'string',
        ...(str.format ? { format: str.format } : {}),
        ...(pattern ? { pattern } : {}),
        ...(str.minLength !== undefined ? { minLength: str.minLength } : {}),
        ...(str.maxLength !== undefined ? { maxLength: str.maxLength } : {}),
      }
    } else if (kind === 'any') s = {}
    else if (kind === 'literal') {
      let value = (schema as STLiteral).value
      s = { type: 'string', enum: [value] }
    } else if (kind === 'array') {
      const arr = schema as STArray
      // ArrayOptions exposes minLength/maxLength (matching the schema-builder API);
      // OpenAPI calls them minItems/maxItems.
      s = {
        type: 'array',
        items: schemaToOpenapi(arr.items).schema,
        ...(arr.minLength !== undefined ? { minItems: arr.minLength } : {}),
        ...(arr.maxLength !== undefined ? { maxItems: arr.maxLength } : {}),
        ...(arr.unique ? { uniqueItems: arr.unique } : {}),
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
      const inner = (schema as STJson).value as STSchema | undefined
      isJson = true
      s = inner ? schemaToOpenapi(inner).schema : { type: 'object' }
    } else if (kind === 'anyOf' || kind === 'oneOf') {
      let members: STSchema[] = (schema as STUnion).members
      let nullable = members.some(s => s[Kind] === 'null')
      members = members.filter(s => s[Kind] !== 'null')

      const allStringLiterals =
        members.length > 0 && members.every(e => e[Kind] === 'literal' && typeof (e as STLiteral).value === 'string')
      const useOneOf = kind === 'oneOf'

      if (members.length === 0) {
        s = {}
      } else if (members.length === 1) {
        s = schemaToOpenapi(members[0]!).schema
      } else if (allStringLiterals && !useOneOf) {
        s = { type: 'string', enum: members.map(e => (e as STLiteral).value) }
      } else if (members.length > 1) {
        const variants = members.map(e => schemaToOpenapi(e).schema)
        s = useOneOf ? { oneOf: variants } : { anyOf: variants }
      }

      //@ts-ignore
      if (nullable) s.nullable = nullable
    } else if (kind === 'intersection') {
      let allOf: STSchema[] = (schema as STIntersection<any>).allOf
      if (allOf.length === 0) {
        s = {}
      } else if (allOf.length === 1) {
        s = schemaToOpenapi(allOf[0]!).schema
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
    // A Galbe schema has one `description`, which is where a parameter's own
    // description lives. It belongs on the Parameter Object, so lift it and
    // drop the copy the schema serializer emitted (same as response headers).
    if ((schema as any)?.description) delete (schema as any).description
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

  // middleware-file header meta applies to every operation in the file's scope
  const mwMeta = (g.metaMiddleware ?? [])
    .filter(m => m.header && Object.keys(m.header).length)
    .map(m => ({ segments: parseMiddlewarePattern(m.scope), header: m.header }))

  // meta keys and spec paths are relative to basePath; route paths carry it
  const prefix = g.router.prefix || ''
  const relPath = (p: string) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) || '/' : p)

  walkRoutes(g.router.routes, r => {
    const rPath = relPath(r.path)
    let meta = metaRoutes?.[rPath]?.[r.method]
    if (r.static?.root) meta = metaStatic[r.static?.root]?.static
    if (meta?.hide) return
    const inherited = mwMeta.filter(m => matchMiddleware(m.segments, rPath.split('/').filter(s => s !== '')))
    let path = rPath.replaceAll(/:([^\/]+)/g, '{$1}')
    if (!(path in paths)) paths[path] = {}
    const metaTags = (m?: Record<string, any>) => [
      ...(m?.tags?.split?.(' ')?.map((t: string) => t.trim()) || []),
      ...(typeof m?.tag === 'string' ? [m?.tag] : m?.tag || []),
    ]
    let tags = [...new Set([...metaTags(meta), ...inherited.flatMap(m => metaTags(m.header))])]
    let security: Record<string, any> = []
    let securityExplicitlyEmpty = false

    // route-level @security wins over the middleware files' scope-level one
    const metaSecRaw = meta?.security ?? inherited.find(m => m.header.security !== undefined)?.header.security
    if (metaSecRaw !== undefined) {
      const entries = Array.isArray(metaSecRaw) ? metaSecRaw : [metaSecRaw]
      for (const e of entries) {
        if (typeof e !== 'string') continue
        const trimmed = e.trim()
        if (trimmed === 'none' || trimmed === '') {
          securityExplicitlyEmpty = true
        } else {
          const [name, ...scopes] = trimmed.split(/\s+/)
          security.push({ [name!]: scopes })
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
              const str = v as STString
              if (str.pattern && str.pattern.toString() === '/^Bearer /') {
                if (!metaSecuritySet) security.push({ bearerAuth: [] })
                const scheme: OpenAPIV3.HttpSecurityScheme = { type: 'http', scheme: 'bearer' }
                if (typeof str.format === 'string') scheme.bearerFormat = str.format
                if (typeof str.description === 'string') scheme.description = str.description
                if (!components.securitySchemes) components.securitySchemes = {}
                if (!declaredSchemes.has('bearerAuth')) components.securitySchemes.bearerAuth = scheme
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
      // Like STResponseContent, a body map keys its bodies by media type; any
      // other key (`description`, `required`, `_requestBodyId`) is metadata
      // about the request body itself.
      const bodyMap = r.schema.body as Record<string, any>
      let description: string | undefined
      let conflictDescription = false
      let required = false
      let content = Object.fromEntries(
        Object.entries(bodyMap)
          .filter(([bodyType, schema]) => bodyType.includes('/') && schema)
          .map(([bodyType, schema]) => {
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
            return [bodyType, { schema: schemaToOpenapi(schema).schema }]
          })
      )
      requestBody = {
        description: typeof bodyMap.description === 'string' ? bodyMap.description : description,
        required: typeof bodyMap.required === 'boolean' ? bodyMap.required : required,
        content,
      }
      // a body that came from components.requestBodies is emitted once and referenced
      if (components.requestBodies && bodyMap._requestBodyId) {
        components.requestBodies[bodyMap._requestBodyId as string] = requestBody
        requestBody = { $ref: `#/components/requestBodies/${bodyMap._requestBodyId}` } as any
      }
    }
    let responses
    if (r.schema.response && Object.keys(r.schema.response).length) {
      responses = Object.fromEntries(
        Object.entries(r.schema.response).map(([status, v]) => {
          if (!v) return []
          let s = status as keyof typeof HttpStatus | 'default'
          const isContentMap = !(v as any)[Kind]
          const explicitHeaders = (v as any)?.responseHeaders as Record<string, STSchema> | undefined
          let response: OpenAPIV3.ResponseObject

          if (isContentMap) {
            // STResponseContent — every key holding a media type is a body; the
            // rest (`description`, `example`, `examples`, `responseHeaders`,
            // `_responseId`) is response-level metadata. Media types always
            // contain a '/', which is what separates the two.
            const cm = v as any
            const desc = cm.description || HttpStatus[s as keyof typeof HttpStatus] || 'Response'
            const content: Record<string, { schema: any; example?: any; examples?: Record<string, any> }> = {}
            for (const [key, bodySchema] of Object.entries(cm)) {
              if (!key.includes('/') || !bodySchema) continue
              const { schema: oaSchema } = schemaToOpenapi(bodySchema as STSchema)
              content[key] = { schema: oaSchema }
              // response-level example(s) apply to every media type offered
              const ex = (bodySchema as any)?.examples ?? cm.examples
              const exSingle = (bodySchema as any)?.example ?? cm.example
              if (ex && Object.keys(ex).length) content[key]!.examples = ex
              if (exSingle !== undefined) content[key]!.example = exSingle
            }
            response = { description: desc, ...(Object.keys(content).length ? { content } : {}) }
          } else {
            const statusNum = Number(s)
            const noBodyStatus = statusNum === 204 || statusNum === 304 || (statusNum >= 100 && statusNum < 200)
            const noContent = noBodyStatus && (v as any)[Kind] === 'null'
            if (noContent) {
              response = {
                description: (v as any).description || HttpStatus[s as keyof typeof HttpStatus] || 'Response',
              }
            } else {
              let { schema, isJson } = schemaToOpenapi(v as STSchema)
              let resolved = resolveRef(schema)
              let { type, format } = resolved
              let hasComposite = !!(resolved as any)?.allOf || !!(resolved as any)?.anyOf || !!(resolved as any)?.oneOf
              const mediaType = schemaToMedia({ type, format, isJson } as SchemaType, hasComposite)
              const explicitExamples = (v as any)?.examples as Record<string, any> | undefined
              const explicitExample = (v as any)?.example
              const content: Record<string, { schema: typeof schema; example?: any; examples?: Record<string, any> }> = {
                [mediaType]: { schema: { ...schema } },
              }
              if (explicitExamples && Object.keys(explicitExamples).length) content[mediaType]!.examples = explicitExamples
              if (explicitExample !== undefined) content[mediaType]!.example = explicitExample
              response = {
                description: (v as any).description || HttpStatus[s as keyof typeof HttpStatus] || 'Response',
                content,
              }
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
              if ((hSer as any)?.description) delete (hSer as any).description
              response.headers[hName] = headerObj
            }
          }

          // `_responseId` marks a response that came from components.responses.
          // Register the fully-built response — headers included — and refer to
          // it: a Reference Object tolerates no sibling keys in 3.0.
          const respId = (v as any)?._responseId
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
    const { summary, description } = splitHead(meta?.head)
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
  const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)
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
      ...g.config?.openapi?.info,
    },
    // basePath is a deploy location, not API structure: it is stripped from
    // `paths` and surfaced through `servers` unless explicitly configured
    ...(g.config?.openapi?.servers
      ? { servers: g.config.openapi.servers }
      : prefix
        ? { servers: [{ url: prefix }] }
        : {}),
    paths,
    components: Object.keys(components)?.length ? components : undefined,
  }
}
