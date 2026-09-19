import { describe, expect, test } from 'bun:test'
import { Galbe } from '../src'
import { clientAddressResolver } from '../src/util'

const request = (forwarded?: string) =>
  new Request('http://localhost/', forwarded === undefined ? {} : { headers: { 'x-forwarded-for': forwarded } })

/** The peer defaults to a private address, as it is behind a proxy that it would come from. */
const resolve = (
  trustProxy: false | number | string[] | undefined,
  forwarded?: string,
  peer: string | null = '10.0.0.1'
) => clientAddressResolver(trustProxy)(request(forwarded), peer)

describe('trustProxy config', () => {
  test('an unusable value is rejected at compile time, not per request', () => {
    expect(() => clientAddressResolver(['nope'])).toThrow(SyntaxError)
    expect(() => clientAddressResolver(['10.0.0.0/33'])).toThrow(SyntaxError)
    expect(() => clientAddressResolver(['::1/129'])).toThrow(SyntaxError)
    expect(() => clientAddressResolver(['10.0.0.0/'])).toThrow(SyntaxError)
    expect(() => clientAddressResolver(-1)).toThrow(SyntaxError)
    expect(() => clientAddressResolver(1.5)).toThrow(SyntaxError)
    expect(() => clientAddressResolver(['10.0.0.0/8', '2001:db8::/32', '192.168.1.1'])).not.toThrow()
  })

  test('no trust configured: the forwarding header is ignored entirely', () => {
    expect(resolve(undefined, '203.0.113.5')).toBe('10.0.0.1')
    expect(resolve(false, '203.0.113.5')).toBe('10.0.0.1')
    expect(resolve(0, '203.0.113.5')).toBe('10.0.0.1')
    expect(resolve([], '203.0.113.5')).toBe('10.0.0.1')
  })

  test('an unknown peer stays unknown', () => {
    expect(resolve(false, '203.0.113.5', null)).toBe(null)
    expect(resolve(1, '203.0.113.5', null)).toBe(null)
  })
})

describe('trustProxy hop count', () => {
  test('one proxy in front resolves the client it forwarded for', () => {
    expect(resolve(1, '203.0.113.5')).toBe('203.0.113.5')
  })

  test('a client-prepended entry is not what a hop count returns', () => {
    // the client sent `X-Forwarded-For: 9.9.9.9` and the proxy appended its peer
    expect(resolve(1, '9.9.9.9, 203.0.113.5')).toBe('203.0.113.5')
    expect(resolve(1, '9.9.9.9, 8.8.8.8, 203.0.113.5')).toBe('203.0.113.5')
    // two real proxies: the second entry from the right is the client, the rest is the spoof
    expect(resolve(2, '9.9.9.9, 198.51.100.7, 203.0.113.5')).toBe('198.51.100.7')
  })

  test('a hop count the header cannot satisfy falls back to the socket peer', () => {
    expect(resolve(1)).toBe('10.0.0.1')
    expect(resolve(2, '203.0.113.5')).toBe('10.0.0.1')
    expect(resolve(3, '9.9.9.9, 203.0.113.5')).toBe('10.0.0.1')
  })
})

describe('trustProxy ranges', () => {
  const trusted = ['10.0.0.0/8', '2001:db8::/32']

  test('hops inside a trusted range are discarded, and the first outside one is the client', () => {
    expect(resolve(trusted, '203.0.113.5')).toBe('203.0.113.5')
    expect(resolve(trusted, '9.9.9.9, 203.0.113.5, 10.0.0.2')).toBe('203.0.113.5')
    expect(resolve(['10.0.0.1'], '203.0.113.5')).toBe('203.0.113.5')
  })

  test('an untrusted peer ends the walk before the header is read at all', () => {
    expect(resolve(['192.168.0.0/16'], '203.0.113.5')).toBe('10.0.0.1')
  })

  test('a chain that is trusted end to end leaves the leftmost entry', () => {
    expect(resolve(trusted, '10.0.0.9, 10.0.0.2')).toBe('10.0.0.9')
  })

  test('prefix boundaries are respected to the bit', () => {
    expect(resolve(['203.0.113.0/25'], '198.51.100.7', '203.0.113.127')).toBe('198.51.100.7')
    expect(resolve(['203.0.113.0/25'], '198.51.100.7', '203.0.113.128')).toBe('203.0.113.128')
    expect(resolve(['203.0.113.5/32'], '198.51.100.7', '203.0.113.5')).toBe('198.51.100.7')
    expect(resolve(['203.0.113.5/32'], '198.51.100.7', '203.0.113.6')).toBe('203.0.113.6')
    expect(resolve(['0.0.0.0/0'], '198.51.100.7', '203.0.113.6')).toBe('198.51.100.7')
  })

  test('IPv6 hops match IPv6 ranges, in any spelling', () => {
    expect(resolve(trusted, '203.0.113.5', '2001:db8::1')).toBe('203.0.113.5')
    expect(resolve(trusted, '203.0.113.5', '2001:0db8:0:0:0:0:0:1')).toBe('203.0.113.5')
    expect(resolve(trusted, '203.0.113.5', '2001:DB8::1')).toBe('203.0.113.5')
    expect(resolve(trusted, '203.0.113.5', '2001:db9::1')).toBe('2001:db9::1')
    // families never match across: an IPv4 hop is not inside an IPv6 range
    expect(resolve(['2001:db8::/32'], '203.0.113.5', '10.0.0.1')).toBe('10.0.0.1')
  })
})

