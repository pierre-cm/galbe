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
        cookie.name = key ?? ''
        cookie.value = val ?? ''
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
  return (
    `${name}=${value};` +
    ` path=${opt.path || '/'};` +
    (opt.domain ? ` Domain=${opt.domain};` : '') +
    (typeof opt.maxAge === 'number' ? ` Max-Age=${Math.floor(opt.maxAge)};` : '') +
    (opt.expires ? ` Expires=${opt.expires.toUTCString()};` : '') +
    (opt.secure ? ' Secure;' : '') +
    sameSite +
    (opt.httpOnly ? ' HttpOnly;' : '')
  )
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
      return [(name ?? '').trim(), value.join('=').trim()]
    })
  )
}
