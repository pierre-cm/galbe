import { $ } from 'bun'

import { Command, Option } from 'commander'
import { resolve, relative, dirname } from 'path'
import { tmpdir } from 'os'
import { mkdir, rm } from 'fs/promises'

import { CWD, fmtVal, silentExec } from '../util'
import { Galbe } from '../../src'
import { defineRoutes } from '../../src/routes'
import type { BuildConfig } from 'bun'
import { cpSync, existsSync } from 'fs'
import { softMerge } from '../../src/util'

const createBuildIndex = async (indexPath: string, g: Galbe, buildId: string, outPath: string) => {
  const buildPath = resolve(tmpdir(), buildId)
  const indexDir = dirname(indexPath)

  // Locate galbe's own modules from the CLI's install location rather than
  // assuming `<app>/node_modules/galbe/src`, which breaks under pnpm,
  // hoisted or global CLI installs.
  const galbeUtilPath = resolve(import.meta.dir, '..', '..', 'src', 'util')
  const galbeIndexPath = resolve(import.meta.dir, '..', '..', 'src', 'index')

  let configPath = ''
  if (existsSync(`${indexDir}/galbe.config.ts`)) configPath = `${indexDir}/galbe.config.ts`
  else if (existsSync(`${indexDir}/galbe.config.js`)) configPath = `${indexDir}/galbe.config.js`

  let errors: any[] = []
  const { routeFiles, middlewareFiles } = await defineRoutes(
    { routes: g?.config?.routes, middleware: g?.config?.middleware },
    g,
    ({ type, error }) => {
      if (type === 'error') errors.push(error)
    }
  )
  // plugin initialization
  await g.init()

  if (errors.length) throw errors

  // Copy static assets next to the bundle so the runtime can resolve them
  // via static-${BUILD_ID}/<target> at request time.
  for (const { target } of g.staticTargets) {
    cpSync(target, `${outPath}/static-${buildId}/${target}`, { recursive: true, dereference: true })
  }

  await mkdir(buildPath, { recursive: true })

  const usesGroup = routeFiles.some(r => r.prefix)
  let buildIndex =
    `import galbe from '${relative(buildPath, indexPath)}';\n` +
    (usesGroup ? `import {GalbeGroup} from '${relative(buildPath, galbeIndexPath)}';\n` : '') +
    (configPath ? `import config from '${relative(buildPath, configPath)}';\n` : '') +
    (configPath
      ? `import {softMerge} from '${relative(buildPath, galbeUtilPath)}';\n`
      : '') +
    (configPath ? `let conf = galbe.config;\ngalbe.config = softMerge(config, conf)\n` : '') +
    `${middlewareFiles.map((m, idx) => `import mw_${idx} from '${relative(buildPath, m.file)}'`).join(';\n')}\n` +
    `${routeFiles.map((r, idx) => `import _${idx} from '${relative(buildPath, r.file)}'`).join(';\n')}\n` +
    `Bun.env.BUN_ENV = 'production';\n` +
    `Bun.env.GALBE_BUILD = '${buildId}';\n` +
    `galbe.meta = ${JSON.stringify(g.meta)};\n` +
    `galbe.metaMiddleware = ${JSON.stringify(g.metaMiddleware)};\n` +
    `${middlewareFiles.map((m, idx) => `galbe.middleware(${JSON.stringify(m.scope)}, mw_${idx})`).join(';\n')};\n` +
    `${routeFiles
      .map((r, idx) => `_${idx}(${r.prefix ? `new GalbeGroup(galbe, ${JSON.stringify(r.prefix)})` : 'galbe'})`)
      .join(';\n')};\n` +
    `galbe.listen();\n` +
    `process.on('SIGTERM', () => galbe.stop());\n` +
    `process.on('SIGINT', () => galbe.stop());\n`

  await Bun.write(resolve(buildPath, 'index.ts'), buildIndex)

  return resolve(buildPath, 'index.ts')
}

export default (cmd: Command) => {
  cmd
    .description('bundle your \x1b[1;30m\x1b[36mGalbe\x1b[0m application')
    .argument('<index>', 'index file')
    .addOption(new Option('-o, --out <dir>', 'output directory').default('dist/app', fmtVal('dist/app')))
    .addOption(new Option('-C, --compile', 'create a standalone executable').default(false, fmtVal(false)))
    .option('-c, --config <file>', 'bun js or ts config file')
    .action(async (index, props) => {
      const { out, compile, config } = props
      const indexPath = resolve(CWD, index)
      const indexDir = dirname(indexPath)
      const buildID = crypto.randomUUID()
      const outPath = resolve(CWD, out)

      let galbeConfig = {}

      if (existsSync(`${indexDir}/galbe.config.ts`)) {
        galbeConfig = (await import(`${indexDir}/galbe.config.ts`)).default
      } else if (existsSync(`${indexDir}/galbe.config.js`)) {
        galbeConfig = (await import(`${indexDir}/galbe.config.js`)).default
      }

      Bun.env.GALBE_BUILD = buildID

      const bunfig = config ? (await import(resolve(CWD, config)))?.default || {} : {}

      if (existsSync(outPath)) await rm(outPath, { recursive: true })

      let error = null
      Bun.write(Bun.stdout, '📦 \x1b[1;30mBuilding \x1b[36mGalbe\x1b[0m\x1b[1;30m app\x1b[0m')
      let g: Galbe = await silentExec(async () => {
        try {
          const g = (await import(resolve(CWD, index))).default
          let conf = g.config
          g.config = softMerge(galbeConfig, conf)
          return g
        } catch (err) {
          error = err
        }
      })
      if (error) {
        console.log(`\nerror: galbe instance import failed`)
        console.log(error)
        return process.exit(1)
      }
      let buildIndex: string = ''
      try {
        buildIndex = await createBuildIndex(index, g, buildID, outPath)
      } catch (errors) {
        console.log(`\nerror: build errors`)
        // route-file errors come as an array; anything else (a boot error, a
        // failed import) throws a single value — don't lose it
        for (let error of [errors].flat()) console.log(error)
        return process.exit(1)
      }
      if (!buildIndex) {
        console.log(`\nerror: could not create build index`)
        return process.exit(1)
      }

      const buildConfig: BuildConfig = {
        publicPath: `${outPath}/`,
        sourcemap: 'external',
        ...Object.fromEntries(Object.entries(bunfig).filter(([_, v]) => v)),
        entrypoints: [buildIndex],
        outdir: outPath,
        target: 'bun',
      }

      let bo = await Bun.build(buildConfig)
      if (bo.success) Bun.write(Bun.stdout, ' : \x1b[1;30m\x1b[32mdone\x1b[0m\n')
      else {
        console.log(`\nerror: build errors`)
        console.log(...bo.logs)
      }
      if (compile) {
        await $`bun build --compile --minify --sourcemap --bytecode ${resolve(CWD, out, 'index.js')} --outfile ${outPath}/bin`
      }

      await rm(dirname(buildIndex), { recursive: true })
      process.exit(0)
    })
}
