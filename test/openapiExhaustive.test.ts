import { afterAll, describe, expect, test } from 'bun:test'
import { readdir, rm } from 'fs/promises'
import { relative, resolve } from 'path'

import { cli, createApp } from './cli.utils'
import { diffSpec, normalize, operations, report } from './openapi.diff'

/**
 * End-to-end coverage for the OpenAPI parser (`generate code`) and serializer
 * (`generate spec`), driven by `resources/openapi.exhaustive.yaml` — a fixture
 * that tries to name every construct OpenAPI 3.0 allows.
 *
 * The pipeline runs once for the whole file:
 *
 *   openapi.exhaustive.yaml --generate code--> src/**.{route,schema}.ts
 *                           --generate spec--> generated.{yaml,json}
 *
 * and three things are then checked:
 *
 *  1. the generated sources, file by file, against snapshots — the parser's
 *     output is pinned, so any change in what Galbe emits is visible in review;
 *  2. the regenerated spec against a snapshot, and yaml against json;
 *  3. the regenerated spec against the *source* spec, structurally. The
 *     pipeline is not fully invertible, so that comparison is a snapshotted
 *     report rather than an equality assertion: it is the inventory of what
 *     the roundtrip loses. Shrinking it is the goal; growing it without
 *     noticing is the regression this guards against.
 *
 * Run `bun test --update-snapshots test/openapiExhaustive.test.ts` after an
 * intentional change, and read the roundtrip-diff delta carefully.
 */

const FIXTURE = resolve(import.meta.dir, 'resources/openapi.exhaustive.yaml')

const readTree = async (root: string): Promise<[string, string][]> => {
  const out: [string, string][] = []
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else out.push([relative(root, p), await Bun.file(p).text()])
    }
  }
  await walk(root)
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

const source = await Bun.file(FIXTURE).text()
const original = Bun.YAML.parse(source) as any

// `info`, `servers`, `securitySchemes`, `tags`, `security` and `externalDocs`
// describe the document, not any single route, so nothing in the generated
// sources can carry them. A real project declares them in GalbeConfig — which
// is what this app does, using the fixture's own values. Routes only *name* a
// scheme (through `@security`) and a tag (through `@tags`).
const dir = await createApp({
  'package.json': JSON.stringify(
    { name: 'exhaustive', version: '0.0.0', type: 'module', dependencies: { galbe: '*' } },
    null,
    2
  ),
  'galbe.config.ts':
    `import type { GalbeConfig } from 'galbe'\n\n` +
    `const config: GalbeConfig = {\n` +
    `  openapi: {\n` +
    `    info: ${JSON.stringify(original.info, null, 4)},\n` +
    `    servers: ${JSON.stringify(original.servers, null, 4)},\n` +
    `    securitySchemes: ${JSON.stringify(original.components.securitySchemes, null, 4)},\n` +
    `    tags: ${JSON.stringify(original.tags, null, 4)},\n` +
    `    security: ${JSON.stringify(original.security, null, 4)},\n` +
    `    externalDocs: ${JSON.stringify(original.externalDocs, null, 4)}\n` +
    `  }\n}\n\nexport default config\n`,
  'index.ts': `import { Galbe } from 'galbe'\nimport config from './galbe.config'\n\nexport default new Galbe(config)\n`,
  'openapi.yaml': source,
})

let setupError: unknown = null
let generateCodeOutput = ''
let sources: [string, string][] = []
let generatedYaml = ''
let generatedJsonText = ''
let generatedJson: any = null
let generated: any = null

