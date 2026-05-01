import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir, symlink, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const PROJECT = resolve(__dirname, '..')
const CLI = resolve(PROJECT, 'bin/cli.ts')

type RunResult = { code: number | null; stdout: string; stderr: string }
const run = async (args: string[], cwd: string): Promise<RunResult> => {
  const proc = Bun.spawn(['bun', CLI, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  await proc.exited
  return {
    code: proc.exitCode,
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
  }
}

const SPEC_V1 = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /users:
    get:
      operationId: listUsers
      responses:
        '200': { description: ok }
  /users/{id}:
    get:
      operationId: getUser
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200': { description: ok }
`

// V2: drops /users/:id, adds /users POST
const SPEC_V2 = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /users:
    get:
      operationId: listUsers
      responses:
        '200': { description: ok }
    post:
      operationId: createUser
      responses:
        '201': { description: created }
`

// V3: renames /users/:id → /users/:userId, keeps /users
const SPEC_V3 = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /users:
    get:
      operationId: listUsers
      responses:
        '200': { description: ok }
  /users/{userId}:
    get:
      operationId: getUserByUserId
      parameters:
        - { name: userId, in: path, required: true, schema: { type: string } }
      responses:
        '200': { description: ok }
`

describe('generate code merge flow', () => {
  let workspace: string
  let dir: string

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'galbe-merge-'))
    await mkdir(join(workspace, 'node_modules'), { recursive: true })
    await symlink(PROJECT, join(workspace, 'node_modules', 'galbe'))
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ name: 'mt', version: '0.0.0', type: 'module', dependencies: { galbe: '*' } }, null, 2)
    )
  })

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  beforeEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = join(workspace, `case-${Math.random().toString(36).slice(2, 8)}`)
    await mkdir(dir, { recursive: true })
    await mkdir(join(dir, 'node_modules'), { recursive: true })
    await symlink(PROJECT, join(dir, 'node_modules', 'galbe'))
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'mt', version: '0.0.0', type: 'module', dependencies: { galbe: '*' } }, null, 2)
    )
  })

  test('fresh generation succeeds without -F flag', async () => {
    await Bun.write(join(dir, 'spec.yaml'), SPEC_V1)
    const r = await run(['generate', 'code', 'spec.yaml'], dir)
    expect(r.code).toBe(0)
    const route = await readFile(join(dir, 'src/routes/users.route.ts'), 'utf-8')
    expect(route).toContain('g.get("/users"')
    expect(route).toContain('g.get("/users/:id"')
  })

  test('re-run with same spec is idempotent and reports no diff items', async () => {
    await Bun.write(join(dir, 'spec.yaml'), SPEC_V1)
    await run(['generate', 'code', 'spec.yaml'], dir)
    const before = await readFile(join(dir, 'src/routes/users.route.ts'), 'utf-8')
    const r = await run(['generate', 'code', 'spec.yaml'], dir)
    expect(r.code).toBe(0)
    const after = await readFile(join(dir, 'src/routes/users.route.ts'), 'utf-8')
    expect(after).toBe(before)
  })

  test('user handler edits survive re-generation', async () => {
    await Bun.write(join(dir, 'spec.yaml'), SPEC_V1)
    await run(['generate', 'code', 'spec.yaml'], dir)

    const routePath = join(dir, 'src/routes/users.route.ts')
    let content = await readFile(routePath, 'utf-8')
    // Patch the listUsers handler
    content = content.replace(
      'throw new NotImplementedError()',
      `return [{ id: '1', name: 'alice' }]`
    )
    await writeFile(routePath, content)

    const r = await run(['generate', 'code', 'spec.yaml'], dir)
    expect(r.code).toBe(0)

    const after = await readFile(routePath, 'utf-8')
    // Prettier may rewrite single→double quotes; check tokens, not exact formatting.
    expect(after).toMatch(/return \[\{ id: ["']1["'], name: ["']alice["'] \}\]/)
  })

  test('stale routes block writing without --remove-stale', async () => {
    await Bun.write(join(dir, 'spec.yaml'), SPEC_V1)
    await run(['generate', 'code', 'spec.yaml'], dir)

    await Bun.write(join(dir, 'spec.yaml'), SPEC_V2)
    const r = await run(['generate', 'code', 'spec.yaml'], dir)
    expect(r.code).toBe(1)
    expect(r.stdout + r.stderr).toContain('GET /users/:id')
    expect(r.stdout + r.stderr).toContain('--rename')
    expect(r.stdout + r.stderr).toContain('--ignore-route')
    expect(r.stdout + r.stderr).toContain('--remove-stale')

    // Confirm the file on disk was NOT modified.
    const route = await readFile(join(dir, 'src/routes/users.route.ts'), 'utf-8')
    expect(route).toContain('g.get("/users/:id"')
    expect(route).not.toContain('g.post("/users"')
  })

  test('--remove-stale deletes stale routes and prunes import', async () => {
    await Bun.write(join(dir, 'spec.yaml'), SPEC_V1)
    await run(['generate', 'code', 'spec.yaml'], dir)

    await Bun.write(join(dir, 'spec.yaml'), SPEC_V2)
    const r = await run(['generate', 'code', 'spec.yaml', '--remove-stale'], dir)
    expect(r.code).toBe(0)

    const route = await readFile(join(dir, 'src/routes/users.route.ts'), 'utf-8')
    expect(route).not.toContain('/users/:id')
    expect(route).toContain('g.post("/users"')
    expect(route).toContain('g.get("/users"')
  })

  test('--ignore-route keeps stale route untouched', async () => {
    await Bun.write(join(dir, 'spec.yaml'), SPEC_V1)
    await run(['generate', 'code', 'spec.yaml'], dir)

    // User customizes the now-stale handler
    const routePath = join(dir, 'src/routes/users.route.ts')
    let content = await readFile(routePath, 'utf-8')
    content = content.replace(
      /g\.get\("\/users\/:id"[\s\S]*?throw new NotImplementedError\(\)/,
      m => m.replace('throw new NotImplementedError()', `return { id: ctx.params.id, custom: true }`)
    )
    await writeFile(routePath, content)

    await Bun.write(join(dir, 'spec.yaml'), SPEC_V2)
    const r = await run(
      ['generate', 'code', 'spec.yaml', '--ignore-route', 'GET /users/:id'],
      dir
    )
    expect(r.code).toBe(0)

    const after = await readFile(routePath, 'utf-8')
    expect(after).toContain('g.get("/users/:id"')
    expect(after).toContain('custom: true')
    expect(after).toContain('g.post("/users"')
  })

  test('--rename preserves handler when route id changes', async () => {
    await Bun.write(join(dir, 'spec.yaml'), SPEC_V1)
    await run(['generate', 'code', 'spec.yaml'], dir)

    const routePath = join(dir, 'src/routes/users.route.ts')
    let content = await readFile(routePath, 'utf-8')
    content = content.replace(
      /g\.get\("\/users\/:id"[\s\S]*?throw new NotImplementedError\(\)/,
      m => m.replace('throw new NotImplementedError()', `return { id: ctx.params.id, fetched: true }`)
    )
    await writeFile(routePath, content)

    await Bun.write(join(dir, 'spec.yaml'), SPEC_V3)
    const r = await run(
      ['generate', 'code', 'spec.yaml', '--rename', 'GET /users/:id=GET /users/:userId'],
      dir
    )
    expect(r.code).toBe(0)

    const after = await readFile(routePath, 'utf-8')
    expect(after).toContain('g.get("/users/:userId"')
    expect(after).not.toContain('g.get("/users/:id"')
    expect(after).toContain('fetched: true')
  })

  test('--dry-run prints diff and writes nothing', async () => {
    await Bun.write(join(dir, 'spec.yaml'), SPEC_V1)
    await run(['generate', 'code', 'spec.yaml'], dir)
    const before = await readFile(join(dir, 'src/routes/users.route.ts'), 'utf-8')

    await Bun.write(join(dir, 'spec.yaml'), SPEC_V2)
    const r = await run(
      ['generate', 'code', 'spec.yaml', '--dry-run', '--remove-stale'],
      dir
    )
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('Dry run')
    expect(r.stdout).toContain('POST /users')
    expect(r.stdout).toContain('GET /users/:id')

    const after = await readFile(join(dir, 'src/routes/users.route.ts'), 'utf-8')
    expect(after).toBe(before)
  })

  test('-F is no longer a recognized flag', async () => {
    await Bun.write(join(dir, 'spec.yaml'), SPEC_V1)
    const r = await run(['generate', 'code', 'spec.yaml', '-F'], dir)
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('unknown option')
  })
})
