import { Command, Option } from 'commander'
import { resolve } from 'path'
import { transformSync } from '@swc/core'
import { CWD, fmtList, instanciateRoutes, silentExec } from '../../util'
import { Galbe, type GalbeClientRoute, type GalbeClientOptions } from '../../../src'
import { walkRoutes } from '../../../src/util'
import { schemaToTypeStr, Kind, Optional, Stream, type STSchema } from '../../../src/schema'
import type { STResponse, STResponseEntry, STResponseContent } from '../../../src/types'

// ─── MIME / short-name helpers ───────────────────────────────────────────────

const MIME_SHORT: Record<string, string> = {
  'application/json': 'json',
  'application/x-www-form-urlencoded': 'urlForm',
  'multipart/form-data': 'multipart',
  'application/octet-stream': 'byteArray',
  'text/plain': 'text',
  'text/html': 'text',
  '*/*': 'raw',
}
const SHORT_SUFFIX: Record<string, string> = {
  json: 'Json',
  urlForm: 'UrlForm',
  multipart: 'Multipart',
  byteArray: 'ByteArray',
  text: 'Text',
  raw: 'Raw',
}

const mimeToShort = (mime: string) => MIME_SHORT[mime] ?? (mime.startsWith('text/') ? 'text' : 'raw')

// ─── Operaion-id derivation ───────────────────────────────────────────────────

const deriveOperationId = (method: string, path: string): string =>
  `${method}-${path
    .replace(/\//g, '-')
    .replace(/:/g, '')
    .replace(/^-/, '')
    .replace(/-+/g, '-')
    .replace(/-$/, '')}`

// ─── Response-entry helpers ───────────────────────────────────────────────────

const isResponseValue = (entry: STResponseEntry): boolean =>
  Kind in (entry as any) && typeof (entry as any)[Kind] === 'string'

type BodyInfo = { methods: string[]; typeStr: string }

const responseBodyInfo = (entry: STResponseEntry): BodyInfo => {
  if (isResponseValue(entry)) {
    const s = entry as STSchema
    const kind = s[Kind]
    const isStream = Stream in s && (s as any)[Stream]
    if (isStream) return { methods: ['stream'], typeStr: schemaToTypeStr(s) }
    if (kind === 'byteArray') return { methods: ['byteArray'], typeStr: 'Uint8Array' }
    if (kind === 'string') return { methods: ['text'], typeStr: 'string' }
    if (kind === 'null') return { methods: [], typeStr: 'null' }
    return { methods: ['json'], typeStr: schemaToTypeStr(s) }
  }
  // STResponseContent
  const content = entry as STResponseContent
  const methods: string[] = []
  let typeStr = 'unknown'
  for (const [mime, s] of Object.entries(content)) {
    if (!mime.includes('/') || !s) continue
    const schema = s as STSchema
    if (Stream in schema && (schema as any)[Stream]) { methods.push('stream'); continue }
    const short = mimeToShort(mime)
    methods.push(short === 'byteArray' ? 'byteArray' : short === 'text' ? 'text' : 'json')
    typeStr = schemaToTypeStr(schema)
  }
  return { methods: [...new Set(methods)], typeStr }
}

const responseHeadersType = (entry: STResponseEntry): string => {
  const rh: Record<string, any> | undefined = isResponseValue(entry)
    ? (entry as any).responseHeaders
    : (entry as STResponseContent).responseHeaders
  if (!rh || !Object.keys(rh).length) return 'Headers'
  const keys = Object.keys(rh).map(k => `'${k}'`).join('|')
  return `{get<K extends string>(name:K):K extends ${keys}?string:string|null}&Omit<Headers,'get'>`
}

// ─── Code-generation helpers ──────────────────────────────────────────────────

