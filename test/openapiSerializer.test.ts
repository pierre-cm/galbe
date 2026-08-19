import { describe, test, expect } from 'bun:test'
import { Galbe, $T } from '../src'
import { OpenAPISerializer } from '../src/extras/spec/openapi.serializer'

describe('openapi serializer', () => {
  test('uses default info block when no openapi config is set', async () => {
    const g = new Galbe()
    g.get('/items', () => [])

    const spec = await OpenAPISerializer(g)
    expect(spec.info).toMatchObject({ title: 'Galbe app', version: '0.1.0' })
    expect(spec.servers).toBeUndefined()
  })

  test('merges config.openapi info and servers into the spec', async () => {
    const g = new Galbe({
      openapi: {
        info: {
          title: 'My API',
          version: '2.3.4',
          description: 'An API with a custom info block',
          contact: { name: 'Jane Doe', email: 'jane@example.com' },
          license: { name: 'MIT' },
          termsOfService: 'https://example.com/tos',
        },
        servers: [{ url: 'https://api.example.com/v1', description: 'production' }],
      },
    })
    g.get('/items', () => [])

    const spec = await OpenAPISerializer(g)
    expect(spec.info).toEqual({
      title: 'My API',
      version: '2.3.4',
      description: 'An API with a custom info block',
      contact: { name: 'Jane Doe', email: 'jane@example.com' },
      license: { name: 'MIT' },
      termsOfService: 'https://example.com/tos',
    })
    expect(spec.servers).toEqual([{ url: 'https://api.example.com/v1', description: 'production' }])
  })

  test('partial info config keeps defaults for unset fields', async () => {
    const g = new Galbe({ openapi: { info: { title: 'Only Title' } } })
    g.get('/items', () => [])

    const spec = await OpenAPISerializer(g)
    expect(spec.info).toMatchObject({ title: 'Only Title', version: '0.1.0' })
  })

  test('emits minItems/maxItems/uniqueItems for arrays from minLength/maxLength/unique', async () => {
    // ArrayOptions exposes minLength/maxLength on the schema-builder side; the
    // serializer must translate those to minItems/maxItems on the OpenAPI side.
    const g = new Galbe()
    g.get('/items', { query: { tags: $T.array($T.string(), { minLength: 1, maxLength: 5, unique: true }) } }, () => [])

    const spec = await OpenAPISerializer(g)
    const op = (spec.paths!['/items'] as any).get
    const param = op.parameters!.find((p: any) => p.name === 'tags')!
    expect(param.schema).toMatchObject({ type: 'array', minItems: 1, maxItems: 5, uniqueItems: true })
  })

  test('query parameters declare only the serialization Galbe actually implements', async () => {
    const g = new Galbe()
    g.get(
      '/q',
      {
        query: {
          filter: $T.object({ lat: $T.number() }),
          piped: $T.array($T.string(), { split: '|' }),
          spaced: $T.array($T.string(), { split: ' ' }),
          tags: $T.array($T.string()),
          exact: $T.array($T.string(), { split: false }),
          name: $T.string(),
        },
      },
      () => []
    )

    const spec = await OpenAPISerializer(g)
    const params = (spec.paths!['/q'] as any).get.parameters!
    const param = (name: string) => params.find((p: any) => p.name === name)!
    expect(param('filter')).toMatchObject({ in: 'query', style: 'deepObject', explode: true })
    expect(param('piped')).toMatchObject({ style: 'pipeDelimited' })
    expect(param('spaced')).toMatchObject({ style: 'spaceDelimited' })
    // form/explode:true is the default *and* both forms are accepted: nothing to say
    expect(param('tags')).not.toHaveProperty('style')
    expect(param('exact')).not.toHaveProperty('style')
    expect(param('name')).not.toHaveProperty('style')
  })

  test('declared cookies become in: cookie parameters', async () => {
    const g = new Galbe()
    g.get(
      '/session',
      { cookies: { session: $T.string({ description: 'Session cookie.' }), theme: $T.optional($T.string()) } },
      () => 'ok'
    )

    const spec = await OpenAPISerializer(g)
    const params = (spec.paths!['/session'] as any).get.parameters!
    expect(params.find((p: any) => p.name === 'session')).toMatchObject({
      name: 'session',
      in: 'cookie',
      description: 'Session cookie.',
      required: true,
      schema: { type: 'string' },
    })
    // the description belongs to the parameter, not to a copy on its schema
    expect(params.find((p: any) => p.name === 'session').schema).not.toHaveProperty('description')
    expect(params.find((p: any) => p.name === 'theme').required).toBeUndefined()
  })

  test('@summary and @description override the JSDoc head split', async () => {
    const g = new Galbe()
    g.meta = [
      {
        file: 'f.route.ts',
        header: {},
        routes: {
          '/head': { get: { head: 'A summary\n\nA description.' } },
          '/override': { get: { head: 'Ignored head', summary: 'Explicit summary', description: 'Explicit body.' } },
          // the case the head convention cannot express
          '/description-only': { get: { summary: true, description: 'Only a description.' } },
          '/multiline': { get: { description: ['first line', 'second line'] } },
        },
      },
    ]
    for (const p of ['/head', '/override', '/description-only', '/multiline']) g.get(p, () => 'x')

    const spec = await OpenAPISerializer(g)
    const op = (p: string) => (spec.paths![p] as any).get
    expect(op('/head')).toMatchObject({ summary: 'A summary', description: 'A description.' })
    expect(op('/override')).toMatchObject({ summary: 'Explicit summary', description: 'Explicit body.' })
    expect(op('/description-only')).toMatchObject({ summary: '', description: 'Only a description.' })
    expect(op('/multiline').description).toBe('first line\nsecond line')
  })

  test('wildcard status ranges survive as their own response keys', async () => {
    const g = new Galbe()
    g.get(
      '/range',
      {
        response: {
          200: $T.object({ ok: $T.boolean() }),
          '4XX': $T.object({ code: $T.string() }),
          '5XX': { 'application/json': $T.object({ code: $T.string() }), description: 'Any server error.' },
        },
      },
      () => ({ ok: true })
    )

    const spec = await OpenAPISerializer(g)
    const responses = (spec.paths!['/range'] as any).get.responses
    expect(Object.keys(responses).sort()).toEqual(['200', '4XX', '5XX'])
    // no HttpStatus reason phrase exists for a range, so it gets a range description
    expect(responses['4XX'].description).toBe('Client error')
    expect(responses['5XX'].description).toBe('Any server error.')
    expect(responses['4XX'].content['application/json'].schema).toMatchObject({ type: 'object' })
  })

  test('emits additionalProperties for records, mixed objects and strict objects', async () => {
    const g = new Galbe()
    g.post(
      '/maps',
      {
        body: {
          'application/json': $T.object({
            map: $T.record($T.string()),
            mixed: $T.object({ id: $T.string() }, { additionalProperties: $T.integer() }),
            strict: $T.object({ id: $T.string() }, { additionalProperties: false }),
            open: $T.object({ id: $T.string() }),
          }),
        },
      },
      () => null
    )

    const spec = await OpenAPISerializer(g)
    const props = (spec.paths!['/maps'] as any).post.requestBody.content['application/json'].schema.properties
    expect(props.map).toEqual({ type: 'object', additionalProperties: { type: 'string' } })
    expect(props.mixed).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: { type: 'integer' },
    })
    expect(props.strict).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    })
    // unset stays unset: the OpenAPI default is permissive too
    expect(props.open).not.toHaveProperty('additionalProperties')
  })

  test('emits format and multipleOf for numbers and integers', async () => {
    const g = new Galbe()
    g.get(
      '/nums',
      {
        query: {
          count: $T.integer({ format: 'int32', min: 0 }),
          ratio: $T.number({ format: 'double', multipleOf: 0.25 }),
        },
      },
      () => []
    )

    const spec = await OpenAPISerializer(g)
    const params = (spec.paths!['/nums'] as any).get.parameters!
    const param = (name: string) => params.find((p: any) => p.name === name)!
    expect(param('count').schema).toEqual({ type: 'integer', format: 'int32', minimum: 0 })
    expect(param('ratio').schema).toEqual({ type: 'number', format: 'double', multipleOf: 0.25 })
  })

  test('null schema emits OpenAPI 3.0 nullable form', async () => {
    // A genuine JSON `null` body is spelled through the content map — a bare
    // `$T.null()` response means "no body" (see the test below).
    const g = new Galbe()
    g.get('/n', { response: { 200: { 'application/json': $T.null() } } }, () => null)

    const spec = await OpenAPISerializer(g)
    const resp = (spec.paths!['/n'] as any).get.responses['200']
    const schema = resp.content['application/json'].schema
    expect(schema).toMatchObject({ nullable: true, enum: [null] })
    // No bogus `anyOf: ['null']` (string in array).
    expect(schema.anyOf).toBeUndefined()
  })

  test('a bare null response schema means "no body", at every status', async () => {
    // 204 and 304 forbid a body outright, but "no body" is a claim an operation
    // can make at any status — and the parser emits `$T.null()` for exactly
    // that. Gating it on the status left 200/202/301 with a JSON `null` body
    // nobody asked for.
    const g = new Galbe()
    g.get('/n', { response: { 200: $T.null({ description: 'Exists.' }), 204: $T.null(), 301: $T.null() } }, () => null)

    const spec = await OpenAPISerializer(g)
    const responses = (spec.paths!['/n'] as any).get.responses
    for (const status of ['200', '204', '301']) expect(responses[status].content).toBeUndefined()
    expect(responses['200'].description).toBe('Exists.')
  })

  test('basePath is stripped from paths and surfaced via servers', async () => {
    const g = new Galbe({ basePath: '/base' })
    g.get('/items', () => [])

    const spec = await OpenAPISerializer(g)
    expect(spec.paths).toHaveProperty('/items')
    expect(spec.paths).not.toHaveProperty('/base/items')
    expect(spec.servers).toEqual([{ url: '/base' }])
  })

  test('explicit servers config wins over the basePath default', async () => {
    const g = new Galbe({ basePath: '/base', openapi: { servers: [{ url: 'https://api.example.com' }] } })
    g.get('/items', () => [])

    const spec = await OpenAPISerializer(g)
    expect(spec.servers).toEqual([{ url: 'https://api.example.com' }])
  })

  test('meta applies under basePath (tags, hide)', async () => {
    // Regression: meta keys are relative to basePath while route paths carry
    // it; meta used to be silently dropped whenever basePath was set.
    const g = new Galbe({ basePath: '/base' })
    g.meta = [
      {
        file: 'f.route.ts',
        header: {},
        routes: {
          '/items': { get: { tags: 'shop', summary: 'List items' } },
          '/internal': { get: { hide: true } },
        },
      },
    ]
    g.get('/items', () => [])
    g.get('/internal', () => 'x')

    const spec = await OpenAPISerializer(g)
    expect((spec.paths['/items'] as any).get.tags).toEqual(['shop'])
    expect(spec.paths).not.toHaveProperty('/internal')
  })

  test('route-file @security and @tags apply to every route the file declares', async () => {
    const g = new Galbe()
    g.meta = [
      {
        file: 'admin.route.ts',
        header: { tags: 'admin', security: 'apiKey' },
        routes: {
          '/admin/items': { get: {} },
          '/admin/open': { get: { security: 'none' } },
          '/admin/tagged': { get: { tags: 'reports' } },
        },
      },
      // a second file with no header must not inherit the first one's
      { file: 'public.route.ts', header: {}, routes: { '/public': { get: {} } } },
    ]
    for (const p of ['/admin/items', '/admin/open', '/admin/tagged', '/public']) g.get(p, () => 'x')

    const spec = await OpenAPISerializer(g)
    const op = (p: string) => (spec.paths![p] as any).get
    expect(op('/admin/items')).toMatchObject({ tags: ['admin'], security: [{ apiKey: [] }] })
    // route-level metadata still wins, including the 'none' escape
    expect(op('/admin/open').security).toEqual([])
    // tags accumulate, nearest first
    expect(op('/admin/tagged').tags).toEqual(['reports', 'admin'])
    // another file's header does not leak
    expect(op('/public').tags).toBeUndefined()
    expect(op('/public').security).toBeUndefined()
  })

  test('a route file header loses to the route and wins over the middleware scope', async () => {
    const g = new Galbe()
    g.metaMiddleware.push({
      file: 'auth.middleware.ts',
      scope: '/api/*',
      header: { security: 'bearerAuth', tags: 'api' },
    })
    g.meta = [
      {
        file: 'f.route.ts',
        header: { security: 'apiKey', tags: 'file' },
        routes: { '/api/a': { get: {} }, '/api/b': { get: { security: 'oauth2' } } },
      },
    ]
    g.get('/api/a', () => 'a')
    g.get('/api/b', () => 'b')

    const spec = await OpenAPISerializer(g)
    const op = (p: string) => (spec.paths![p] as any).get
    expect(op('/api/a').security).toEqual([{ apiKey: [] }])
    expect(op('/api/b').security).toEqual([{ oauth2: [] }])
    // tags are a union across all three scopes
    expect(op('/api/a').tags).toEqual(['file', 'api'])
  })

  test('middleware-file @security and @tags apply to the file scope', async () => {
    const g = new Galbe()
    g.metaMiddleware.push({
      file: 'auth.middleware.ts',
      scope: '/api/*',
      header: { security: 'bearerAuth', tags: 'api' },
    })
    g.meta = [
      {
        file: 'f.route.ts',
        header: {},
        routes: {
          '/api/open': { get: { security: 'none' } },
          '/api/custom': { get: { security: 'apiKey', tags: 'custom' } },
        },
      },
    ]
    g.get('/api/items', () => [])
    g.get('/api/open', () => 'open')
    g.get('/api/custom', () => 'custom')
    g.get('/health', () => 'ok')

    const spec = await OpenAPISerializer(g)
    const op = (p: string) => (spec.paths[p] as any).get
    // inherited from the middleware file scope
    expect(op('/api/items').security).toEqual([{ bearerAuth: [] }])
    expect(op('/api/items').tags).toEqual(['api'])
    // route-level meta wins, including the 'none' escape
    expect(op('/api/open').security).toEqual([])
    expect(op('/api/custom').security).toEqual([{ apiKey: [] }])
    expect(op('/api/custom').tags).toEqual(['custom', 'api'])
    // outside the scope: untouched
    expect(op('/health').security).toBeUndefined()
    expect(op('/health').tags).toBeUndefined()
  })

  test("a code-registered middleware's security documents like a middleware file's @security", async () => {
    const g = new Galbe()
    g.middleware('/api/*', { security: 'bearerAuth', hooks: (_, next) => next() })
    g.get('/api/items', () => [])
    g.get('/health', () => 'ok')

    const spec = await OpenAPISerializer(g)
    const op = (p: string) => (spec.paths![p] as any).get
    expect(op('/api/items').security).toEqual([{ bearerAuth: [] }])
    // naming bearerAuth is enough to get the scheme defined, as an annotation is
    expect(spec.components?.securitySchemes?.bearerAuth).toEqual({ type: 'http', scheme: 'bearer' })
    // outside the pattern: untouched
    expect(op('/health').security).toBeUndefined()
  })

  test('a def can carry scopes, several requirements and the public escape', async () => {
    const g = new Galbe()
    g.middleware('/api/*', { security: 'oauth2 read write' })
    g.middleware('/alt/*', { security: ['bearerAuth', 'apiKeyAuth'] })
    g.middleware('/open/*', { security: 'none' })
    for (const p of ['/api/items', '/alt/items', '/open/items']) g.get(p, () => [])

    const spec = await OpenAPISerializer(g)
    const op = (p: string) => (spec.paths![p] as any).get
    expect(op('/api/items').security).toEqual([{ oauth2: ['read', 'write'] }])
    // a list is a list of alternatives, exactly like a repeated @security
    expect(op('/alt/items').security).toEqual([{ bearerAuth: [] }, { apiKeyAuth: [] }])
    // 'none' documents the scope as public, not as "nothing declared"
    expect(op('/open/items').security).toEqual([])
  })

  test('an apiKey-shaped def registers its own scheme instead of bearerAuth', async () => {
    const g = new Galbe()
    g.middleware('/api/*', {
      schema: { headers: { 'x-api-key': $T.string() } },
      security: 'apiKeyAuth',
      securitySchemes: { apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' } },
    })
    g.get('/api/items', { query: { page: $T.optional($T.integer()) } }, () => [])

    const spec = await OpenAPISerializer(g)
    const op = (spec.paths!['/api/items'] as any).get
    expect(op.security).toEqual([{ apiKeyAuth: [] }])
    expect(spec.components?.securitySchemes).toEqual({
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
    })
    expect(spec.components?.securitySchemes?.bearerAuth).toBeUndefined()
    // the scheme already says where the credential goes: no duplicate parameter
    expect(op.parameters).toEqual([
      { name: 'page', in: 'query', description: undefined, required: undefined, schema: { type: 'integer' } },
    ])
  })

  test('an http-scheme def drops the fragment authorization header, pattern or not', async () => {
    const g = new Galbe()
    g.middleware('/basic/*', {
      schema: { headers: { authorization: $T.string() } },
      security: 'basicAuth',
      securitySchemes: { basicAuth: { type: 'http', scheme: 'basic' } },
    })
    // a def naming bearerAuth without defining it: the default scheme owns the
    // header just the same, so the fragment's parameter is still dropped
    g.middleware('/jwt/*', {
      schema: { headers: { authorization: $T.string({ pattern: /^Bearer /, format: 'JWT' }) } },
      security: 'bearerAuth',
    })
    g.get('/basic/items', () => [])
    g.get('/jwt/items', () => [])

    const spec = await OpenAPISerializer(g)
    const op = (p: string) => (spec.paths![p] as any).get
    expect(op('/basic/items').security).toEqual([{ basicAuth: [] }])
    expect(op('/basic/items').parameters).toBeUndefined()
    expect(spec.components?.securitySchemes?.basicAuth).toEqual({ type: 'http', scheme: 'basic' })
    expect(op('/jwt/items').security).toEqual([{ bearerAuth: [] }])
    expect(op('/jwt/items').parameters).toBeUndefined()
    // a bearerFormat needs the scheme declared: nothing is inferred from the header
    expect(spec.components?.securitySchemes?.bearerAuth).toEqual({ type: 'http', scheme: 'bearer' })
  })

  test('a def naming its own http scheme leaves no unreferenced bearerAuth behind', async () => {
    const g = new Galbe()
    g.middleware('/api/*', {
      schema: { headers: { authorization: $T.string({ pattern: /^Bearer /, format: 'JWT' }) } },
      security: 'tenantAuth',
      securitySchemes: { tenantAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    })
    g.get('/api/items', () => [])

    const spec = await OpenAPISerializer(g)
    expect(Object.keys(spec.components?.securitySchemes ?? {})).toEqual(['tenantAuth'])
    expect((spec.paths!['/api/items'] as any).get.security).toEqual([{ tenantAuth: [] }])
    expect((spec.paths!['/api/items'] as any).get.parameters).toBeUndefined()
  })

  test('a config-declared scheme wins over a def-declared one of the same name', async () => {
    const g = new Galbe({
      openapi: { securitySchemes: { apiKeyAuth: { type: 'apiKey', in: 'query', name: 'token' } } },
    })
    g.middleware('/api/*', {
      security: 'apiKeyAuth',
      securitySchemes: { apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' } },
    })
    g.get('/api/items', () => [])

    const spec = await OpenAPISerializer(g)
    expect(spec.components?.securitySchemes?.apiKeyAuth).toEqual({ type: 'apiKey', in: 'query', name: 'token' })
  })

  test('route and route-file metadata still override a def, including @security none', async () => {
    const g = new Galbe()
    g.middleware('/api/*', { security: 'bearerAuth' })
    g.meta = [
      {
        file: 'api.route.ts',
        header: {},
        routes: { '/api/open': { get: { security: 'none' } }, '/api/key': { get: { security: 'apiKeyAuth' } } },
      },
      { file: 'other.route.ts', header: { security: 'oauth2' }, routes: { '/api/file': { get: {} } } },
    ]
    for (const p of ['/api/open', '/api/key', '/api/file']) g.get(p, () => [])

    const spec = await OpenAPISerializer(g)
    const op = (p: string) => (spec.paths![p] as any).get
    expect(op('/api/open').security).toEqual([])
    expect(op('/api/key').security).toEqual([{ apiKeyAuth: [] }])
    expect(op('/api/file').security).toEqual([{ oauth2: [] }])
  })

  test('among middleware scopes the nearest one wins, and an annotation beats the def it annotates', async () => {
    const g = new Galbe()
    g.middleware('*', { security: 'globalAuth' })
    g.middleware('/api/*', { security: 'bearerAuth' })
    g.middleware('/api/admin/*', { security: 'adminAuth' })
    // a middleware file: the header annotates the def registered from that file
    g.middleware('/tenant/*', { security: 'defAuth' })
    g.metaMiddleware.push({ file: 'tenant.middleware.ts', scope: '/tenant/*', header: { security: 'headerAuth' } })
    for (const p of ['/free', '/api/items', '/api/admin/users', '/tenant/items']) g.get(p, () => [])

    const spec = await OpenAPISerializer(g)
    const op = (p: string) => (spec.paths![p] as any).get
    expect(op('/free').security).toEqual([{ globalAuth: [] }])
    expect(op('/api/items').security).toEqual([{ bearerAuth: [] }])
    expect(op('/api/admin/users').security).toEqual([{ adminAuth: [] }])
    expect(op('/tenant/items').security).toEqual([{ headerAuth: [] }])
  })

  test('a middleware schema fragment documents like a route-declared schema', async () => {
    const auth = { headers: { authorization: $T.string({ pattern: /^Bearer / }) } }
    const g = new Galbe()
    g.middleware('/api/*', { schema: auth })
    g.get('/api/items', () => [])
    g.get('/declared', auth, () => [])
    g.get('/plain', () => [])

    const spec = await OpenAPISerializer(g)
    const op = (p: string) => (spec.paths[p] as any).get
    expect(op('/api/items')).toEqual(op('/declared'))
    // an authorization header is a header and nothing more: auth is documented
    // by a declared scheme, never inferred from what a header looks like
    expect(op('/api/items').parameters).toMatchObject([{ $ref: '#/components/parameters/Authorization' }])
    expect(spec.components?.parameters?.Authorization).toMatchObject({ name: 'authorization', in: 'header' })
    expect(op('/api/items').security).toBeUndefined()
    expect(spec.components?.securitySchemes).toBeUndefined()
    expect(op('/plain').parameters).toBeUndefined()
  })

  test('a query fragment becomes a documented parameter', async () => {
    const g = new Galbe()
    g.middleware('/api/*', { schema: { query: { page: $T.optional($T.integer()) } } })
    g.get('/api/items', { query: { size: $T.optional($T.integer()) } }, () => [])

    const spec = await OpenAPISerializer(g)
    expect((spec.paths['/api/items'] as any).get.parameters).toMatchObject([
      { name: 'page', in: 'query', schema: { type: 'integer' } },
      { name: 'size', in: 'query', schema: { type: 'integer' } },
    ])
  })

  test('a config-declared scheme owns its credential, so the route header is not documented twice', async () => {
    const g = new Galbe({
      openapi: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    })
    g.middleware('/api/*', { security: 'bearerAuth' })
    g.get('/api/items', { headers: { authorization: $T.string() } }, () => [])
    g.get('/plain', { headers: { authorization: $T.string() } }, () => [])

    const spec = await OpenAPISerializer(g)
    const op = (p: string) => (spec.paths![p] as any).get
    expect(op('/api/items').parameters).toBeUndefined()
    // no requirement on it, so the same header stays an ordinary parameter
    expect(op('/plain').parameters).toMatchObject([{ name: 'authorization', in: 'header' }])
  })
})
