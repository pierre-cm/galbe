import { semver } from 'bun'
import { transformSync } from '@swc/core'
import { resolve, relative, dirname } from 'path'
import { load as ymlLoad } from 'js-yaml'
import { OpenAPIV3 } from 'openapi-types'

type SchemaEntry = {
  key: string
  prefix: string
  schema: string
  dependsOn: Set<string>
  usedBy: Set<string>
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
  const ascend = (d: { dependsOn: Set<string> }) => {
    for (let p of d.dependsOn.keys()) {
      if (p in deps) {
        ascend(deps[p])
        if (p in deps && !l.has(p)) {
          l.add(p)
          stack.splice(stack.indexOf(p), 1)
        }
      }
    }
  }
  while (stack.length) {
    let k = stack.pop()
    if (!k) continue
    let d = deps[k]
    ascend(d)
    if (!l.has(k)) {
      l.add(k)
    }
  }
  return Object.fromEntries([...l].map(k => [k, deps[k]]))
}
const serialize = (obj: any) => {
  return JSON.stringify(obj, (k, value) => {
    if (k === 'pattern' && value) return `/${value}/`
    return value
  }).replace(/"\/(.*)\/([gimsuy]*)"/g, '/$1/$2');
}

const writeCodeFile = async (path: string, content: string, target: 'js' | 'ts') => {
  if (target === 'js') {
    content = transformSync(content, {
      jsc: {
        parser: {
          syntax: 'typescript'
        },
        preserveAllComments: true,
        target: 'esnext'
      }
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
  if (os?.$ref) return `%ref:${os.$ref}%`
  os = os as OpenAPIV3.SchemaObject
  let options: typeof details & {
    min?: number
    max?: number
    exclusiveMin?: number
    exclusiveMax?: number
    minLength?: number
    maxLength?: number
    pattern?: string
    minItems?: number
    maxItems?: number
    unique?: boolean
  } = {
    ...details,
    title: os.title,
    description: details.description || os.description
  }
  if(!os?.type) return `$T.any(${details && Object.keys(details).length ? JSON.stringify(details) : ''})`
  let resp = ''
  let hasOptions = Object.values(options).some(v => !!v)
  let optArg = hasOptions ? serialize(options) : ''
  let anyOf = os.oneOf || os.anyOf || os.allOf
  let required = os.required
  let nullable = os.nullable

  if (anyOf?.length) {
    if (anyOf.length === 1) resp = parseOapiSchema(anyOf[0] as OpenAPIV3.SchemaObject, details, extra)
    else {
      resp = `$T.union([${anyOf.map(s => parseOapiSchema(s as OpenAPIV3.SchemaObject)).join(',')}], ${serialize(
        options
      )})`
    }
  } else if (os.type === 'boolean') resp = `$T.boolean(${hasOptions ? serialize(options) : ''})`
  else if (os.type === 'number') {
    let { max, min, exclusiveMax, exclusiveMin } = {
      max: os.maximum !== undefined && !os.exclusiveMaximum ? os.maximum : undefined,
      min: os.minimum !== undefined && !os.exclusiveMinimum ? os.minimum : undefined,
      exclusiveMax: os.maximum !== undefined && os.exclusiveMaximum ? os.maximum : undefined,
      exclusiveMin: os.minimum !== undefined && os.exclusiveMinimum ? os.minimum : undefined
    }
    options = { ...options, min, max, exclusiveMax, exclusiveMin }
    hasOptions = Object.values(options).some(v => !!v)
    resp = `$T.number(${hasOptions ? serialize(options) : ''})`
  } else if (os.type === 'integer') {
    let max = os.maximum !== undefined && !os.exclusiveMaximum ? os.maximum : undefined
    let min = os.minimum !== undefined && !os.exclusiveMinimum ? os.minimum : undefined
    let exclusiveMax = os.maximum !== undefined && os.exclusiveMaximum ? os.maximum : undefined
    let exclusiveMin = os.minimum !== undefined && os.exclusiveMinimum ? os.minimum : undefined
    options = { ...options, min, max, exclusiveMax, exclusiveMin }
    hasOptions = Object.values(options).some(v => !!v)
    resp = `$T.integer(${hasOptions ? serialize(options) : ''})`
  } else if (os.type === 'string') {
    if (os.format === 'binary') resp = `$T.byteArray(${hasOptions ? serialize(options) : ''})`
    else {
      let minLength = os.minLength
      let maxLength = os.maxLength
      let pattern = os.pattern
      options = { ...options, minLength, maxLength, pattern }
      hasOptions = Object.values(options).some(v => !!v)
      resp = `$T.string(${hasOptions ? serialize(options) : ''})`
    }
  } else if (os.type === 'array') {
    let minItems = os.minItems
    let maxItems = os.maxItems
    let unique = os.uniqueItems
    options = { ...options, minItems, maxItems, unique }
    resp = `$T.array(${parseOapiSchema(os?.items)}, ${optArg})`
  } else if (os.type === 'object') {
    let props = Object.entries(os?.properties || {})
    .map(([k, v]) => `"${k}":${parseOapiSchema(v)}`)
    .join(',')
    if (extra?.media === 'multipart/form-data') {
      resp = `$T.multipartForm({${props}}${optArg ? `, ${optArg}`:''})`
    } else if (extra?.media === 'application/x-www-form-urlencoded') {
      resp = `$T.urlForm({${props}}${optArg ? `, ${optArg}`:''})`
    } else {
      resp = `$T.object({${props}}${optArg ? `, ${optArg}`:''})`
    }
  } else throw new Error(`Unknown schema type ${JSON.stringify(os)}`)

  if (!required && nullable) resp = `$T.nullish(${resp})`
  else if (!required) resp = `$T.optional(${resp})`
  else if (nullable) resp = `$T.nullable(${resp})`

  return resp
}

const buildSchemaIndex = (def: OpenAPIV3.Document) => {
  let index: Record<string, SchemaEntry> = {}

  const initSchema = (k: string, s: any, kind: 'schemas' | 'requestBodies' | 'responses') => {
    let schema = ''
    let dependsOn = new Set<string>()
    if (kind === 'schemas') schema = parseOapiSchema(s, { id: k })
    else if (kind === 'requestBodies' || kind === 'responses') {
      let schemas=[] as string[]
      if(!!s.content){

        schemas = [
          ...new Set(
            Object.entries((s as OpenAPIV3.RequestBodyObject)?.content || {null:{}}).map(([media, v]) => {
              return parseOapiSchema(v.schema, { id: k }, { media })
            })
          )
        ]
      } else {
        schemas = [
          parseOapiSchema(undefined, {id: k, ...s})
        ]
      }
      schema = schemas.length <= 0 ? '' : schemas.length === 1 ? schemas[0] : `$T.union([${schemas.join(',')}])`
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
      usedBy: new Set()
    }
  }
  for (let [k, v] of Object.entries(def.components?.schemas || {})) initSchema(k, v, 'schemas')
  for (let [k, v] of Object.entries(def.components?.requestBodies || {})) initSchema(k, v, 'requestBodies')
  for (let [k, v] of Object.entries(def.components?.responses || {})) initSchema(k, v, 'responses')

  Object.entries(index).forEach(([k, v]) => {
    for (let d of v.dependsOn) index[d].usedBy.add(k)
  })

  return index
}

const parseEndpointDef = (method: string, path: string, def?: OpenAPIV3.OperationObject) => {
  if (!def) return {}
  let imports = {}
  let p = path.replaceAll(/\{([^\}]*)\}/g, ':$1')
  // let description = def.summary || def.description
  let pathName = path.replaceAll(/\/\{[^\}]*\}/g, 'X').replaceAll(/[^$\w\d_]+([$\w\d_])/g, (_, $1) => $1.toUpperCase())
  let schemaName = `${method}${pathName}`.replace(/^\w/, c => c.toUpperCase())

  let meta = '/**\n'
  if (def.summary) meta += ` * ${def.summary}\n *\n`
  if (def.description) meta += ` * ${def.description.replace('\n', '\n * ')}\n`
  if (def.operationId) meta += ` * @operationId ${def.operationId}\n`
  if (def.externalDocs) meta += ` * @externalDocs ${def.externalDocs}\n`
  if (def.tags) meta += ` * @tags ${def.tags.join(' ')}\n`
  if (def.deprecated) meta == ' * @deprecated\n'
  meta += ' */'
  let endpoint = `${method}("${p}", ${schemaName}, ctx => {\n  throw new NotImplementedError()\n})`

  let sp = { path: {}, query: {}, header: {}, body: {}, formData: {} } // TODO handle body and formData cases
  for (let _p of def?.parameters || []) {
    // @ts-ignore: TODO handle refs cases
    if (_p.$ref) continue
    let p = _p as OpenAPIV3.ParameterObject
    let o = (s: string) => (p.in !== 'path' && !p.required && !/^\$T.optional\(.*\)$/.test(s) ? `$T.optional(${s})` : s)
    sp[p.in][p.name] = o(
      unref(parseOapiSchema(p.schema, {description: p.description }), m => {
        let l = m.split('/')
        imports[l[l.length - 1]] = m
        return l[l.length - 1]
      })
    )
  }

  let [schemaParams, schemaQuery, schemaHeaders] = [
    { g: 'params', o: 'path' },
    { g: 'query', o: 'query' },
    { g: 'headers', o: 'header' }
  ].map(({ g, o }) =>
    Object.keys(sp[o]).length
      ? `  ${g}: {${Object.entries(sp[o])
          .map(([k, v]) => `"${k}":${v}`)
          .join(',')}}`
      : ''
  )

  let body = ''
  if(!['get', 'delete', 'options', 'head'].includes(method)){
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
          Object.entries(rb?.content || {null:{}}).map(([media, v]) =>
            unref(parseOapiSchema(v.schema, undefined, { media }), m => {
              let l = m.split('/')
              imports[l[l.length - 1]] = m
              return l[l.length - 1]
            })
          )
        )
      ]
      body = bs.length === 1 ? `  body: ${o(bs[0])}` : bs.length > 1 ? `  body: ${o(`$T.union([${bs.join(',')}])`)}` : ''
    }
  }

  let resp = ''
  let r = def?.responses
  let rs = Object.fromEntries(
    Object.entries(r || {}).map(([status, sv]) => {
      let entries: string[] = []
      let s: string = Number.isInteger(Number(status)) ? status : 'default'

      //@ts-ignore
      let rootRef = sv?.$ref ? unref(parseOapiSchema(sv), m => {
        let l = m.split('/')
        imports[l[l.length - 1]] = m
        return l[l.length - 1]
      }) : null
      if (rootRef) {
        return [s, [rootRef]]
      }

      for (let [_type, tv] of Object.entries((sv as OpenAPIV3.ResponseObject)?.content || {})) {
        entries.push(
          unref(parseOapiSchema(tv.schema), m => {
            let l = m.split('/')
            imports[l[l.length - 1]] = m
            return l[l.length - 1]
          })
        )
      }
      return [s, [...new Set(entries)]]
    })
  )

  if (Object.keys(rs).length) {
    resp = `  response: {${Object.entries(rs)
      .filter(([_, v]) => v.length)
      .map(([s, v]) => `${s}: ${v.length === 1 ? v[0] : v.length > 1 ? `$T.union([${v.join(',')}])` : ''}`)
      .join(',')}}`
  } else resp = ''

  let schema = [schemaHeaders, schemaParams, schemaQuery, body, resp].filter(s => s)

  return {
    schema: {
      name: schemaName,
      imports,
      def: schema.length ? `{\n${schema.join(',\n')}\n}` : ''
    },
    endpoint: {
      meta,
      def: endpoint
    }
  }
}

