import { relative } from 'path'
import { watch } from 'fs'
import { Galbe, type Route } from '../src'
import { logRoute, walkRoutes } from '../src/util'
import { type RouteMeta, defineRoutes, NEVER_SCANNED_DIRS } from '../src/routes'

export { default as pckg } from '../package.json'

export const CWD = process.cwd()
// What the analyzer refuses to load, the watcher refuses to watch: reloading on
// a `bun install` or a `git checkout` only ever costs a respawn. `.galbe` is a
// legacy build directory, kept for apps that still carry one. Always applied —
// `--watchignore` adds to this list, it does not replace it.
export const WATCH_IGNORE = new RegExp(
  `(^|[\\\\/])(${[...NEVER_SCANNED_DIRS, '.galbe'].map(d => d.replaceAll('.', '\\.')).join('|')})([\\\\/]|$)`
)

export const fmtVal = (v: any) => {
  if (typeof v === 'boolean') return `\x1b[3${v ? '2' : '1'}m${v}\x1b[0m`
  if (typeof v === 'string') return `\x1b[33m${v}\x1b[0m`
  if (typeof v === 'number') return `\x1b[36m${v}\x1b[0m`
  return v
}
export const fmtList = (l: any) => `[${l.map((v: any) => fmtVal(v)).join(', ')}]`
export const fmtInterval = (a: any, b: any) => `[${fmtVal(a)}-${fmtVal(b)}]`

export const silentExec = async (fn: () => any) => {
  let consoleMock = Object.fromEntries(
    Object.entries(console)
      .filter(([_, v]) => typeof v === 'function')
      .map(([k, _]) => [k, () => {}])
  )
  const _console = console
  const _processStdoutWrite = process.stdout.write
  const _processStderrWrite = process.stderr.write
  //@ts-ignore
  global.console = consoleMock
  //@ts-ignore
  process.stdout.write = function () {}
  //@ts-ignore
  process.stderr.write = function () {}
  const r = await fn()
  global.console = _console
  process.stdout.write = _processStdoutWrite
  process.stderr.write = _processStderrWrite
  return r
}
export type ReloadStrategy = 'registry' | 'respawn'
// `Loader.registry` is a low-level JavaScriptCore API that current Bun versions (1.3.x)
// do not expose at runtime; when absent, watch-mode reload must respawn the app process.
export const resolveReloadStrategy = (scope: any = globalThis): ReloadStrategy =>
  typeof scope?.Loader?.registry?.clear === 'function' ? 'registry' : 'respawn'

export const watchDir = async (
  path: string,
  callback: (event: {
    path: string | null
    eventType: 'change' | 'add' | 'addDir' | 'unlink' | 'unlinkDir'
  }) => any | Promise<any>,
  options?: { ignore?: RegExp }
) => {
  watch(path, { persistent: false, recursive: true }, async (eventType, filename) => {
    const filePath = filename?.toString() ?? null
    if (!filePath || filePath.match(WATCH_IGNORE)) return
    if (options?.ignore && filePath.match(options.ignore)) return
    await callback({ path: filePath, eventType: eventType === 'change' ? 'change' : 'add' })
  })
}
export const instanciateRoutes = async (g: Galbe) => {
  console.log('🏗️  \x1b[1mConstructing routes\x1b[0m\n')
  // Main thread routes definitions
  let hasMainRoutes = false
  walkRoutes(g.router.routes, r => {
    hasMainRoutes = true
    logRoute(r)
  })
  if (hasMainRoutes) Bun.write(Bun.stdout, '\n')
  // Route Files Analysis
  let routes: Record<string, { route?: Route; meta?: RouteMeta; error?: any }[]> = {}
  let errors: Record<string, any> = {}

  // static registrations emit one event per served file: collapse them to one
  // log line per `static(path, target)` call
  const seenStaticRoots = new Set<string>()
  await defineRoutes(
    { routes: g?.config?.routes, middleware: g?.config?.middleware },
    g,
    ({ type, route, error, filepath, meta }) => {
      if (meta?.ignore || meta?.hide) return
      if (!filepath) return
      if (!(filepath in routes)) routes[filepath] = []
      if (type === 'add' && route && filepath) {
        const root = route.static?.root
        if (root) {
          if (seenStaticRoots.has(`${filepath}:${root}`)) return
          seenStaticRoots.add(`${filepath}:${root}`)
          const target = g.staticTargets.find(t => t.path === root)?.target ?? route.static!.path
          routes[filepath].push({ route: { ...route, path: root, static: { path: target, root } }, meta })
        } else routes[filepath].push({ route, meta })
      }
      if (type === 'error') errors[filepath] = error
    }
  )
  for (let [fp, e] of Object.entries(routes)) {
    console.log(`\x1b\[0;36m    ${relative(CWD, fp)}\x1b[0m`)
    let maxPathLength = e.reduce((p, c) => {
      return Math.max(p, c.route?.path.length || 0)
    }, 0)
    for (let r of e) {
      if (r.route && !r.meta?.ignore && !r.meta?.hide) logRoute(r.route, r.meta, { maxPathLength })
    }
    if (errors?.[fp]) {
      console.log(`\x1b\[0;31m    Error:\x1b[0m`)
      console.log(errors?.[fp])
    }
    console.log('')
  }
  console.log('\x1b[1;30m\x1b[32mdone\x1b[0m\n')
}

export function abbreviateVar(input: string): string {
  if (!input) return ''
  const normalized = input
    .replace(/[_\-\s]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')

  const tokens = normalized
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

  if (tokens.length === 0) return ''

  return tokens
    .map(t => t[0])
    .join('')
    .toLowerCase()
}

export const toPascalCase = (input: string) =>
  input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
