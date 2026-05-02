import { $ } from 'bun'
import { resolve } from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import type { GalbeCLICommand, GalbeCLIOptions } from '../../../../../src'
import { CWD } from '../../../../util'

export interface GenerateOptions {
  commands: GalbeCLICommand[]
  mode: 'standalone' | 'module'
  out: string
  pckg: any
  options?: GalbeCLIOptions
}

export async function generate(opts: GenerateOptions): Promise<void> {
  if (opts.mode === 'standalone') await buildStandalone(opts)
  else await buildModule(opts)
}

async function buildStandalone(opts: GenerateOptions): Promise<void> {
  const code = generateSource(opts.commands, 'standalone', opts.pckg, opts.options)
  const buildDir = await mkdtemp(resolve(tmpdir(), 'galbe-cli-'))
  try {
    await Bun.write(resolve(buildDir, 'package.json'), JSON.stringify({ dependencies: { cac: 'latest' } }))
    await $`bun install --cwd ${buildDir}`.quiet()
    await Bun.write(resolve(buildDir, 'cli.ts'), code)
    const outPath = resolve(CWD, opts.out)
    await $`bun build --compile ${resolve(buildDir, 'cli.ts')} --outfile ${outPath}`.quiet()
  } finally {
    await rm(buildDir, { recursive: true })
  }
}

async function buildModule(opts: GenerateOptions): Promise<void> {
  const code = generateSource(opts.commands, 'module', opts.pckg, opts.options)
  await Bun.write(resolve(CWD, opts.out), code)
}

function serializeValue(value: any): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'function') return value.toString()
  if (Array.isArray(value)) return `[${value.map(serializeValue).join(', ')}]`
  if (typeof value === 'object')
    return `{ ${Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k)}: ${serializeValue(v)}`)
      .join(', ')} }`
  return 'undefined'
}

// cac camelCases hyphenated option names when accessing via options object
function toCamelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

// Strip characters that are invalid in JS identifiers / cac option names
function sanitizeOptionName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, '').replace(/^-+/, '') || 'opt'
}

function generateSingleCommand(c: GalbeCLICommand, cliVar: string, includeTag: boolean): string {
  const builtinShorts = new Set(['H', 'Q', 'b', 'B'])
  const tag = c.tags[0]?.toLowerCase() || ''
  const pathArgs = (c.arguments || []).map(a => ` <${a.name}>`).join('')
  const cmdStr = includeTag ? `${tag ? tag + ' ' : ''}${c.name}${pathArgs}` : `${c.name}${pathArgs}`
  const desc = JSON.stringify(c.description || '')

  const routeOptsLines = (c.options || [])
    .map(o => {
      const cleanName = sanitizeOptionName(o.name)
      const short = o.short && !builtinShorts.has(o.short) ? `-${o.short}, ` : ''
      const optType = o.type || '[string]'
      const defVal = o.default !== undefined ? `, { default: ${serializeValue(o.default)} }` : ''
      return `  .option('${short}--${cleanName} ${optType}', ${JSON.stringify(o.description || o.name)}${defVal})`
    })
    .join('\n')

  const actionParams = (c.arguments || []).length
    ? (c.arguments || []).map(a => a.name).join(', ') + ', options'
    : 'options'

  const routeOptsObj = (c.options || []).length
    ? `{ ${(c.options || []).map(o => `${JSON.stringify(o.name)}: (options as any).${toCamelCase(sanitizeOptionName(o.name))}`).join(', ')} }`
    : '{}'

  const pathLiteral = '`' + c.pathT.replace(/`/g, '\\`') + '`'
  const method = c.route.method.toUpperCase()
  const customAction = c.action ? `await (${c.action.toString()})(options as any)\n    ` : ''

  return `${cliVar}.command(${JSON.stringify(cmdStr)}, ${desc})
  .option('-H, --header [string...]', 'request header as name=value', { default: [] })
  .option('-Q, --query [string...]', 'query param as name=value', { default: [] })
  .option('-b, --body [string]', 'request body')
  .option('-B, --body-file [string]', 'request body file path')
${routeOptsLines}
  .action(async (${actionParams}) => {
    const { header, query, body, bodyFile } = options as any
    ${customAction}return _fetchApi(${JSON.stringify(method)}, ${pathLiteral}, header ?? [], query ?? [], body ?? '', bodyFile ?? '', ${routeOptsObj})
  })`
}

