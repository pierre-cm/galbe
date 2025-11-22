import { describe, expect, it } from 'bun:test'
import { parseCookie, stringifyCookie, readCookies } from '../src/cookies'

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
})