try {
  generateCodeOutput = await cli(dir, ['generate', 'code', 'openapi.yaml'])
  await cli(dir, ['generate', 'spec', './index.ts', '-o', 'generated.yaml'])
  await cli(dir, ['generate', 'spec', './index.ts', '-t', 'openapi:3.0:json', '-o', 'generated.json'])
  sources = await readTree(resolve(dir, 'src'))
  generatedYaml = await Bun.file(resolve(dir, 'generated.yaml')).text()
  generatedJsonText = await Bun.file(resolve(dir, 'generated.json')).text()
  generatedJson = JSON.parse(generatedJsonText)
  generated = Bun.YAML.parse(generatedYaml)
} catch (err) {
  setupError = err
}

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('openapi exhaustive: generate code', () => {
  test('the whole pipeline runs without an error', () => {
    if (setupError) throw setupError
    expect(sources.length).toBeGreaterThan(0)
  })

  test('emits the expected file tree', () => {
    expect(sources.map(([p]) => p).join('\n')).toMatchSnapshot()
  })

  // One snapshot per generated file: a mismatch names the file it happened in.
  for (const [path, content] of sources) {
    test(`source ${path}`, () => {
      expect(content).toMatchSnapshot()
    })
  }

  // Everything the fixture declares and Galbe cannot express is reported at
  // generation time. A silently widened validator is the failure mode this
  // guards against: the omission has to be visible when it happens, not months
  // later in a diff.
  test('constructs it cannot carry are reported, not dropped silently', () => {
    expect(generateCodeOutput).toContain('Not carried into the generated sources')
    // `not` widens the validator to `any`
    expect(generateCodeOutput).toContain('`not` has no equivalent in Galbe')
    // a method with no route builder disappears entirely
    expect(generateCodeOutput).toContain("method 'TRACE' has no Galbe route builder")
    // deprecated in OpenAPI itself, undefined behaviour for most serializations
    expect(generateCodeOutput).toContain('allowEmptyValue is not modelled')
    // the fixture's style/explode are the OpenAPI defaults — nothing is lost,
    // so nothing is reported
    expect(generateCodeOutput).not.toContain('is not modelled — the generated route parses it as')
  })

  test('every source file parses as TypeScript', async () => {
    const transpiler = new Bun.Transpiler({ loader: 'ts' })
    for (const [path, content] of sources) {
      expect(() => transpiler.transformSync(content), `${path} does not parse`).not.toThrow()
    }
  })

  test('routes land in the file the directory convention dictates, with relative paths', () => {
    const byPath = Object.fromEntries(sources)
    // /v2/admin/users/{userId}/... -> src/v2/admin/users.route.ts, and the path
    // is emitted relative to /v2/admin so the analyzer's dirPrefix rebuilds it
    expect(byPath['v2/admin/users.route.ts']).toContain('g.get("/users/:userId/sessions/:sessionId"')
    expect(byPath['v2/admin/users.route.ts']).not.toContain('"/v2/admin/users')
    // a root-level parameterised path has no literal scope at all
    expect(byPath['main.route.ts']).toContain('g.get("/:slug"')
    // every method of /primitives/{id} shares one file
    for (const m of ['get', 'put', 'patch', 'delete', 'head', 'options'])
      expect(byPath['primitives.route.ts']).toContain(`g.${m}("/primitives/:id"`)
  })

  test('component schemas are split by component type', () => {
    const byPath = Object.fromEntries(sources)
    expect(byPath['schemas/commons.schema.ts']).toContain('export const Widget')
    expect(byPath['schemas/commons.schema.ts']).toContain('export const Error')
    expect(byPath['schemas/requests.schema.ts']).toContain('export const WidgetBody')
    expect(byPath['schemas/responses.schema.ts']).toContain('export const NotFound')
    // dependencies are declared before their dependents
    const commons = byPath['schemas/commons.schema.ts']!
    expect(commons.indexOf('export const Identified')).toBeLessThan(commons.indexOf('export const Widget'))
  })

  test('operation metadata is emitted as JSDoc', () => {
    const primitives = Object.fromEntries(sources)['primitives.route.ts']!
    expect(primitives).toContain('@operationId listPrimitives')
    expect(primitives).toContain('@tags primitives')
    expect(primitives).toContain('@security none')
    const meta = Object.fromEntries(sources)['meta/deprecated.route.ts']!
    expect(meta).toContain('@deprecated')
    expect(meta).toContain('@tags meta primitives')
    // a description containing an `@` must not be truncated at it
    expect(meta).toContain('`@scope/name`')
  })
})

