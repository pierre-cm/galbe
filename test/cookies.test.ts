import { describe, expect, it, test, beforeAll, afterAll } from 'bun:test'
import { parseCookie, stringifyCookie, readCookies } from '../src/cookies'
import { Galbe } from '../src'

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
    })
})