const OKS = new Set([200, 201, 202, 203, 204, 205, 206, 207, 208, 226])
// prettier-ignore
const HTTP_CODES = [100,101,102,103,200,201,202,203,204,205,206,207,208,226,300,301,302,303,304,305,307,308,400,401,402,403,404,405,406,407,408,409,410,411,412,413,414,415,416,417,418,421,422,423,424,426,428,429,431,451,500,501,502,503,504,505,506,507,508,510,511]

const STATIC_TYPES = `
// prettier-ignore
type _OKStatus = ${[...OKS].join('|')}
// prettier-ignore
type _HttpStatus = ${HTTP_CODES.join('|')}
`.trim()

// Convert operationId to a safe TypeScript identifier (for type names)
const safeTypeId = (id: string) => id.replace(/[^a-zA-Z0-9_$]/g, '_')
// Quote a property key if it is not a valid bare identifier
const safePropKey = (id: string) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(id) ? id : `'${id}'`

const buildBodyObjType = (methods: string[], typeStr: string): string => {
  const parts: string[] = []
  if (methods.includes('json')) parts.push(`json():Promise<${typeStr}>`)
  if (methods.includes('text')) parts.push(`text():Promise<string>`)
  if (methods.includes('byteArray')) parts.push(`byteArray():Promise<Uint8Array>`)
  if (methods.includes('stream')) parts.push(`stream():AsyncGenerator<Uint8Array,void,unknown>`)
  if (!parts.length) parts.push(`text():Promise<string>`)
  return `{${parts.join(';')}}`
}

const FALLBACK_BODY = `{json():Promise<unknown>;text():Promise<string>;byteArray():Promise<Uint8Array>;stream():AsyncGenerator<Uint8Array,void,unknown>}`

/** Generates the `type _GR_OpId = ...` discriminated union for $raw */
const buildRawResponseType = (operationId: string, response: STResponse | null): string => {
  const typeName = `_GR_${safeTypeId(operationId)}`
  if (!response || !Object.keys(response).length) {
    return `type ${typeName} = {status:_HttpStatus;ok:boolean;headers:Headers;body:${FALLBACK_BODY}}`
  }

  const declared: string[] = []
  const arms: string[] = []

  for (const [rawKey, entry] of Object.entries(response)) {
    if (!entry) continue
    const status = rawKey === 'default' ? null : Number(rawKey)
    if (status === null) continue // handled as fallback
    declared.push(String(status))
    const ok = OKS.has(status)
    const { methods, typeStr } = responseBodyInfo(entry)
    const headersT = responseHeadersType(entry)
    arms.push(
      `{status:${status};ok:${ok};headers:${headersT};body:${buildBodyObjType(methods, typeStr)}}`
    )
  }

  // fallback arm
  const defaultEntry = (response as any)['default'] as STResponseEntry | undefined
  const fallbackBody = defaultEntry ? buildBodyObjType(...Object.values(responseBodyInfo(defaultEntry)) as [string[], string]) : FALLBACK_BODY
  const excludeStr = declared.length ? `Exclude<_HttpStatus,${declared.join('|')}>` : '_HttpStatus'
  arms.push(`{status:${excludeStr};ok:boolean;headers:Headers;body:${fallbackBody}}`)

  return `type ${typeName} = \n  | ${arms.join('\n  | ')}`
}

/** Build the 2xx union body type (return type of the simple API) */
const buildSuccessType = (response: STResponse | null): string => {
  if (!response) return 'unknown'
  const types: string[] = []
  for (const [rawKey, entry] of Object.entries(response)) {
    if (!entry) continue
    const status = rawKey === 'default' ? null : Number(rawKey)
    if (status === null || !OKS.has(status)) continue
    const { typeStr } = responseBodyInfo(entry)
    types.push(typeStr)
  }
  return types.length ? [...new Set(types)].join('|') : 'unknown'
}