describe('openapi exhaustive: generate spec', () => {
  test('the yaml and json targets carry the same document', () => {
    // strict: `toEqual` treats a missing key and an undefined one as the same,
    // which would hide a target emitting `null` where the other emits nothing
    expect(Bun.deepEquals(generatedJson, generated, true)).toBe(true)
  })

  test('regenerated yaml spec matches the snapshot', () => {
    expect(generatedYaml).toMatchSnapshot()
  })

  test('regenerated json spec matches the snapshot', () => {
    expect(generatedJsonText).toMatchSnapshot()
  })

  // The roundtrip-diff snapshot measures information loss. These three measure
  // something stricter: whether the emitted document is a *valid* OpenAPI 3.0
  // one at all. A dangling `$ref`, an undefined security scheme or a 3.1-style
  // exclusive bound is a broken spec, not a lossy one.
  test('every $ref in the generated spec resolves', () => {
    const dangling: string[] = []
    const resolve = (ref: string) =>
      ref.replace(/^#\//, '').split('/').reduce<any>((c, s) => c?.[s.replaceAll('~1', '/').replaceAll('~0', '~')], generated)
    const walk = (n: any, at: string): void => {
      if (Array.isArray(n)) return n.forEach((v, i) => walk(v, `${at}/${i}`))
      if (!n || typeof n !== 'object') return
      for (const [k, v] of Object.entries(n)) {
        if (k === '$ref' && typeof v === 'string') {
          if (!v.startsWith('#/') || resolve(v) === undefined) dangling.push(`${at} -> ${v}`)
        } else walk(v, `${at}/${k}`)
      }
    }
    walk(generated, '')
    expect(dangling).toEqual([])
  })

  test('every security requirement names a declared scheme', () => {
    const declared = new Set(Object.keys(generated.components?.securitySchemes ?? {}))
    const undeclared: string[] = []
    for (const [path, item] of Object.entries<any>(generated.paths))
      for (const [method, op] of Object.entries<any>(item))
        for (const req of op?.security ?? [])
          for (const name of Object.keys(req)) if (!declared.has(name)) undeclared.push(`${method} ${path}: ${name}`)
    expect(undeclared).toEqual([])
  })

  test('exclusive bounds use the 3.0 boolean form', () => {
    const wrong: string[] = []
    const walk = (n: any, at: string): void => {
      if (Array.isArray(n)) return n.forEach((v, i) => walk(v, `${at}/${i}`))
      if (!n || typeof n !== 'object') return
      for (const side of ['Minimum', 'Maximum'] as const) {
        const key = `exclusive${side}`
        if (!(key in n)) continue
        // draft-4: a boolean modifying an inclusive bound that must be present
        if (typeof n[key] !== 'boolean') wrong.push(`${at}/${key} is ${JSON.stringify(n[key])}, expected a boolean`)
        else if (n[side.toLowerCase()] === undefined) wrong.push(`${at}/${key} has no ${side.toLowerCase()}`)
      }
      for (const [k, v] of Object.entries(n)) walk(v, `${at}/${k}`)
    }
    walk(generated, '')
    expect(wrong).toEqual([])
  })

  test('document-level fields declared in GalbeConfig survive verbatim', () => {
    expect(generated.openapi).toBe('3.0.3')
    expect(generated.info).toEqual(original.info)
    expect(generated.servers).toEqual(original.servers)
    expect(generated.tags).toEqual(original.tags)
    expect(generated.security).toEqual(original.security)
    expect(generated.externalDocs).toEqual(original.externalDocs)
  })
})

describe('openapi exhaustive: roundtrip', () => {
  /**
   * The inventory of everything the roundtrip loses or rewrites. Every line is
   * a gap; the snapshot exists so that closing one, or opening a new one, is a
   * deliberate, reviewed change rather than a silent drift.
   */
  test('differences against the source spec match the known set', () => {
    expect(report(diffSpec(normalize(original), normalize(generated)))).toMatchSnapshot()
  })

  test('every path and operation survives', () => {
    for (const { path, method } of operations(original)) {
      expect(generated.paths, `${method.toUpperCase()} ${path} is missing`).toHaveProperty(path)
      expect(generated.paths[path], `${method.toUpperCase()} ${path} is missing`).toHaveProperty(method)
    }
    expect(Object.keys(generated.paths).sort()).toEqual(Object.keys(original.paths).sort())
  })

  test('operationId, tags and deprecated survive on every operation', () => {
    for (const { path, method, op } of operations(original)) {
      const gen = generated.paths[path][method]
      expect(gen.operationId, `${method} ${path}`).toBe(op.operationId)
      expect(gen.tags, `${method} ${path}`).toEqual(op.tags)
      if (op.deprecated) expect(gen.deprecated, `${method} ${path}`).toBe(true)
      else expect(gen.deprecated, `${method} ${path}`).toBeUndefined()
    }
  })

  test('summary and description survive on every operation that has one', () => {
    for (const { path, method, op } of operations(original)) {
      // `/meta/description-only` deliberately has an empty summary: the JSDoc
      // head has no way to say "description but no summary", so it is skipped.
      if (!op.summary) continue
      const gen = generated.paths[path][method]
      expect(gen.summary, `${method} ${path}`).toBe(op.summary.trim())
      if (op.description) expect(gen.description, `${method} ${path}`).toBe(op.description.trim())
    }
  })

  test('per-operation security requirements survive, including the empty one', () => {
    for (const { path, method, op } of operations(original)) {
      if (op.security === undefined) continue
      expect(generated.paths[path][method].security, `${method} ${path}`).toEqual(op.security)
    }
    expect(generated.paths['/security/public'].get.security).toEqual([])
    expect(generated.paths['/security/alternatives'].get.security).toEqual([
      { bearerAuth: [] },
      { apiKeyAuth: [] },
    ])
    expect(generated.paths['/v2/admin/users/{userId}/sessions/{sessionId}'].get.security).toEqual([
      { bearerAuth: ['admin'] },
    ])
  })

  test('parameters survive with their location, requiredness and description', () => {
    const normGenerated = normalize(generated)
    for (const { path, method, op } of operations(normalize(original))) {
      const genParams: any[] = normGenerated.paths[path]?.[method]?.parameters || []
      for (const p of op.parameters || []) {
        // Cookie parameters have no slot in RequestSchema. A `content`-typed
        // parameter keeps its shape but is re-emitted under `schema`, so there
        // is no source-side `schema` to compare against here.
        if (p.in === 'cookie' || !p.schema) continue
        const gen = genParams.find(g => g.name === p.name && g.in === p.in)
        expect(gen, `${method} ${path} parameter ${p.in}:${p.name} is missing`).toBeDefined()
        if (p.in === 'path') expect(gen.required, `${method} ${path} ${p.name}`).toBe(true)
        else expect(gen.required, `${method} ${path} ${p.name}`).toBe(p.required || undefined)
        expect(gen.description, `${method} ${path} ${p.name}`).toBe(p.description)
        expect(gen.deprecated, `${method} ${path} ${p.name}`).toBe(p.deprecated)
      }
    }
  })

  test('string constraints survive on parameters', () => {
    const params: any[] = generated.paths['/primitives'].get.parameters
    const byName = (n: string) => params.find(p => p.name === n).schema
    expect(byName('plainString')).toMatchObject({ type: 'string' })
    expect(byName('boundedString')).toMatchObject({
      type: 'string',
      minLength: 3,
      maxLength: 24,
      pattern: '^[a-z][a-z0-9_-]*$',
    })
    expect(byName('formattedString')).toMatchObject({ type: 'string', format: 'date-time' })
    expect(byName('defaultedString')).toMatchObject({ type: 'string', default: 'fallback' })
    expect(byName('enumString')).toMatchObject({ type: 'string', enum: ['alpha', 'beta', 'gamma'] })
    expect(byName('singleEnumString')).toMatchObject({ type: 'string', enum: ['only'] })
    expect(byName('anySchema').type).toBeUndefined()
  })

  test('numeric bounds and array constraints survive on parameters', () => {
    const params: any[] = generated.paths['/primitives'].get.parameters
    const byName = (n: string) => params.find(p => p.name === n).schema
    expect(byName('boundedInteger')).toMatchObject({ type: 'integer', minimum: 0, maximum: 100 })
    expect(byName('boundedNumber')).toMatchObject({ type: 'number', minimum: -1.5, maximum: 1.5 })
    expect(byName('flag')).toMatchObject({ type: 'boolean', default: false })
    expect(byName('stringList')).toMatchObject({
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 10,
      uniqueItems: true,
    })
  })

  test('component schemas survive with their constraints', () => {
    const s = generated.components.schemas
    for (const name of Object.keys(original.components.schemas)) expect(s, `${name} is missing`).toHaveProperty(name)

    expect(s.PrimitiveBag.type).toBe('object')
    expect(s.PrimitiveBag.title).toBe('Primitive bag')
    expect(s.PrimitiveBag.required.sort()).toEqual(['bool', 'int', 'list', 'num', 'obj', 'str'])
    expect(s.PrimitiveBag.properties.str).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 64,
      pattern: '^[A-Za-z0-9 ]+$',
    })
    expect(s.PrimitiveBag.properties.list).toMatchObject({ type: 'array', minItems: 0, maxItems: 100, uniqueItems: true })
    expect(s.PrimitiveBag.properties.defaulted.default).toBe('none')
    expect(s.PrimitiveBag.properties.exampled.example).toBe('sample-value')
    // a property with no type at all keeps its description and gains no type
    expect(s.Error.properties.details.type).toBeUndefined()
    expect(s.Error.properties.details.description).toBe('Free-form, no type on purpose.')
  })

  test('every string format survives', () => {
    const props = generated.components.schemas.StringFormats.properties
    for (const [name, expected] of Object.entries(original.components.schemas.StringFormats.properties))
      expect(props[name].format, name).toBe((expected as any).format)
  })

  test('allOf, oneOf and anyOf survive as composition', () => {
    const s = generated.components.schemas
    expect(s.Widget.allOf).toHaveLength(2)
    expect(s.Widget.allOf[0]).toEqual({ $ref: '#/components/schemas/Identified' })
    expect(s.Widget.allOf[1].properties.kind).toMatchObject({ type: 'string', enum: ['bolt', 'nut', 'washer'], default: 'bolt' })

    const body = generated.paths['/composition'].post.requestBody.content['application/json'].schema
    expect(body.properties.intersected.allOf).toEqual([
      { $ref: '#/components/schemas/Identified' },
      { $ref: '#/components/schemas/Timestamped' },
    ])
    expect(body.properties.union.oneOf).toEqual([
      { $ref: '#/components/schemas/Cat' },
      { $ref: '#/components/schemas/Dog' },
    ])
    // a union of non-literals stays an anyOf rather than collapsing to an enum
    expect(body.properties.loose.anyOf).toEqual([{ type: 'string' }, { type: 'integer' }])
    expect(body.required.sort()).toEqual(['intersected', 'loose', 'union'])
  })

  test('a discriminator becomes an explicit union of tagged variants', () => {
    // Galbe has no discriminator primitive: the mapping is expanded into
    // `anyOf` of `allOf(literal tag, variant)`, which validates the same way.
    const pet = generated.components.schemas.Pet
    expect(pet.anyOf).toHaveLength(2)
    for (const [i, [tag, ref]] of [
      ['cat', '#/components/schemas/Cat'],
      ['dog', '#/components/schemas/Dog'],
    ].entries()) {
      expect(pet.anyOf[i].allOf[0].properties.petType).toEqual({ type: 'string', enum: [tag] })
      expect(pet.anyOf[i].allOf[1]).toEqual({ $ref: ref })
    }
  })

  test('nested objects and arrays survive at depth', () => {
    const n = generated.components.schemas.Nested
    expect(n.properties.root.properties.branches.items.properties.leaves).toMatchObject({
      type: 'array',
      items: { type: 'array', items: { type: 'string' } },
    })
    expect(n.properties.matrix).toMatchObject({ type: 'array', items: { type: 'array', items: { type: 'number' } } })
  })

  test('nullable and optional stay distinguishable', () => {
    const b = generated.components.schemas.NullableBag
    expect(b.required).toEqual(['requiredNullable'])
    expect(b.properties.requiredNullable.nullable).toBe(true)
    expect(b.properties.optionalNullable.nullable).toBe(true)
    expect(b.properties.optionalNonNullable.nullable).toBeUndefined()
    expect(b.properties.nullableArray).toMatchObject({ type: 'array', nullable: true })
  })

  test('request bodies survive with their media types and requiredness', () => {
    const multi = generated.paths['/bodies/multi'].post.requestBody
    expect(multi.required).toBe(true)
    expect(Object.keys(multi.content).sort()).toEqual([
      'application/json',
      'application/octet-stream',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'text/plain',
    ])
    expect(multi.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/Widget' })
    expect(multi.content['application/octet-stream'].schema).toMatchObject({ type: 'string', format: 'binary' })
    expect(multi.content['text/plain'].schema).toMatchObject({ type: 'string' })

    const form = multi.content['multipart/form-data'].schema
    expect(form.type).toBe('object')
    expect(form.required).toEqual(['file'])
    expect(form.properties.file).toMatchObject({ type: 'string', format: 'binary' })
    expect(form.properties.tags).toMatchObject({ type: 'array', items: { type: 'string' } })

    expect(generated.paths['/bodies/json'].post.requestBody.required).toBe(true)
    expect(generated.paths['/bodies/optional'].post.requestBody.required).toBe(false)
  })

  test('response statuses and descriptions survive', () => {
    const statuses = generated.paths['/responses/statuses'].get.responses
    // 5XX is the one status shape Galbe cannot express; it lands on `default`
    expect(Object.keys(statuses).sort()).toEqual(['200', '201', '204', '301', '304', '400', '401', '404', '500'])
    expect(statuses['200'].description).toBe('OK with a body.')
    expect(statuses['204'].description).toBe('No content at all.')
    expect(statuses['500'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/Error' })
    expect(generated.paths['/responses/default'].get.responses.default.description).toBe('Anything at all.')
  })

  test('bodiless 204 and 304 responses stay bodiless', () => {
    const statuses = generated.paths['/responses/statuses'].get.responses
    expect(statuses['204'].content).toBeUndefined()
    expect(statuses['304'].content).toBeUndefined()
    expect(generated.paths['/meta/bare'].get.responses['204'].content).toBeUndefined()
    expect(generated.paths['/primitives/{id}'].delete.responses['204'].content).toBeUndefined()
  })

  test('responses that alias a component schema keep their $ref', () => {
    expect(generated.paths['/primitives/{id}'].get.responses['404']).toEqual({
      $ref: '#/components/responses/NotFound',
    })
    expect(generated.paths['/security/bearer'].get.responses['401']).toEqual({
      $ref: '#/components/responses/Unauthorized',
    })
    const nf = generated.components.responses.NotFound
    expect(nf.description).toBe('The resource does not exist.')
    expect(nf.content['application/json'].example).toEqual({ code: 'not_found', message: 'no such widget' })
  })

  test('response headers survive with their type and requiredness', () => {
    const h = generated.paths['/responses/headers'].get.responses['200'].headers
    expect(h['X-Request-Id']).toMatchObject({ required: true, schema: { type: 'string', format: 'uuid' } })
    expect(h['X-Request-Id'].description).toBe('Correlation id.')
    expect(h['X-Rate-Limit'].required).toBeUndefined()
    expect(h['X-Rate-Limit'].schema.type).toBe('integer')
    expect(h['X-Cached'].schema.type).toBe('boolean')
    expect(generated.paths['/responses/links'].post.responses['201'].headers.Location).toMatchObject({
      required: true,
      schema: { type: 'string', format: 'uri' },
    })
    expect(generated.paths['/primitives/{id}'].options.responses['204'].headers.Allow).toMatchObject({
      required: true,
      schema: { type: 'string' },
    })
  })

  test('response examples survive, single and named', () => {
    const r = generated.paths['/responses/examples'].get.responses
    expect(r['200'].content['application/json'].example).toEqual({ id: 'w_1', name: 'Bolt', size: 3 })
    const named = r['409'].content['application/json'].examples
    expect(Object.keys(named).sort()).toEqual(['duplicate', 'fromComponents', 'locked'])
    expect(named.duplicate.value).toEqual({ code: 'duplicate', message: 'widget already exists' })
  })

  test('a response offering several media types keeps all of them', () => {
    const content = generated.paths['/responses/media'].get.responses['200'].content
    expect(Object.keys(content).sort()).toEqual([
      'application/json',
      'application/octet-stream',
      'text/html',
      'text/plain',
    ])
    expect(content['application/json'].schema).toEqual({ $ref: '#/components/schemas/Widget' })
    expect(content['application/octet-stream'].schema).toMatchObject({ type: 'string', format: 'binary' })
  })

  test('parameters shared by several operations are promoted to components', () => {
    const p = generated.components.parameters
    expect(p).toHaveProperty('Page')
    expect(p).toHaveProperty('PageSize')
    expect(p.Page.schema).toMatchObject({ type: 'integer', minimum: 1, default: 1 })
    expect(p.PageSize.schema).toMatchObject({ type: 'integer', minimum: 1, maximum: 100, default: 25 })
    expect(generated.paths['/params/shared'].get.parameters).toEqual([
      { $ref: '#/components/parameters/Page' },
      { $ref: '#/components/parameters/PageSize' },
    ])
  })

  test('security schemes declared in GalbeConfig survive verbatim', () => {
    expect(generated.components.securitySchemes).toEqual(original.components.securitySchemes)
    // a declared scheme wins over the one inferred from an Authorization header
    expect(generated.components.securitySchemes.bearerAuth.bearerFormat).toBe('JWT')
  })
})
