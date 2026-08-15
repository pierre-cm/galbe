import { semver } from 'bun'
import { transformSync } from '@swc/wasm'
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
  /** Response-only: the response's `links`, with component refs already inlined. */
  responseLinks?: Record<string, any>
  /** Response-only: the response's headers as `[name, schema source]` pairs. */
  responseHeaders?: [string, string][]
  /**
   * Response-only: the response's bodies as `[mediaType, schema]` pairs. Kept
   * even for a single media type so the component can be emitted in the
   * content-map form — decorating a schema by spread would leak the response's
   * `description`/`example` into the shared component schema it refers to.
   */
  responseContent?: [string, string][]
  /** RequestBody-only: the bodies as `[mediaType, schema]` pairs, same rationale as `responseContent`. */
  requestContent?: [string, string][]
  /** RequestBody-only: the component-level description and requiredness. */
  requestDescription?: string
  requestRequired?: boolean
}
type EndpointEntry = {
  /** leading literal path segments — the last one names the route file, the ones before it the directory */
  scope: string[]
  method?: 'get' | 'put' | 'patch' | 'post' | 'delete' | 'options' | 'head'
  /** path as emitted in the file, relative to the file's directory prefix */
  path?: string
  schema?: { imports: Record<string, string>; name: string; def: string }
  endpoint?: { meta?: string; def?: string }
}

/**
 * A construct the spec declares and the generated Galbe sources cannot carry.
 * Collected while planning and reported by `generate code`: a silently widened
 * validator is a security-adjacent surprise, a warning makes it a choice.
 */
