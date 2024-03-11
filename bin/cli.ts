#!/usr/bin/env bun

import { $, Glob } from 'bun'
import type { RouteMeta } from '../dist/routes'
import { program } from 'commander'
import { relative, resolve } from 'path'
import { mkdir, readdir, lstat, rm } from 'fs/promises'
import { DEFAULT_ROUTE_PATTERN, metaAnalysis } from '../dist/routes'
import { randomUUID } from 'crypto'
import { Galbe } from '../dist'

const ROOT = process.cwd()
const BUILD_ID = randomUUID()

Bun.env.FORCE_COLOR = '1'

const parseRoutes = async (routes?: boolean | string | string[]): Promise<{ path: string; meta: RouteMeta }[]> => {
  routes = routes === true ? DEFAULT_ROUTE_PATTERN : routes
  if (!routes) return []
  let files: { path: string; meta: RouteMeta }[] = []
  if (typeof routes === 'string') {
    for await (const path of new Glob(routes).scan({ cwd: ROOT, absolute: true, onlyFiles: false })) {
      const isDir = (await lstat(path)).isDirectory()
      if (isDir) {
        files = files.concat(
          await Promise.all(
            (
              await readdir(path)
            ).map(async f => ({
              path: f,
              meta: await metaAnalysis(path)
            }))
          )
        )
      } else files.push({ path, meta: await metaAnalysis(path) })
    }
  }
  if (Array.isArray(routes)) for (const r of routes) files = files.concat(await parseRoutes(r))
  return files
}

const createBuildIndex = async (indexPath: string, routes: { path: string; meta: RouteMeta }[]) => {
  const buildPath = resolve(ROOT, '.galbe', 'build', BUILD_ID)
  await mkdir(buildPath, { recursive: true })
  await Bun.write(
    resolve(buildPath, 'index.ts'),
    `import galbe from '${relative(buildPath, indexPath)}';
${routes.map((r, idx) => `import _${idx} from '${relative(buildPath, r.path)}'`).join(';\n')}
${routes
  .map(
    (r, idx) => `galbe.routesMetadata = {...${JSON.stringify(r.meta)}}
_${idx}(galbe)`
  )
  .join(';\n')}
galbe.listen();
`
  )
  return resolve(buildPath, 'index.ts')
}

program.name('galbe').description('CLI to execute galbe utilities').version('0.1.0')

program
  .command('dev')
  .description('Start a dev server running your Galbe application')
  .argument('<string>', 'filename')
  .option('-p, --port <number>', 'port number', '')
  .option('-w, --watch', 'watch file changes', 'true')
  .action(async (fileName, props) => {
    const { port, watch } = props
    const devRoot = resolve(ROOT, '.galbe', 'dev')
    await mkdir(devRoot, { recursive: true })
    await Bun.write(
      resolve(devRoot, 'index.ts'),
      `import galbe from '${relative(devRoot, fileName)}';galbe.listen(${port});`
    )
    process.on('SIGINT', async () => {
      await rm(resolve(ROOT, '.galbe', 'dev'), { recursive: true })
    })

    await $`BUN_ENV=development bun run ${watch ? '--watch' : ''} ${resolve(devRoot, 'index.ts')}`.cwd(ROOT)
  })

program
  .command('build')
  .description('undle your Galbe application')
  .argument('<string>', 'filename')
  .option('-o, --out <string>', 'output file/directory', '')
  .option('-c, --compile', 'create a standalone executable', false)
  .action(async (fileName, props) => {
    const { out, compile } = props
    const g: Galbe = (await import(resolve(ROOT, fileName))).default
    const routes = await parseRoutes(g?.config?.routes)
    const buildIndex = await createBuildIndex(fileName, routes)

    const cmds = [
      'bun',
      'build',
      buildIndex,
      '--target',
      'bun',
      ...(compile ? ['--compile', '--outfile', out ? out : 'app'] : ['--outdir', out ? out : 'dist'])
    ].filter(c => c)
    Bun.spawn(cmds, {
      cwd: ROOT,
      stdout: 'inherit',
      async onExit() {
        await rm(resolve(ROOT, '.galbe', 'build', BUILD_ID), { recursive: true })
      }
    })
  })

program.parse()
