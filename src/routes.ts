import { cpSync } from 'fs'
import type { GalbeConfig, GalbePlugin, Method, Route } from './types'

import { readdir, lstat } from 'fs/promises'
import { extname } from 'path'
import { parse } from 'acorn'
import { simple } from 'acorn-walk'
import { Galbe } from './index'
import { transformSync } from '@swc/core'
import { Glob } from 'bun'

export const DEFAULT_ROUTE_PATTERN = 'src/**/*.route.{js,ts}'

const IGNORE_COMMENT_RGX = /^\s*\@galbe-ignore\s*$/
const HIDE_COMMENT_RGX = /^\s*\@galbe-hide\s*$/

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

export class GalbeProxy {
  #g: Galbe
  #plugins: GalbePlugin[] = []
  _cb?: RouteInstanciationCallback
  _metaTmp?: RoutesMeta
  _filepath?: string
  _meta: Array<RouteFileMeta> = []
  constructor(g: Galbe, cb?: RouteInstanciationCallback) {
    this.#g = g
    this._cb = cb
    this.#plugins = g.plugins
  }
  get server() {
    return this.#g.server
  }
  get router() {
    return this.#g.router
  }
  get config() {
    return this.#g.config
  }
  get meta() {
    return this._meta
  }
  set meta(meta: Array<RouteFileMeta>) {
    this._meta = meta
    this.#g.meta = meta
  }
  async init() {
    for (const p of this.#plugins) {
      // @ts-ignore
      if (p.init) await p.init(this.#g.config?.plugin?.[p.name] || {}, this)
    }
  }
  private async handleRoute(method: Method | 'static', ...args: any[]): Promise<Route | undefined> {
    let path = args[0]
    let meta = {
      ...this._metaTmp?.routes?.[path]?.[method],
      ...(this._metaTmp?.hide ? { hide: true } : {}),
      ...(this._metaTmp?.ignore ? { ignore: true } : {})
    }
    if (meta?.ignore) return

    //@ts-ignore
    const route = this.#g[method](...args) as Route

    if (this._cb && !meta?.ignore) {
      await this._cb({
        type: 'add',
        route,
        filepath: this._filepath || '',
        meta
      })
    }
    return route
  }
  async get(...args: any[]) {
    return this.handleRoute('get', ...args)
  }
  async post(...args: any[]) {
    return this.handleRoute('post', ...args)
  }
  async put(...args: any[]) {
    return this.handleRoute('put', ...args)
  }
  async patch(...args: any[]) {
    return this.handleRoute('patch', ...args)
  }
  async delete(...args: any[]) {
    return this.handleRoute('delete', ...args)
  }
  async options(...args: any[]) {
    return this.handleRoute('options', ...args)
  }
  async head(...args: any[]) {
    return this.handleRoute('head', ...args)
  }
  async static(...args: any[]) {
    if (!!Bun.env.GALBE_BUILD_OUT) {
      let [_, target] = args
      cpSync(target, `${Bun.env.GALBE_BUILD_OUT}/static-${Bun.env.GALBE_BUILD}/${target}`, { recursive: true, dereference: true })
    }
    return this.handleRoute('static', ...args)
  }
}

const parseComment = (comment: string): Record<string, string | string[]> => {
  const head =
    comment
      .match(/^([^@]*)/)?.[1]
      .replace(/^ *\* */gm, '')
      .trim() || ''
  const refs = {
    ...(head ? { head } : {}),
    ...[...comment.matchAll(new RegExp(`^\\s*\\*\\s*@([a-zA-Z_][0-9a-zA-Z_]*)(?:$|\\s+([^\\n]*)\\s*$)`, 'gm'))].reduce(
      (acc, n) => {
        return {
          ...acc,
          [n[1]]:
            n[1] in acc ? [...(typeof acc[n[1]] === 'string' ? [acc[n[1]]] : acc[n[1]]), n[2] ?? true] : n[2] ?? true
        }
      },
      {} as Record<string, any>
    )
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
        target: 'esnext'
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
        else comments[locEnd.line][locEnd.column] = text
      }
    }
  })
  simple(ast, {
    ExportDefaultDeclaration(node) {
      const headerLine = node.loc?.start.line || -1
      const headerCol = node.loc?.start.column || -1
      const headerCom = comments?.[headerLine]?.[headerCol - 1] ? comments[headerLine][headerCol - 1] : ''
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
            let path = node.arguments[0].value
            if (!path?.startsWith("/")) path = `/${path}`
            // @ts-ignore
            const method = node.callee.property.name as Method
            const line = node.loc?.start.line || -1
            const col = node.loc?.start.column || -1
            const com = comments?.[line]?.[col - 1] ? comments[line][col - 1] : ''
            const routeRefs = ignoredLines.has(line) ? { ignore: true } : { ...parseComment(com), ...(hide || hideLines.has(line) ? { hide: true } : {}) }
            if (!(path in meta.routes)) meta.routes[path] = {}
            if (!(method in meta.routes[path])) meta.routes[path][method] = routeRefs as RouteMeta
          }
        }
      })
    }
  })
  return meta
}

export const defineRoutes = async (
  options: Pick<GalbeConfig, 'routes'>,
  proxy: GalbeProxy,
) => {
  const routes = options?.routes === true ? DEFAULT_ROUTE_PATTERN : options?.routes
  if (!routes) return
  const root = process.cwd()
  if (typeof routes === 'string') {
    for await (const path of new Glob(routes).scan({ cwd: root, absolute: true, onlyFiles: false, dot: true })) {
      const isDir = (await lstat(path)).isDirectory()

      let files: string[] = []
      if (!isDir) files.push(path)
      else files = files.concat((await readdir(path)).map(f => `${path}/${f}`))
      for (const f of files) {
        try {
          const metadata = await metaAnalysis(f)
          if (metadata?.ignore) continue
          proxy._filepath = f
          proxy._metaTmp = metadata
          proxy.meta = [...proxy.meta, { file: path, ...metadata }]
          const imported = await import(f)
          if (!imported?.default) throw new Error('No default export function')
          if (typeof imported.default !== 'function') throw new Error('Default export must be a function')
          const routes = imported.default
          routes(proxy)
        } catch (err: any) {
          if (proxy._cb) await proxy._cb({ type: 'error', error: err, filepath: f, route: undefined, meta: undefined })
        }
      }
    }
  } else if (Array.isArray(routes)) {
    for (const r of routes) {
      await defineRoutes({ routes: r }, proxy)
    }
  }
}