describe('trustProxy header parsing', () => {
  test('a hop that is not an address is not walked past', () => {
    expect(resolve(1, 'not-an-ip')).toBe('10.0.0.1')
    expect(resolve(1, '  ')).toBe('10.0.0.1')
    expect(resolve(1, '203.0.113.5,')).toBe('10.0.0.1')
    expect(resolve(1, '256.0.0.1')).toBe('10.0.0.1')
    expect(resolve(1, '010.0.0.1')).toBe('10.0.0.1') // leading zeros: one address, one spelling
    expect(resolve(1, '1.2.3.4.5')).toBe('10.0.0.1')
    expect(resolve(1, '2001:db8:::1')).toBe('10.0.0.1')
    expect(resolve(1, '2001:db8::1::2')).toBe('10.0.0.1')
    expect(resolve(1, '1:2:3:4:5:6:7')).toBe('10.0.0.1')
    expect(resolve(1, 'x'.repeat(10_000))).toBe('10.0.0.1')
    expect(resolve(1, '<script>alert(1)</script>')).toBe('10.0.0.1')
  })

  test('an empty or absent header leaves the socket peer', () => {
    expect(resolve(1, '')).toBe('10.0.0.1')
    expect(resolve(1)).toBe('10.0.0.1')
    expect(resolve(['10.0.0.0/8'], '')).toBe('10.0.0.1')
  })

  test('brackets, ports and IPv4-mapped forms are normalized away', () => {
    expect(resolve(1, '203.0.113.5:41234')).toBe('203.0.113.5')
    expect(resolve(1, '[2001:db8::1]:41234')).toBe('2001:db8::1')
    expect(resolve(1, '[2001:db8::1]')).toBe('2001:db8::1')
    expect(resolve(1, '::ffff:203.0.113.5')).toBe('203.0.113.5')
    expect(resolve(1, '2001:DB8::1')).toBe('2001:db8::1')
    expect(resolve(1, '   203.0.113.5   ')).toBe('203.0.113.5')
    expect(resolve(1, '[2001:db8::1')).toBe('10.0.0.1')
    // an IPv4-mapped peer is matched against IPv4 ranges, as it is an IPv4 client
    expect(resolve(['10.0.0.0/8'], '203.0.113.5', '::ffff:10.0.0.1')).toBe('203.0.113.5')
  })

  test('a header longer than the hop cap resolves to the socket peer', () => {
    const flood = Array.from({ length: 40 }, () => '10.0.0.2').join(', ')
    expect(resolve(['10.0.0.0/8'], flood)).toBe('10.0.0.1')
    expect(resolve(40, flood)).toBe('10.0.0.1')
    // the cap only bites on trusted hops: the walk still stops at the first untrusted one
    expect(resolve(['10.0.0.0/8'], `${flood}, 203.0.113.5`)).toBe('203.0.113.5')
  })
})

describe('clientAddress in the request lifecycle', async () => {
  const echo = (galbe: Galbe) => {
    galbe.get('/who', ctx => ({ remote: ctx.remoteAddress?.address ?? null, client: ctx.clientAddress }))
    galbe.get('/pre', ctx => ctx.state.pre)
    galbe.middleware('/pre', { beforeParse: ctx => void (ctx.state.pre = ctx.clientAddress) })
    return galbe
  }
  const untrusting = echo(new Galbe())
  const trusting = echo(new Galbe({ trustProxy: 1 }))
  // explicit address: `localhost` may resolve to ::1 (CI, containers), which
  // would bind the IPv6 loopback only and leave these fetches unreachable
  await untrusting.listen(7402, '127.0.0.1')
  await trusting.listen(7403, '127.0.0.1')
  const get = (port: number, path: string, forwarded?: string) =>
    fetch(`http://127.0.0.1:${port}${path}`, forwarded ? { headers: { 'x-forwarded-for': forwarded } } : undefined)
  const who = async (port: number, forwarded?: string) =>
    (await (await get(port, '/who', forwarded)).json()) as { remote: string | null; client: string | null }

  test('by default a forwarding header changes nothing', async () => {
    const plain = await who(7402)
    expect(plain.remote).toBe('127.0.0.1')
    expect(plain.client).toBe('127.0.0.1')
    const forwarded = await who(7402, '203.0.113.5')
    expect(forwarded.remote).toBe('127.0.0.1')
    expect(forwarded.client).toBe('127.0.0.1')
  })

  test('with a trusted hop the client is resolved, and remoteAddress is untouched', async () => {
    const forwarded = await who(7403, '9.9.9.9, 203.0.113.5')
    expect(forwarded.remote).toBe('127.0.0.1')
    expect(forwarded.client).toBe('203.0.113.5')
    const plain = await who(7403)
    expect(plain.remote).toBe('127.0.0.1')
    expect(plain.client).toBe('127.0.0.1')
  })

  test('it is available in the beforeParse slot, where rate limiting runs', async () => {
    expect(await (await get(7403, '/pre', '203.0.113.5')).text()).toBe('203.0.113.5')
    expect(await (await get(7402, '/pre', '203.0.113.5')).text()).toBe('127.0.0.1')
  })
})