export type GenerationWarning = { at: string; message: string }
let warnings: GenerationWarning[] = []
// where the walk currently is, so a warning raised deep in a schema can say so
let warnAt = ''
const warn = (message: string, at = warnAt) => {
  if (!warnings.some(w => w.at === at && w.message === message)) warnings.push({ at, message })
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
/**
 * Marks a value that is already Galbe source — a nested `$T.…` builder — so it
 * comes back out of `serialize` as code instead of a quoted string.
 */
const raw = (code: string) => `__RAW__${code}__ENDRAW__`
const serialize = (obj: any) => {
  return JSON.stringify(obj, (k, value) => {
    if (k === 'pattern' && value) return `__PATTERN__${value}__ENDPATTERN__`
    return value
  })
    .replace(/"__PATTERN__([\s\S]*?)__ENDPATTERN__"/g, (_, body) => {
      const decoded = JSON.parse(`"${body}"`) as string
      return `/${decoded.replace(/\//g, '\\/')}/`
    })
    .replace(/"__RAW__([\s\S]*?)__ENDRAW__"/g, (_, body) => JSON.parse(`"${body}"`) as string)
}

const writeCodeFile = async (path: string, content: string, target: 'js' | 'ts') => {
  if (target === 'js') {
    content = transformSync(content, {
      jsc: {
        parser: {
          syntax: 'typescript',
        },
        preserveAllComments: true,
        // @swc/wasm's JscTarget typing lags @swc/core's; 'esnext' is supported at runtime
        target: 'esnext' as any,
      },
    }).code
  }
  await Bun.write(`${path}.${target}`, content)
}

const parseOapiSchema = (
  os?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  details: { id?: string; title?: string; description?: string; deprecated?: boolean } = {},
  extra?: { media?: string; skipNullable?: boolean; encoding?: Record<string, any>; split?: string }
): string => {
  if (!os) {
    return `$T.any(${details && Object.keys(details).length ? JSON.stringify(details) : ''})`
  }
  //@ts-ignore
  const ref: string | undefined = os?.$ref
  if (ref) return `%ref:${ref}%`
  os = os as OpenAPIV3.SchemaObject
  // `nullable` is valid on any schema, not only on an object's properties, so
  // it is applied once here — array items, component schemas and composition
  // members included. The object branch opts out through `skipNullable`: it
  // folds nullability together with optionality into `$T.nullish`.
  const nullable = !extra?.skipNullable && os.nullable === true
  let options: typeof details & {
    min?: number
    max?: number
    exclusiveMin?: number
    exclusiveMax?: number
    minLength?: number
    maxLength?: number
    multipleOf?: number
    pattern?: string
    format?: string
    minItems?: number
    maxItems?: number
    unique?: boolean
    split?: string
    default?: any
    examples?: any
    readOnly?: boolean
    writeOnly?: boolean
    encoding?: Record<string, any>
    /** already-rendered source, injected through `raw()` */
    additionalProperties?: string
  } = {
    ...details,
    title: os.title,
    description: details.description || os.description,
    default: os.default,
    ...(os.readOnly ? { readOnly: true } : {}),
    ...(os.writeOnly ? { writeOnly: true } : {}),
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
    if (os.not) warn('`not` has no equivalent in Galbe — the constraint is dropped and the value validates as `any`')
    resp = `$T.any(${hasOptions ? optArg : ''})`
  } else if (
    os.enum?.length &&
    os.format !== 'binary' &&
    ['string', 'integer', 'number', 'boolean'].includes(os.type as string)
  ) {
    // An `enum` closes the value set for any primitive type, not just strings:
    // one value is a literal, several are a union of literals. Both carry the
    // options — a literal that drops them loses its description.
    const literals = os.enum.map(v => `$T.literal(${JSON.stringify(v)})`)
    resp =
      literals.length === 1
        ? `$T.literal(${JSON.stringify(os.enum[0])}${optArg ? `, ${optArg}` : ''})`
        : `$T.union([${literals.join(', ')}]${optArg ? `, ${optArg}` : ''})`
  } else if (os.type === 'boolean') resp = `$T.boolean(${hasOptions ? serialize(options) : ''})`
  else if (os.type === 'number') {
    let { max, min, exclusiveMax, exclusiveMin } = {
      max: os.maximum !== undefined && !os.exclusiveMaximum ? os.maximum : undefined,
      min: os.minimum !== undefined && !os.exclusiveMinimum ? os.minimum : undefined,
      exclusiveMax: os.maximum !== undefined && os.exclusiveMaximum ? os.maximum : undefined,
      exclusiveMin: os.minimum !== undefined && os.exclusiveMinimum ? os.minimum : undefined,
    }
    options = { ...options, min, max, exclusiveMax, exclusiveMin, multipleOf: os.multipleOf, format: os.format }
    hasOptions = Object.values(options).some(v => v !== undefined)
    resp = `$T.number(${hasOptions ? serialize(options) : ''})`
  } else if (os.type === 'integer') {
    let max = os.maximum !== undefined && !os.exclusiveMaximum ? os.maximum : undefined
    let min = os.minimum !== undefined && !os.exclusiveMinimum ? os.minimum : undefined
    let exclusiveMax = os.maximum !== undefined && os.exclusiveMaximum ? os.maximum : undefined
    let exclusiveMin = os.minimum !== undefined && os.exclusiveMinimum ? os.minimum : undefined
    options = { ...options, min, max, exclusiveMax, exclusiveMin, multipleOf: os.multipleOf, format: os.format }
    hasOptions = Object.values(options).some(v => v !== undefined)
    resp = `$T.integer(${hasOptions ? serialize(options) : ''})`
  } else if (os.type === 'string') {
    if (os.format === 'binary') resp = `$T.byteArray(${hasOptions ? serialize(options) : ''})`
    else {
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
    options = { ...options, minLength, maxLength, unique, split: extra?.split }
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
        // `w` owns this property's nullability, so the recursive call must not
        // also wrap it — otherwise a nullable property comes back doubly wrapped.
        return `"${k}":${w(parseOapiSchema(v, {}, { skipNullable: true }))}`
      })
      .join(',')
    // `additionalProperties: true` is the OpenAPI default — only the two
    // constraining forms carry information worth emitting.
    const apDef = os.additionalProperties
    const ap =
      apDef === false ? 'false' : apDef && apDef !== true ? parseOapiSchema(apDef as OpenAPIV3.SchemaObject) : undefined

    if (extra?.media === 'multipart/form-data') {
      // `encoding` sits on the media type in the spec; Galbe carries it on the
      // multipartForm schema, which is the only place it can live
      if (extra.encoding && Object.keys(extra.encoding).length) {
        options = { ...options, encoding: extra.encoding }
        optArg = serialize(options)
      }
      resp = `$T.multipartForm({${props}}${optArg ? `, ${optArg}` : ''})`
    } else if (ap !== undefined && ap !== 'false' && !props) {
      // a free-form map: no declared properties, one schema for every value
      resp = `$T.record(${ap}${optArg ? `, ${optArg}` : ''})`
    } else {
      if (ap !== undefined) {
        options = { ...options, additionalProperties: raw(ap) }
        optArg = serialize(options)
      }
      resp = `$T.object({${props}}${optArg ? `, ${optArg}` : ''})`
    }
  } else throw new Error(`Unknown schema type ${JSON.stringify(os)}`)

  return nullable ? `$T.nullable(${resp})` : resp
}

