import type { GalbeConfig, Hook, Method, Route } from './types'

import { readdir, lstat } from 'fs/promises'
import { extname, dirname, relative, resolve, sep } from 'path'
import { parse } from 'acorn'
import { simple } from 'acorn-walk'
import { Galbe, GalbeGroup } from './index'
import { joinPath } from './util'
import { transformSync } from '@swc/wasm'
import { Glob } from 'bun'

export const DEFAULT_ROUTE_PATTERN = 'src/**/*.route.{js,ts}'
export const DEFAULT_MIDDLEWARE_PATTERN = 'src/**/*.middleware.{js,ts}'

const IGNORE_COMMENT_RGX = /^\s*\@galbe-ignore\s*$/
const HIDE_COMMENT_RGX = /^\s*\@galbe-hide\s*$/
const ROUTE_PATH_RGX = /^(\/(\*|:?\d+|:?\w+|:?[\w\d.][\w-.]+[\w\d]))*\/?$/
// literal route segment: the router's segment rules minus ':param' and '*'
const LITERAL_SEGMENT_RGX = /^(\d+|\w+|[\w\d.][\w-.]+[\w\d])$/
const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'static'])

export type RouteMeta = { head?: string, ignore?: boolean, hide?: boolean } & Record<string, boolean | string | string[]>
export type RoutesMeta = {
  header: Record<string, boolean | string | string[]>
  routes: Record<string, Partial<Record<Method | 'static', RouteMeta>>>
  ignore?: boolean
  hide?: boolean
}
export type RouteInstanciationCallback = <T extends 'add' | 'error'>(event: {
  type: T
  error?: T extends 'error' ? any : undefined
  route: T extends 'add' ? Route : undefined
  filepath?: string
  meta: T extends 'add' ? RouteMeta : undefined
}) => any | Promise<any>
export type RouteFileMeta = {
  file: string
} & RoutesMeta
export type MiddlewareFileMeta = {
  file: string
  /** effective middleware pattern, e.g. `/api/*` or `*` */
  scope: string
  header: Record<string, boolean | string | string[]>
}
export type RouteFileRegistration = { file: string; prefix: string }
export type MiddlewareFileRegistration = { file: string; scope: string }

const parseComment = (comment: string): Record<string, string | string[]> => {
  // Find the first JSDoc-tag line (a line whose first non-whitespace/star
  // character is `@`). Anything before it is the head; from it onwards is tags.
  // We can't naively split on `@` because descriptions legitimately contain
  // `@` (e.g. `@scope/name` package identifiers).
  const tagLineRe = /^\s*\*?\s*@[a-zA-Z_][0-9a-zA-Z_]*(?:\s|$)/m
  const m = comment.match(tagLineRe)
  const headRaw = m && m.index !== undefined ? comment.slice(0, m.index) : comment
  const head = headRaw.replace(/^ *\* */gm, '').trim() || ''
  const tagsSrc = m && m.index !== undefined ? comment.slice(m.index) : ''
  const refs = {
    ...(head ? { head } : {}),
    ...[...tagsSrc.matchAll(new RegExp(`^\\s*\\*\\s*@([a-zA-Z_][0-9a-zA-Z_]*)(?:$|\\s+([^\\n]*)\\s*$)`, 'gm'))].reduce(
      (acc, n) => {
        const tag = n[1]!
        const val = n[2] ?? true
        return {
          ...acc,
          [tag]:
            tag in acc ? [...(typeof acc[tag] === 'string' ? [acc[tag]] : acc[tag]), val] : val
        }
      },
      {} as Record<string, any>
    ),
  }
  return refs
}
export const metaAnalysis = async (filePath: string): Promise<RoutesMeta> => {
  const file = Bun.file(filePath)
  const fileExt = extname(filePath)
  let content = await file.text()
  let meta: RoutesMeta = { header: {}, routes: {} }

  if (fileExt === '.ts') {
    //// Much faster but doesn't include comments. See https://github.com/oven-sh/bun/pull/7055
    // content = new Bun.Transpiler({
    //   loader: 'ts',
    //   target: 'bun',
    //   tsconfig: {
    //     compilerOptions: {
    //       // @ts-ignore https://github.com/oven-sh/bun/pull/7055
    //       removeComments: false
    //     }
    //   }
    // }).transformSync(content)
    content = transformSync(content, {
      jsc: {
        parser: {
          syntax: 'typescript'
        },
        preserveAllComments: true,
        // @swc/wasm's JscTarget typing lags @swc/core's; 'esnext' is supported at runtime
        target: 'esnext' as any
      }
    }).code
  }

  const comments: Record<number, Record<number, string>> = {}
  const ignoredLines = new Set<number>()
  const hideLines = new Set<number>()
  const ast = parse(content, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    onComment: (_isBlock, text, _start, _end, _locStart, locEnd) => {
      if (locEnd?.line !== undefined && locEnd?.column !== undefined) {
        if (!comments?.[locEnd.line]) comments[locEnd.line] = []
        if (IGNORE_COMMENT_RGX.test(text)) {
          ignoredLines.add(locEnd.line + 1)
        }
        else if (HIDE_COMMENT_RGX.test(text)) {
          hideLines.add(locEnd.line + 1)
        }
        else comments[locEnd.line]![locEnd.column] = text
      }
    }
  })
  simple(ast, {
    ExportDefaultDeclaration(node) {
      const headerLine = node.loc?.start.line || -1
      const headerCol = node.loc?.start.column || -1
      const headerCom = comments?.[headerLine]?.[headerCol - 1] ?? ''
      const hide = hideLines.has(headerLine)
      if (hide) meta.hide = true
      if (ignoredLines.has(headerLine)) {
        meta.ignore = true
        return meta
      }
      const headerRef = parseComment(headerCom)
      meta.header = headerRef

      // @ts-ignore
      let galbeIdentifier = node.declaration?.params?.[0]?.name
      if (!galbeIdentifier) return meta

      // @ts-ignore
      simple(node.declaration.body, {
        CallExpression(node) {
          // @ts-ignore
          if (node?.callee?.object?.name === galbeIdentifier) {
            // @ts-ignore
            const method = node.callee.property.name as Method
            // 'group'/'middleware' calls are not routes; skip non-literal paths
            // @ts-ignore
            let path = node.arguments?.[0]?.value
            if (!ROUTE_METHODS.has(method) || typeof path !== 'string') return
            if (!path.startsWith("/")) path = `/${path}`
            const line = node.loc?.start.line || -1
            const col = node.loc?.start.column || -1
            const com = comments?.[line]?.[col - 1] ?? ''
            const routeRefs = ignoredLines.has(line) ? { ignore: true } : { ...parseComment(com), ...(hide || hideLines.has(line) ? { hide: true } : {}) }
            if (!(path in meta.routes)) meta.routes[path] = {}
            if (!(method in meta.routes[path]!)) meta.routes[path]![method] = routeRefs as RouteMeta
          }
        }
      })
    }
  })
  return meta
}

