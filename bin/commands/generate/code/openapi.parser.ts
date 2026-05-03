import { semver } from 'bun'
import { transformSync } from '@swc/core'
import { resolve, relative, dirname } from 'path'
import { OpenAPIV3 } from 'openapi-types'

type SchemaEntry = {
  key: string
  prefix: string
  schema: string
  dependsOn: Set<string>
  usedBy: Set<string>
  /** Response-only: the original component-level description, kept distinct
   * from the inner schema's own description. */
  responseDescription?: string
  /** Response-only: content-level single example. */
  responseExample?: any
  /** Response-only: content-level multi-key examples. */
  responseExamples?: Record<string, any>
}
type EndpointEntry = {
  version?: string
  visibility?: 'public' | 'private'
  scope?: string
  method?: 'get' | 'put' | 'patch' | 'post' | 'delete' | 'options' | 'head'
  path?: string
  schema?: { imports: Record<string, string>; name: string; def: string }
  endpoint?: { meta?: string; def?: string }
}

// Util
const unref = (code: string, cb: (m: string) => string) => code.replaceAll(/%ref:([^%]*)%/g, (_, m) => cb(m))
const refToPath = (ref: string, basePath?: string) => {
  let result: string | null = null
  let match = ref.match(/^#\/(paths|components)\/(.*)$/)
  if (!match) return null
  let [_, type, path] = match
  if (type === 'components') {
    let [t] = path.split('/')
    if (!t) return null
    if (t === 'schemas') result = `schemas/commons.schema`
    if (t === 'requestBodies') result = `schemas/requests.schema`
    if (t === 'responses') result = `schemas/responses.schema`
  } else if (type === 'paths') {
    result = `schemas/${path}`
  }
  if (!result) return null
  if (basePath) {
    let relPath = relative(basePath, result)
    return relPath.includes('/') ? relPath : `./${relPath}` //resolve(basePath, relPath)
  } else return result
}
const orderDeps = (deps: Record<string, SchemaEntry>) => {
  let stack = Object.keys(deps)
  let l = new Set<string>()
  const ascend = (d: { dependsOn: Set<string> }, visiting: Set<string>) => {
    for (let p of d.dependsOn) {
      if (visiting.has(p) || l.has(p)) continue
      if (p in deps) {
        visiting.add(p)
        ascend(deps[p], visiting)
        l.add(p)
        let idx = stack.indexOf(p)
        if (idx >= 0) stack.splice(idx, 1)
      }
    }
  }
  while (stack.length) {
    let k = stack.pop()
    if (!k) continue
    let d = deps[k]
    ascend(d, new Set([k]))
    if (!l.has(k)) {
      l.add(k)
    }
  }
  return Object.fromEntries([...l].map(k => [k, deps[k]]))
}
const serialize = (obj: any) => {
  return JSON.stringify(obj, (k, value) => {
    if (k === 'pattern' && value) return `__PATTERN__${value}__ENDPATTERN__`
    return value
  }).replace(/"__PATTERN__([\s\S]*?)__ENDPATTERN__"/g, (_, body) => {
    const decoded = JSON.parse(`"${body}"`) as string
    return `/${decoded.replace(/\//g, '\\/')}/`
  })
}

const writeCodeFile = async (path: string, content: string, target: 'js' | 'ts') => {
  if (target === 'js') {
    content = transformSync(content, {
      jsc: {
        parser: {
          syntax: 'typescript',
        },
        preserveAllComments: true,
        target: 'esnext',
      },
    }).code
  }
  await Bun.write(`${path}.${target}`, content)
}

const parseOapiSchema = (
  os?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  details: { id?: string; title?: string; description?: string } = {},
  extra?: { media?: string }
): string => {
  if (!os) {
    return `$T.any(${details && Object.keys(details).length ? JSON.stringify(details) : ''})`
  }
  //@ts-ignore
  const ref: string | undefined = os?.$ref
  if (ref) return `%ref:${ref}%`
  os = os as OpenAPIV3.SchemaObject
  let options: typeof details & {
    min?: number
    max?: number
    exclusiveMin?: number
    exclusiveMax?: number
    minLength?: number
    maxLength?: number
    pattern?: string
    format?: string
    minItems?: number
    maxItems?: number
    unique?: boolean
    default?: any
    examples?: any
  } = {
    ...details,
    title: os.title,
    description: details.description || os.description,
    default: os.default,
    ...(os.example !== undefined ? { examples: os.example } : {}),
  }

  let resp = ''
  let hasOptions = Object.values(options).some(v => v !== undefined)
  let optArg = hasOptions ? serialize(options) : ''
  let anyOf = os.oneOf || os.anyOf
  let allOf = os.allOf

  if (os.discriminator) {
    const propName = os.discriminator.propertyName
    const mapEntries = Object.entries(os.discriminator.mapping || {})
    resp = `$T.union([${mapEntries
      .map(
        ([k, s]) =>
          `$T.intersection([$T.object({\"${propName}\":$T.literal(\"${k}\")}),${parseOapiSchema({
            $ref: s,
          })}])`
      )
      .join(',')}], ${serialize(options)})`
  } else if (anyOf?.length) {
    if (anyOf.length === 1) resp = parseOapiSchema(anyOf[0] as OpenAPIV3.SchemaObject, details, extra)
    else {
      const builder = os.oneOf ? '$T.oneOf' : '$T.anyOf'
      resp = `${builder}([${anyOf.map(s => parseOapiSchema(s as OpenAPIV3.SchemaObject)).join(',')}]${optArg ? `, ${optArg}` : ''})`
    }
  } else if (allOf?.length) {
    if (allOf.length === 1) resp = parseOapiSchema(allOf[0] as OpenAPIV3.SchemaObject, details, extra)
    else {
      resp = `$T.intersection([${allOf.map(s => parseOapiSchema(s as OpenAPIV3.SchemaObject)).join(',')}], ${serialize(
        options
      )})`
    }
  } else if (!os?.type) {
    return `$T.any(${hasOptions ? optArg : ''})`
  } else if (os.type === 'boolean') resp = `$T.boolean(${hasOptions ? serialize(options) : ''})`
  else if (os.type === 'number') {
    let { max, min, exclusiveMax, exclusiveMin } = {
      max: os.maximum !== undefined && !os.exclusiveMaximum ? os.maximum : undefined,
      min: os.minimum !== undefined && !os.exclusiveMinimum ? os.minimum : undefined,
      exclusiveMax: os.maximum !== undefined && os.exclusiveMaximum ? os.maximum : undefined,
      exclusiveMin: os.minimum !== undefined && os.exclusiveMinimum ? os.minimum : undefined,
    }
    options = { ...options, min, max, exclusiveMax, exclusiveMin }
    hasOptions = Object.values(options).some(v => v !== undefined)
    resp = `$T.number(${hasOptions ? serialize(options) : ''})`
  } else if (os.type === 'integer') {
    let max = os.maximum !== undefined && !os.exclusiveMaximum ? os.maximum : undefined
    let min = os.minimum !== undefined && !os.exclusiveMinimum ? os.minimum : undefined
    let exclusiveMax = os.maximum !== undefined && os.exclusiveMaximum ? os.maximum : undefined
    let exclusiveMin = os.minimum !== undefined && os.exclusiveMinimum ? os.minimum : undefined
    options = { ...options, min, max, exclusiveMax, exclusiveMin }
    hasOptions = Object.values(options).some(v => v !== undefined)
    resp = `$T.integer(${hasOptions ? serialize(options) : ''})`
  } else if (os.type === 'string') {
    if (os.format === 'binary') resp = `$T.byteArray(${hasOptions ? serialize(options) : ''})`
    else if (os.enum?.length === 1) {
      resp = `$T.literal("${os.enum[0]}")`
    } else if (os.enum?.length) {
      const literals = os.enum.map(v => `$T.literal("${v}")`).join(', ')
      resp = `$T.union([${literals}]${optArg ? `, ${optArg}` : ''})`
    } else {
      let minLength = os.minLength
      let maxLength = os.maxLength
      let pattern = os.pattern
      let format = os.format
      options = { ...options, minLength, maxLength, pattern, format }
      hasOptions = Object.values(options).some(v => v !== undefined)
      resp = `$T.string(${hasOptions ? serialize(options) : ''})`
    }
  } else if (os.type === 'array') {
    // Galbe's ArrayOptions uses minLength/maxLength/unique (mirroring the
    // builder API), not OpenAPI's minItems/maxItems/uniqueItems names.
    let minLength = os.minItems
    let maxLength = os.maxItems
    let unique = os.uniqueItems
    options = { ...options, minLength, maxLength, unique }
    hasOptions = Object.values(options).some(v => v !== undefined)
    optArg = hasOptions ? serialize(options) : ''
    resp = `$T.array(${parseOapiSchema(os?.items)}${optArg ? `, ${optArg}` : ''})`
  } else if (os.type === 'object') {
    let required = new Set(os.required || [])
    let props = Object.entries(os?.properties || {})
      .map(([k, v]) => {
        v = v as OpenAPIV3.SchemaObject
        const isRequired = required.has(k)
        const w = (s: string) => {
          if (!isRequired && v.nullable) return `$T.nullish(${s})`
          else if (!isRequired) return `$T.optional(${s})`
          else if (v.nullable) return `$T.nullable(${s})`
          return s
        }
        return `"${k}":${w(parseOapiSchema(v))}`
      })
      .join(',')
    if (extra?.media === 'multipart/form-data') {
      resp = `$T.multipartForm({${props}}${optArg ? `, ${optArg}` : ''})`
    } else if (extra?.media === 'application/x-www-form-urlencoded') {
      resp = `$T.object({${props}}${optArg ? `, ${optArg}` : ''})`
    } else {
      resp = `$T.object({${props}}${optArg ? `, ${optArg}` : ''})`
    }
  } else throw new Error(`Unknown schema type ${JSON.stringify(os)}`)

  return resp
}