/** Build the error union type (E param of GalbeRequest) */
const buildErrorType = (operationId: string, response: STResponse | null): string => {
  const typeName = `_Err_${safeTypeId(operationId)}`
  if (!response || !Object.keys(response).length) {
    return `type ${typeName} = {status:number;headers:Headers;body:any}`
  }

  const declared: string[] = []
  const arms: string[] = []

  for (const [rawKey, entry] of Object.entries(response)) {
    if (!entry) continue
    const status = rawKey === 'default' ? null : Number(rawKey)
    if (status === null || OKS.has(status)) continue
    declared.push(String(status))
    const { typeStr } = responseBodyInfo(entry)
    const headersT = responseHeadersType(entry)
    arms.push(`{status:${status};headers:${headersT};body:${typeStr}}`)
  }

  const defaultEntry = (response as any)['default'] as STResponseEntry | undefined
  const fallbackBody = defaultEntry ? responseBodyInfo(defaultEntry).typeStr : 'any'
  // also exclude all declared 2xx
  const declared2xx = Object.keys(response)
    .filter(k => k !== 'default' && OKS.has(Number(k)))
    .map(String)
  const allDeclared = [...declared, ...declared2xx]
  const errExcludeStr = allDeclared.length ? `Exclude<_HttpStatus,${allDeclared.join('|')}>` : '_HttpStatus'
  arms.push(`{status:${errExcludeStr};headers:Headers;body:${fallbackBody}}`)

  return `type ${typeName} = \n  | ${arms.join('\n  | ')}`
}

/** One logical route expanded into 1..N variants (one per body content-type) */
interface RouteVariant {
  operationId: string // final method name (may include suffix)
  method: string
  path: string
  pathTemplate: string // with ${param} interpolation
  params: { name: string; typeStr: string; description?: string }[]
  bodyShortName: string | null // null = no body
  bodyTypeStr: string | null
  query: Record<string, { typeStr: string; optional: boolean; description?: string }>
  reqHeaders: Record<string, { typeStr: string; optional: boolean; description?: string }>
  response: STResponse | null
  rawTypeName: string
  errTypeName: string
}

const expandRoute = (r: GalbeClientRoute): RouteVariant[] => {
  const pathTemplate = r.path.replaceAll(/:([^/]+)/g, '${$1}')
  const params = Object.entries(r.params).map(([name, p]) => ({
    name,
    typeStr: p.type,
    description: p.description,
  }))
  const query = Object.fromEntries(
    Object.entries(r.query).map(([k, v]) => [k, { typeStr: v.type, optional: v.optional, description: v.description }])
  )
  const reqHeaders = Object.fromEntries(
    Object.entries(r.headers).map(([k, v]) => [k, { typeStr: v.type, optional: v.optional, description: v.description }])
  )

  const bodyEntries = r.body ? Object.entries(r.body) : []
  const multiBody = bodyEntries.length > 1

  if (!bodyEntries.length) {
    return [
      {
        operationId: r.operationId,
        method: r.method,
        path: r.path,
        pathTemplate,
        params,
        bodyShortName: null,
        bodyTypeStr: null,
        query,
        reqHeaders,
        response: r.response,
        rawTypeName: `_GR_${safeTypeId(r.operationId)}`,
        errTypeName: `_Err_${safeTypeId(r.operationId)}`,
      },
    ]
  }

  return bodyEntries.map(([shortName, schema]) => {
    const suffix = multiBody ? (SHORT_SUFFIX[shortName] ?? shortName[0].toUpperCase() + shortName.slice(1)) : ''
    const id = r.operationId + suffix
    return {
      operationId: id,
      method: r.method,
      path: r.path,
      pathTemplate,
      params,
      bodyShortName: shortName,
      bodyTypeStr: schemaToTypeStr(schema),
      query,
      reqHeaders,
      response: r.response,
      rawTypeName: `_GR_${safeTypeId(id)}`,
      errTypeName: `_Err_${safeTypeId(id)}`,
    }
  })
}

// ─── Method signature builders ────────────────────────────────────────────────