function generateStandaloneBlock(commands: GalbeCLICommand[], name: string, version: string): string {
  // Group by first tag (lowercased), untagged go to root
  const groups = new Map<string, GalbeCLICommand[]>()
  const untagged: GalbeCLICommand[] = []
  for (const c of commands) {
    const tag = c.tags[0]?.toLowerCase()
    if (tag) {
      if (!groups.has(tag)) groups.set(tag, [])
      groups.get(tag)!.push(c)
    } else {
      untagged.push(c)
    }
  }

  const groupBlocks = [...groups.entries()].map(([tag, cmds], i) => {
    const subVar = `_sub`
    const subCmds = cmds.map(c => generateSingleCommand(c, subVar, false)).join('\n\n')
    return `${i === 0 ? 'if' : 'else if'} (_rootCmd === ${JSON.stringify(tag)}) {
  const ${subVar} = cac(${JSON.stringify(name + ' ' + tag)})
${subCmds
  .split('\n')
  .map(l => '  ' + l)
  .join('\n')}
  ${subVar}.help()
  const _known = new Set(${subVar}.commands.map((c: any) => c.name))
  const _subArg = _argv[1]
  if (!_subArg || (!_subArg.startsWith('-') && !_known.has(_subArg))) {
    ${subVar}.outputHelp()
    process.exit(_subArg ? 1 : 0)
  }
  ${subVar}.parse(['', '', ..._argv.slice(1)])
}`
  })

  const rootVar = '_cli'
  const groupListings = [...groups.keys()]
    .map(tag => `${rootVar}.command(${JSON.stringify(tag)}, ${JSON.stringify(tag + ' commands')})`)
    .join('\n')
  const untaggedCmds = untagged.map(c => generateSingleCommand(c, rootVar, false)).join('\n\n')

  const rootBlock = `${groupBlocks.length ? 'else ' : ''}{
  const ${rootVar} = cac(${JSON.stringify(name)})
  ${rootVar}.version(${JSON.stringify(version)})
${groupListings
  .split('\n')
  .map(l => '  ' + l)
  .join('\n')}
${
  untaggedCmds
    ? untaggedCmds
        .split('\n')
        .map(l => '  ' + l)
        .join('\n')
    : ''
}
  ${rootVar}.help()
  const _known = new Set(${rootVar}.commands.map((c: any) => c.name))
  if (!_rootCmd || (!_rootCmd.startsWith('-') && !_known.has(_rootCmd))) {
    ${rootVar}.outputHelp()
    process.exit(_rootCmd ? 1 : 0)
  }
  ${rootVar}.parse()
}`

  return [...groupBlocks, rootBlock].join('\n')
}

function generateModuleCommands(commands: GalbeCLICommand[]): string {
  return commands.map(c => generateSingleCommand(c, 'parent', true)).join('\n\n')
}

function generateUtilities(): string {
  return `
const _ansi = (p: boolean, c: string, str: unknown): string =>
  p ? \`\\x1b[\${c}m\${str}\\x1b[0m\` : String(str)

const _fmtObject = (o: unknown, p = false, idt = 2, iidt = 0): string => {
  const _ = ' '.repeat(iidt)
  const __ = ' '.repeat(iidt + idt)
  const lr = idt === 0 ? '' : '\\n'
  if (o === null) return _ansi(p, '38;2;255;128;0', 'null')
  if (typeof o === 'boolean') return _ansi(p, '38;2;255;128;0', String(o))
  if (typeof o === 'number') return _ansi(p, '38;2;10;180;220', String(o))
  if (typeof o === 'string') return _ansi(p, '38;2;125;170;0', \`"\${o}"\`)
  if (Array.isArray(o))
    return \`[\${lr}\${o.map(e => \`\${__}\${_fmtObject(e, p, idt, iidt + idt)}\`).join(\`,\${lr}\`)}\${lr}\${_}]\`
  if (typeof o === 'object' && o !== null)
    return \`{\${lr}\${Object.entries(o as object)
      .map(([k, v]) => v === undefined ? '' : \`\${__}\${_ansi(p, '38;2;170;120;200', \`"\${k}"\`)}: \${_fmtObject(v, p, idt, iidt + idt)}\`)
      .filter(Boolean)
      .join(\`,\${lr}\`)}\${lr}\${_}}\`
  return String(o)
}`
}

