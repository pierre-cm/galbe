import type { GalbeConfig } from './types'

import { readdir, lstat } from 'fs/promises'
import { extname, relative } from 'path'
import { parse } from 'acorn'
import { simple } from 'acorn-walk'
import { Galbe } from './index'
import { transformSync } from '@swc/core'
import { Glob } from 'bun'

export const DEFAULT_ROUTE_PATTERN = 'src/**/*.route.{js,ts}'

export type RouteMeta = {
  header: Record<string, boolean | string | string[]>
  routes: Record<string, Record<string, Record<string, boolean | string | string[]>>>
}

export type RouteFileMeta = {
  file: string
} & RouteMeta

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
export const metaAnalysis = async (filePath: string): Promise<RouteMeta> => {
  const file = Bun.file(filePath)
  const fileExt = extname(filePath)
  let content = await file.text()
  let meta: RouteMeta = { header: {}, routes: {} }

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

  const comments: Record<number, string> = {}

  const ast = parse(content, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    onComment: (isBlock, text, _start, _end, _locStart, locEnd) => {
      if (isBlock && locEnd?.line) comments[locEnd?.line] = text
    }
  })
  simple(ast, {
    ExportDefaultDeclaration(node) {
      const headerLine = node.loc?.start.line
      const headerCom = headerLine !== undefined && comments?.[headerLine] ? comments[headerLine] : ''
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
            const method = node.callee.property.name
            const line = node.loc?.start.line
            const com = line !== undefined && comments?.[line] ? comments[line] : ''

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

const importRoutes = async (filePath: string, galbe: Galbe) => {
  const imported = await import(filePath)
  if (!imported?.default) throw new Error('No default export function')
  if (typeof imported.default !== 'function') throw new Error('Default export must be a function')
  const routes = imported.default
  routes(galbe)
}

export const defineRoutes = async (options: GalbeConfig, galbe: Galbe) => {
  const routes = options?.routes === true ? DEFAULT_ROUTE_PATTERN : options?.routes
  if (!routes) {
    console.log(`\x1b\[38;5;245m    No route file defined\x1b[0m`)
    return
  }
  const root = process.cwd()
  if (typeof routes === 'string') {
    let noRouteFound = true
    for await (const path of new Glob(routes).scan({ cwd: root, absolute: true, onlyFiles: false })) {
      noRouteFound = false
      const isDir = (await lstat(path)).isDirectory()

      let files: string[] = []
      if (!isDir) files.push(path)
      else files = files.concat((await readdir(path)).map(f => `${path}/${f}`))
      if (files.length === 0) console.log(`\x1b\[38;5;245m    No route found\x1b[0m`)
      for (const f of files) {
        try {
          const metadata = await metaAnalysis(f)
          galbe.meta?.push({ file: path, ...metadata })
          console.log(`\n\x1b\[0;36m    ${relative('.', f)}\x1b[0m`)
          await importRoutes(f, galbe)
        } catch (err: any) {
          console.log(`\x1b\[0;31m    Error: ${err?.message}\x1b[0m`)
        }
      }
    }
    if (noRouteFound) {
      console.log(`\x1b\[38;5;245m    No route found\x1b[0m`)
      return
    }
  } else if (Array.isArray(routes)) {
    for (const r of routes) {
      await defineRoutes({ routes: r }, galbe)
    }
  }
}
