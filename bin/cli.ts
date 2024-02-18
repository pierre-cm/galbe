#!/usr/bin/env bun

import { $ } from 'bun'
import type { RouteMeta } from '../src/routes'
import { program } from 'commander'
import { relative, resolve } from 'path'
import { mkdir, readdir, rm } from 'fs/promises'
import { metaAnalysis } from '../src/routes'
import { randomUUID } from 'crypto'
import { glob } from 'glob'
import { Galbe } from '../src'

const ROOT = process.cwd()
const BUILD_ID = randomUUID()

Bun.env.FORCE_COLOR = '1'

const parseRoutes = async (routes?: string | string[]): Promise<{ path: string; meta: RouteMeta }[]> => {
  if (!routes) return []
  let files: { path: string; meta: RouteMeta }[] = []
  if (typeof routes === 'string') {
    let filePaths = await glob(routes, { cwd: ROOT, withFileTypes: true, ignore: 'node_modules/**' })
    for (const file of filePaths.map(f => ({ name: f.name, path: f.path, type: f.getType() }))) {
      const path = `${file.path}/${file.name}`
      if (file.type === 'File') files.push({ path, meta: await metaAnalysis(path) })
      else if (file.type === 'Directory') {
        files = files.concat(
          await Promise.all(
            (
              await readdir(`${file.path}/${file.name}`)
            ).map(async f => ({
              path: `${file.path}/${f}`,
              meta: await metaAnalysis(`${file.path}/${f}`)
            }))
          )
        )
      }
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
  .description('Run a dev server running your galbe API')
  .argument('<string>', 'filename')
  .option('-p, --port <number>', 'port number', '')
  .action(async (fileName, props) => {
    const { port } = props
    const devRoot = resolve(ROOT, '.galbe', 'dev')
    await mkdir(devRoot, { recursive: true })
    await Bun.write(
      resolve(devRoot, 'index.ts'),
      `import galbe from '${relative(devRoot, fileName)}';galbe.listen(${port});`
    )
    process.on('SIGINT', async () => {
      await rm(resolve(ROOT, '.galbe', 'dev'), { recursive: true })
    })

    await $`BUN_ENV=development bun run --watch ${resolve(devRoot, 'index.ts')}`.cwd(ROOT)
  })

program
  .command('build')
  .description('Build your galbe API')
  .argument('<string>', 'filename')
  .option('-o, --out <string>', 'output file', '')
  .option('-c, --compile', 'standalone executable', false)
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
      ...(compile ? ['--compile', '--outfile', out ? out : 'api'] : ['--outdir', out ? out : 'dist'])
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