// static base of a glob pattern: the segments before the first one containing a
// glob metachar. Directory prefixes are derived relative to this anchor. A
// pattern with no metachar names a file: its own directory is the base.
export const globBase = (pattern: string): string => {
  const segments = pattern.split('/')
  const idx = segments.findIndex(s => /[*?[{]/.test(s))
  return (idx === -1 ? segments.slice(0, -1) : segments.slice(0, idx)).join('/')
}

const dirPrefixOf = (file: string, base: string): string => {
  const rel = relative(base, dirname(file))
  if (!rel || rel === '.') return ''
  const segments = rel.split(sep)
  for (const s of segments) {
    if (!LITERAL_SEGMENT_RGX.test(s))
      throw new Error(
        `invalid directory name '${s}' for ${file} — directory names must be valid literal route segments`
      )
  }
  return `/${segments.join('/')}`
}

// '@prefix /v2' declares the file's route prefix, overriding the dir-derived
// one entirely; '@prefix /' opts a file out of dirPrefix
const headerPrefixOf = (meta: RoutesMeta, file: string): string | undefined => {
  let p = meta.header?.prefix
  if (p === undefined) return undefined
  if (Array.isArray(p)) {
    console.warn(`duplicate @prefix in ${file} — using the first one`)
    p = p[0]!
  }
  if (typeof p !== 'string' || !ROUTE_PATH_RGX.test(p) || p.includes('*'))
    throw new Error(`invalid @prefix ${String(p)} in ${file} — must be a valid route path`)
  return p.replace(/\/+$/, '')
}

// rewrite meta keys to the final path relative to basePath: group/@prefix
// included, basePath excluded — the shape every consumer looks up by
const prefixMeta = (meta: RoutesMeta, prefix: string): RoutesMeta =>
  !prefix
    ? meta
    : { ...meta, routes: Object.fromEntries(Object.entries(meta.routes).map(([p, m]) => [joinPath(prefix, p), m])) }

const collectFiles = async (pattern: string): Promise<Array<{ file: string; base: string }>> => {
  const root = process.cwd()
  const base = resolve(root, globBase(pattern))
  const out: Array<{ file: string; base: string }> = []
  for await (const path of new Glob(pattern).scan({ cwd: root, absolute: true, onlyFiles: false, dot: true })) {
    if ((await lstat(path)).isDirectory()) {
      // a pattern naming a directory registers its direct children, unprefixed
      for (const f of await readdir(path)) out.push({ file: `${path}/${f}`, base: path })
    } else out.push({ file: path, base })
  }
  return out
}

/**
 * Automatic Route Analyzer: discovers middleware files (registered first,
 * shallowest directory wins the outer position), then imports route files,
 * handing each a registrar bound to its prefix (directory-derived or
 * `@prefix`). Route-to-file correlation relies on `galbe.onRouteAdded` and
 * assumes registration is synchronous within a file's default export.
 */
export const defineRoutes = async (
  options: Pick<GalbeConfig, 'routes' | 'middleware'>,
  galbe: Galbe,
  cb?: RouteInstanciationCallback
): Promise<{ routeFiles: RouteFileRegistration[]; middlewareFiles: MiddlewareFileRegistration[] }> => {
  const result = { routeFiles: [] as RouteFileRegistration[], middlewareFiles: [] as MiddlewareFileRegistration[] }
  const routesConf = options?.routes
  if (routesConf === false) return result
  const conf =
    typeof routesConf === 'object' && !Array.isArray(routesConf)
      ? routesConf
      : { pattern: routesConf === undefined || routesConf === true ? undefined : routesConf }
  const dirPrefix = conf.dirPrefix !== false
  const patterns = conf.pattern === undefined ? [DEFAULT_ROUTE_PATTERN] : [conf.pattern].flat()

  const relPath = (path: string) =>
    galbe.router.prefix && path.startsWith(galbe.router.prefix)
      ? path.slice(galbe.router.prefix.length) || '/'
      : path

  // middleware files first: outer scopes wrap route files' in-file registrations
  const mwConf = options?.middleware
  if (mwConf !== false) {
    const mwPatterns = mwConf === undefined || mwConf === true ? [DEFAULT_MIDDLEWARE_PATTERN] : [mwConf].flat()
    const files = (await Promise.all(mwPatterns.map(collectFiles))).flat()
    // deterministic order: directory depth (shallowest first), then path
    files.sort((a, b) => a.file.split('/').length - b.file.split('/').length || a.file.localeCompare(b.file))
    for (const { file, base } of files) {
      const dirScope = dirPrefixOf(file, base)
      try {
        const metadata = await metaAnalysis(file)
        if (metadata?.ignore) continue
        const imported = await import(file)
        const def = imported?.default
        const hooks: Hook[] = Array.isArray(def) ? def : def ? [def] : []
        if (!hooks.length || hooks.some(h => typeof h !== 'function'))
          throw new Error('Middleware file must default-export a hook function or an array of hooks')
        const scopeExport = imported.scope
        if (scopeExport !== undefined && typeof scopeExport !== 'string')
          throw new Error(`invalid scope export in ${file} — must be a middleware pattern string`)
        const scope = scopeExport !== undefined ? joinPath(dirScope, scopeExport) : dirScope ? `${dirScope}/*` : '*'
        galbe.middleware(scope, hooks)
        galbe.metaMiddleware.push({ file, scope, header: metadata.header })
        result.middlewareFiles.push({ file, scope })
      } catch (err: any) {
        if (cb) await cb({ type: 'error', error: err, filepath: file, route: undefined, meta: undefined })
      }
    }
  }

  for (const pattern of patterns) {
    for (const { file, base } of await collectFiles(pattern)) {
      let metadata: RoutesMeta
      try {
        metadata = await metaAnalysis(file)
      } catch (err: any) {
        if (cb) await cb({ type: 'error', error: err, filepath: file, route: undefined, meta: undefined })
        continue
      }
      if (metadata?.ignore) continue
      // invalid dir segments and invalid @prefix are boot errors, not per-file ones
      const prefix = headerPrefixOf(metadata, file) ?? (dirPrefix ? dirPrefixOf(file, base) : '')
      const meta = prefixMeta(metadata, prefix)
      galbe.meta = [...(galbe.meta ?? []), { file, ...meta }]
      const added: Route[] = []
      const unsub = galbe.onRouteAdded(({ route }) => added.push(route))
      try {
        const imported = await import(file)
        if (!imported?.default) throw new Error('No default export function')
        if (typeof imported.default !== 'function') throw new Error('Default export must be a function')
        imported.default(prefix ? new GalbeGroup(galbe, prefix) : galbe)
        result.routeFiles.push({ file, prefix })
      } catch (err: any) {
        if (cb) await cb({ type: 'error', error: err, filepath: file, route: undefined, meta: undefined })
      } finally {
        unsub()
      }
      for (const route of added) {
        const root = route.static?.root
        const key = root ? (root[0] === '/' ? root : `/${root}`) : relPath(route.path)
        const routeMeta: RouteMeta = {
          ...meta.routes?.[key]?.[root ? 'static' : route.method],
          ...(meta.hide ? { hide: true } : {}),
          ...(meta.ignore ? { ignore: true } : {})
        }
        // '@galbe-ignore'd routes must not be served: unregister them
        if (routeMeta.ignore) {
          galbe.router.remove(route)
          continue
        }
        if (cb) await cb({ type: 'add', route, filepath: file, meta: routeMeta })
      }
    }
  }
  return result
}
