import { BadRequestError } from './types'

// encodeURIComponent throws on lone surrogates; surface that as a controlled 400
const encode = (str: string, part: string) => {
  try {
    return encodeURIComponent(str)
  } catch {
    throw new BadRequestError(`Invalid cookie ${part}`)
  }
}
// malformed %XX sequences fall back to the raw string instead of throwing
const decode = (str: string) => {
  try {
    return decodeURIComponent(str)
  } catch {
    return str
  }
}

export type CookieOptions = {
  path?: string
  maxAge?: number
  httpOnly?: boolean
  sameSite?: true | false | 'lax' | 'strict' | 'none'
  secure?: boolean
  domain?: string
  expires?: Date
}
export const parseCookie = (str: string) => {
  type Cookie = {
    name: string
    value: string
  } & CookieOptions
  let cookie: Cookie = { name: '', value: '', path: '/' }
  const entries = str.match(/([^=;\s]+)(?:=([^;]*))?/g)
  if (entries) {
    for (const [idx, entry] of entries.entries()) {
      const [_, key, val] = [...(entry.match(/([^=]+)(?:=(.*))?/) || [])]
      if (idx === 0) {
        cookie.name = decode(key ?? '')
        cookie.value = decode(val ?? '')
      } else {
        switch (key) {
          case 'Path':
            cookie.path = val
            break
          case 'Max-Age':
            if (val !== undefined) cookie.maxAge = parseInt(val)
            break
          case 'HttpOnly':
            cookie.httpOnly = true
            break
          case 'SameSite':
            cookie.sameSite =
              ({ true: true, false: false, lax: 'lax', strict: 'strict', none: 'none' } as const)[
              val?.toLowerCase() || 'true'
              ] || true
            break
          case 'Secure':
            cookie.secure = true
            break
          case 'Domain':
            cookie.domain = val
            break
          case 'Expires':
            if (val !== undefined) cookie.expires = new Date(val)
            break
        }
      }
    }
  }
  return cookie
}
export const stringifyCookie = (name: string, value: string, opt: CookieOptions = { path: '/' }) => {
  const sameSite =
    typeof opt.sameSite === 'string'
      ? ` SameSite=${capitalize(opt.sameSite)};`
      : opt.sameSite === true
        ? ' SameSite=Lax;'
        : ''
  const cookie =
    `${encode(name, 'name')}=${encode(value, 'value')};` +
    ` path=${opt.path || '/'};` +
    (opt.domain ? ` Domain=${encode(opt.domain, 'Domain')};` : '') +
    (typeof opt.maxAge === 'number' ? ` Max-Age=${Math.floor(opt.maxAge)};` : '') +
    (opt.expires ? ` Expires=${opt.expires.toUTCString()};` : '') +
    (opt.secure ? ' Secure;' : '') +
    sameSite +
    (opt.httpOnly ? ' HttpOnly;' : '')
  // path is the only free-form part left unencoded; block header injection through it
  if (/[\x00-\x1f\x7f]/.test(cookie)) throw new BadRequestError('Invalid cookie: control characters not allowed')
  return cookie
}

function capitalize(str?: string) {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export const readCookies = (cookies?: string | null) => {
  if (!cookies) return {}
  return Object.fromEntries(
    cookies.split(';').map(c => {
      const [name, ...value] = c.split('=')
      return [decode((name ?? '').trim()), decode(value.join('=').trim())]
    })
  )
}
