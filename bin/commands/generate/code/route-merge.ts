import ts from 'typescript'
import type { RoutePlanEntry, ScopePlan } from './openapi.parser'

const METHODS = new Set(['get', 'put', 'patch', 'post', 'delete', 'options', 'head'])

export type RouteId = string

export const routeId = (method: string, path: string): RouteId => `${method.toUpperCase()} ${path}`

export type MergeOptions = {
  /** Delete routes that exist in code but are absent from the plan. Default false (kept as `stale`). */
  removeStale?: boolean
  /** Existing route ids (`${METHOD} ${path}`) to leave alone even if absent from plan. */
  ignore?: Set<RouteId>
  /** Existing-route id -> new id. Applied before diffing so a renamed route is treated as an update. */
  rename?: Map<RouteId, RouteId>
}

export type MergeResult = {
  content: string
  added: RouteId[]
  updated: RouteId[]
  removed: RouteId[]
  /** Stale: in code but not in plan, neither removed nor explicitly ignored. */
  stale: RouteId[]
}

type ExistingRoute = {
  origId: RouteId
  method: string
  path: string
  stmt: ts.ExpressionStatement
  pathArg: ts.StringLiteral
  schemaArg: ts.Identifier
  jsdoc: ts.CommentRange | null
}

type ExistingFile = {
  text: string
  sourceFile: ts.SourceFile
  routes: ExistingRoute[]
  schemaImport: ts.ImportDeclaration | null
  bodyOpenBracePos: number | null
  bodyCloseBracePos: number | null
}

const importPathForScope = (scopeKey: string): string => {
  const deepness = scopeKey.split('/').length - 1
  return `${Array(deepness).fill('../').join('')}schemas${scopeKey}.schema`
}

const renderFreshRouteFile = (scope: ScopePlan): string => {
  const importPath = importPathForScope(scope.scopeKey)
  const rDecl = scope.routes.map(r => `  ${r.meta}\ng.${r.call}`)
  return (
    `import { NotImplementedError, type Galbe } from 'galbe'\n` +
    `import { ${[...scope.routeSchemaImports].sort().join(', ')} } from '${importPath}'\n\n` +
    `export default (g: Galbe) => {\n` +
    rDecl.map(d => d.replaceAll('\n', '\n  ')).join('\n\n') +
    `\n}\n`
  )
}

const findLeadingJsDoc = (sf: ts.SourceFile, stmt: ts.Node): ts.CommentRange | null => {
  const ranges = ts.getLeadingCommentRanges(sf.text, stmt.pos) || []
  let last: ts.CommentRange | null = null
  for (const r of ranges) {
    if (r.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue
    const txt = sf.text.slice(r.pos, r.end)
    if (txt.startsWith('/**')) last = r
  }
  return last
}

const parseExistingFile = (text: string, scope: ScopePlan): ExistingFile => {
  const sf = ts.createSourceFile('route.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  const expectedSuffix = `schemas${scope.scopeKey}.schema`
  let schemaImport: ts.ImportDeclaration | null = null
  let body: ts.Block | null = null

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const spec = stmt.moduleSpecifier
      if (ts.isStringLiteral(spec) && spec.text.endsWith(expectedSuffix)) schemaImport = stmt
    } else if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const expr = stmt.expression
      if (ts.isArrowFunction(expr) && ts.isBlock(expr.body)) body = expr.body
      else if (ts.isFunctionExpression(expr)) body = expr.body
    }
  }

  const routes: ExistingRoute[] = []
  if (body) {
    for (const stmt of body.statements) {
      if (!ts.isExpressionStatement(stmt)) continue
      const call = stmt.expression
      if (!ts.isCallExpression(call)) continue
      const fn = call.expression
      if (!ts.isPropertyAccessExpression(fn)) continue
      if (!ts.isIdentifier(fn.expression) || fn.expression.text !== 'g') continue
      if (!ts.isIdentifier(fn.name)) continue
      const method = fn.name.text.toLowerCase()
      if (!METHODS.has(method)) continue
      const args = call.arguments
      if (args.length < 2) continue
      const pathArg = args[0]
      const schemaArg = args[1]
      if (!ts.isStringLiteral(pathArg)) continue
      if (!ts.isIdentifier(schemaArg)) continue

      routes.push({
        origId: routeId(method, pathArg.text),
        method,
        path: pathArg.text,
        stmt,
        pathArg,
        schemaArg,
        jsdoc: findLeadingJsDoc(sf, stmt),
      })
    }
  }

  return {
    text,
    sourceFile: sf,
    routes,
    schemaImport,
    bodyOpenBracePos: body ? body.getStart(sf) : null,
    bodyCloseBracePos: body ? body.end - 1 : null,
  }
}

