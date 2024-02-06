import type { KadreConfig } from './types'

import { readdir } from 'fs/promises'
import { extname } from 'path'
import { glob } from 'glob'
import { parse } from 'acorn'
import { simple } from 'acorn-walk'
import { Kadre } from './index'
import { transformSync } from '@swc/core'

export type RouteMetadata = Record<string, Record<string, Record<string, string | string[]>>>

const COMMENT_PROPS = ['tags', 'summary', 'description', 'deprecated', 'param', 'body']

export const metaAnalysis = async (filePath: string): Promise<RouteMetadata> => {
  const file = Bun.file(filePath)
  const fileExt = extname(filePath)
  let content = await file.text()
  let meta: RouteMetadata = {}

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
      // @ts-ignore
      let kadreIdentifier = node.declaration.params[0].name
      // @ts-ignore
      simple(node.declaration.body, {
        CallExpression(node) {
          // @ts-ignore
          if (node?.callee?.object?.name === kadreIdentifier) {
            // @ts-ignore
            const path = node.arguments[0].value
            // @ts-ignore
            const method = node.callee.property.name
            const line = node.loc?.start.line
            const com = line && line in comments ? comments[line] : ''

            const refs = [
              ...com.matchAll(new RegExp(`^\\s*\\*\\s*@(${COMMENT_PROPS.join('|')})\\s+([^\\n]*)\\s*$`, 'gm'))
            ].reduce((acc, n) => {
              return {
                ...acc,
                [n[1]]: n[1] in acc ? [...(typeof acc[n[1]] === 'string' ? [acc[n[1]]] : acc[n[1]]), n[2]] : n[2]
              }
            }, {} as Record<string, any>)

            if (!(path in meta)) meta[path] = {}
            if (!(method in meta[path])) meta[path][method] = refs
          }
        }
      })
    }
  })
  return meta
}

const importRoutes = async (filePath: string, kadre: Kadre) => {
  const routes = (await import(filePath)).default
  routes(kadre)
}

export const defineRoutes = async (options: KadreConfig, kadre: Kadre) => {
  const routes = options?.routes
  if (!routes) {
    console.log(`\x1b\[38;5;245m    No route defined\x1b[0m`)
    return
  }
  const root = process.cwd()
  if (typeof routes === 'string') {
    let files = await glob(routes, { cwd: root, withFileTypes: true, ignore: 'node_modules/**' })
    if (!files || !files.length) {
      console.log(`\x1b\[38;5;245m    No route found\x1b[0m`)
      return
    }
    for (const file of files.map(f => ({ name: f.name, path: f.path, type: f.getType() }))) {
      let files: string[] = []
      if (file.type === 'File') files.push(`${file.path}/${file.name}`)
      else if (file.type === 'Directory')
        files = files.concat((await readdir(`${file.path}/${file.name}`)).map(f => `${file.path}/${f}`))
      if (files.length === 0) console.log(`\x1b\[38;5;245m    No route found\x1b[0m`)
      for (const f of files) {
        try {
          const metadata = await metaAnalysis(f)
          kadre.routesMetadata = { ...metadata }
          await importRoutes(f, kadre)
          console.log(`\x1b\[0;32m    ${f}\x1b[0m`)
        } catch (err) {
          console.log(`\x1b\[0;31m    ${f}\x1b[0m`)
          throw err
        }
      }
    }
  } else if (Array.isArray(routes)) {
    for (const r of routes) {
      await defineRoutes({ routes: r }, kadre)
    }
  }
}
