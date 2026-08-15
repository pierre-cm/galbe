import { mkdtemp, mkdir, rm, writeFile, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import { resolve, dirname } from 'path'

export const CLI = resolve(import.meta.dir, '../bin/cli.ts')
const REPO = resolve(import.meta.dir, '..')

/** app files, keyed by app-relative path */
export type App = Record<string, string>

/**
 * Write a throwaway app on disk and link `galbe` to this repo, the way a real
 * project installs it.
 */
export const createApp = async (files: App): Promise<string> => {
  const dir = await mkdtemp(`${tmpdir()}/galbe-cli-`)
  for (const [path, content] of Object.entries(files)) {
    const full = `${dir}/${path}`
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, content)
  }
  await mkdir(`${dir}/node_modules`, { recursive: true })
  await symlink(REPO, `${dir}/node_modules/galbe`, 'dir')
  return dir
}

export const freePort = async (): Promise<number> => {
  const s = Bun.serve({ port: 0, fetch: () => new Response('') })
  const { port } = s
  await s.stop(true)
  if (!port) throw new Error('could not allocate a free port')
  return port
}

export type CliProc = {
  output: () => string
  exited: Promise<number>
  stop: () => Promise<void>
}

/** run a galbe CLI command in `dir`, capturing its interleaved output */
export const runCli = (dir: string, args: string[]): CliProc => {
  const proc = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, BUN_ENV: 'development', NO_COLOR: '1' }
  })
  let output = ''
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder()
    for await (const chunk of stream) output += decoder.decode(chunk)
  }
  drain(proc.stdout as ReadableStream<Uint8Array>)
  drain(proc.stderr as ReadableStream<Uint8Array>)
  return {
    output: () => output,
    exited: proc.exited,
    stop: async () => {
      proc.kill()
      await proc.exited
    }
  }
}

/** poll until `fn` returns a value, or throw with the process output on timeout */
export const until = async <T>(
  proc: CliProc,
  what: string,
  fn: () => Promise<T | undefined>,
  timeout = 20_000
): Promise<T> => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const r = await fn()
      if (r !== undefined) return r
    } catch {}
    await Bun.sleep(50)
  }
  throw new Error(`timed out waiting for ${what}\n--- cli output ---\n${proc.output()}`)
}

export const cleanup = async (procs: CliProc[], dirs: string[]) => {
  await Promise.all(procs.splice(0).map(p => p.stop()))
  await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })))
}

export const INDEX = `import { Galbe } from 'galbe'
import config from './galbe.config'

export default new Galbe(config)
`
export const HELLO_ROUTE = `import type { Galbe } from 'galbe'

export default (g: Galbe) => {
  g.get('/hello', ctx => \`hello \${ctx.state.who ?? 'world'}\`)
}
`
export const config = (opts: { routes: string; middleware?: string; port?: number }) =>
  `import type { GalbeConfig } from 'galbe'

const config: GalbeConfig = {
${[
  opts.port ? `  port: ${opts.port}` : '',
  `  routes: '${opts.routes}'`,
  opts.middleware ? `  middleware: '${opts.middleware}'` : ''
]
  .filter(Boolean)
  .join(',\n')}
}

export default config
`
