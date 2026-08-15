import { describe, expect, it, test, beforeAll, afterAll } from 'bun:test'
import { parseCookie, stringifyCookie, readCookies } from '../src/cookies'
import { Galbe, BadRequestError, $T } from '../src'

describe('cookies schema', () => {
    const port = 7373
    const g = new Galbe()

    g.get(
        '/typed',
        {
            cookies: {
                session: $T.string({ minLength: 3 }),
                visits: $T.integer({ min: 0 }),
                beta: $T.optional($T.boolean()),
            },
        },
        ctx => {
            // declared cookies come back parsed and typed
            const visits: number = ctx.cookies.visits
            const session: string = ctx.cookies.session
            return { session, visits, beta: ctx.cookies.beta, extra: (ctx.cookies as any).extra }
        }
    )

    beforeAll(async () => {
        await g.listen(port)
    })
    afterAll(() => {
        g.stop()
    })

    const get = (cookie: string) => fetch(`http://localhost:${port}/typed`, { headers: { cookie } })

    test('declared cookies are parsed to their schema type', async () => {
        const resp = await get('session=abcdef; visits=3')
        expect(resp.status).toBe(200)
        expect(await resp.json()).toEqual({ session: 'abcdef', visits: 3, beta: undefined, extra: undefined })
    })

    test('undeclared cookies survive as raw strings', async () => {
        const resp = await get('session=abcdef; visits=3; extra=kept')
        expect(await resp.json()).toMatchObject({ extra: 'kept' })
    })

    test('a cookie that violates its schema is a 400', async () => {
        const resp = await get('session=ab; visits=3')
        expect(resp.status).toBe(400)
        expect(await resp.json()).toEqual({ cookies: { session: 'Length is too small (3 char min)' } })
    })

    test('a missing required cookie is a 400', async () => {
        const resp = await get('visits=3')
        expect(resp.status).toBe(400)
        expect(await resp.json()).toEqual({ cookies: { session: 'Required' } })
    })

    test('an optional cookie may be absent', async () => {
        const resp = await get('session=abcdef; visits=0')
        expect(resp.status).toBe(200)
        expect(await resp.json()).toMatchObject({ visits: 0 })
    })
})