const buildParamList = (v: RouteVariant): string => {
  const parts: string[] = []
  for (const p of v.params) parts.push(`${p.name}:${p.typeStr}`)
  if (v.bodyShortName !== null) parts.push(`body:${v.bodyTypeStr}`)
  const queryFields = Object.entries(v.query)
    .map(([k, p]) => `${k}${p.optional ? '?' : ''}:${p.typeStr}`)
    .join(';')
  const headerFields = Object.keys(v.reqHeaders).length
    ? Object.entries(v.reqHeaders)
        .map(([k, p]) => `'${k}'${p.optional ? '?' : ''}:${p.typeStr}`)
        .join(';')
    : null

  const optParts: string[] = []
  if (queryFields) optParts.push(`query?:{${queryFields}}`)
  if (headerFields) optParts.push(`headers?:{${headerFields}}`)
  else optParts.push(`headers?:Record<string,string>`)
  parts.push(`options?:{${optParts.join(';')}}`)

  return parts.join(',')
}

const buildFetchCall = (v: RouteVariant, fnName: string): string => {
  const pathExpr = v.params.length ? `\`${v.pathTemplate}\`` : `'${v.path}'`
  const bodyArg = v.bodyShortName !== null ? 'body' : 'undefined'
  const optionsArg = v.bodyShortName !== null
    ? `{...(options??{}),contentType:'${v.bodyShortName}'}`
    : 'options'
  return `${fnName}(this.#config,'${v.method.toUpperCase()}',${pathExpr},${bodyArg},${optionsArg})`
}

const buildMethod = (v: RouteVariant): string => {
  const successType = buildSuccessType(v.response)
  const paramList = buildParamList(v)
  const call = buildFetchCall(v, '_createRequest')
  return `  ${safePropKey(v.operationId)}(${paramList}):GalbeRequest<${successType},${v.errTypeName}>{return ${call}}`
}

const buildRawDecl = (v: RouteVariant): string => {
  const paramList = buildParamList(v)
  return `    ${safePropKey(v.operationId)}(${paramList}):Promise<${v.rawTypeName}>`
}

const buildRawImpl = (v: RouteVariant): string => {
  const paramList = buildParamList(v)
  const call = buildFetchCall(v, '_createRawRequest')
  return `      ${safePropKey(v.operationId)}:(${paramList})=>${call}`
}

// ─── Top-level code generator ─────────────────────────────────────────────────

export const generateClientCode = async (opts: {
  routes: GalbeClientRoute[]
  namedTypes: Record<string, string>
  className: string
  version: string
  runtimeContent: string
}): Promise<string> => {
  const { routes, namedTypes, className, version, runtimeContent } = opts

  // Expand each route into per-content-type variants
  const variants = routes.flatMap(expandRoute)

  // Collect response type declarations (deduplicated by raw/err type name)
  const rawTypeDecls = new Map<string, string>()
  const errTypeDecls = new Map<string, string>()
  for (const r of routes) {
    const baseId = r.operationId
    const bodyEntries = r.body ? Object.entries(r.body) : []
    const multiBody = bodyEntries.length > 1

    if (!bodyEntries.length) {
      rawTypeDecls.set(`_GR_${safeTypeId(baseId)}`, buildRawResponseType(baseId, r.response))
      errTypeDecls.set(`_Err_${safeTypeId(baseId)}`, buildErrorType(baseId, r.response))
    } else {
      for (const [shortName] of bodyEntries) {
        const suffix = multiBody ? (SHORT_SUFFIX[shortName] ?? '') : ''
        const id = baseId + suffix
        rawTypeDecls.set(`_GR_${safeTypeId(id)}`, buildRawResponseType(id, r.response))
        errTypeDecls.set(`_Err_${safeTypeId(id)}`, buildErrorType(id, r.response))
      }
    }
  }

  const namedTypesStr = Object.entries(namedTypes)
    .map(([name, t]) => `export type ${name} = ${t}`)
    .join('\n')

  const rawDeclStr = variants.map(buildRawDecl).join('\n')
  const rawImplStr = variants.map(buildRawImpl).join(',\n')
  const methodsStr = variants.map(buildMethod).join('\n')

  return [
    `// Generated by galbe generate client — v${version}`,
    `// Do not edit manually.`,
    ``,
    runtimeContent,
    ``,
    STATIC_TYPES,
    ``,
    namedTypesStr ? `// Named types\n${namedTypesStr}\n` : '',
    [...rawTypeDecls.values(), ...errTypeDecls.values()].join('\n'),
    ``,
    `export class ${className} {`,
    `  readonly #config:GalbeClientConfig`,
    `  readonly $raw:{`,
    rawDeclStr,
    `  }`,
    `  constructor(config?:GalbeClientConfig){`,
    `    this.#config=config??{}`,
    `    this.$raw={`,
    rawImplStr,
    `    }`,
    `  }`,
    methodsStr,
    `}`,
    `export {GalbeClientError}`,
    `export type {GalbeClientConfig}`,
    `export default ${className}`,
  ]
    .filter(s => s !== '')
    .join('\n')
}