const buildSchemaIndex = (def: OpenAPIV3.Document) => {
  let index: Record<string, SchemaEntry> = {}

  const initSchema = (k: string, s: any, kind: 'schemas' | 'requestBodies' | 'responses') => {
    let schema = ''
    let dependsOn = new Set<string>()
    let responseExample: any = undefined
    let responseExamples: Record<string, any> | undefined = undefined
    let responseLinks: Record<string, any> | undefined = undefined
    let responseHeaders: [string, string][] | undefined = undefined
    let responseContent: [string, string][] | undefined = undefined
    let requestContent: [string, string][] | undefined = undefined
    if (kind === 'schemas') schema = parseOapiSchema(s, { id: k })
    else if (kind === 'requestBodies') {
      const contentMap = (s as OpenAPIV3.RequestBodyObject)?.content
      requestContent = Object.entries(contentMap || {}).map(([media, v]) => [
        media,
        parseOapiSchema(v.schema, {}, { media, encoding: (v as any).encoding }),
      ])
      schema = `{${requestContent.map(([m, v]) => `"${m}": ${v}`).join(',')}}`
    } else if (kind === 'responses') {
      responseLinks = resolveLinks((s as OpenAPIV3.ResponseObject)?.links as any, def.components)
      responseHeaders = responseHeaderEntries((s as OpenAPIV3.ResponseObject)?.headers, def.components)
      if (!s.content) {
        // a bodiless component response: no media types, description only
        responseContent = []
      } else {
        const contentMap = s.content as Record<string, { schema?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject; example?: any; examples?: any }>
        const entries = Object.entries(contentMap)
        for (const [, v] of entries) {
          if (v.example !== undefined && responseExample === undefined) responseExample = v.example
          if (v.examples && Object.keys(v.examples).length)
            responseExamples = {
              ...(responseExamples || {}),
              ...Object.fromEntries(Object.entries(v.examples).map(([k, ex]) => [k, resolveExample(ex, def.components)])),
            }
        }
        const keyGroups: Record<string, string[]> = {}
        for (const [media, v] of entries) {
          const galbeKey = media
          const schemaStr = parseOapiSchema(v.schema, {}, { media })
          if (!keyGroups[galbeKey]) keyGroups[galbeKey] = []
          keyGroups[galbeKey].push(schemaStr)
        }
        responseContent = Object.entries(keyGroups).map(([k, schemas]) => {
          const unique = [...new Set(schemas)]
          return [k, unique.length === 1 ? unique[0]! : `$T.union([${unique.join(',')}])`]
        })
        schema = `{${responseContent.map(([k, v]) => `"${k}": ${v}`).join(',')}}`
      }
    }
    const deref = (code: string) =>
      unref(code, m => {
        let l = m.split('/')
        dependsOn.add(m)
        return l[l.length - 1]!
      })
    schema = deref(schema)
    responseContent = responseContent?.map(([media, sc]) => [media, deref(sc)])
    requestContent = requestContent?.map(([media, sc]) => [media, deref(sc)])
    responseHeaders = responseHeaders?.map(([name, sc]) => [name, deref(sc)])
    index[`#/components/${kind}/${k}`] = {
      key: k,
      prefix: '',
      schema,
      dependsOn,
      usedBy: new Set(),
      ...(kind === 'responses' ? { responseContent: responseContent ?? [] } : {}),
      ...(kind === 'requestBodies'
        ? {
            requestContent: requestContent ?? [],
            ...(typeof s?.description === 'string' && s.description ? { requestDescription: s.description } : {}),
            ...(s?.required !== undefined ? { requestRequired: !!s.required } : {}),
          }
        : {}),
      ...(kind === 'responses' && typeof s?.description === 'string' && s.description
        ? { responseDescription: s.description }
        : {}),
      ...(kind === 'responses' && responseExample !== undefined ? { responseExample } : {}),
      ...(kind === 'responses' && responseExamples ? { responseExamples } : {}),
      ...(kind === 'responses' && responseLinks && Object.keys(responseLinks).length ? { responseLinks } : {}),
      ...(kind === 'responses' && responseHeaders?.length ? { responseHeaders } : {}),
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

/**
 * Inline a `#/components/examples/*` reference. Galbe carries examples as plain
 * values on the schema, with nowhere to keep a components entry, so a `$ref`
 * left as-is would dangle in the regenerated spec.
 */
const resolveExample = (ex: any, components: OpenAPIV3.ComponentsObject | undefined, seen = new Set<string>()): any => {
  const ref: unknown = ex?.$ref
  if (typeof ref !== 'string' || seen.has(ref)) return ex
  let match = ref.match(/^#\/components\/examples\/(.+)$/)
  if (!match) return ex
  let target = components?.examples?.[match[1]!]
  if (!target) return ex
  seen.add(ref)
  return resolveExample(target, components, seen)
}

/**
 * Resolve a `#/components/headers/*` reference. Galbe carries response headers
 * inline on the response, with nowhere to keep a components entry, so the
 * header is inlined — the component's identity is lost but its shape is not,
 * which beats the silent skip this replaces.
 */
const resolveHeaderRef = (
  ref: string,
  components: OpenAPIV3.ComponentsObject | undefined,
  seen = new Set<string>()
): OpenAPIV3.HeaderObject | undefined => {
  if (seen.has(ref)) return undefined
  let match = ref.match(/^#\/components\/headers\/(.+)$/)
  if (!match) return undefined
  let target = components?.headers?.[match[1]!]
  if (!target) return undefined
  seen.add(ref)
  if ('$ref' in target) return resolveHeaderRef(target.$ref, components, seen)
  return target
}

/**
 * Resolve a `#/components/links/*` reference. Galbe carries links inline on the
 * response, with nowhere to keep a components entry, so the link is inlined —
 * the component's name is lost, its content is not.
 */
const resolveLinkRef = (
  ref: string,
  components: OpenAPIV3.ComponentsObject | undefined,
  seen = new Set<string>()
): any => {
  if (seen.has(ref)) return undefined
  let match = ref.match(/^#\/components\/links\/(.+)$/)
  if (!match) return undefined
  let target = (components?.links as Record<string, any> | undefined)?.[match[1]!]
  if (!target) return undefined
  seen.add(ref)
  if ('$ref' in target) return resolveLinkRef(target.$ref, components, seen)
  return target
}

/** Every link on a response, with `$ref`s inlined. Empty when the response declares none. */
const resolveLinks = (
  links: Record<string, any> | undefined,
  components: OpenAPIV3.ComponentsObject | undefined
): Record<string, any> => {
  const out: Record<string, any> = {}
  for (const [name, link] of Object.entries(links ?? {})) {
    const resolved = link && '$ref' in link ? resolveLinkRef(link.$ref, components) : link
    if (resolved) out[name] = resolved
  }
  return out
}

/**
 * A response's headers as `[name, schema source]` pairs, with
 * `#/components/headers/*` references resolved and `%ref:%` markers left in
 * place. Deliberately strategy-free: a route file resolves those markers
 * through its import map and a component file through its dependency set, and
 * baking either one in is what kept component responses from carrying headers.
 */
const responseHeaderEntries = (
  headers: OpenAPIV3.ResponseObject['headers'],
  components: OpenAPIV3.ComponentsObject | undefined
): [string, string][] => {
  const out: [string, string][] = []
  for (const [name, value] of Object.entries(headers ?? {})) {
    let h: OpenAPIV3.HeaderObject | undefined
    if ('$ref' in (value as any)) {
      h = resolveHeaderRef((value as any).$ref, components)
      if (!h) continue
    } else h = value as OpenAPIV3.HeaderObject
    const code = parseOapiSchema(h.schema || ({ type: 'string' } as any), { description: h.description })
    out.push([name, h.required ? code : `$T.optional(${code})`])
  }
  return out
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
  emitPath: string,
  def?: OpenAPIV3.OperationObject,
  components?: OpenAPIV3.ComponentsObject
) => {
  if (!def) return {}
  let imports: Record<string, string> = {}
  // every `%ref:%` in this operation resolves to a name the route file imports
  const deref = (code: string): string =>
    unref(code, m => {
      const l = m.split('/')
      imports[l[l.length - 1]!] = m
      return l[l.length - 1]!
    })
  // the emitted path is relative to the file's directory prefix; the schema
  // name derives from the full path so it stays unique across scopes
  let p = emitPath.replaceAll(/\{([^\}]*)\}/g, ':$1')
  // let description = def.summary || def.description
  let schemaName = def.operationId
    ? def.operationId.replace(/^\w/, c => c.toUpperCase())
    : `${method}${path
        .replaceAll(/\{([^\}]+)\}/g, (_, p) => `By${p.replace(/^\w/, (c: string) => c.toUpperCase())}`)
        .replaceAll(/[^$\w\d_]+([$\w\d_])/g, (_, $1) => $1.toUpperCase())
      }`.replace(/^\w/, c => c.toUpperCase())

  warnAt = `${method.toUpperCase()} ${path}`
  let meta = '/**\n'
  // The JSDoc head expresses "summary, then description" and nothing else, so a
  // description with no summary needs the explicit tags: a bare `@summary`
  // declares the empty one the head convention cannot write down.
  const headExpressible = !def.description || !!def.summary
  if (headExpressible) {
    if (def.summary) meta += ` * ${def.summary}\n *\n`
    if (def.description) meta += ` * ${def.description.replace(/\n/g, '\n * ')}\n`
  } else {
    if (typeof def.summary === 'string') meta += ` * @summary\n`
    for (const line of def.description!.split('\n')) meta += ` * @description ${line}\n`
  }
  if (def.operationId) meta += ` * @operationId ${def.operationId}\n`
  // `@externalDocs <url> [description]` — the serializer splits it back on the
  // first whitespace, so the description survives the roundtrip.
  if (def.externalDocs?.url)
    meta += ` * @externalDocs ${def.externalDocs.url}${
      def.externalDocs.description ? ` ${def.externalDocs.description}` : ''
    }\n`
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

  let sp: Record<string, Record<string, string>> = {
    path: {},
    query: {},
    header: {},
    cookie: {},
    body: {},
    formData: {},
  } // TODO handle body and formData cases

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
    // A parameter is typed either by `schema` or by `content` (a single media
    // type). Galbe cannot record *which* media type it was serialized as, so
    // the roundtrip stays lossy there — but keeping the shape beats `$T.any()`.
    const pSchema = p.schema ?? Object.values(p.content ?? {})[0]?.schema
    if ((p as any).allowEmptyValue)
      warn(`parameter '${p.name}': allowEmptyValue is not modelled (OpenAPI deprecates it) and is dropped`)
    // Only a serialization Galbe's parsers do not implement is worth reporting.
    // A query array accepts the repeated *and* the comma form, so both explode
    // variants of 'form' are honoured; 'pipeDelimited' and 'spaceDelimited'
    // become the array's `split`, and 'deepObject' is an object parameter.
    const defaultStyle = p.in === 'query' || p.in === 'cookie' ? 'form' : 'simple'
    const style = ((p as any).style as string | undefined) ?? defaultStyle
    const pType = (p.schema as OpenAPIV3.SchemaObject | undefined)?.type
    const split = style === 'pipeDelimited' ? '|' : style === 'spaceDelimited' ? ' ' : undefined
    const honoured =
      style === defaultStyle
        ? p.in !== 'query' || pType !== 'object' // form-on-object is `a,b,c,d`, not implemented
        : p.in === 'query' &&
          (style === 'deepObject' ? pType === 'object' : !!split && pType === 'array')
    if (!honoured)
      warn(
        `parameter '${p.name}': style '${style}'${pType ? ` on a ${pType}` : ''} is not implemented — the generated route parses it as '${defaultStyle}'`
      )
    if (p.content && Object.keys(p.content).length > 1)
      warn(`parameter '${p.name}': only the first of ${Object.keys(p.content).length} content media types is kept`)
    sp[p.in][p.name] = o(
      deref(parseOapiSchema(pSchema, { description: p.description, deprecated: p.deprecated }, { split }))
    )
  }

  let [schemaParams, schemaQuery, schemaHeaders, schemaCookies] = [
    { g: 'params', o: 'path' },
    { g: 'query', o: 'query' },
    { g: 'headers', o: 'header' },
    { g: 'cookies', o: 'cookie' },
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
      body = deref(`  body: %ref:${_rb.$ref}%`)
    } else {
      let rb = def?.requestBody as OpenAPIV3.RequestBodyObject
      let o = (s: string) => (!rb?.required ? `$T.optional(${s})` : s)
      let bs = [
        ...new Set(
          Object.entries(rb?.content || { null: {} }).map(([media, v]) => [
            media,
            deref(parseOapiSchema(v.schema, undefined, { media, encoding: (v as any).encoding })),
          ])
        ),
      ]
      // The body's own description sits beside the media types, never spread
      // onto a body schema — a spread over a schema carrying an `id` leaks it
      // into the shared component (same failure mode as response metadata).
      const parts = bs.map(([k, v]) => `"${k}":${o(v)}`)
      if (typeof rb?.description === 'string' && rb.description)
        parts.push(`description:${JSON.stringify(rb.description)}`)
      body = parts.length ? `  body: {${parts.join(',')}}` : ''
    }
  }

  let resp = ''
  let r = def?.responses
  let rs = Object.fromEntries(
    Object.entries(r || {}).map(([status, sv]) => {
      // `1XX`…`5XX` are status keys of their own — Galbe carries them verbatim.
      // Anything else that is not an integer collapses onto `default`.
      let s: string = Number.isInteger(Number(status))
        ? status
        : /^[1-5]XX$/i.test(status)
          ? status.toUpperCase()
          : 'default'
      if (s === 'default' && status !== 'default')
        warn(`response '${status}' is not a status Galbe can express and collapses onto 'default'`)

      //@ts-ignore
      let rootRef = sv?.$ref ? deref(parseOapiSchema(sv)) : null
      if (rootRef) return [s, rootRef]

      const respObj = sv as OpenAPIV3.ResponseObject
      const content = respObj?.content || {}

      const headerEntries = responseHeaderEntries(respObj?.headers, components).map(
        ([hName, code]) => `${JSON.stringify(hName)}:${deref(code)}`
      )
      const description = typeof respObj?.description === 'string' && respObj.description ? respObj.description : undefined
      const links = resolveLinks((respObj as any)?.links, components)
      const hasLinks = Object.keys(links).length > 0

      if (Object.keys(content).length === 0) {
        let nullSchema = description ? `$T.null({description:${JSON.stringify(description)}})` : `$T.null()`
        const extras = [
          ...(headerEntries.length ? [`responseHeaders:{${headerEntries.join(',')}}`] : []),
          ...(hasLinks ? [`responseLinks:${JSON.stringify(links)}`] : []),
        ]
        if (extras.length) nullSchema = `({...${nullSchema}, ${extras.join(', ')}})`
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
          for (const [k, ex] of Object.entries(tv.examples))
            exampleParts.push(`${JSON.stringify(k)}:${JSON.stringify(resolveExample(ex, components))}`)
        }
        const schemaStr = deref(parseOapiSchema(tv.schema))
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
        if (hasLinks) parts.push(`responseLinks: ${JSON.stringify(links)}`)
        if (exampleParts.length) parts.push(`examples: {${exampleParts.join(',')}}`)
        if (singleExample !== undefined) parts.push(`example: ${JSON.stringify(singleExample)}`)
        return [s, `{${parts.join(',')}}`]
      } else {
        // Single body key → STResponseContent object (preserves exact media type key)
        const [key] = uniqueKeys
        const unique = [...new Set(keyGroups[key] || [])]
        let schemaStr = unique.length === 0 ? `$T.null()` : unique.length === 1 ? unique[0] : `$T.union([${unique.join(',')}])`
        // Examples sit beside the body in the content map, never spread onto the
        // body schema: a spread carrying `example`/`examples` over a schema with
        // an `id` leaks them into that shared component (see _responseId above).
        const parts: string[] = []
        if (key) parts.push(`"${key}":${schemaStr}`)
        if (description) parts.push(`description:${JSON.stringify(description)}`)
        if (headerEntries.length) parts.push(`responseHeaders:{${headerEntries.join(',')}}`)
        if (hasLinks) parts.push(`responseLinks:${JSON.stringify(links)}`)
        if (exampleParts.length) parts.push(`examples:{${exampleParts.join(',')}}`)
        if (singleExample !== undefined) parts.push(`example:${JSON.stringify(singleExample)}`)
        return [s, `{${parts.join(',')}}`]
      }
    })
  )

  if (Object.keys(rs).length) {
    resp = `  response: {${Object.entries(rs)
      .filter(([_, v]) => v)
      // a range key is not a valid bare property name — `5XX:` does not parse
      .map(([s, v]) => `${/^\d+$/.test(s) ? s : JSON.stringify(s)}: ${v}`)
      .join(',')}}`
  } else resp = ''

  let schema = [schemaHeaders, schemaParams, schemaQuery, schemaCookies, body, resp].filter(s => s)

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
    // Directory convention: the leading literal segments pick the output file
    // (all but the last become its directory, i.e. its dirPrefix), and the
    // emitted path is written relative to that directory so the analyzer
    // reconstructs the full path on load.
    const segments = fullPath.split('/').filter(s => s !== '')
    let nLit = 0
    while (nLit < segments.length && !/[{}]/.test(segments[nLit]!)) nLit++
    const scope = segments.slice(0, nLit)
    const emitPath = `/${segments.slice(Math.max(nLit - 1, 0)).join('/')}`
    let methods = ['get', 'put', 'patch', 'post', 'delete', 'options', 'head'] as const
    // 'trace' is deliberately absent: it is disabled across most infrastructure
    // and Galbe has no builder for it. Say so rather than dropping it silently.
    for (const m of Object.keys(pathVal))
      if (!(methods as readonly string[]).includes(m) && m !== 'parameters' && m !== 'summary' && m !== 'description' && m !== 'servers')
        warn(`method '${m.toUpperCase()}' has no Galbe route builder — the operation is skipped`, `${m.toUpperCase()} ${fullPath}`)
    let pathParams = pathVal.parameters || []
    for (let m of methods) {
      let endpointDef = pathVal?.[m]
      if (!endpointDef) continue
      let ref = `#/paths/${m}${fullPath}`
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
      let { schema, endpoint } = parseEndpointDef(m, fullPath, emitPath, mergedDef, def.components)
      endpoints[ref] = {
        method: m,
        scope,
        path: emitPath,
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
    // Responses and requestBodies are emitted in the content-map form: media
    // types as keys, the component's own metadata beside them, and an
    // `_responseId` / `_requestBodyId` preserving the component's name so the
    // serializer can put it back under `components` and `$ref` it.
    //
    // Never a spread onto the body schema: that writes the response's
    // `description`/`example` into the shared component schema the body refers
    // to, which the serializer registers by `id`.
    if (type === 'responses' || type === 'requestBodies') {
      const isResp = type === 'responses'
      const content = (isResp ? s.responseContent : s.requestContent) ?? []
      const extras = [`${isResp ? '_responseId' : '_requestBodyId'}: "${s.key}"`]
      const description = isResp ? s.responseDescription : s.requestDescription
      if (description) extras.push(`description: ${JSON.stringify(description)}`)
      if (isResp) {
        if (s.responseExample !== undefined) extras.push(`example: ${JSON.stringify(s.responseExample)}`)
        if (s.responseExamples) extras.push(`examples: ${JSON.stringify(s.responseExamples)}`)
        if (s.responseLinks) extras.push(`responseLinks: ${JSON.stringify(s.responseLinks)}`)
        if (s.responseHeaders?.length)
          extras.push(
            `responseHeaders: {${s.responseHeaders.map(([n, sc]) => `${JSON.stringify(n)}: ${sc}`).join(', ')}}`
          )
      } else if (s.requestRequired !== undefined) extras.push(`required: ${s.requestRequired}`)
      const body = [...content.map(([media, sc]) => `${JSON.stringify(media)}: ${sc}`), ...extras].join(', ')
      // the exported type is the body type, read back off the const
      const bodyType = content.length
        ? content.map(([media]) => `Static<(typeof ${s.key})[${JSON.stringify(media)}]>`).join(' | ')
        : 'null'
      decl.push(`export const ${s.key} = { ${body} }\nexport type ${s.key} = ${bodyType}\n`)
      return
    }
    decl.push(`export const ${s.key} = ${s.schema}\nexport type ${s.key} = Static<typeof ${s.key}>\n`)
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
  /** Path as emitted in the call expression: relative to the scope's `prefix`, OpenAPI braces converted to `:param`. */
  path: string
  schemaName: string
  /** JSDoc block string (e.g. '/**\n * summary\n *\/'). */
  meta: string
  /** Rendered call expression body, e.g. 'get("/path", FooSchema, ctx => { ... })'. */
  call: string
}

export type ScopePlan = {
  /** e.g. '/main', '/v1/modules'. */
  scopeKey: string
  /** The route file's directory prefix (dirPrefix reconstructs it on load), e.g. '/v1' or ''. */
  prefix: string
  /** Output path without extension, e.g. 'main.route', 'v1/modules.route'. */
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
  /** Constructs the spec declared that the generated sources cannot carry. */
  warnings?: GenerationWarning[]
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
    let scopeKey = v.scope.length ? `/${v.scope.join('/')}` : '/main'
    if (!(scopeKey in p)) p[scopeKey] = []
    p[scopeKey].push(v)
    return p
  }, {})

  const scopes: ScopePlan[] = []
  for (let [scopeKey, def] of Object.entries(scopedDefs)) {
    const scope = def[0].scope
    let prefix = scope.length > 1 ? `/${scope.slice(0, -1).join('/')}` : ''
    let routeFile = scope.length ? `${scope.join('/')}.route` : 'main.route'
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
      prefix,
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

/** Relative import path from a scope's route file to its sibling schema file. */
export const schemaImportPath = (scope: Pick<ScopePlan, 'routeFile' | 'schemaFile'>): string => {
  const rel = relative(dirname(scope.routeFile), scope.schemaFile)
  return rel.startsWith('.') ? rel : `./${rel}`
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
        const importPath = schemaImportPath(scope)
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

  warnings = []
  warnAt = ''
  let schemaIndex = buildSchemaIndex(def)
  let endpointDefs = parseEndpoints(def)

  return { ...buildPlan(endpointDefs, schemaIndex, target), warnings }
}

export const generateFromOapi = async (
  input: string,
  out: string,
  opts: { version: string; ext: 'json' | 'yaml'; target: 'js' | 'ts' }
) => {
  await applyPlan(await planFromOapi(input, opts), out)
}