function generateFetchApi(
  nameVersion: string,
  bakedBaseUrl: string,
  bakedHeaders: string,
  bakedRequestInterceptor: string,
  bakedResponseFormatter: string,
  isStandalone: boolean
): string {
  const bakedConfig = isStandalone
    ? `
const _baseUrl: string | (() => string) | undefined = ${bakedBaseUrl}
const _defaultHeaders: Record<string, string> = ${bakedHeaders}
const _requestInterceptor: ((req: Request) => Promise<Request> | Request) | undefined = ${bakedRequestInterceptor}
const _responseFormatter: ((res: Response) => Promise<string> | string) | undefined = ${bakedResponseFormatter}
`
    : ''

  const getBaseUrl = isStandalone
    ? `
const _getBaseUrl = (): string => {
  if (_baseUrl) return typeof _baseUrl === 'function' ? _baseUrl() : _baseUrl
  return process.env.GCLI_SERVER_URL ?? ''
}`
    : `
const _getBaseUrl = (_opts: CLIOptions): string => {
  if (_opts.baseUrl) return typeof _opts.baseUrl === 'function' ? _opts.baseUrl() : _opts.baseUrl
  return process.env.GCLI_SERVER_URL ?? ''
}`

  const fetchApiSignature = isStandalone
    ? `const _fetchApi = async (
  method: string,
  path: string,
  header: string[],
  query: string[],
  body: string,
  bodyFile: string,
  routeOpts: Record<string, unknown>
): Promise<void> => {`
    : `const _makeFetchApi = (_opts: CLIOptions) => async (
  method: string,
  path: string,
  header: string[],
  query: string[],
  body: string,
  bodyFile: string,
  routeOpts: Record<string, unknown>
): Promise<void> => {`

  const baseUrlCall = isStandalone ? '_getBaseUrl()' : '_getBaseUrl(_opts)'
  const headersRef = isStandalone ? '_defaultHeaders' : '(_opts.headers ?? {})'
  const interceptorRef = isStandalone ? '_requestInterceptor' : '_opts.requestInterceptor'
  const formatterRef = isStandalone ? '_responseFormatter' : '_opts.responseFormatter'

  return `${bakedConfig}${getBaseUrl}

${fetchApiSignature}
  const fmt = new Set('sbp'.split(''))
  const extraHeaders = Object.fromEntries(header.map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)] }))
  const queryParams = Object.fromEntries(query.map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)] }))
  const queryString = Object.entries({ ...queryParams, ...routeOpts })
    .filter(([_, v]) => v !== undefined && v !== '')
    .map(([k, v]) => \`\${encodeURIComponent(k)}=\${encodeURIComponent(String(v))}\`)
    .join('&')

  const baseUrl = ${baseUrlCall}
  if (!baseUrl) { console.error('error: Missing GCLI_SERVER_URL env'); process.exit(1) }

  const url = \`\${baseUrl}\${path}\${queryString ? '?' + queryString : ''}\`
  let bodyData: BodyInit | undefined
  if (bodyFile) bodyData = await Bun.file(bodyFile).arrayBuffer()
  else if (body) bodyData = body

  let req = new Request(url, {
    method,
    headers: {
      'user-agent': ${JSON.stringify(nameVersion)},
      ...(${headersRef} ?? {}),
      ...(bodyFile ? { 'content-type': 'application/octet-stream' } : {}),
      ...extraHeaders,
    },
    ...(bodyData !== undefined ? { body: bodyData } : {}),
  })

  if (${interceptorRef}) req = await ${interceptorRef}(req)

  let _res: Response | undefined
  let _resClone: Response | undefined
  try {
    const t0 = Bun.nanoseconds()
    _res = await fetch(req)
    _resClone = _res.clone()
    const elapsed = (Bun.nanoseconds() - t0) / 1_000_000

    if (${formatterRef}) {
      Bun.write(Bun.stdout, await ${formatterRef}(_res))
    } else {
      if (fmt.has('s')) Bun.write(Bun.stdout, \`\${_res.status}\\n\`)
      if (fmt.has('h')) Bun.write(Bun.stdout, _fmtObject(Object.fromEntries(_res.headers.entries()), fmt.has('p')) + '\\n')
      if (fmt.has('b')) {
        const ct = _res.headers.get('content-type') ?? ''
        if (ct.includes('application/json')) Bun.write(Bun.stdout, _fmtObject(await _res.json(), fmt.has('p')) + '\\n')
        else if (ct.match(/^text\\//)) Bun.write(Bun.stdout, (await _res.text()) + '\\n')
        else Bun.write(Bun.stdout, new Uint8Array(await _res.arrayBuffer()))
      }
      if (fmt.has('t')) Bun.write(Bun.stdout, \`\${elapsed.toFixed(2)}ms\\n\`)
    }

    process.exit(_res.ok ? 0 : 1)
  } catch (e: any) {
    if (process.env.GCLI_DEBUG) {
      console.error(\`\\n[debug] \${req.method} \${req.url}\`)
      console.error(\`[debug] request headers: \${JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2)}\`)
      if (_resClone) {
        try { console.error(\`[debug] response \${_resClone.status}: \${await _resClone.text()}\`) } catch {}
      }
      console.error(\`[debug] \${e?.stack ?? e}\`)
    }
    console.error(\`error: \${e?.message ?? e}\`)
    process.exit(1)
  }
}`
}

