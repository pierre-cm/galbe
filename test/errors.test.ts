import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import {
  Galbe,
  RequestError,
  BadRequestError,
  UnauthorizedError,
  PaymentRequiredError,
  ForbiddenError,
  NotFoundError,
  MethodNotAllowedError,
  NotAcceptableError,
  ProxyAuthenticationRequiredError,
  RequestTimeoutError,
  ConflictError,
  GoneError,
  LengthRequiredError,
  PreconditionFailedError,
  PayloadTooLargeError,
  URITooLongError,
  UnsupportedMediaTypeError,
  RangeNotSatisfiableError,
  ExpectationFailedError,
  ImATeapotError,
  MisdirectedRequestError,
  UnprocessableEntityError,
  LockedError,
  FailedDependencyError,
  UpgradeRequiredError,
  PreconditionRequiredError,
  TooManyRequestsError,
  RequestHeaderFieldsTooLargeError,
  UnavailableForLegalReasonsError,
  InternalServerError,
  InternalError,
  NotImplementedError,
  BadGatewayError,
  ServiceUnavailableError,
  GatewayTimeoutError,
  HTTPVersionNotSupportedError,
  InsufficientStorageError,
  NetworkAuthenticationRequiredError,
} from '../src'

const errorClasses: Array<[new (payload?: any, headers?: Record<string, string>) => RequestError, number, string]> = [
  [BadRequestError, 400, 'BadRequestError'],
  [UnauthorizedError, 401, 'UnauthorizedError'],
  [PaymentRequiredError, 402, 'PaymentRequiredError'],
  [ForbiddenError, 403, 'ForbiddenError'],
  [NotFoundError, 404, 'NotFoundError'],
  [MethodNotAllowedError, 405, 'MethodNotAllowedError'],
  [NotAcceptableError, 406, 'NotAcceptableError'],
  [ProxyAuthenticationRequiredError, 407, 'ProxyAuthenticationRequiredError'],
  [RequestTimeoutError, 408, 'RequestTimeoutError'],
  [ConflictError, 409, 'ConflictError'],
  [GoneError, 410, 'GoneError'],
  [LengthRequiredError, 411, 'LengthRequiredError'],
  [PreconditionFailedError, 412, 'PreconditionFailedError'],
  [PayloadTooLargeError, 413, 'PayloadTooLargeError'],
  [URITooLongError, 414, 'URITooLongError'],
  [UnsupportedMediaTypeError, 415, 'UnsupportedMediaTypeError'],
  [RangeNotSatisfiableError, 416, 'RangeNotSatisfiableError'],
  [ExpectationFailedError, 417, 'ExpectationFailedError'],
  [ImATeapotError, 418, 'ImATeapotError'],
  [MisdirectedRequestError, 421, 'MisdirectedRequestError'],
  [UnprocessableEntityError, 422, 'UnprocessableEntityError'],
  [LockedError, 423, 'LockedError'],
  [FailedDependencyError, 424, 'FailedDependencyError'],
  [UpgradeRequiredError, 426, 'UpgradeRequiredError'],
  [PreconditionRequiredError, 428, 'PreconditionRequiredError'],
  [TooManyRequestsError, 429, 'TooManyRequestsError'],
  [RequestHeaderFieldsTooLargeError, 431, 'RequestHeaderFieldsTooLargeError'],
  [UnavailableForLegalReasonsError, 451, 'UnavailableForLegalReasonsError'],
  [InternalServerError, 500, 'InternalServerError'],
  [NotImplementedError, 501, 'NotImplementedError'],
  [BadGatewayError, 502, 'BadGatewayError'],
  [ServiceUnavailableError, 503, 'ServiceUnavailableError'],
  [GatewayTimeoutError, 504, 'GatewayTimeoutError'],
  [HTTPVersionNotSupportedError, 505, 'HTTPVersionNotSupportedError'],
  [InsufficientStorageError, 507, 'InsufficientStorageError'],
  [NetworkAuthenticationRequiredError, 511, 'NetworkAuthenticationRequiredError'],
]