const buildSchemaIndex = (def: OpenAPIV3.Document) => {
  let index: Record<string, SchemaEntry> = {}

  const initSchema = (k: string, s: any, kind: 'schemas' | 'requestBodies' | 'responses') => {
    let schema = ''
    let dependsOn = new Set<string>()
    let responseExample: any = undefined
    let responseExamples: Record<string, any> | undefined = undefined
    if (kind === 'schemas') schema = parseOapiSchema(s, { id: k })
    else if (kind === 'requestBodies') {
      let schemas = [] as string[]
      if (!!s.content) {
        const contentMap = (s as OpenAPIV3.RequestBodyObject)?.content || { null: {} }
        schemas = [...new Set(Object.entries(contentMap).map(([media, v]) => parseOapiSchema(v.schema, { id: k }, { media })))]
      } else {
        schemas = [parseOapiSchema(undefined, { id: k, ...s })]
      }
      schema = schemas.length <= 0 ? '' : schemas.length === 1 ? schemas[0] : `$T.union([${schemas.join(',')}])`
    } else if (kind === 'responses') {
      if (!s.content) {
        schema = parseOapiSchema(undefined, { id: k, ...s })
      } else {
        const contentMap = s.content as Record<string, { schema?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject; example?: any; examples?: any }>
        const entries = Object.entries(contentMap)
        for (const [, v] of entries) {
          if (v.example !== undefined && responseExample === undefined) responseExample = v.example
          if (v.examples && Object.keys(v.examples).length) responseExamples = { ...(responseExamples || {}), ...v.examples }
        }
        const keyGroups: Record<string, string[]> = {}
        for (const [media, v] of entries) {
          const galbeKey = media
          const schemaStr = parseOapiSchema(v.schema, {}, { media })
          if (!keyGroups[galbeKey]) keyGroups[galbeKey] = []
          keyGroups[galbeKey].push(schemaStr)
        }
        const uniqueKeys = Object.keys(keyGroups)
        if (uniqueKeys.length <= 1) {
          const [key] = uniqueKeys
          const uniqueSchemas = [...new Set(keyGroups[key] || [])]
          schema = uniqueSchemas.length === 0 ? '' : uniqueSchemas.length === 1 ? uniqueSchemas[0] : `$T.union([${uniqueSchemas.join(',')}])`
        } else {
          const parts = Object.entries(keyGroups).map(([k, schemas]) => {
            const unique = [...new Set(schemas)]
            return `"${k}": ${unique.length === 1 ? unique[0] : `$T.union([${unique.join(',')}])`}`
          })
          schema = `{${parts.join(',')}}`
        }
      }
    }
    schema = unref(schema, m => {
      let l = m.split('/')
      dependsOn.add(m)
      return l[l.length - 1]
    })
    index[`#/components/${kind}/${k}`] = {
      key: k,
      prefix: '',
      schema,
      dependsOn,
      usedBy: new Set(),
      ...(kind === 'responses' && typeof s?.description === 'string' && s.description
        ? { responseDescription: s.description }
        : {}),
      ...(kind === 'responses' && responseExample !== undefined ? { responseExample } : {}),
      ...(kind === 'responses' && responseExamples ? { responseExamples } : {}),
    }
  }
  for (let [k, v] of Object.entries(def.components?.schemas || {})) initSchema(k, v, 'schemas')
  for (let [k, v] of Object.entries(def.components?.requestBodies || {})) initSchema(k, v, 'requestBodies')
  for (let [k, v] of Object.entries(def.components?.responses || {})) initSchema(k, v, 'responses')

  Object.entries(index).forEach(([k, v]) => {
    for (let d of v.dependsOn) index[d]?.usedBy.add(k)
  })

  return index
}

