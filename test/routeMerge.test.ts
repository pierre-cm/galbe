import { describe, test, expect } from 'bun:test'
import { mergeRouteFile, routeId } from '../bin/commands/generate/code/route-merge'
import type { ScopePlan, RoutePlanEntry } from '../bin/commands/generate/code/openapi.parser'

const meta = (summary: string) => `/**\n * ${summary}\n */`

const route = (over: Partial<RoutePlanEntry>): RoutePlanEntry => ({
  method: 'get',
  path: '/users',
  schemaName: 'GetUsers',
  meta: meta('Get users'),
  call: 'get("/users", GetUsers, ctx => {\n  throw new NotImplementedError()\n})',
  ...over,
})

const scope = (routes: RoutePlanEntry[]): ScopePlan => ({
  scopeKey: '/main',
  routeFile: 'routes/main.route',
  schemaFile: 'schemas/main.schema',
  schemaImports: {},
  schemaDecls: [],
  routeSchemaImports: routes.map(r => r.schemaName),
  routes,
})

const existingFile = (body: string, imports = `import { GetUsers } from './schemas/main.schema'`) => `import { NotImplementedError, type Galbe } from 'galbe'
${imports}

export default (g: Galbe) => {
${body}
}
`

describe('mergeRouteFile', () => {
  test('returns fresh content when no existing file', () => {
    const r = route({})
    const result = mergeRouteFile(null, scope([r]))
    expect(result.added).toEqual([routeId('get', '/users')])
    expect(result.updated).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.content).toContain(`g.get("/users", GetUsers, ctx =>`)
    expect(result.content).toContain(`import { GetUsers } from '../schemas/main.schema'`)
  })

  test('preserves user handler body on update', () => {
    const userBody = `  /** old summary */
  g.get("/users", GetUsers, ctx => {
    return ctx.db.users.list()
  })`
    const existing = existingFile(userBody)
    const updated = route({ meta: meta('Updated summary') })

    const result = mergeRouteFile(existing, scope([updated]))

    expect(result.updated).toEqual([routeId('get', '/users')])
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.content).toContain('return ctx.db.users.list()')
    expect(result.content).toContain('Updated summary')
    expect(result.content).not.toContain('old summary')
  })

  test('preserves hook array on update', () => {
    const userBody = `  g.get("/users", GetUsers, [authHook, loggerHook], ctx => {
    return ctx.db.users.list()
  })`
    const existing = existingFile(userBody)

    const result = mergeRouteFile(existing, scope([route({ schemaName: 'GetUsersV2' })]))

    expect(result.updated).toEqual([routeId('get', '/users')])
    expect(result.content).toContain('[authHook, loggerHook]')
    expect(result.content).toContain('GetUsersV2')
    expect(result.content).not.toContain('GetUsers,')
  })

  test('renames schema reference when schemaName changes', () => {
    const userBody = `  g.get("/users", GetUsers, ctx => { return [] })`
    const existing = existingFile(userBody)

    const result = mergeRouteFile(existing, scope([route({ schemaName: 'ListUsers' })]))

    expect(result.content).toContain(`g.get("/users", ListUsers,`)
    expect(result.content).toContain(`import { ListUsers }`)
    expect(result.content).not.toMatch(/import\s*\{[^}]*GetUsers[^}]*\}/)
  })

  test('appends new routes at end of body', () => {
    const userBody = `  g.get("/users", GetUsers, ctx => { return [] })`
    const existing = existingFile(userBody)

    const newRoute = route({ method: 'post', path: '/users', schemaName: 'CreateUser', call: 'post("/users", CreateUser, ctx => {\n  throw new NotImplementedError()\n})' })
    const result = mergeRouteFile(existing, scope([route({}), newRoute]))

    expect(result.added).toEqual([routeId('post', '/users')])
    expect(result.updated).toContain(routeId('get', '/users'))
    expect(result.content).toContain('g.post("/users", CreateUser')
    // Existing route still present
    expect(result.content).toContain('g.get("/users", GetUsers')
    // New schema imported
    expect(result.content).toMatch(/import\s*\{[^}]*CreateUser[^}]*\}/)
  })

  test('default behavior: stale routes are kept (not removed)', () => {
    const userBody = `  g.get("/users", GetUsers, ctx => { return [] })
  g.delete("/users/:id", DeleteUser, ctx => { ctx.db.users.delete(ctx.params.id) })`
    const existing = existingFile(userBody, `import { GetUsers, DeleteUser } from './schemas/main.schema'`)

    const result = mergeRouteFile(existing, scope([route({})]))

    expect(result.stale).toEqual([routeId('delete', '/users/:id')])
    expect(result.removed).toEqual([])
    expect(result.content).toContain('g.delete("/users/:id"')
    // Both schemas still imported
    expect(result.content).toMatch(/import\s*\{[^}]*GetUsers[^}]*\}/)
    expect(result.content).toMatch(/import\s*\{[^}]*DeleteUser[^}]*\}/)
  })

  test('removeStale: stale routes deleted and unused imports pruned', () => {
    const userBody = `  g.get("/users", GetUsers, ctx => { return [] })
  /** legacy */
  g.delete("/users/:id", DeleteUser, ctx => { ctx.db.users.delete(ctx.params.id) })`
    const existing = existingFile(userBody, `import { GetUsers, DeleteUser } from './schemas/main.schema'`)

    const result = mergeRouteFile(existing, scope([route({})]), { removeStale: true })

    expect(result.removed).toEqual([routeId('delete', '/users/:id')])
    expect(result.stale).toEqual([])
    expect(result.content).not.toContain('DeleteUser')
    expect(result.content).not.toContain('legacy')
    expect(result.content).toContain('g.get("/users"')
  })

  test('ignore: stale route preserved even with removeStale', () => {
    const userBody = `  g.get("/users", GetUsers, ctx => { return [] })
  g.get("/health", HealthCheck, ctx => { return { ok: true } })`
    const existing = existingFile(userBody, `import { GetUsers, HealthCheck } from './schemas/main.schema'`)

    const result = mergeRouteFile(existing, scope([route({})]), {
      removeStale: true,
      ignore: new Set([routeId('get', '/health')]),
    })

    expect(result.removed).toEqual([])
    expect(result.stale).toEqual([routeId('get', '/health')])
    expect(result.content).toContain('g.get("/health"')
    expect(result.content).toMatch(/import\s*\{[^}]*HealthCheck[^}]*\}/)
  })

  test('rename: treats old route as update and rewrites path + handler kept', () => {
    const userBody = `  /** old */
  g.get("/users/:id/legacy", GetUsersLegacy, ctx => {
    return ctx.db.users.legacyById(ctx.params.id)
  })`
    const existing = existingFile(userBody, `import { GetUsersLegacy } from './schemas/main.schema'`)

    const renamed = route({
      method: 'get',
      path: '/users/:id',
      schemaName: 'GetUserById',
      meta: meta('Get user'),
      call: 'get("/users/:id", GetUserById, ctx => {\n  throw new NotImplementedError()\n})',
    })

    const result = mergeRouteFile(existing, scope([renamed]), {
      rename: new Map([[routeId('get', '/users/:id/legacy'), routeId('get', '/users/:id')]]),
    })

    expect(result.updated).toEqual([routeId('get', '/users/:id')])
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.content).toContain('g.get("/users/:id", GetUserById,')
    // Handler body preserved
    expect(result.content).toContain('legacyById(ctx.params.id)')
    expect(result.content).not.toContain('/users/:id/legacy')
    // Schema import updated
    expect(result.content).toMatch(/import\s*\{[^}]*GetUserById[^}]*\}/)
    expect(result.content).not.toMatch(/import\s*\{[^}]*GetUsersLegacy[^}]*\}/)
  })

  test('user-added imports and helpers are preserved', () => {
    const existing = `import { NotImplementedError, type Galbe } from 'galbe'
import { GetUsers } from './schemas/main.schema'
import { logger } from '../lib/logger'

const helper = () => 42

export default (g: Galbe) => {
  g.get("/users", GetUsers, ctx => {
    logger.info('list users')
    return [helper()]
  })
}
`
    const result = mergeRouteFile(existing, scope([route({})]))

    expect(result.content).toContain(`import { logger } from '../lib/logger'`)
    expect(result.content).toContain('const helper = () => 42')
    expect(result.content).toContain(`logger.info('list users')`)
    expect(result.content).toContain('helper()')
  })
})