describe('errors', () => {
  describe('RequestError base', () => {
    test('extends Error', () => {
      const err = new RequestError({ status: 400, payload: 'oops' })
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(RequestError)
      expect(err.name).toBe('RequestError')
      expect(err.status).toBe(400)
      expect(err.payload).toBe('oops')
      expect(err.message).toBe('oops')
      expect(typeof err.stack).toBe('string')
    })

    test('defaults to status 400 / "Bad Request" message when no payload', () => {
      const err = new RequestError()
      expect(err.status).toBe(400)
      expect(err.payload).toBeUndefined()
      expect(err.message).toBe('Bad Request')
    })

    test('non-string payload uses HTTP status name as message', () => {
      const err = new RequestError({ status: 422, payload: { field: 'oops' } })
      expect(err.message).toBe('Unprocessable Entity')
      expect(err.payload).toEqual({ field: 'oops' })
    })

    test('preserves headers', () => {
      const err = new RequestError({ status: 400, headers: { 'x-custom': 'value' } })
      expect(err.headers).toEqual({ 'x-custom': 'value' })
    })

    test('throwable, catchable as Error', () => {
      try {
        throw new RequestError({ status: 418, payload: 'tea' })
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
        expect((e as Error).message).toBe('tea')
      }
    })
  })

  describe('subclasses', () => {
    test.each(errorClasses)('%p — fields and inheritance', (Cls, status, name) => {
      const err = new Cls()
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(RequestError)
      expect(err).toBeInstanceOf(Cls)
      expect(err.status).toBe(status)
      expect(err.name).toBe(name)
      expect(typeof err.message).toBe('string')
      expect(err.message.length).toBeGreaterThan(0)
      expect(typeof err.stack).toBe('string')
    })

    test.each(errorClasses)('%p — defaults payload to HTTP status name', (Cls, _status, _name) => {
      const err = new Cls()
      expect(typeof err.payload).toBe('string')
      expect(err.payload).toBe(err.message)
    })

    test.each(errorClasses)('%p — preserves custom payload + headers', (Cls, status, _name) => {
      const payload = { detail: 'custom', code: status }
      const headers = { 'x-trace': 'abc' }
      const err = new Cls(payload, headers)
      expect(err.payload).toEqual(payload)
      expect(err.headers).toEqual(headers)
    })

    test.each(errorClasses)('%p — string payload becomes message', (Cls, _status, _name) => {
      const err = new Cls('custom message')
      expect(err.message).toBe('custom message')
      expect(err.payload).toBe('custom message')
    })
  })

  test('InternalError is an alias for InternalServerError', () => {
    expect(InternalError).toBe(InternalServerError)
    const err = new InternalError()
    expect(err).toBeInstanceOf(InternalServerError)
    expect(err.status).toBe(500)
  })

  describe('integration: thrown errors yield correct HTTP status', () => {
    const port = 7363
    const g = new Galbe()

    for (const [Cls, status, _name] of errorClasses) {
      g.get(`/throw/${status}`, () => {
        throw new Cls()
      })
    }
    g.get('/throw/with-headers', () => {
      throw new ForbiddenError('nope', { 'x-trace': 'abc' })
    })

    beforeAll(async () => {
      await g.listen(port)
    })
    afterAll(() => {
      g.stop()
    })

    test.each(errorClasses)('%p — server returns matching status', async (_Cls, status, _name) => {
      const resp = await fetch(`http://localhost:${port}/throw/${status}`)
      expect(resp.status).toBe(status)
      await resp.body?.cancel()
    })

    test('custom headers propagate to response', async () => {
      const resp = await fetch(`http://localhost:${port}/throw/with-headers`)
      expect(resp.status).toBe(403)
      expect(resp.headers.get('x-trace')).toBe('abc')
      await resp.body?.cancel()
    })
  })

  describe('integration: async onError handlers', () => {
    const port = 7370
    const g = new Galbe()

    g.get('/boom', () => {
      throw new Error('boom')
    })
    g.onError(async () => {
      await new Promise(r => setTimeout(r, 5))
      return new Response('handled', { status: 418 })
    })
    // a trailing logging handler that returns undefined must not clobber
    // the real handler registered earlier
    g.onError(async () => undefined)

    beforeAll(async () => {
      await g.listen(port)
    })
    afterAll(() => {
      g.stop()
    })

    // async handlers must be awaited; the first non-undefined result wins
    test('async onError result is used', async () => {
      const resp = await fetch(`http://localhost:${port}/boom`)
      expect(resp.status).toBe(418)
      expect(await resp.text()).toBe('handled')
    })
  })

  describe('integration: RequestError responses merge headers and cookies', () => {
    const port = 7371
    const g = new Galbe()

    g.get('/fail', ctx => {
      ctx.set.cookie('session', 'abc')
      ctx.set.headers['x-multi'] = ['1', '2']
      ctx.set.headers['x-single'] = 'one'
      throw new RequestError({ status: 400, payload: 'bad', headers: { 'x-error': 'err' } })
    })

    beforeAll(async () => {
      await g.listen(port)
    })
    afterAll(() => {
      g.stop()
    })

    test('no bogus empty set-cookie, no comma-joined arrays, cookies merged', async () => {
      const resp = await fetch(`http://localhost:${port}/fail`)
      expect(resp.status).toBe(400)
      // context.set.headers always carries a 'set-cookie': [] sentinel — it
      // must not surface as an empty header
      expect(resp.headers.getSetCookie()).toEqual(['session=abc; path=/;'])
      // array-valued headers use append semantics (joined with ', ' by get),
      // not the Headers-constructor stringification ('1,2')
      expect(resp.headers.get('x-multi')).toBe('1, 2')
      expect(resp.headers.get('x-single')).toBe('one')
      expect(resp.headers.get('x-error')).toBe('err')
      await resp.body?.cancel()
    })
  })
})