const resolveParamRef = (
  ref: string,
  components: OpenAPIV3.ComponentsObject | undefined
): OpenAPIV3.ParameterObject | undefined => {
  let match = ref.match(/^#\/components\/parameters\/(.+)$/)
  if (!match) return undefined
  let target = components?.parameters?.[match[1]]
  if (!target) return undefined
  if ('$ref' in target) return resolveParamRef(target.$ref, components)
  return target
}

const parseEndpointDef = (
  method: string,
  path: string,
  def?: OpenAPIV3.OperationObject,
  components?: OpenAPIV3.ComponentsObject
) => {
  if (!def) return {}
  let imports: Record<string, string> = {}
  let p = path.replaceAll(/\{([^\}]*)\}/g, ':$1')
  // let description = def.summary || def.description
  let schemaName = def.operationId
    ? def.operationId.replace(/^\w/, c => c.toUpperCase())
    : `${method}${path
        .replaceAll(/\{([^\}]+)\}/g, (_, p) => `By${p.replace(/^\w/, (c: string) => c.toUpperCase())}`)
        .replaceAll(/[^$\w\d_]+([$\w\d_])/g, (_, $1) => $1.toUpperCase())
      }`.replace(/^\w/, c => c.toUpperCase())

  let meta = '/**\n'
  if (def.summary) meta += ` * ${def.summary}\n *\n`
  if (def.description) meta += ` * ${def.description.replace(/\n/g, '\n * ')}\n`
  if (def.operationId) meta += ` * @operationId ${def.operationId}\n`
  if (def.externalDocs?.url) meta += ` * @externalDocs ${def.externalDocs.url}\n`
  if (def.tags) meta += ` * @tags ${def.tags.join(' ')}\n`
  if (Array.isArray(def.security)) {
    if (def.security.length === 0) {
      meta += ` * @security none\n`
    } else {
      for (const s of def.security) {
        const keys = Object.keys(s)
        if (keys.length === 0) {
          meta += ` * @security none\n`
        } else {
          for (const k of keys) {
            const scopes = (s as any)[k] as string[]
            meta += ` * @security ${k}${scopes && scopes.length ? ` ${scopes.join(' ')}` : ''}\n`
          }
        }
      }
    }
  }
  if (def.deprecated) meta += ' * @deprecated\n'
  meta += ' */'
  let endpoint = `${method}("${p}", ${schemaName}, ctx => {\n  throw new NotImplementedError()\n})`

  let sp: Record<string, Record<string, string>> = { path: {}, query: {}, header: {}, body: {}, formData: {} } // TODO handle body and formData cases

  for (let _p of def?.parameters || []) {
    let p: OpenAPIV3.ParameterObject | undefined
    if ('$ref' in _p) {
      p = resolveParamRef(_p.$ref, components)
      if (!p) continue
    } else p = _p as OpenAPIV3.ParameterObject
    if (!sp[p.in]) continue
    let o = (s: string) => {
      const [_, so] = [...(s.match(/^\$T.optional\((.*)\)$/) || [])]
      s = so ?? s
      return p.in !== 'path' && !p.required ? `$T.optional(${s})` : s
    }
    sp[p.in][p.name] = o(
      unref(parseOapiSchema(p.schema, { description: p.description }), m => {
        let l = m.split('/')
        imports[l[l.length - 1]] = m
        return l[l.length - 1]
      })
    )
  }

  let [schemaParams, schemaQuery, schemaHeaders] = [
    { g: 'params', o: 'path' },
    { g: 'query', o: 'query' },
    { g: 'headers', o: 'header' },
  ].map(({ g, o }) =>
    Object.keys(sp[o]).length
      ? `  ${g}: {${Object.entries(sp[o])
          .map(([k, v]) => `"${k}":${v}`)
          .join(',')}}`
      : ''
  )

  let body = ''
  if (!['get', 'delete', 'options', 'head'].includes(method)) {
    let _rb = def?.requestBody as OpenAPIV3.ReferenceObject
    if (_rb?.$ref) {
      body = unref(`  body: %ref:${_rb.$ref}%`, m => {
        let l = m.split('/')
        imports[l[l.length - 1]] = m
        return l[l.length - 1]
      })
    } else {
      let rb = def?.requestBody as OpenAPIV3.RequestBodyObject
      let o = (s: string) => (!rb?.required ? `$T.optional(${s})` : s)
      let bs = [
        ...new Set(
          Object.entries(rb?.content || { null: {} }).map(([media, v]) => [
            media,
            unref(parseOapiSchema(v.schema, undefined, { media }), m => {
              let l = m.split('/')
              imports[l[l.length - 1]] = m
              return l[l.length - 1]
            }),
          ])
        ),
      ]
      body = bs.length ? `  body: {${bs.map(([k, v]) => `"${k}":${o(v)}`).join(',')}}` : ''
    }
  }

  let resp = ''
  let r = def?.responses
  let rs = Object.fromEntries(
    Object.entries(r || {}).map(([status, sv]) => {
      let s: string = Number.isInteger(Number(status)) ? status : 'default'

      //@ts-ignore
      let rootRef = sv?.$ref
        ? unref(parseOapiSchema(sv), m => {
            let l = m.split('/')
            imports[l[l.length - 1]] = m
            return l[l.length - 1]
          })
        : null
      if (rootRef) return [s, rootRef]

      const respObj = sv as OpenAPIV3.ResponseObject
      const content = respObj?.content || {}

      // Collect response-level headers
      const headerEntries: string[] = []
      for (const [hName, hVal] of Object.entries(respObj?.headers || {})) {
        if ('$ref' in (hVal as any)) continue
        const h = hVal as OpenAPIV3.HeaderObject
        const headerSchema = unref(
          parseOapiSchema(h.schema || ({ type: 'string' } as any), { description: h.description }),
          m => {
            let l = m.split('/')
            imports[l[l.length - 1]] = m
            return l[l.length - 1]
          }
        )
        headerEntries.push(`${JSON.stringify(hName)}:${h.required ? headerSchema : `$T.optional(${headerSchema})`}`)
      }
      const description = typeof respObj?.description === 'string' && respObj.description ? respObj.description : undefined

      if (Object.keys(content).length === 0) {
        let nullSchema = description ? `$T.null({description:${JSON.stringify(description)}})` : `$T.null()`
        if (headerEntries.length) nullSchema = `({...${nullSchema}, responseHeaders:{${headerEntries.join(',')}}})`
        return [s, nullSchema]
      }

      // Group schemas by galbe body key, collect examples
      const keyGroups: Record<string, string[]> = {}
      const exampleParts: string[] = []
      let singleExample: any = undefined
      for (const [mediaType, tv] of Object.entries(content)) {
        const galbeKey = mediaType
        if ((tv as any).example !== undefined && singleExample === undefined) singleExample = (tv as any).example
        if (tv.examples && Object.keys(tv.examples).length) {
          for (const [k, ex] of Object.entries(tv.examples)) exampleParts.push(`${JSON.stringify(k)}:${JSON.stringify(ex)}`)
        }
        const schemaStr = unref(parseOapiSchema(tv.schema), m => {
          let l = m.split('/')
          imports[l[l.length - 1]] = m
          return l[l.length - 1]
        })
        if (!keyGroups[galbeKey]) keyGroups[galbeKey] = []
        keyGroups[galbeKey].push(schemaStr)
      }

      const uniqueKeys = Object.keys(keyGroups)

      if (uniqueKeys.length > 1) {
        // Multiple body keys → STResponseContent object
        const parts: string[] = []
        for (const [key, schemas] of Object.entries(keyGroups)) {
          const unique = [...new Set(schemas)]
          parts.push(`"${key}": ${unique.length === 1 ? unique[0] : `$T.union([${unique.join(',')}])`}`)
        }
        if (description) parts.push(`description: ${JSON.stringify(description)}`)
        if (headerEntries.length) parts.push(`responseHeaders: {${headerEntries.join(',')}}`)
        if (exampleParts.length) parts.push(`examples: {${exampleParts.join(',')}}`)
        if (singleExample !== undefined) parts.push(`example: ${JSON.stringify(singleExample)}`)
        return [s, `{${parts.join(',')}}`]
      } else {
        // Single body key → STResponseContent object (preserves exact media type key)
        const [key] = uniqueKeys
        const unique = [...new Set(keyGroups[key] || [])]
        let schemaStr = unique.length === 0 ? `$T.null()` : unique.length === 1 ? unique[0] : `$T.union([${unique.join(',')}])`
        // Embed per-media-type example/examples inside the schema spread so the
        // content-map serializer can read them from the per-key body schema.
        const perKeyExtras: string[] = []
        if (exampleParts.length) perKeyExtras.push(`examples:{${exampleParts.join(',')}}`)
        if (singleExample !== undefined) perKeyExtras.push(`example:${JSON.stringify(singleExample)}`)
        if (perKeyExtras.length) schemaStr = `({...${schemaStr},${perKeyExtras.join(',')}})`
        const parts: string[] = []
        if (key) parts.push(`"${key}":${schemaStr}`)
        if (description) parts.push(`description:${JSON.stringify(description)}`)
        if (headerEntries.length) parts.push(`responseHeaders:{${headerEntries.join(',')}}`)
        return [s, `{${parts.join(',')}}`]
      }
    })
  )

  if (Object.keys(rs).length) {
    resp = `  response: {${Object.entries(rs)
      .filter(([_, v]) => v)
      .map(([s, v]) => `${s}: ${v}`)
      .join(',')}}`
  } else resp = ''

  let schema = [schemaHeaders, schemaParams, schemaQuery, body, resp].filter(s => s)

  return {
    schema: {
      name: schemaName,
      imports,
      def: schema.length ? `{\n${schema.join(',\n')}\n}` : '',
    },
    endpoint: {
      meta,
      def: endpoint,
    },
  }
}

