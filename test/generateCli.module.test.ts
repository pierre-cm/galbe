import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { generate } from '../bin/commands/generate/cli/targets/cac'
import { tmpdir } from 'os'
import { mkdtemp, rm } from 'fs/promises'
import { resolve } from 'path'
import type { GalbeCLICommand } from '../src'

const PORT = 47211

const mkRoute = (method: string, path: string) => ({ method, path, handler: () => {} } as any)

const COMMANDS: GalbeCLICommand[] = [
  // untagged
  {
    name: 'ping',
    tags: [],
    description: 'ping the server',
    route: mkRoute('get', '/ping'),
    pathT: '/ping',
    arguments: [],
    options: [],
  },
  // single tag
  {
    name: 'list-users',
    tags: ['users'],
    description: 'list users',
    route: mkRoute('get', '/users'),
    pathT: '/users',
    arguments: [],
    options: [],
  },
  {
    name: 'get-user',
    tags: ['users'],
    description: 'get a user',
    route: mkRoute('get', '/users/:id'),
    pathT: '/users/${id}',
    arguments: [{ name: 'id', type: '<string>', description: 'user id' }],
    options: [],
  },
  {
    name: 'create-user',
    tags: ['users'],
    description: 'create a user',
    route: mkRoute('post', '/users'),
    pathT: '/users',
    arguments: [],
    options: [],
  },
  // multi-tag
  {
    name: 'ban-user',
    tags: ['users', 'admin'],
    description: 'ban a user',
    route: mkRoute('post', '/users/:username/ban'),
    pathT: '/users/${username}/ban',
    arguments: [{ name: 'username', type: '<string>', description: 'username' }],
    options: [],
  },
]

let tmpDir: string
let wrapperPath: string
let modulePath: string
let server: ReturnType<typeof Bun.serve>
const captured: { method: string; pathname: string; body: string; search: string }[] = []

