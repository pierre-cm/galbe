import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const PROJECT = resolve(__dirname, '..')
const CLI = resolve(PROJECT, 'bin/cli.ts')
const FIXTURE = resolve(PROJECT, 'test/resources/openapi.fixture.yaml')

const run = async (args: string[], cwd: string) => {
  const proc = Bun.spawn(['bun', CLI, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  await proc.exited
  if (proc.exitCode !== 0) {
    const out = await new Response(proc.stdout).text()
    const err = await new Response(proc.stderr).text()
    throw new Error(`CLI failed (${proc.exitCode}): ${args.join(' ')}\nstdout:\n${out}\nstderr:\n${err}`)
  }
}

describe('openapi roundtrip', () => {
  let dir: string
  let original: any
  let generated: any

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'galbe-rt-'))
    await mkdir(join(dir, 'node_modules'), { recursive: true })
    await symlink(PROJECT, join(dir, 'node_modules', 'galbe'))
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'rt', version: '0.0.0', type: 'module', dependencies: { galbe: '*' } }, null, 2)
    )
    await Bun.write(join(dir, 'openapi.yaml'), await Bun.file(FIXTURE).text())
    await writeFile(join(dir, 'index.ts'), `import { Galbe } from 'galbe'\nexport default new Galbe()\n`)

    await run(['generate', 'code', 'openapi.yaml', '-F'], dir)
    await run(['generate', 'spec', './index.ts', '-o', 'generated.yaml'], dir)

    original = Bun.YAML.parse(await Bun.file(FIXTURE).text()) as any
    generated = Bun.YAML.parse(await Bun.file(join(dir, 'generated.yaml')).text()) as any
  }, 60_000)

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  test('every original path operation is present in generated', () => {
    for (const [path, methods] of Object.entries(original.paths || {})) {
      expect(generated.paths).toHaveProperty(path)
      for (const m of Object.keys(methods as any)) {
        if (m === 'parameters') continue
        expect(generated.paths[path]).toHaveProperty(m)
      }
    }
  })

  test('operationIds, summaries and tags survive the roundtrip', () => {
    for (const [path, methods] of Object.entries(original.paths || {})) {
      for (const [m, op] of Object.entries(methods as any)) {
        if (m === 'parameters') continue
        const gen = generated.paths[path][m]
        const orig = op as any
        if (orig.operationId) expect(gen.operationId).toBe(orig.operationId)
        if (orig.summary) expect(gen.summary).toBe(orig.summary)
        if (orig.tags) expect(gen.tags).toEqual(orig.tags)
      }
    }
  })

  test('every component schema is present and structurally similar', () => {
    const oSchemas = original.components?.schemas || {}
    const gSchemas = generated.components?.schemas || {}
    for (const name of Object.keys(oSchemas)) {
      expect(gSchemas).toHaveProperty(name)
    }
  })

  test('component schemas keep their string format when set', () => {
    const checks: [string, string, string][] = [
      ['Owner', 'addedAt', 'date-time'],
      ['ModuleVersionDetail', 'publishedAt', 'date-time'],
      ['ModuleVersionDetail', 'artifactUrl', 'uri'],
      ['Advisory', 'publishedAt', 'date-time'],
      ['AdvisoryInput', 'url', 'uri'],
    ]
    for (const [schemaName, prop, format] of checks) {
      const s = generated.components.schemas[schemaName]
      const props = s.properties || s.allOf?.[1]?.properties
      expect(props?.[prop]?.format).toBe(format)
    }
  })

  test('component schemas keep min/max bounds including 0', () => {
    const summary = generated.components.schemas.RegistryModuleSummary
    expect(summary.properties.downloads.minimum).toBe(0)
    expect(summary.properties.rating.minimum).toBe(0)
    expect(summary.properties.rating.maximum).toBe(5)
    expect(summary.properties.ratingCount.minimum).toBe(0)
  })

  test('component schemas keep array minItems', () => {
    const ai = generated.components.schemas.AdvisoryInput
    expect(ai.properties.affectedVersions.minItems).toBe(1)
  })

  test('multipart/form-data body is serialized as an object schema', () => {
    const publish = generated.paths['/v1/publish'].post
    const mp = publish.requestBody.content['multipart/form-data'].schema
    expect(mp.type).toBe('object')
    expect(mp.properties).toHaveProperty('artifact')
    expect(mp.required).toContain('artifact')
  })

  test('requestBody.required is true when the body is non-optional', () => {
    expect(generated.paths['/v1/publish'].post.requestBody.required).toBe(true)
    expect(generated.paths['/v1/advisories'].post.requestBody.required).toBe(true)
  })

  test('named response components survive the roundtrip', () => {
    const r = generated.components?.responses || {}
    for (const name of ['NotFound', 'Unauthorized', 'Forbidden', 'BadRequest']) {
      expect(r).toHaveProperty(name)
    }
  })

  test('path-level $ref to named responses is preserved', () => {
    const r404 = generated.paths['/v1/modules/{scope}/{name}'].get.responses['404']
    expect(r404.$ref).toBe('#/components/responses/NotFound')
    const r400 = generated.paths['/v1/search'].get.responses['400']
    expect(r400.$ref).toBe('#/components/responses/BadRequest')
  })

  test('union of string literals collapses to a single enum', () => {
    const env = generated.components.schemas.HealthResponse.properties.env
    expect(env.type).toBe('string')
    expect(env.enum).toEqual(['development', 'test', 'production'])
  })

  test('parameters component is not polluted with schema ids', () => {
    const ps = generated.components?.parameters || {}
    expect(ps).not.toHaveProperty('Semver')
  })

  test('parameters used by 2+ ops are promoted to components.parameters', () => {
    const ps = generated.components.parameters
    for (const name of ['Scope', 'Name', 'Version', 'Page', 'PageSize']) {
      expect(ps).toHaveProperty(name)
    }
    const op = generated.paths['/v1/modules/{scope}/{name}/{version}'].get
    expect(op.parameters).toEqual([
      { $ref: '#/components/parameters/Scope' },
      { $ref: '#/components/parameters/Name' },
      { $ref: '#/components/parameters/Version' },
    ])
  })

  test('long operation descriptions survive', () => {
    const op = generated.paths['/v1/modules/{scope}/{name}/{version}/artifact'].get
    expect(op.summary).toBe('Download the artifact tarball.')
    expect(op.description).toContain('Streams the')
    expect(op.description).toContain('Supports `If-None-Match`')
  })

  test('descriptions containing `@scope/name` are not truncated at the @', () => {
    // Regression: parseComment used to split on the first `@`, which truncated
    // descriptions at npm-style scoped package identifiers like `@scope/name`.
    const getModule = generated.paths['/v1/modules/{scope}/{name}'].get
    expect(getModule.description).toContain('@{scope}/{name}')
    expect(getModule.description).toContain('X-All-Versions-Yanked: true')

    const publish = generated.paths['/v1/publish'].post
    expect(publish.description).toContain('@{scope}/{name}')
    // Step 5 of the publish pipeline must still be there
    expect(publish.description).toContain('content-addressed blob storage')
    // The `claim` scope note must still be there
    expect(publish.description).toContain('`claim` scope')
  })

  test('response headers survive (artifact, X-All-Versions-Yanked, Location)', () => {
    const art = generated.paths['/v1/modules/{scope}/{name}/{version}/artifact'].get.responses['200']
    expect(art.headers).toBeDefined()
    expect(art.headers.ETag.required).toBe(true)
    expect(art.headers.ETag.schema.type).toBe('string')
    expect(art.headers['Content-Length'].schema.type).toBe('integer')
    expect(art.headers['X-Yanked'].schema.type).toBe('boolean')

    const mod = generated.paths['/v1/modules/{scope}/{name}'].get.responses['200']
    expect(mod.headers['X-All-Versions-Yanked']).toBeDefined()
    expect(mod.headers['X-All-Versions-Yanked'].schema.type).toBe('boolean')

    const pub = generated.paths['/v1/publish'].post.responses['201']
    expect(pub.headers.Location).toBeDefined()
  })

  test('content-level multi-key examples (versionExists, integrityMismatch) survive', () => {
    const r409 = generated.paths['/v1/publish'].post.responses['409']
    const ex = r409.content['application/json'].examples
    expect(ex).toHaveProperty('versionExists')
    expect(ex).toHaveProperty('integrityMismatch')
    expect(ex.versionExists.value.error).toBe('version_exists')
  })

  test('per-operation response descriptions survive (not flattened to status names)', () => {
    expect(generated.paths['/v1/modules/{scope}/{name}'].get.responses['200'].description).toBe('Module exists.')
    expect(generated.paths['/v1/publish'].post.responses['201'].description).toBe('Version published.')
    expect(generated.paths['/v1/modules/{scope}/{name}/{version}/yank'].post.responses['200'].description).toBe(
      'Yank state updated.'
    )
    expect(generated.paths['/v1/modules/{scope}/{name}/owners'].post.responses['409'].description).toBe(
      'Refused — e.g., last owner cannot remove themselves.'
    )
    expect(generated.paths['/v1/modules/{scope}/{name}/{version}'].delete.responses['204'].description).toBe(
      'Version deleted.'
    )
  })

  test('component-level response descriptions survive', () => {
    expect(generated.components.responses.NotFound.description).toBe(
      'Module, version, or other resource not found.'
    )
    expect(generated.components.responses.BadRequest.description).toBe('Malformed request.')
    expect(generated.components.responses.Unauthorized.description).toBe('Missing or invalid bearer token.')
    expect(generated.components.responses.Forbidden.description).toBe(
      'Authenticated but lacking the required scope or ownership.'
    )
  })

  test('component-level response examples survive (NotFound)', () => {
    const nf = generated.components.responses.NotFound
    expect(nf.content['application/json'].example).toEqual({
      error: 'not_found',
      message: 'no such module: @acme/widget',
    })
  })

  test('content-level single example survives (health)', () => {
    const r200 = generated.paths['/health'].get.responses['200']
    const ex = r200.content['application/json'].example
    expect(ex).toEqual({ status: 'ok', storage: 'sqlite', authMode: 'none', env: 'development' })
  })

  test('artifact endpoint preserves application/gzip + format:binary', () => {
    const op = generated.paths['/v1/modules/{scope}/{name}/{version}/artifact'].get
    const r200 = op.responses['200']
    expect(r200.content).toHaveProperty('application/gzip')
    expect(r200.content['application/gzip'].schema.format).toBe('binary')
  })

  test('publish multipart artifact field uses format:binary', () => {
    const mp = generated.paths['/v1/publish'].post.requestBody.content['multipart/form-data'].schema
    expect(mp.properties.artifact.format).toBe('binary')
  })

  test('readme endpoint exposes both text/html and text/markdown', () => {
    const op = generated.paths['/v1/modules/{scope}/{name}/readme'].get
    const r200 = op.responses['200']
    expect(r200.content).toHaveProperty('text/html')
    expect(r200.content).toHaveProperty('text/markdown')
  })

  test('empty-body responses (204, 304) survive', () => {
    const del = generated.paths['/v1/modules/{scope}/{name}/{version}'].delete
    expect(del.responses['204']).toBeDefined()
    expect(del.responses['204'].description).toBe('Version deleted.')
    expect(del.responses['204'].content).toBeUndefined()

    const art = generated.paths['/v1/modules/{scope}/{name}/{version}/artifact'].get
    expect(art.responses['304']).toBeDefined()
    expect(art.responses['304'].content).toBeUndefined()
  })

  test('per-operation security scopes survive', () => {
    const del = generated.paths['/v1/modules/{scope}/{name}/{version}'].delete
    expect(del.security).toEqual([{ bearerAuth: ['admin'] }])

    const yank = generated.paths['/v1/modules/{scope}/{name}/{version}/yank'].post
    expect(yank.security).toEqual([{ bearerAuth: ['publish'] }])
  })

  test('explicit per-operation public security ([]) survives', () => {
    expect(generated.paths['/health'].get.security).toEqual([])
    expect(generated.paths['/v1/search'].get.security).toEqual([])
  })

  test('default values on Page/PageSize parameters survive', () => {
    const ps = generated.components.parameters
    expect(ps.Page.schema.default).toBe(1)
    expect(ps.PageSize.schema.default).toBe(20)
  })

  test('ModuleManifest.repository keeps oneOf (not anyOf)', () => {
    const repo = generated.components.schemas.ModuleManifest.properties.repository
    expect(repo.oneOf).toBeDefined()
    expect(repo.anyOf).toBeUndefined()
  })

  test('Error.details keeps its description without a spurious type', () => {
    const details = generated.components.schemas.Error.properties.details
    expect(details.type).toBeUndefined()
    expect(details.description).toBe('Optional code-specific structured detail.')
  })

  test('bearerAuth security scheme is registered', () => {
    expect(generated.components.securitySchemes).toHaveProperty('bearerAuth')
    expect(generated.components.securitySchemes.bearerAuth.type).toBe('http')
    expect(generated.components.securitySchemes.bearerAuth.scheme).toBe('bearer')
  })
})
