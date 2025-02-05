import { $ } from 'bun'

import { Command, Option } from 'commander'
import { resolve, relative, dirname } from 'path'
import { tmpdir } from 'os'
import { mkdir, rm, exists } from 'fs/promises'

import { CWD, fmtVal, silentExec } from '../util'
import { Galbe } from '../../src'
import { defineRoutes, GalbeProxy } from '../../src/routes'
import { BuildConfig } from 'bun'

const createBuildIndex = async (indexPath: string, g: Galbe, buildId: string) => {
  const buildPath = resolve(tmpdir(), buildId)
  const routes = new Map<string, { filepath: string, static?: { path: string, root: string } }>()
  let errors: any[] = []
  // Create GalbeProxy here
  // use it to define routes
  const proxy = new GalbeProxy(g, ({ type, error, filepath, route }) => {
    if (!filepath) return
    routes.set(filepath, { filepath, static: route?.static })
    if (type === 'error') errors.push(error)
  })
  await defineRoutes({ routes: g?.config?.routes }, proxy)
  // call init on it for plugin initialization
  await proxy.init()

  if (errors.length) throw errors
  await mkdir(buildPath, { recursive: true })

  let buildIndex =
    `import galbe from '${relative(buildPath, indexPath)}';\n` +
    `${[...routes.values()].map((r, idx) => `import _${idx} from '${relative(buildPath, r.filepath)}'`).join(';\n')}\n` +
    `Bun.env.BUN_ENV = 'production';\n` +
    `Bun.env.GALBE_BUILD = '${buildId}';\n` +
    `galbe.meta = ${JSON.stringify(g.meta)};\n` +
    `${[...routes].map((_, idx) => `_${idx}(galbe)`).join(';\n')};\n` +
    `galbe.listen();\n`

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

      const buildID = crypto.randomUUID()
      const outPath = resolve(CWD, out)

      Bun.env.GALBE_BUILD = buildID
      Bun.env.GALBE_BUILD_OUT = outPath

      const bunfig = config ? (await import(resolve(CWD, config)))?.default || {} : {}

      if(await exists(outPath)) await rm(outPath, { recursive: true })

      let error = null
      Bun.write(Bun.stdout, '📦 \x1b[1;30mBuilding \x1b[36mGalbe\x1b[0m\x1b[1;30m app\x1b[0m')
      let g: Galbe = await silentExec(async () => {
        try {
          const g = (await import(resolve(CWD, index))).default
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
        buildIndex = await createBuildIndex(index, g, buildID)
      } catch (errors) {
        console.log(`\nerror: build errors`)
        for (let error of errors) console.log(error)
        return process.exit(1)
      }
      if (!buildIndex) {
        console.log(`\nerror: could not create build index`)
        return process.exit(1)
      }

      const buildConfig: BuildConfig = {
        publicPath: `${outPath}/`,
        ...Object.fromEntries(Object.entries(bunfig).filter(([k, v]) => v)),
        entrypoints: [buildIndex],
        outdir: outPath,
        sourcemap: 'external',
        target: 'bun',
      }

      let bo = await Bun.build(buildConfig)
      if (bo.success) Bun.write(Bun.stdout, ' : \x1b[1;30m\x1b[32mdone\x1b[0m\n')
      else {
        console.log(`\nerror: build errors`)
        console.log(...bo.logs)
      }
      if (compile) {
        await $`bun build --compile ${resolve(CWD, out, 'index.js')} --outfile ${outPath}/bin`
      }

      await rm(dirname(buildIndex), { recursive: true })
      process.exit(0)
    })
}
