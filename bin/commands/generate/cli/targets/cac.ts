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
  configPath?: string
}

export async function generate(opts: GenerateOptions): Promise<void> {
  if (opts.mode === 'standalone') await buildStandalone(opts)
  else await buildModule(opts)
}

async function buildStandalone(opts: GenerateOptions): Promise<void> {
  // Bundle config as an IIFE to avoid importing the full config module at startup
  // (a direct import would run all module-level side effects before the CLI is set up).
  let inlinedConfigCode: string | undefined
  if (opts.configPath) {
    const tmpDir = await mkdtemp(resolve(tmpdir(), 'galbe-cli-cfg-'))
    try {
      const allExports = [
        '__galbe_baseUrl',
        '__galbe_headers',
        '__galbe_requestInterceptor',
        '__galbe_responseFormatter',
      ]
      const entry = [
        `import { options as __cfg } from ${JSON.stringify(opts.configPath)}`,
        `const __galbe_baseUrl = __cfg?.baseUrl`,
        `const __galbe_headers = __cfg?.headers`,
        `const __galbe_requestInterceptor = __cfg?.requestInterceptor`,
        `const __galbe_responseFormatter = __cfg?.responseFormatter`,
        `export { ${allExports.join(', ')} }`,
      ].join('\n')
      const entryPath = resolve(tmpDir, 'entry.ts')
      const outPath = resolve(tmpDir, 'bundled.js')
      await Bun.write(entryPath, entry)
      await $`bun build --bundle --format esm ${entryPath} --outfile ${outPath}`.quiet()
      const bundled = await Bun.file(outPath).text()

      const exportMatch = bundled.match(/export\s*\{([^}]+)\}/)
      const codeBody = exportMatch ? bundled.replace(/export\s*\{[^}]+\}\s*;?\s*/g, '').trim() : bundled.trim()

      let returnExpr = `{ ${allExports.join(', ')} }`
      if (exportMatch) {
        const entries = exportMatch[1]
          .split(',')
          .map(e => {
            const parts = e.trim().split(/\s+as\s+/)
            return { local: parts[0].trim(), exported: (parts[1] ?? parts[0]).trim() }
          })
          .filter(e => allExports.includes(e.exported))
        if (entries.length) {
          const props = entries.map(e => (e.local === e.exported ? e.exported : `${e.exported}: ${e.local}`)).join(', ')
          returnExpr = `{ ${props} }`
        }
      }

      const indented = codeBody
        .split('\n')
        .map(l => '  ' + l)
        .join('\n')
      inlinedConfigCode = `const { ${allExports.join(', ')} } = (() => {\n${indented}\n  return ${returnExpr}\n})()`
    } finally {
      await rm(tmpDir, { recursive: true })
    }
  }

  const code = generateSource(opts.commands, 'standalone', opts.pckg, opts.options, undefined, inlinedConfigCode)
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
  // For module mode, the output must be self-contained (only cac as external dep).
  // Bundle the config and its transitive deps into an IIFE snippet that is embedded
  // directly in the generated file.
  let inlinedConfigCode: string | undefined
  if (opts.configPath) {
    const tmpDir = await mkdtemp(resolve(tmpdir(), 'galbe-cli-cfg-'))
    try {
      const entry = [
        `import { options as __cfg } from ${JSON.stringify(opts.configPath)}`,
        `const __galbe_requestInterceptor = __cfg?.requestInterceptor`,
        `const __galbe_responseFormatter = __cfg?.responseFormatter`,
        `export { __galbe_requestInterceptor, __galbe_responseFormatter }`,
      ].join('\n')
      const entryPath = resolve(tmpDir, 'entry.ts')
      const outPath = resolve(tmpDir, 'bundled.js')
      await Bun.write(entryPath, entry)
      await $`bun build --bundle --format esm ${entryPath} --outfile ${outPath}`.quiet()
      const bundled = await Bun.file(outPath).text()

      // Parse "export { localA as exportedA, ... }" and transform to a return expression
      // so that renaming by the bundler doesn't break the IIFE interface.
      const exportMatch = bundled.match(/export\s*\{([^}]+)\}/)
      const codeBody = exportMatch ? bundled.replace(/export\s*\{[^}]+\}\s*;?\s*/g, '').trim() : bundled.trim()

      let returnExpr = '{ __galbe_requestInterceptor, __galbe_responseFormatter }'
      if (exportMatch) {
        const entries = exportMatch[1]
          .split(',')
          .map(e => {
            const parts = e.trim().split(/\s+as\s+/)
            return { local: parts[0].trim(), exported: (parts[1] ?? parts[0]).trim() }
          })
          .filter(e => e.exported === '__galbe_requestInterceptor' || e.exported === '__galbe_responseFormatter')
        if (entries.length) {
          const props = entries.map(e => (e.local === e.exported ? e.exported : `${e.exported}: ${e.local}`)).join(', ')
          returnExpr = `{ ${props} }`
        }
      }

      const indented = codeBody
        .split('\n')
        .map(l => '  ' + l)
        .join('\n')
      inlinedConfigCode = `const { __galbe_requestInterceptor, __galbe_responseFormatter } = (() => {\n${indented}\n  return ${returnExpr}\n})()`
    } finally {
      await rm(tmpDir, { recursive: true })
    }
  }

  const code = generateSource(opts.commands, 'module', opts.pckg, opts.options, undefined, inlinedConfigCode)
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
  const hide = new Set(c.hideOptions ?? [])
  const tagPrefix = includeTag && c.tags.length > 0 ? c.tags.map(t => t.toLowerCase()).join(' ') + ' ' : ''
  const pathArgs = (c.arguments || []).map(a => ` ${a.type.replace(/\w+/, a.name)}`).join('')
  const cmdStr = `${tagPrefix}${c.name}${pathArgs}`
  const desc = JSON.stringify(c.description || '')

  const routeOptsLines = (c.options || [])
    .map(o => {
      const cleanName = sanitizeOptionName(o.name)
      const short = o.short && !builtinShorts.has(o.short) ? `-${o.short}, ` : ''
      const optType = o.type != null ? o.type : '[string]'
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

  const argsObj = (c.arguments || []).length ? `{ ${(c.arguments || []).map(a => a.name).join(', ')} }` : '{}'

  const commandMeta: Record<string, any> = { name: c.name, tags: c.tags }
  if (c.description !== undefined) commandMeta.description = c.description
  commandMeta.pathT = c.pathT
  if (c.arguments !== undefined) commandMeta.arguments = c.arguments
  if (c.options !== undefined) commandMeta.options = c.options
  if (c.hideOptions !== undefined) commandMeta.hideOptions = c.hideOptions
  const commandLiteral = serializeValue(commandMeta)

  const builtinOptLines = [
    !hide.has('header') && `  .option('-H, --header [string...]', 'request header as name=value', { default: [] })`,
    !hide.has('query') && `  .option('-Q, --query [string...]', 'query param as name=value', { default: [] })`,
    !hide.has('body') && `  .option('-b, --body [string]', 'request body')`,
    !hide.has('body-file') && `  .option('-B, --body-file [string]', 'request body file path')`,
  ]
    .filter(Boolean)
    .join('\n')

  return `${cliVar}.command(${JSON.stringify(cmdStr)}, ${desc})
${builtinOptLines}
${routeOptsLines}
  .action(async (${actionParams}) => {
    const { header, query, body, bodyFile } = options as any
    const _args = ${argsObj}
    ${customAction}return _fetchApi(${JSON.stringify(method)}, ${pathLiteral}, header ?? [], query ?? [], body ?? '', bodyFile ?? '', ${routeOptsObj}, ${commandLiteral}, _args, options as any)
  })`
}

type CommandNode = {
  subgroups: Map<string, CommandNode>
  commands: GalbeCLICommand[]
}

function buildCommandTree(commands: GalbeCLICommand[]): CommandNode {
  const root: CommandNode = { subgroups: new Map(), commands: [] }
  for (const cmd of commands) {
    let node = root
    for (const tag of cmd.tags) {
      const t = tag.toLowerCase()
      if (!node.subgroups.has(t)) node.subgroups.set(t, { subgroups: new Map(), commands: [] })
      node = node.subgroups.get(t)!
    }
    node.commands.push(cmd)
  }
  return root
}

function nodeToBlock(node: CommandNode, tagPath: string[], appName: string, version: string): string {
  const depth = tagPath.length
  const safeId = (t: string) => t.replace(/[^a-zA-Z0-9]/g, '_')
  const cliVar = depth === 0 ? '_cli' : `_sub_${tagPath.map(safeId).join('_')}`
  const knownVar = depth === 0 ? '_known' : `_known_${tagPath.map(safeId).join('_')}`
  const cliName = [appName, ...tagPath].join(' ')
  const argvExpr = `_argv[${depth}]`

  const subGroupEntries = [...node.subgroups.entries()]

  const subBlocks = subGroupEntries.map(([tag, subNode], i) => {
    const sub = nodeToBlock(subNode, [...tagPath, tag], appName, version)
    const indented = sub
      .split('\n')
      .map(l => '  ' + l)
      .join('\n')
    return `${i === 0 ? 'if' : 'else if'} (${argvExpr} === ${JSON.stringify(tag)}) {\n${indented}\n}`
  })

  const groupListings = subGroupEntries
    .map(([tag]) => `${cliVar}.command(${JSON.stringify(tag)}, ${JSON.stringify(tag + ' commands')})`)
    .join('\n')

  const commandBlocks = node.commands.map(c => generateSingleCommand(c, cliVar, false)).join('\n\n')

  const versionLine = depth === 0 ? `\n${cliVar}.version(${JSON.stringify(version)})` : ''
  const parseArg = depth > 0 ? `['', '', ..._argv.slice(${depth})]` : ''

  const cliBlockLines = [
    `const ${cliVar} = cac(${JSON.stringify(cliName)})${versionLine}`,
    groupListings,
    commandBlocks,
    `${cliVar}.help()`,
    `const ${knownVar} = new Set(${cliVar}.commands.map((c: any) => c.name))`,
    `if (!${argvExpr} || (!${argvExpr}.startsWith('-') && !${knownVar}.has(${argvExpr}))) {`,
    `  ${cliVar}.outputHelp()`,
    `  process.exit(${argvExpr} ? 1 : 0)`,
    `}`,
    `try { ${cliVar}.parse(${parseArg}) } catch (e: any) { console.error(\`error: \${e.message ?? e}\`); process.exit(1) }`,
  ]
    .filter(Boolean)
    .join('\n')

  if (subBlocks.length > 0) {
    const indentedCli = cliBlockLines
      .split('\n')
      .map(l => '  ' + l)
      .join('\n')
    return `${subBlocks.join('\n')}\nelse {\n${indentedCli}\n}`
  }
  return cliBlockLines
}

function generateStandaloneBlock(commands: GalbeCLICommand[], name: string, version: string): string {
  return nodeToBlock(buildCommandTree(commands), [], name, version)
}

function generateModuleCommands(commands: GalbeCLICommand[], appName: string): string {
  const tree = buildCommandTree(commands)
  const safeId = (t: string) => t.replace(/[^a-zA-Z0-9]/g, '_')
  const lines: string[] = []

  function genSubCacSetup(node: CommandNode, tagPath: string[]): string {
    const subVar = `_sub_${tagPath.map(safeId).join('_')}`
    const cliName = [appName, ...tagPath].join(' ')
    const nodeLines: string[] = []

    nodeLines.push(`const ${subVar} = cac(${JSON.stringify(cliName)})`)
    for (const cmd of node.commands) nodeLines.push(generateSingleCommand(cmd, subVar, false))

    for (const [tag, subNode] of node.subgroups.entries()) {
      const subTagPath = [...tagPath, tag]
      const subSubVar = `_sub_${subTagPath.map(safeId).join('_')}`
      const grpVar = `_grp_${subTagPath.map(safeId).join('_')}`
      const knownVar = `_known_${subTagPath.map(safeId).join('_')}`
      nodeLines.push(genSubCacSetup(subNode, subTagPath))
      nodeLines.push(
        `const ${grpVar} = ${subVar}.command(${JSON.stringify(tag + ' [..._sub]')}, ${JSON.stringify(tag + ' commands')})` +
          `\n  .allowUnknownOptions()` +
          `\n  .action(() => {` +
          `\n    const _rawArgv = process.argv.slice(2)` +
          `\n    const _tagIdx = _rawArgv.findIndex((a: string) => a === ${JSON.stringify(tag)})` +
          `\n    const _subArgv = _tagIdx >= 0 ? _rawArgv.slice(_tagIdx + 1) : []` +
          `\n    const ${knownVar} = new Set(${subSubVar}.commands.map((c: any) => c.name))` +
          `\n    if (!_subArgv[0] || (!_subArgv[0].startsWith('-') && !${knownVar}.has(_subArgv[0]))) {` +
          `\n      ${subSubVar}.outputHelp()` +
          `\n      process.exit(_subArgv[0] ? 1 : 0)` +
          `\n    }` +
          `\n    try { ${subSubVar}.parse(['', '', ..._subArgv]) } catch (e: any) { console.error(\`error: \${e.message ?? e}\`); process.exit(1) }` +
          `\n  })` +
          `\n;(${grpVar} as any).rawName = ${JSON.stringify(tag)}` +
          `\n;(${grpVar} as any).outputHelp = () => ${subSubVar}.outputHelp()`
      )
    }

    nodeLines.push(`${subVar}.help()`)
    return nodeLines.join('\n')
  }

  for (const [tag, subNode] of tree.subgroups.entries()) {
    const subVar = `_sub_${safeId(tag)}`
    const grpVar = `_grp_${safeId(tag)}`
    const knownVar = `_known_${safeId(tag)}`
    lines.push(genSubCacSetup(subNode, [tag]))
    lines.push(
      `const ${grpVar} = parent.command(${JSON.stringify(tag + ' [..._sub]')}, ${JSON.stringify(tag + ' commands')})` +
        `\n  .allowUnknownOptions()` +
        `\n  .action(() => {` +
        `\n    const _rawArgv = process.argv.slice(2)` +
        `\n    const _tagIdx = _rawArgv.findIndex((a: string) => a === ${JSON.stringify(tag)})` +
        `\n    const _subArgv = _tagIdx >= 0 ? _rawArgv.slice(_tagIdx + 1) : []` +
        `\n    const ${knownVar} = new Set(${subVar}.commands.map((c: any) => c.name))` +
        `\n    if (!_subArgv[0] || (!_subArgv[0].startsWith('-') && !${knownVar}.has(_subArgv[0]))) {` +
        `\n      ${subVar}.outputHelp()` +
        `\n      process.exit(_subArgv[0] ? 1 : 0)` +
        `\n    }` +
        `\n    try { ${subVar}.parse(['', '', ..._subArgv]) } catch (e: any) { console.error(\`error: \${e.message ?? e}\`); process.exit(1) }` +
        `\n  })` +
        `\n;(${grpVar} as any).rawName = ${JSON.stringify(tag)}` +
        `\n;(${grpVar} as any).outputHelp = () => ${subVar}.outputHelp()`
    )
  }

  for (const cmd of tree.commands) lines.push(generateSingleCommand(cmd, 'parent', false))

  lines.push(
    `const _parseOrig = (parent as any).parse.bind(parent)` +
      `\n;(parent as any).parse = (argv?: string[]) => {` +
      `\n  const _a: string[] = argv ?? process.argv` +
      `\n  const _positionals = _a.slice(2).filter((x: string) => !x.startsWith('-'))` +
      `\n  if (_positionals.length === 0 && !_a.slice(2).includes('--help') && !_a.slice(2).includes('-h')) {` +
      `\n    parent.outputHelp()` +
      `\n    process.exit(0)` +
      `\n  }` +
      `\n  let _r: any` +
      `\n  try { _r = _parseOrig(argv) } catch (e: any) { console.error(\`error: \${e.message ?? e}\`); process.exit(1) }` +
      `\n  if (!(parent as any).matchedCommand && _positionals.length > 0 && !_a.slice(2).includes('--help') && !_a.slice(2).includes('-h')) {` +
      `\n    console.error(\`error: Unknown command "\${_positionals[0]}"\`)` +
      `\n    process.exit(1)` +
      `\n  }` +
      `\n  return _r` +
      `\n}`
  )

  return lines.filter(Boolean).join('\n\n')
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
}

const _headersToObj = (h: Headers): Record<string, string> => {
  const r: Record<string, string> = {}
  h.forEach((v, k) => { r[k] = v })
  return r
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
const _requestInterceptor: ((req: Request, command: any, args: Record<string, string>, options: Record<string, any>) => Promise<Request> | Request) | undefined = ${bakedRequestInterceptor}
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
  routeOpts: Record<string, unknown>,
  command: any,
  cliArgs: Record<string, string>,
  cliOptions: Record<string, any>
): Promise<void> => {`
    : `const _makeFetchApi = (_opts: CLIOptions) => async (
  method: string,
  path: string,
  header: string[],
  query: string[],
  body: string,
  bodyFile: string,
  routeOpts: Record<string, unknown>,
  command: CommandInfo,
  cliArgs: Record<string, string>,
  cliOptions: Record<string, any>
): Promise<void> => {`

  const baseUrlCall = isStandalone ? '_getBaseUrl()' : '_getBaseUrl(_opts)'
  const headersRef = isStandalone ? '_defaultHeaders' : '(_opts.headers ?? {})'
  const interceptorRef = isStandalone ? '_requestInterceptor' : '_opts.requestInterceptor'
  const formatterRef = isStandalone ? '_responseFormatter' : '_opts.responseFormatter'

  return `${bakedConfig}${getBaseUrl}

${fetchApiSignature}
  const fmt = new Set('sbp'.split(''))
  const _toArr = (v: any): string[] => Array.isArray(v) ? v : v ? [String(v)] : []
  const extraHeaders = Object.fromEntries(_toArr(header).map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)] }))
  const queryParams = Object.fromEntries(_toArr(query).map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)] }))
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

  if (${interceptorRef}) {
    try { req = await ${interceptorRef}(req, command, cliArgs, cliOptions) } catch (e: any) {
      console.error(_ansi(true, '31', \`error: \${e?.message ?? e}\`))
      process.exit(1)
    }
  }

  let _res: Response | undefined
  let _resClone: Response | undefined
  try {
    const t0 = Bun.nanoseconds()
    _res = await fetch(req)
    _resClone = _res.clone()
    const elapsed = (Bun.nanoseconds() - t0) / 1_000_000

    if (${formatterRef}) {
      try { Bun.write(Bun.stdout, await ${formatterRef}(_res, command, cliArgs, cliOptions)) } catch (e: any) {
        console.error(_ansi(true, '31', \`error: \${e?.message ?? e}\`))
        process.exit(1)
      }
    } else {
      if (fmt.has('s')) Bun.write(Bun.stdout, \`\${_res.status}\\n\`)
      if (fmt.has('h')) Bun.write(Bun.stdout, _fmtObject(_headersToObj(_res.headers), fmt.has('p')) + '\\n')
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
      console.error(\`[debug] request headers: \${JSON.stringify(_headersToObj(req.headers), null, 2)}\`)
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
  options?: GalbeCLIOptions,
  _unused?: undefined,
  // pre-bundled IIFE snippet; standalone exports all 4 config values, module exports only functions
  inlinedConfigCode?: string
): string {
  const name = pckg?.name || 'galbe-cli'
  const version = pckg?.version || '0.1.0'
  const nameVersion = `${name}/${version}/cli`

  // Standalone with config: all values come from the IIFE (avoids module-level side effects).
  // Module with config: scalars serialized from options; functions come from the IIFE.
  const standaloneInlined = mode === 'standalone' && !!inlinedConfigCode
  const bakedBaseUrl = standaloneInlined ? '__galbe_baseUrl' : serializeValue(options?.baseUrl)
  const bakedHeaders = standaloneInlined ? '__galbe_headers ?? {}' : serializeValue(options?.headers ?? {})
  const bakedRequestInterceptor = !!inlinedConfigCode
    ? '__galbe_requestInterceptor'
    : serializeValue(options?.requestInterceptor)
  const bakedResponseFormatter = !!inlinedConfigCode
    ? '__galbe_responseFormatter'
    : serializeValue(options?.responseFormatter)

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
${inlinedConfigCode ? '\n' + inlinedConfigCode + '\n' : ''}${utils}
${fetchApi}

const _argv = process.argv.slice(2)

${block}
`
  } else {
    const cmds = generateModuleCommands(commands, name)

    const defaultOptsEntries: string[] = []
    if (options?.baseUrl !== undefined) defaultOptsEntries.push(`  baseUrl: ${serializeValue(options.baseUrl)}`)
    if (options?.headers !== undefined) defaultOptsEntries.push(`  headers: ${serializeValue(options.headers)}`)
    if (inlinedConfigCode) {
      // Functions are defined by the inlined IIFE; always include them (undefined = no-op)
      defaultOptsEntries.push(`  requestInterceptor: __galbe_requestInterceptor as CLIOptions['requestInterceptor']`)
      defaultOptsEntries.push(`  responseFormatter: __galbe_responseFormatter as CLIOptions['responseFormatter']`)
    } else {
      if (options?.requestInterceptor !== undefined)
        defaultOptsEntries.push(`  requestInterceptor: ${serializeValue(options.requestInterceptor)}`)
      if (options?.responseFormatter !== undefined)
        defaultOptsEntries.push(`  responseFormatter: ${serializeValue(options.responseFormatter)}`)
    }
    const defaultOpts = defaultOptsEntries.length ? `{\n${defaultOptsEntries.join(',\n')}\n}` : '{}'

    return `${header}

import { cac, type CAC } from 'cac'

export type CommandInfo = {
  name: string
  tags: string[]
  description?: string
  pathT: string
  arguments?: { name: string; type: string; description: string }[]
  options?: { name: string; short: string; type: string; description: string; default: any }[]
  hideOptions?: string[]
}

export type CLIOptions = {
  baseUrl?: string | (() => string)
  headers?: Record<string, string>
  requestInterceptor?: (req: Request, command: CommandInfo, args: Record<string, string>, options: Record<string, any>) => Promise<Request> | Request
  responseFormatter?: (res: Response, command: CommandInfo, args: Record<string, string>, options: Record<string, any>) => Promise<string> | string
}
${inlinedConfigCode ? '\n' + inlinedConfigCode + '\n' : ''}${utils}
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