const parseEndpoints = (def: OpenAPIV3.Document) => {
  let endpoints: Record<string, EndpointEntry> = {}
  for (let [fullPath, pathVal] of Object.entries(def.paths || {})) {
    if (!pathVal) continue
    let match = fullPath.match(/^\/?(?:(v\d+)[^\/]*\/)?(?:\/?(public|private))?\/?([^\/]+)\/?(.*)$/)
    if (!match) continue
    let [_, version, visibility, scope, path] = [...match]
    path = `/${path}`
    let methods = ['get', 'put', 'patch', 'post', 'delete', 'options', 'head'] as const
    let pathParams = pathVal.parameters || []
    for (let m of methods) {
      let endpointDef = pathVal?.[m]
      if (!endpointDef) continue
      let ref = `#/paths${version ? `/${version}` : ''}${visibility ? `/${visibility}` : ''}${
        scope ? `/${scope}` : ''
      }/${m}${path}`
      let opParams = endpointDef.parameters || []
      let opKeys = new Set(
        opParams
          .map(p => {
            let resolved = '$ref' in p ? resolveParamRef(p.$ref, def.components) : (p as OpenAPIV3.ParameterObject)
            return resolved ? `${resolved.in}:${resolved.name}` : null
          })
          .filter((k): k is string => k !== null)
      )
      let inheritedParams = pathParams.filter(p => {
        let resolved = '$ref' in p ? resolveParamRef(p.$ref, def.components) : (p as OpenAPIV3.ParameterObject)
        if (!resolved) return false
        return !opKeys.has(`${resolved.in}:${resolved.name}`)
      })
      let mergedDef = { ...endpointDef, parameters: [...inheritedParams, ...opParams] }
      let { schema, endpoint } = parseEndpointDef(m, fullPath, mergedDef, def.components)
      endpoints[ref] = {
        version,
        visibility: visibility as 'public' | 'private',
        method: m,
        scope,
        path,
        schema,
        endpoint,
      }
    }
  }
  return endpoints
}