function generateSource(
  commands: GalbeCLICommand[],
  mode: 'standalone' | 'module',
  pckg: any,
  options?: GalbeCLIOptions
): string {
  const name = pckg?.name || 'galbe-cli'
  const version = pckg?.version || '0.1.0'
  const nameVersion = `${name}/${version}/cli`

  const bakedBaseUrl = serializeValue(options?.baseUrl)
  const bakedHeaders = serializeValue(options?.headers ?? {})
  const bakedRequestInterceptor = serializeValue(options?.requestInterceptor)
  const bakedResponseFormatter = serializeValue(options?.responseFormatter)

  const utils = generateUtilities()
  const fetchApi = generateFetchApi(
    nameVersion,
    bakedBaseUrl,
    bakedHeaders,
    bakedRequestInterceptor,
    bakedResponseFormatter,
    mode === 'standalone'
  )

  const header = `/**
 * This file was auto-generated by \`galbe generate cli\`
 * Source: ${name}@${version}
 */`

  if (mode === 'standalone') {
    const block = generateStandaloneBlock(commands, name, version)
    return `#!/usr/bin/env bun
${header}

import { cac } from 'cac'
${utils}
${fetchApi}

const _argv = process.argv.slice(2)
const _rootCmd = _argv[0]

${block}
`
  } else {
    const cmds = generateModuleCommands(commands)

    const defaultOptsEntries: string[] = []
    if (options?.baseUrl !== undefined) defaultOptsEntries.push(`  baseUrl: ${serializeValue(options.baseUrl)}`)
    if (options?.headers !== undefined) defaultOptsEntries.push(`  headers: ${serializeValue(options.headers)}`)
    if (options?.requestInterceptor !== undefined)
      defaultOptsEntries.push(`  requestInterceptor: ${serializeValue(options.requestInterceptor)}`)
    if (options?.responseFormatter !== undefined)
      defaultOptsEntries.push(`  responseFormatter: ${serializeValue(options.responseFormatter)}`)
    const defaultOpts = defaultOptsEntries.length ? `{\n${defaultOptsEntries.join(',\n')}\n}` : '{}'

    return `${header}

import type { CAC } from 'cac'

export type CLIOptions = {
  baseUrl?: string | (() => string)
  headers?: Record<string, string>
  requestInterceptor?: (req: Request) => Promise<Request> | Request
  responseFormatter?: (res: Response) => Promise<string> | string
}
${utils}
${fetchApi}

const _defaultOptions: CLIOptions = ${defaultOpts}

export function register(parent: CAC, options?: CLIOptions): CAC {
  const _opts: CLIOptions = { ..._defaultOptions, ...options }
  const _fetchApi = _makeFetchApi(_opts)

  ${cmds.split('\n').join('\n  ')}

  return parent
}
`
  }
}
