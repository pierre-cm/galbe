#!/usr/bin/env bun
import { program } from 'commander'
import { relative, resolve } from 'path'
import { mkdir, readdir, rm } from 'fs/promises'
import { RouteMetadata, metaAnalysis } from '../src/routes'
import { randomUUID } from 'crypto'
import { glob } from 'glob'
import { Kadre } from '../src/index'

const ROOT = process.cwd()
const BUILD_ID = randomUUID()

const parseRoutes = async (routes?: string | string[]): Promise<{ path: string; meta: RouteMetadata }[]> => {
  if (!routes) return []
  let files: { path: string; meta: RouteMetadata }[] = []
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

const createBuildIndex = async (indexPath: string, routes: { path: string; meta: RouteMetadata }[], port?: number) => {
  const buildPath = resolve(ROOT, '.kadre', 'build', BUILD_ID)
  await mkdir(buildPath, { recursive: true })
  await Bun.write(
    resolve(buildPath, 'index.ts'),
    `import kadre from '${relative(buildPath, indexPath)}';
${routes.map((r, idx) => `import _${idx} from '${relative(buildPath, r.path)}'`).join(';\n')}
${routes
  .map(
    (r, idx) => `kadre.routesMetadata = {...${JSON.stringify(r.meta)}}
_${idx}(kadre)`
  )
  .join(';\n')}
kadre.listen(${port || 3000});
`
  )
  return resolve(buildPath, 'index.ts')
}

program.name('kadre').description('CLI to execute kadre utilities').version('0.1.0')

program
  .command('dev')
  .description('Run a dev server running your kadre API')
  .argument('<string>', 'filename')
  .option('-p, --port <number>', 'port number', '')
  .action(async (fileName, props) => {
    const { port } = props
    const devRoot = resolve(ROOT, '.kadre', 'dev')
    await mkdir(devRoot, { recursive: true })
    await Bun.write(
      resolve(devRoot, 'index.ts'),
      `import kadre from '${relative(devRoot, fileName)}';kadre.listen(${port || 3000});`
    )
    process.on('SIGINT', async () => {
      await rm(resolve(ROOT, '.kadre', 'dev'), { recursive: true })
    })
    Bun.spawn(['bun', 'run', '--watch', resolve(devRoot, 'index.ts')], {
      cwd: ROOT,
      stdout: 'inherit',
      env: {
        ...Bun.env,
        BUN_ENV: 'development'
      },
      async onExit() {
        await rm(resolve(ROOT, '.kadre', 'dev'), { recursive: true })
      }
    })
  })

program
  .command('build')
  .description('Build your kadre API')
  .argument('<string>', 'filename')
  .option('-o, --out <string>', 'output file', '')
  .option('-c, --compile', 'standalone executable', false)
  .action(async (fileName, props) => {
    const { out, compile } = props
    const k: Kadre = (await import(resolve(ROOT, fileName))).default
    const routes = await parseRoutes(k?.config?.routes)
    const buildIndex = await createBuildIndex(fileName, routes, k?.config?.port)

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
        await rm(resolve(ROOT, '.kadre', 'build', BUILD_ID), { recursive: true })
      }
    })
  })

program.parse()
