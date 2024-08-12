import type { GalbeConfig, Method, Route } from './types'

import { readdir, lstat } from 'fs/promises'
import { extname } from 'path'
import { parse } from 'acorn'
import { simple } from 'acorn-walk'
import { Galbe } from './index'
import { transformSync } from '@swc/core'
import { Glob } from 'bun'

export const DEFAULT_ROUTE_PATTERN = 'src/**/*.route.{js,ts}'

export type RouteMeta = { head?: string } & Record<string, boolean | string | string[]>
export type RoutesMeta = {
  header: Record<string, boolean | string | string[]>
  routes: Record<string, Partial<Record<Method, RouteMeta>>>
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

class GalbeProxy {
  #g: Galbe
  #cb?: RouteInstanciationCallback
  filepath?: string
  meta?: RoutesMeta
  constructor(g: Galbe, cb?: RouteInstanciationCallback) {
    this.#g = g
    this.#cb = cb
  }
  async get(...args: any[]) {
    //@ts-ignore
    const route = this.#g.get(...args) as Route
    if (this.#cb)
      await this.#cb({
        type: 'add',
        route,
        filepath: this.filepath || '',
        meta: this.meta?.routes?.[route.path]?.[route.method] || {}
      })
    return route
  }
  async post(...args: any[]) {
    //@ts-ignore
    const route = this.#g.post(...args) as Route
    if (this.#cb)
      await this.#cb({
        type: 'add',
        route,
        filepath: this.filepath,
        meta: this.meta?.routes?.[route.path]?.[route.method] || {}
      })
    return route
  }
  async put(...args: any[]) {
    //@ts-ignore
    const route = this.#g.put(...args) as Route
    if (this.#cb)
      await this.#cb({
        type: 'add',
        route,
        filepath: this.filepath,
        meta: this.meta?.routes?.[route.path]?.[route.method] || {}
      })
    return route
  }
  async patch(...args: any[]) {
    //@ts-ignore
    const route = this.#g.patch(...args) as Route
    if (this.#cb)
      await this.#cb({
        type: 'add',
        route,
        filepath: this.filepath,
        meta: this.meta?.routes?.[route.path]?.[route.method] || {}
      })
    return route
  }
  async delete(...args: any[]) {
    //@ts-ignore
    const route = this.#g.delete(...args) as Route
    if (this.#cb)
      await this.#cb({
        type: 'add',
        route,
        filepath: this.filepath,
        meta: this.meta?.routes?.[route.path]?.[route.method] || {}
      })
    return route
  }
  async options(...args: any[]) {
    //@ts-ignore
    const route = this.#g.options(...args) as Route
    if (this.#cb)
      await this.#cb({
        type: 'add',
        route,
        filepath: this.filepath,
        meta: this.meta?.routes?.[route.path]?.[route.method] || {}
      })
    return route
  }
  async head(...args: any[]) {
    //@ts-ignore
    const route = this.#g.head(...args) as Route
    if (this.#cb)
      await this.#cb({
        type: 'add',
        route,
        filepath: this.filepath,
        meta: this.meta?.routes?.[route.path]?.[route.method] || {}
      })
    return route
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

  const ast = parse(content, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    onComment: (isBlock, text, _start, _end, _locStart, locEnd) => {
      if (isBlock && locEnd?.line !== undefined && locEnd?.column !== undefined) {
        if (!comments?.[locEnd.line]) comments[locEnd.line] = []
        comments[locEnd.line][locEnd.column] = text
      }
    }
  })
  simple(ast, {
    ExportDefaultDeclaration(node) {
      const headerLine = node.loc?.start.line || -1
      const headerCol = node.loc?.start.column || -1
      const headerCom = comments?.[headerLine]?.[headerCol - 1] ? comments[headerLine][headerCol - 1] : ''
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
            const path = node.arguments[0].value
            // @ts-ignore
            const method = node.callee.property.name as Method
            const line = node.loc?.start.line || -1
            const col = node.loc?.start.column || -1
            const com = comments?.[line]?.[col - 1] ? comments[line][col - 1] : ''

            const routeRefs = parseComment(com)

            if (!(path in meta.routes)) meta.routes[path] = {}
            if (!(method in meta.routes[path])) meta.routes[path][method] = routeRefs
          }
        }
      })
    }
  })
  return meta
}

export const defineRoutes = async (
  options: Pick<GalbeConfig, 'routes'>,
  galbe: Galbe,
  cb?: RouteInstanciationCallback
) => {
  const routes = options?.routes === true ? DEFAULT_ROUTE_PATTERN : options?.routes
  const proxy = new GalbeProxy(galbe, cb)
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
          proxy.filepath = f
          proxy.meta = metadata
          galbe.meta?.push({ file: path, ...metadata })
          const imported = await import(f)
          if (!imported?.default) throw new Error('No default export function')
          if (typeof imported.default !== 'function') throw new Error('Default export must be a function')
          const routes = imported.default
          routes(proxy)
        } catch (err: any) {
          if (cb) await cb({ type: 'error', error: err, filepath: f, route: undefined, meta: undefined })
        }
      }
    }
  } else if (Array.isArray(routes)) {
    for (const r of routes) {
      await defineRoutes({ routes: r }, galbe, cb)
    }
  }
}