const COMPONENT_TYPE_MAP = {
  schemas: 'commons',
  requestBodies: 'requests',
  responses: 'responses',
} as const

const renderComponentSchemaFile = (
  schemas: Record<string, SchemaEntry>,
  type: 'schemas' | 'requestBodies' | 'responses'
): string => {
  if (Object.keys(schemas).length === 0) return ''
  let imports: Record<string, string[]> = {}
  let decl: string[] = []
  Object.entries(schemas).forEach(([k, s]) => {
    if (s.key === s.schema && s.dependsOn.size === 1) {
      let depMatch = [...s.dependsOn][0].match(/^#\/components\/([^\/]+)\/([^\/]+)/)
      if (!depMatch) return
      let [_, depOrig, depName] = [...depMatch]
      decl.push(`export { ${depName} } from './${COMPONENT_TYPE_MAP[depOrig as keyof typeof COMPONENT_TYPE_MAP]}.schema'\n`)
      return
    }
    for (let dep of [k, ...s.dependsOn]) {
      let depMatch = dep.match(/^#\/components\/([^\/]+)\/([^\/]+)/)
      if (!depMatch) continue
      let [_, depOrig, depName] = [...depMatch]
      if (depOrig !== type) {
        if (!(depOrig in imports)) imports[depOrig] = []
        imports[depOrig].push(depName)
      }
    }
    // For requestBodies/responses that are just a single ref to another schema,
    // preserve identity by tagging a _responseId / _requestBodyId rather than
    // aliasing it (which would lose the original component name in the spec).
    const isSingleAlias =
      (type === 'responses' || type === 'requestBodies') &&
      s.dependsOn.size === 1 &&
      s.schema.trim() === [...s.dependsOn][0].split('/').pop()
    const responseExtras: string[] = []
    if (type === 'responses') {
      if (s.responseDescription) responseExtras.push(`description: ${JSON.stringify(s.responseDescription)}`)
      if (s.responseExample !== undefined) responseExtras.push(`example: ${JSON.stringify(s.responseExample)}`)
      if (s.responseExamples) responseExtras.push(`examples: ${JSON.stringify(s.responseExamples)}`)
    }
    if (isSingleAlias) {
      const tagKey = type === 'responses' ? '_responseId' : '_requestBodyId'
      const extras = [`${tagKey}: "${s.key}"`, ...responseExtras]
      decl.push(
        `export const ${s.key} = { ...${s.schema}, ${extras.join(', ')} } as typeof ${s.schema}\nexport type ${s.key} = Static<typeof ${s.key}>\n`
      )
    } else if (type === 'responses' && responseExtras.length) {
      decl.push(
        `export const ${s.key} = {...${s.schema}, ${responseExtras.join(', ')}}\nexport type ${s.key} = Static<typeof ${s.key}>\n`
      )
    } else {
      decl.push(`export const ${s.key} = ${s.schema}\nexport type ${s.key} = Static<typeof ${s.key}>\n`)
    }
  })
  if (decl.length === 0) return ''
  return `import type { Static } from 'galbe/schema'\nimport { $T } from 'galbe'\n${Object.entries(imports)
    .map(
      ([k, v]) =>
        `import { ${[...new Set(v)].join(', ')} } from './${COMPONENT_TYPE_MAP[k as keyof typeof COMPONENT_TYPE_MAP]}.schema'\n`
    )
    .join('\n')}\n${decl.join('\n')}\n`
}

export type RoutePlanEntry = {
  /** HTTP method, lowercase (matches the property accessed on `g`). */
  method: string
  /** Path as emitted in the call expression: full prefix included, OpenAPI braces converted to `:param`. Stable identity for diff/rename. */
  path: string
  schemaName: string
  /** JSDoc block string (e.g. '/**\n * summary\n *\/'). */
  meta: string
  /** Rendered call expression body, e.g. 'get("/path", FooSchema, ctx => { ... })'. */
  call: string
}

export type ScopePlan = {
  /** e.g. '/main', '/v1/public/admin'. */
  scopeKey: string
  /** Output path without extension, e.g. 'routes/main.route'. */
  routeFile: string
  /** Output path without extension, e.g. 'schemas/main.schema'. */
  schemaFile: string
  /** Imports to inject in the scope schema file: relative path -> imported names. */
  schemaImports: Record<string, string[]>
  /** 'export const X = {...}' declarations for the scope schema file. */
  schemaDecls: string[]
  /** Schema names to import in the scope route file from its sibling schema file. */
  routeSchemaImports: string[]
  routes: RoutePlanEntry[]
}

export type GenerationPlan = {
  /** Component schema files (commons/requests/responses), ready to write. Path is relative to outDir without extension. */
  componentFiles: { path: string; content: string }[]
  scopes: ScopePlan[]
  target: 'js' | 'ts'
}

export const buildPlan = (
  endpoints: Record<string, EndpointEntry>,
  schemaIndex: Record<string, SchemaEntry>,
  target: 'js' | 'ts'
): GenerationPlan => {
  const componentFiles: { path: string; content: string }[] = []
  const sMaps = [
    { g: 'commons', o: 'schemas' },
    { g: 'requests', o: 'requestBodies' },
    { g: 'responses', o: 'responses' },
  ] as const
  for (let { g, o } of sMaps) {
    let content = renderComponentSchemaFile(
      orderDeps(
        Object.fromEntries(
          Object.entries(schemaIndex).filter(([k, _]) => {
            return k.match(new RegExp(`^#/components/${o}/`))
          })
        )
      ),
      o
    )
    if (content) componentFiles.push({ path: `schemas/${g}.schema`, content })
  }

  let scopedDefs = Object.entries(endpoints).reduce<Record<string, EndpointEntry[]>>((p, [_, v]) => {
    let scopeKey = `${v.version ? `/${v.version}` : ''}${v.visibility ? `/${v.visibility}` : ''}${
      v.scope ? `/${v.scope}` : '/main'
    }`
    if (!(scopeKey in p)) p[scopeKey] = []
    p[scopeKey].push(v)
    return p
  }, {})

  const scopes: ScopePlan[] = []
  for (let [scopeKey, def] of Object.entries(scopedDefs)) {
    let routeFile = `routes${scopeKey}.route`
    let schemaFile = `schemas${scopeKey}.schema`

    let sImports: Record<string, Set<string>> = {}
    let sDecl: string[] = []
    let rImports: Set<string> = new Set()
    let routes: RoutePlanEntry[] = []

    for (let d of def) {
      Object.entries(d.schema?.imports || {}).forEach(([iK, dep]) => {
        let k = refToPath(dep, dirname(schemaFile))
        if (!k) return
        if (!(k in sImports)) sImports[k] = new Set()
        sImports[k].add(iK)
      })
      sDecl.push(`export const ${d.schema?.name} = ${d.schema?.def}`)

      let ep = d.endpoint
      if (!ep) continue
      if (d.schema?.name) rImports.add(d.schema?.name)
      // Source of truth for the path is the rendered call expression itself —
      // reconstructing from version/visibility/scope/path drifts on edge cases
      // (e.g. an empty trailing segment yields `/users/` instead of `/users`).
      const callPathMatch = (ep.def ?? '').match(/^\w+\("([^"]*)"/)
      const emittedPath = callPathMatch?.[1] ?? ''
      routes.push({
        method: d.method ?? '',
        path: emittedPath,
        schemaName: d.schema?.name ?? '',
        meta: ep.meta ?? '',
        call: ep.def ?? '',
      })
    }

    scopes.push({
      scopeKey,
      routeFile,
      schemaFile,
      schemaImports: Object.fromEntries(Object.entries(sImports).map(([k, v]) => [k, [...v]])),
      schemaDecls: sDecl,
      routeSchemaImports: [...rImports],
      routes,
    })
  }

  return { componentFiles, scopes, target }
}

export type ApplyPlanOptions = {
  /** Override the route file content for given scope keys. When set, the value is written verbatim
   * instead of fresh-rendering from the plan — used by the merger to preserve user code. */
  routeContents?: Map<string, string>
}

export const applyPlan = async (plan: GenerationPlan, outDir: string, opts: ApplyPlanOptions = {}): Promise<void> => {
  const { target } = plan

  for (const f of plan.componentFiles) {
    await writeCodeFile(resolve(outDir, f.path), f.content, target)
  }

  for (const scope of plan.scopes) {
    if (scope.schemaDecls.length) {
      const schemaContent =
        `import { $T } from 'galbe'\n\n` +
        `${Object.entries(scope.schemaImports)
          .map(([k, v]) => `import { ${v.join(', ')} } from '${k}'`)
          .join('\n')}\n\n` +
        `${scope.schemaDecls.join('\n\n')}\n`
      await writeCodeFile(resolve(outDir, scope.schemaFile), schemaContent, target)
    }

    if (scope.routes.length) {
      const override = opts.routeContents?.get(scope.scopeKey)
      let routeContent: string
      if (override !== undefined) {
        routeContent = override
      } else {
        const deepness = scope.scopeKey.split('/').length - 1
        const importPath = `${Array(deepness).fill('../').join('')}schemas${scope.scopeKey}.schema`
        const rDecl = scope.routes.map(r => `  ${r.meta}\ng.${r.call}`)
        routeContent =
          `import { NotImplementedError, type Galbe } from 'galbe'\n` +
          `import { ${scope.routeSchemaImports.join(', ')} } from '${importPath}'\n\n` +
          `export default (g: Galbe) => {\n` +
          rDecl.map(d => d.replaceAll('\n', '\n  ')).join('\n\n') +
          `\n}\n`
      }
      await writeCodeFile(resolve(outDir, scope.routeFile), routeContent, target)
    }
  }
}

export const planFromOapi = async (
  input: string,
  { version, ext, target }: { version: string; ext: 'json' | 'yaml'; target: 'js' | 'ts' }
): Promise<GenerationPlan> => {
  let def: OpenAPIV3.Document =
    ext === 'json' ? await Bun.file(input).json() : Bun.YAML.parse(await Bun.file(input).text())

  let v = def?.openapi
  if (!v || !semver.satisfies(v, version)) throw new Error('Invalid openapi version')

  let schemaIndex = buildSchemaIndex(def)
  let endpointDefs = parseEndpoints(def)

  return buildPlan(endpointDefs, schemaIndex, target)
}

export const generateFromOapi = async (
  input: string,
  out: string,
  opts: { version: string; ext: 'json' | 'yaml'; target: 'js' | 'ts' }
) => {
  await applyPlan(await planFromOapi(input, opts), out)
}
