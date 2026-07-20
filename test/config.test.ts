import { describe, test, expect } from 'bun:test'
import { Galbe } from '../src'

const port = 7369

describe('config', () => {
  // config.server is passed through to Bun.serve
  describe('config.server', () => {
    test('maxRequestBodySize is enforced', async () => {
      const galbe = new Galbe({ server: { maxRequestBodySize: 1024 } })
      galbe.post('/upload', ctx => `${(ctx.body as string).length}`)
      await galbe.listen(port)
      try {
        const ok = await fetch(`http://localhost:${port}/upload`, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: 'a'.repeat(512),
        })
        expect(ok.status).toBe(200)
        expect(await ok.text()).toBe('512')

        let oversized: number | 'aborted' = 'aborted'
        try {
          const resp = await fetch(`http://localhost:${port}/upload`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body: 'a'.repeat(8192),
          })
          oversized = resp.status
        } catch {}
        expect(oversized).not.toBe(200)
      } finally {
        galbe.stop()
      }
    })
  })
})