type Edit = { pos: number; end: number; text: string }

const applyEdits = (text: string, edits: Edit[]): string => {
  // Apply in reverse order of pos so earlier offsets stay valid.
  const sorted = [...edits].sort((a, b) => b.pos - a.pos || b.end - a.end)
  let out = text
  for (const e of sorted) out = out.slice(0, e.pos) + e.text + out.slice(e.end)
  return out
}

export const mergeRouteFile = (
  existing: string | null,
  scope: ScopePlan,
  opts: MergeOptions = {}
): MergeResult => {
  const removeStale = opts.removeStale ?? false
  const ignore = opts.ignore ?? new Set<RouteId>()
  const rename = opts.rename ?? new Map<RouteId, RouteId>()

  const planById = new Map<RouteId, RoutePlanEntry>()
  for (const r of scope.routes) planById.set(routeId(r.method, r.path), r)

  if (existing === null || existing.trim() === '') {
    return {
      content: renderFreshRouteFile(scope),
      added: [...planById.keys()],
      updated: [],
      removed: [],
      stale: [],
    }
  }

  const file = parseExistingFile(existing, scope)
  const sf = file.sourceFile

  const existingByEffectiveId = new Map<RouteId, ExistingRoute>()
  for (const er of file.routes) {
    const effId = rename.get(er.origId) ?? er.origId
    existingByEffectiveId.set(effId, er)
  }

  const updates: { er: ExistingRoute; entry: RoutePlanEntry }[] = []
  const removals: ExistingRoute[] = []
  const stale: ExistingRoute[] = []

  for (const er of file.routes) {
    const effId = rename.get(er.origId) ?? er.origId
    const planEntry = planById.get(effId)
    if (planEntry) updates.push({ er, entry: planEntry })
    else if (ignore.has(er.origId)) stale.push(er)
    else if (removeStale) removals.push(er)
    else stale.push(er)
  }

  const additions: RoutePlanEntry[] = []
  for (const [id, entry] of planById) {
    if (!existingByEffectiveId.has(id)) additions.push(entry)
  }

  // Compute final imported schema names.
  const finalImports = new Set<string>()
  for (const { entry } of updates) finalImports.add(entry.schemaName)
  for (const er of stale) finalImports.add(er.schemaArg.text)
  for (const entry of additions) finalImports.add(entry.schemaName)

  const edits: Edit[] = []

  for (const { er, entry } of updates) {
    if (er.path !== entry.path) {
      edits.push({ pos: er.pathArg.getStart(sf), end: er.pathArg.end, text: JSON.stringify(entry.path) })
    }
    if (er.schemaArg.text !== entry.schemaName) {
      edits.push({ pos: er.schemaArg.getStart(sf), end: er.schemaArg.end, text: entry.schemaName })
    }
    if (er.jsdoc) {
      edits.push({ pos: er.jsdoc.pos, end: er.jsdoc.end, text: entry.meta })
    } else if (entry.meta) {
      const stmtStart = er.stmt.getStart(sf)
      edits.push({ pos: stmtStart, end: stmtStart, text: `${entry.meta}\n  ` })
    }
  }

  for (const er of removals) {
    edits.push({ pos: er.stmt.pos, end: er.stmt.end, text: '' })
  }

  if (file.schemaImport) {
    const sortedImports = [...finalImports].sort()
    if (sortedImports.length === 0) {
      edits.push({ pos: file.schemaImport.pos, end: file.schemaImport.end, text: '' })
    } else {
      const importPath = importPathForScope(scope.scopeKey)
      const newText = `import { ${sortedImports.join(', ')} } from '${importPath}'`
      edits.push({
        pos: file.schemaImport.getStart(sf),
        end: file.schemaImport.end,
        text: newText,
      })
    }
  }

  if (additions.length > 0 && file.bodyCloseBracePos !== null) {
    const block = additions.map(a => `\n  ${a.meta}\n  ${`g.${a.call}`.replaceAll('\n', '\n  ')}\n`).join('')
    edits.push({ pos: file.bodyCloseBracePos, end: file.bodyCloseBracePos, text: block })
  }

  return {
    content: applyEdits(existing, edits),
    added: additions.map(a => routeId(a.method, a.path)),
    updated: updates.map(u => routeId(u.entry.method, u.entry.path)),
    removed: removals.map(r => r.origId),
    stale: stale.map(s => s.origId),
  }
}

