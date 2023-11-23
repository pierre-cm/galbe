import { readdir } from 'fs/promises'
import { extname } from 'path'
import { glob } from 'glob'
import esprima from 'esprima'
import estraverse from 'estraverse'

import { Kadre } from '.'
import { KadreConfig } from './types'

export type RouteMetadata = Record<string, Record<string, Record<string, string | string[]>>>

const COMMENT_PROPS = ['tags', 'summary', 'description', 'deprecated', 'param', 'body']

export const metaAnalysis = async (filePath: string): Promise<RouteMetadata> => {
  const file = Bun.file(filePath)
  const fileExt = extname(filePath)
  let content = await file.text()
  let meta: RouteMetadata = {}

  if (fileExt === '.ts') {
    content = new Bun.Transpiler({
      loader: 'ts',
      target: 'bun',
      tsconfig: {
        compilerOptions: {
          //@ts-ignore https://github.com/oven-sh/bun/pull/7055
          removeComments: false
        }
      }
    }).transformSync(content)
  }

  const ast = esprima.parseModule(content, { comment: true, loc: true })

  const comments = ast.comments
    ?.filter(c => c.type === 'Block')
    .reduce((acc, c) => {
      //@ts-ignore
      if (c.loc?.end.line) acc[c.loc?.end.line] = c.value
      return acc
    }, {})

  estraverse.traverse(ast, {
    enter: function (node, parent) {
      let fnExpr = null
      // @ts-ignore
      if (node.type === 'MemberExpression' && node.object.name === 'exports' && node.property.name === 'default') {
        // @ts-ignore
        fnExpr = parent.right
      } else if (node.type === 'ExportDefaultDeclaration') fnExpr = node.declaration

      if (fnExpr) {
        let kadreIdentifier = fnExpr.params[0].name
        estraverse.traverse(fnExpr.body, {
          enter: function (n, _p) {
            // @ts-ignore
            if (n?.type === 'CallExpression' && n?.callee?.object?.name === kadreIdentifier) {
              // @ts-ignore
              const com = n.loc?.start.line - 1 in comments ? comments[n.loc?.start.line - 1] : ''
              const refs = [
                ...com.matchAll(new RegExp(`^\\s*\\*\\s*@(${COMMENT_PROPS.join('|')})\\s+([^\\n]*)\\s*$`, 'gm'))
              ].reduce((acc, n) => {
                return {
                  ...acc,
                  [n[1]]: n[1] in acc ? [...(typeof acc[n[1]] === 'string' ? [acc[n[1]]] : acc[n[1]]), n[2]] : n[2]
                }
              }, {})

              // @ts-ignore
              const path: string = n.arguments[0].value
              // @ts-ignore
              const method: Method = n.callee.property.name

              if (!(path in meta)) meta[path] = {}
              if (!(method in meta[path])) meta[path][method] = refs
            }
          }
        })
        this.break()
      }
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
      defineRoutes({ routes: r }, kadre)
    }
  }
}