const parseEndpoints = (def: OpenAPIV3.Document) => {
  let endpoints: Record<string, EndpointEntry> = {}
  for (let [fullPath, pathVal] of Object.entries(def.paths || {})) {
    if (!pathVal) continue
    let match = fullPath.match(/^\/?(v\d+[^\/]*\/)?(?:\/?(public|private))?\/?([^\/]+)\/?(.*)$/)
    if (!match) continue
    let [_, version, visibility, scope, path] = [...match]
    path = `/${path}`
    let methods = ['get', 'put', 'patch', 'post', 'delete', 'options', 'head'] as const
    for (let m of methods) {
      let endpointDef = pathVal?.[m]
      if (!endpointDef) continue
      let ref = `#/paths${version ? `/${version}` : ''}${visibility ? `/${visibility}` : ''}${
        scope ? `/${scope}` : ''
      }/${m}${path}`
      let { schema, endpoint } = parseEndpointDef(m, fullPath, endpointDef)
      endpoints[ref] = {
        version,
        visibility: visibility as 'public' | 'private',
        method: m,
        scope,
        path,
        schema,
        endpoint
      }
    }
  }
  return endpoints
}

const writeFiles = async (
  path: string,
  endpoints: Record<string, EndpointEntry>,
  schemaIndex: Record<string, SchemaEntry>,
  target: 'js' | 'ts'
) => {
  const typeMap = {
    schemas: 'commons',
    requestBodies: 'requests',
    responses: 'responses'
  }
  const parseSchemasToFile = (
    schemas: Record<string, SchemaEntry>,
    type: 'schemas' | 'requestBodies' | 'responses'
  ) => {
    if (Object.keys(schemas).length === 0) return ''
    let imports: Record<string, string[]> = {}
    let decl: string[] = []
    Object.entries(schemas).forEach(([k, s]) => {
      if (s.key === s.schema && s.dependsOn.size === 1) {
        let depMatch = [...s.dependsOn][0].match(/^#\/components\/([^\/]+)\/([^\/]+)/)
        if (!depMatch) return
        let [_, depOrig, depName] = [...depMatch]
        decl.push(`export { ${depName} } from './${typeMap[depOrig]}.schema'\n`)
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
      decl.push(`export const ${s.key} = ${s.schema}\nexport type T${s.key} = Static<typeof ${s.key}>\n`)
    })
    if (decl.length === 0) return ''
    return `import type { Static } from 'galbe/schema'\nimport { $T } from 'galbe'\n${Object.entries(imports)
      .map(([k, v]) => `import { ${[...new Set(v)].join(', ')} } from './${typeMap[k]}.schema'\n`)
      .join('\n')}\n${decl.join('\n')}\n`
  }

  const sMaps = [
    { g: 'commons', o: 'schemas' },
    { g: 'requests', o: 'requestBodies' },
    { g: 'responses', o: 'responses' }
  ] as const
  for (let { g, o } of sMaps) {
    let s = parseSchemasToFile(
      orderDeps(
        Object.fromEntries(
          Object.entries(schemaIndex).filter(([k, _]) => {
            return k.match(new RegExp(`^#/components/${o}/`))
          })
        )
      ),
      o
    )
    if (s) await writeCodeFile(resolve(path, 'schemas', `${g}.schema`), s, target)
  }

  let scopedDefs = Object.entries(endpoints).reduce((p, [_, v]) => {
    let scopeKey = `${v.version ? `/${v.version}` : ''}${v.visibility ? `/${v.visibility}` : ''}${
      v.scope ? `/${v.scope}` : '/main'
    }`
    if (!(scopeKey in p)) p[scopeKey] = []
    p[scopeKey].push(v)
    return p
  }, {}) as Record<string, EndpointEntry[]>

  for (let [scopeKey, def] of Object.entries(scopedDefs)) {
    let routePath = `routes${scopeKey}.route`
    let schemaPath = `schemas${scopeKey}.schema`

    let sImports: Record<string, Set<string>> = {}
    let sDecl: string[] = []

    let rImports: Set<string> = new Set()
    let rDecl: string[] = []

    for (let d of def) {
      // schema
      Object.entries(d.schema?.imports || {}).forEach(([iK, dep]) => {
        let k = refToPath(dep, dirname(schemaPath))
        if (!k) return
        if (!(k in sImports)) sImports[k] = new Set()
        sImports[k].add(iK)
      })
      sDecl.push(`export const ${d.schema?.name} = ${d.schema?.def}`)

      // route
      let ep = d.endpoint
      if (!ep) continue
      if (d.schema?.name) rImports.add(d.schema?.name)
      rDecl.push(`  ${ep.meta}\ng.${ep.def}`)
    }

    let schemaFile =
      `import { $T } from 'galbe'\n\n` +
      `${Object.entries(sImports)
        .map(([k, v]) => `import { ${[...v].join(', ')} } from '${k}'`)
        .join('\n')}\n\n` +
      `${sDecl.map(d => d).join('\n\n')}\n`

    let routeFile =
      `import { NotImplementedError, type Galbe } from 'galbe'\n` +
      `import { ${[...rImports].join(', ')} } from '../schemas${scopeKey}.schema'\n\n` +
      `export default (g: Galbe) => {\n` +
      rDecl.map(d => d.replaceAll('\n', '\n  ')).join('\n\n') +
      `\n}\n`

    if (sDecl?.length) await writeCodeFile(resolve(path, schemaPath), schemaFile, target)
    if (rDecl?.length) await writeCodeFile(resolve(path, routePath), routeFile, target)
  }
}

export const generateFromOapi = async (
  input: string,
  out: string,
  { version, ext, target }: { version: string; ext: 'json' | 'yaml'; target: 'js' | 'ts' }
) => {
  let def: OpenAPIV3.Document = ext === 'json' ? await Bun.file(input).json() : ymlLoad(await Bun.file(input).text())

  let v = def?.openapi
  if (!v || !semver.satisfies(v, version)) throw new Error('Invalid openapi version')

  let schemaIndex = buildSchemaIndex(def)
  let endpointDefs = parseEndpoints(def)

  await writeFiles(out, endpointDefs, schemaIndex, target)
}