// ─── CLI command ──────────────────────────────────────────────────────────────

const clientTargets = ['ts', 'js']

export default (cmd: Command) => {
  cmd
    .description('generate a \x1b[1;30m\x1b[36mGalbe\x1b[0m client')
    .argument('<index>', 'index file')
    .addOption(
      new Option('-o, --out <file>', 'output file').default(null, fmtList(['dist/client.ts', 'dist/client.js']))
    )
    .addOption(
      new Option('-t, --target <target>', `build target ${fmtList(clientTargets)}`).argParser(v => {
        if (clientTargets.includes(v)) return v
        console.log(`error: target must be one of ${fmtList(clientTargets)}`)
        process.exit(1)
      })
    )
    .addOption(new Option('-c, --config <file>', 'config file (.ts or .js)'))
    .action(async (index, props) => {
      let { target, out, config } = props
      if (!target) target = clientTargets.includes(index.split('.').pop()) ? index.split('.').pop() : 'ts'
      if (!out) out = { ts: 'dist/client.ts', js: 'dist/client.js' }[target as 'ts' | 'js']

      let pckg: any = {}
      try { pckg = await Bun.file(resolve(CWD, 'package.json')).json() } catch {}

      let error: any = null
      Bun.write(Bun.stdout, '💻 \x1b[1;30mBuilding \x1b[36mGalbe\x1b[0m\x1b[1;30m client\x1b[0m')

      const g: Galbe = await silentExec(async () => {
        try {
          const mod = (await import(resolve(CWD, index))).default
          await instanciateRoutes(mod)
          await mod.init()
          return mod
        } catch (err) { error = err }
      })

      if (error) {
        console.log(`\nerror: galbe instance import failed`)
        console.log(error)
        return process.exit(1)
      }

      const metaRoutes = g.meta?.reduce(
        (acc, c) => ({ ...acc, ...c.routes }),
        {} as Record<string, Record<string, Record<string, any>>>
      )

      // Collect named types from response schemas with ids
      const namedTypes: Record<string, string> = {}

      const routes: GalbeClientRoute[] = []
      const autoDerivedIds: string[] = []

      walkRoutes(g.router.routes, r => {
        const meta = metaRoutes?.[r.path]?.[r.method]
        const [, summary, description] = meta?.head?.match(/^([^\n]*)\n\n(.*)/) ?? []
        const explicitId: string | undefined = meta?.operationId
        const autoDerived = !explicitId
        const operationId = explicitId ?? deriveOperationId(r.method, r.path)
        if (autoDerived) autoDerivedIds.push(`${r.method.toUpperCase()} ${r.path} → ${operationId}`)

        // Collect named types
        Object.values(r.schema.response ?? {}).forEach(entry => {
          if (!entry) return
          const s = isResponseValue(entry as STResponseEntry) ? entry as STSchema : null
          if (s?.id) namedTypes[s.id] = schemaToTypeStr(s)
        })

        // Build body map (MIME → short name)
        let body: Record<string, STSchema> | null = null
        const rawBody = r.schema.body as any
        if (rawBody && (rawBody as STSchema)[Kind] !== 'null') {
          body = {}
          for (const [mime, s] of Object.entries(rawBody)) {
            if (!mime.includes('/') || !s) continue
            body[mimeToShort(mime)] = s as STSchema
          }
          if (!Object.keys(body).length) body = null
        }

        // Build query schema map
        const query: GalbeClientRoute['query'] = {}
        for (const [k, s] of Object.entries((r.schema.query ?? {}) as Record<string, STSchema>)) {
          query[k] = {
            type: schemaToTypeStr({ ...s, [Optional]: false }),
            optional: !!(s as any)[Optional],
            description: (s as any).description,
          }
        }

        // Build headers schema map
        const headers: GalbeClientRoute['headers'] = {}
        for (const [k, s] of Object.entries((r.schema.headers ?? {}) as Record<string, STSchema>)) {
          headers[k] = {
            type: schemaToTypeStr({ ...s, [Optional]: false }),
            optional: !!(s as any)[Optional],
            description: (s as any).description,
          }
        }

        routes.push({
          method: r.method,
          path: r.path,
          operationId,
          autoDerived,
          params: Object.fromEntries(
            [...r.path.matchAll(/:([^/]+)/g)].map(m => {
              const ps = (r.schema.params as Record<string, STSchema>)?.[m[1]]
              return [m[1], { type: ps ? schemaToTypeStr(ps) : 'string', description: (ps as any)?.description }]
            })
          ),
          query,
          headers,
          body,
          response: (r.schema.response as STResponse) ?? null,
          summary: summary || undefined,
          description: description || undefined,
          tags: meta?.tags ? (Array.isArray(meta.tags) ? meta.tags : [meta.tags]) : [],
        })
      })

      // Load user config
      let userTransform: ((routes: GalbeClientRoute[]) => GalbeClientRoute[]) | undefined
      let userOptions: GalbeClientOptions | undefined
      if (config) {
        try {
          const m = await import(resolve(CWD, config))
          userTransform = m.transform
          userOptions = m.options
        } catch (err) {
          console.log(`\nerror: config file import failed`)
          console.log(err)
          return process.exit(1)
        }
      }
      const finalRoutes = userTransform ? userTransform(routes) : routes
      const className = userOptions?.className ?? 'Client'

      // Log generation info
      const allVariants = finalRoutes.flatMap(expandRoute)
      Bun.write(Bun.stdout, '\n')
      for (const v of allVariants) {
        const sourceRoute = finalRoutes.find(r =>
          r.operationId === v.operationId || v.operationId.startsWith(r.operationId)
        )
        const isAuto = sourceRoute?.autoDerived
        Bun.write(
          Bun.stdout,
          `    ${isAuto ? '\x1b[33m~\x1b[0m' : '\x1b[32m+\x1b[0m'} ${v.operationId}${isAuto ? ' \x1b[2m(auto-derived)\x1b[0m' : ''}\n`
        )
      }
      if (autoDerivedIds.length) {
        Bun.write(
          Bun.stdout,
          `\n  \x1b[33m!\x1b[0m ${autoDerivedIds.length} auto-derived operationId(s) — add explicit operationIds to stabilise names\n`
        )
      }

      const runtimeContent = await Bun.file(resolve(import.meta.dir, '..', '..', 'res', 'client.runtime.ts')).text()

      let code = await generateClientCode({
        routes: finalRoutes,
        namedTypes,
        className,
        version: pckg?.version ?? '0.1.0',
        runtimeContent,
      })

      if (target === 'js') {
        code = transformSync(code, {
          jsc: { parser: { syntax: 'typescript' }, preserveAllComments: true, target: 'esnext' },
        }).code
      }

      await Bun.write(out, code)
      Bun.write(Bun.stdout, ' : \x1b[1;30m\x1b[32mdone\x1b[0m\n')
      process.exit(0)
    })
}