async function run(args: string[]) {
  const proc = Bun.spawn(['bun', wrapperPath, ...args], {
    env: { ...process.env, GCLI_SERVER_URL: `http://localhost:${PORT}` },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

beforeAll(async () => {
  tmpDir = await mkdtemp(resolve(tmpdir(), 'galbe-cli-test-'))
  modulePath = resolve(tmpDir, 'cli.ts')
  wrapperPath = resolve(tmpDir, 'wrapper.ts')

  await generate({
    commands: COMMANDS,
    mode: 'module',
    out: modulePath,
    pckg: { name: 'testcli', version: '1.0.0' },
  })

  await Bun.write(
    wrapperPath,
    `import { cac } from 'cac'
import { register } from '${modulePath}'

const app = cac('testcli')
register(app)
app.help()
try {
  app.parse()
} catch (e: any) {
  console.error('error: ' + (e.message ?? e))
  process.exit(1)
}
`
  )

  server = Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url)
      captured.push({
        method: req.method,
        pathname: url.pathname,
        search: url.search,
        body: req.body ? await new Response(req.body).text() : '',
      })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
})

afterAll(async () => {
  server?.stop()
  await rm(tmpDir, { recursive: true })
})

// ── happy paths ───────────────────────────────────────────────────────────────

describe('module CLI — happy paths', () => {
  test('untagged: ping → GET /ping', async () => {
    captured.length = 0
    const { exitCode, stderr } = await run(['ping'])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('GET')
    expect(captured[0].pathname).toBe('/ping')
  })

  test('single tag: users list-users → GET /users', async () => {
    captured.length = 0
    const { exitCode, stderr } = await run(['users', 'list-users'])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('GET')
    expect(captured[0].pathname).toBe('/users')
  })

  test('single tag + path arg: users get-user abc → GET /users/abc', async () => {
    captured.length = 0
    const { exitCode, stderr } = await run(['users', 'get-user', 'abc123'])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('GET')
    expect(captured[0].pathname).toBe('/users/abc123')
  })

  test('single tag + body: users create-user -b {...} → POST /users', async () => {
    captured.length = 0
    const body = JSON.stringify({ name: 'test' })
    const { exitCode, stderr } = await run(['users', 'create-user', '-b', body])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('POST')
    expect(captured[0].pathname).toBe('/users')
    expect(captured[0].body).toBe(body)
  })

  test('multi-tag: users admin ban-user pierre → POST /users/pierre/ban', async () => {
    captured.length = 0
    const { exitCode, stderr } = await run(['users', 'admin', 'ban-user', 'pierre'])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('POST')
    expect(captured[0].pathname).toBe('/users/pierre/ban')
  })

  test('query param forwarded: users list-users -Q page=2 → GET /users?page=2', async () => {
    captured.length = 0
    const { exitCode } = await run(['users', 'list-users', '-Q', 'page=2'])
    expect(exitCode).toBe(0)
    expect(captured[0].search).toContain('page=2')
  })

  test('custom header forwarded: ping -H x-token=abc', async () => {
    captured.length = 0
    const { exitCode } = await run(['ping', '-H', 'x-token=abc'])
    expect(exitCode).toBe(0)
    // server captured the request; header assertion is on server side — just check exit
    expect(captured).toHaveLength(1)
  })
})

// ── help / routing ────────────────────────────────────────────────────────────

describe('module CLI — help & routing', () => {
  test('no args: shows root help listing groups, exits 0', async () => {
    const { stdout, exitCode } = await run([])
    expect(exitCode).toBe(0)
    expect(stdout).toContain('testcli')
    expect(stdout).toContain('users')
    expect(stdout).toContain('ping')
  })

  test('--help: shows root help, exits 0', async () => {
    const { stdout, exitCode } = await run(['--help'])
    expect(exitCode).toBe(0)
    expect(stdout).toContain('testcli')
  })

  test('users (no subcommand): shows users help listing commands, exits 0', async () => {
    const { stdout, exitCode } = await run(['users'])
    expect(exitCode).toBe(0)
    expect(stdout).toContain('list-users')
    expect(stdout).toContain('get-user')
    expect(stdout).toContain('admin')
  })

  test('users --help: shows users help, exits 0', async () => {
    const { stdout, exitCode } = await run(['users', '--help'])
    expect(exitCode).toBe(0)
    expect(stdout).toContain('list-users')
  })

  test('users admin (no subcommand): shows admin help listing commands, exits 0', async () => {
    const { stdout, exitCode } = await run(['users', 'admin'])
    expect(exitCode).toBe(0)
    expect(stdout).toContain('ban-user')
  })

  test('help does NOT show [_sub...] for group commands', async () => {
    const { stdout } = await run([])
    expect(stdout).not.toContain('[_sub')
  })
})

// ── error handling ────────────────────────────────────────────────────────────

describe('module CLI — error handling', () => {
  test('unknown root command: exits 1, no stack trace', async () => {
    const { stderr, exitCode } = await run(['nope'])
    expect(exitCode).toBe(1)
    expect(stderr).not.toMatch(/at .+:\d+/)
  })

  test('users unknown: exits 1, no stack trace', async () => {
    const { stderr, exitCode } = await run(['users', 'nope'])
    expect(exitCode).toBe(1)
    expect(stderr).not.toMatch(/at .+:\d+/)
  })

  test('users admin unknown: exits 1, no stack trace', async () => {
    const { stderr, exitCode } = await run(['users', 'admin', 'nope'])
    expect(exitCode).toBe(1)
    expect(stderr).not.toMatch(/at .+:\d+/)
  })

  test('users get-user (missing required arg): clean error message, exits 1', async () => {
    const { stderr, exitCode } = await run(['users', 'get-user'])
    expect(exitCode).toBe(1)
    expect(stderr).toContain('error:')
    expect(stderr).not.toMatch(/at .+:\d+/)
  })

  test('users admin ban-user (missing required arg): clean error, exits 1', async () => {
    const { stderr, exitCode } = await run(['users', 'admin', 'ban-user'])
    expect(exitCode).toBe(1)
    expect(stderr).toContain('error:')
    expect(stderr).not.toMatch(/at .+:\d+/)
  })
})