describe('Cookies', () => {
    describe('readCookies', () => {
        it('should read simple cookies', () => {
            const cookies = readCookies('foo=bar; baz=qux')
            expect(cookies).toEqual({ foo: 'bar', baz: 'qux' })
        })

        it('should handle values with equals sign', () => {
            const cookies = readCookies('foo=bar=baz')
            expect(cookies).toEqual({ foo: 'bar=baz' })
        })
    })

    describe('parseCookie', () => {
        it('should parse simple cookie', () => {
            const cookie = parseCookie('foo=bar')
            expect(cookie).toEqual({ name: 'foo', value: 'bar', path: '/' })
        })

        it('should parse cookie with attributes', () => {
            const cookie = parseCookie('foo=bar; Path=/baz; HttpOnly; Secure; SameSite=Lax')
            expect(cookie).toEqual({
                name: 'foo',
                value: 'bar',
                path: '/baz',
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
            })
        })

        it('should handle case-insensitive SameSite', () => {
            const cookie = parseCookie('foo=bar; SameSite=strict')
            expect(cookie.sameSite).toBe('strict')
        })

        it('should default SameSite to true (Lax) if invalid', () => {
            // Current implementation defaults to true for unknown values
            const cookie = parseCookie('foo=bar; SameSite=Invalid')
            expect(cookie.sameSite).toBe(true)
        })
    })

    describe('stringifyCookie', () => {
        it('should stringify simple cookie', () => {
            const str = stringifyCookie('foo', 'bar')
            expect(str).toBe('foo=bar; path=/;')
        })

        it('should stringify cookie with attributes', () => {
            const str = stringifyCookie('foo', 'bar', {
                path: '/baz',
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
            })
            expect(str).toBe('foo=bar; path=/baz; Secure; SameSite=Lax; HttpOnly;')
        })

        it('should stringify cookie with SameSite=None', () => {
            const str = stringifyCookie('foo', 'bar', {
                path: '/',
                sameSite: 'none',
                secure: true
            })
            expect(str).toBe('foo=bar; path=/; Secure; SameSite=None;')
        })
    })

    describe('encoding', () => {
        const specials = ['hello world', 'a;b', 'a=b', '"quoted"', 'héllo ✓', 'line1\r\nline2', '100%']

        it('round-trips special characters through stringifyCookie → readCookies', () => {
            for (const value of specials) {
                const pair = stringifyCookie('name', value).split(';')[0]!
                expect(readCookies(pair)).toEqual({ name: value })
            }
        })

        it('round-trips special characters in names', () => {
            const pair = stringifyCookie('wéird name', 'v').split(';')[0]!
            expect(readCookies(pair)).toEqual({ 'wéird name': 'v' })
        })

        it('parseCookie decodes stringified cookies', () => {
            const cookie = parseCookie(stringifyCookie('foo', 'hello; wörld'))
            expect(cookie.name).toBe('foo')
            expect(cookie.value).toBe('hello; wörld')
        })

        it('readCookies tolerates malformed percent-encoding', () => {
            expect(readCookies('foo=%E0%A4%A; bar=%zz')).toEqual({ foo: '%E0%A4%A', bar: '%zz' })
        })

        it('throws BadRequestError on unencodable name or value', () => {
            expect(() => stringifyCookie('foo', '\ud800')).toThrow(BadRequestError)
            expect(() => stringifyCookie('\ud800', 'bar')).toThrow(BadRequestError)
        })

        it('throws BadRequestError on control characters in path', () => {
            expect(() => stringifyCookie('foo', 'bar', { path: '/\r\nSet-Cookie: hax=1' })).toThrow(BadRequestError)
        })
    })

    describe('ctx.set.cookie', () => {
        const port = 7364
        const g = new Galbe()

        g.get('/cookie/simple', ctx => {
            ctx.set.cookie('foo', 'bar')
            return 'ok'
        })
        g.get('/cookie/options', ctx => {
            ctx.set.cookie('foo', 'bar', { httpOnly: true, secure: true, sameSite: 'lax' })
            return 'ok'
        })
        g.get('/cookie/no-path', ctx => {
            // Regression: `path` must be optional in CookieOptions
            ctx.set.cookie('foo', 'bar', { httpOnly: true })
            return 'ok'
        })
        g.get('/cookie/multiple', ctx => {
            ctx.set.cookie('a', '1')
            ctx.set.cookie('b', '2', { path: '/scoped' })
            return 'ok'
        })
        g.get('/cookie/read', ctx => {
            return ctx.cookies
        })
        g.get('/cookie/special', ctx => {
            ctx.set.cookie('sp', 'a b;c=d\r\n✓')
            return 'ok'
        })
        g.get('/cookie/bad-value', ctx => {
            ctx.set.cookie('bad', '\ud800')
            return 'ok'
        })
        g.get('/cookie/bad-path', ctx => {
            ctx.set.cookie('x', 'y', { path: '/\r\nX-Injected: 1' })
            return 'ok'
        })

        beforeAll(async () => {
            await g.listen(port)
        })
        afterAll(() => {
            g.stop()
        })

        test('sets a simple cookie', async () => {
            const resp = await fetch(`http://localhost:${port}/cookie/simple`)
            expect(resp.status).toBe(200)
            expect(resp.headers.getSetCookie()).toEqual(['foo=bar; path=/;'])
            await resp.body?.cancel()
        })

        test('sets a cookie with options', async () => {
            const resp = await fetch(`http://localhost:${port}/cookie/options`)
            expect(resp.status).toBe(200)
            expect(resp.headers.getSetCookie()).toEqual([
                'foo=bar; path=/; Secure; SameSite=Lax; HttpOnly;',
            ])
            await resp.body?.cancel()
        })

        test('options object without path defaults to /', async () => {
            const resp = await fetch(`http://localhost:${port}/cookie/no-path`)
            expect(resp.status).toBe(200)
            expect(resp.headers.getSetCookie()).toEqual(['foo=bar; path=/; HttpOnly;'])
            await resp.body?.cancel()
        })

        test('sets multiple cookies', async () => {
            const resp = await fetch(`http://localhost:${port}/cookie/multiple`)
            expect(resp.status).toBe(200)
            expect(resp.headers.getSetCookie()).toEqual(['a=1; path=/;', 'b=2; path=/scoped;'])
            await resp.body?.cancel()
        })

        test('reads request cookies into ctx.cookies', async () => {
            const resp = await fetch(`http://localhost:${port}/cookie/read`, {
                headers: { cookie: 'session=abc; theme=dark' },
            })
            expect(resp.status).toBe(200)
            expect(await resp.json()).toEqual({ session: 'abc', theme: 'dark' })
        })

        test('special characters round-trip through Set-Cookie and back', async () => {
            const resp = await fetch(`http://localhost:${port}/cookie/special`)
            expect(resp.status).toBe(200)
            const pair = resp.headers.getSetCookie()[0]!.split(';')[0]!
            await resp.body?.cancel()
            const read = await fetch(`http://localhost:${port}/cookie/read`, { headers: { cookie: pair } })
            expect(read.status).toBe(200)
            expect(await read.json()).toEqual({ sp: 'a b;c=d\r\n✓' })
        })

        test('unencodable cookie value yields a controlled 400', async () => {
            const resp = await fetch(`http://localhost:${port}/cookie/bad-value`)
            expect(resp.status).toBe(400)
            expect(await resp.text()).toBe('Invalid cookie value')
        })

        test('control characters in cookie path yield a controlled 400', async () => {
            const resp = await fetch(`http://localhost:${port}/cookie/bad-path`)
            expect(resp.status).toBe(400)
            await resp.body?.cancel()
        })
    })
})
