import { $ } from 'bun'

await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  minify: true,
  target: 'bun',
  sourcemap: 'external',
  external: ['bun']
})

await $`bun x tsc --outdir ./dist`

process.exit()
