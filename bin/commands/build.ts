import { $ } from 'bun'

import { Command, Option } from 'commander'
import { resolve, relative, dirname } from 'path'
import { tmpdir } from 'os'
import { mkdir, rm } from 'fs/promises'

import { CWD, fmtVal, silentExec } from '../util'
import { Galbe } from '../../src'
import { defineRoutes } from '../../src/routes'
import { BuildConfig } from 'bun'

const createBuildIndex = async (indexPath: string, g: Galbe) => {
  const buildId = crypto.randomUUID()
  const buildPath = resolve(tmpdir(), buildId)
  const routes = new Set<string>()
  let errors: any[] = []
  await defineRoutes({ routes: g?.config?.routes }, g, ({ type, error, filepath }) => {
    if (!filepath) return
    routes.add(filepath)
    if (type === 'error') errors.push(error)
  })
  if (errors.length) throw errors
  await mkdir(buildPath, { recursive: true })
  await Bun.write(
    resolve(buildPath, 'index.ts'),
    `import galbe from '${relative(buildPath, indexPath)}';
${[...routes].map((r, idx) => `import _${idx} from '${relative(buildPath, r)}'`).join(';\n')}
galbe.meta = ${JSON.stringify(g.meta)};
${[...routes].map((_, idx) => `_${idx}(galbe)`).join(';\n')}
galbe.listen();
`
  )
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

      const bunfig = config ? (await import(resolve(CWD, config)))?.default || {} : {}

      let error = null
      process.stdout.write('📦 \x1b[1;30mBuilding \x1b[36mGalbe\x1b[0m\x1b[1;30m app\x1b[0m')
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
        buildIndex = await createBuildIndex(index, g)
      } catch (errors) {
        console.log(`\nerror: build errors`)
        for (let error of errors) console.log(error)
        return process.exit(1)
      }
      if (!buildIndex) {
        console.log(`\nerror: could not create build index`)
        return process.exit(1)
      }

      console.log(Object.fromEntries(Object.entries(bunfig).filter(([k, v]) => v)))
      const buildConfig: BuildConfig = {
        publicPath: `${resolve(CWD, out)}/`,
        ...Object.fromEntries(Object.entries(bunfig).filter(([k, v]) => v)),
        entrypoints: [buildIndex],
        outdir: resolve(CWD, out),
        target: 'bun'
      }

      let bo = await Bun.build(buildConfig)
      if (bo.success) process.stdout.write(' : \x1b[1;30m\x1b[32mdone\x1b[0m\n')
      else {
        console.log(`\nerror: build errors`)
        console.log(...bo.logs)
      }
      if (compile) await $`bun build --compile ${resolve(CWD, out, 'index.js')} --outfile ${resolve(CWD, out, 'app')}`

      await rm(dirname(buildIndex), { recursive: true })
    })
}
