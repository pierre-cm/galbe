import { $ } from 'bun'
import { devNull } from 'os'
import { Command, Option } from 'commander'
import { resolve, relative, extname } from 'path'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'

import { CWD, fmtList, fmtVal } from '../../util'
import { applyPlan, planFromOapi, type GenerationPlan } from './code/openapi.parser'
import { mergeRouteFile, type MergeOptions, type RouteId } from './code/route-merge'

const srcTargets = ['ts', 'js']
const inputFormats = ['openapi:3.0:yaml', 'openapi:3.0:json']

const collectFlag = (value: string, prev: string[] = []) => [...prev, value]

const parseRename = (raw: string): [RouteId, RouteId] => {
  const eq = raw.indexOf('=')
  if (eq < 0) throw new Error(`invalid --rename value ${fmtVal(raw)} (expected "OLD=NEW")`)
  const from = raw.slice(0, eq).trim()
  const to = raw.slice(eq + 1).trim()
  if (!from || !to) throw new Error(`invalid --rename value ${fmtVal(raw)}`)
  return [from, to]
}

type ScopedDiff = { scope: string; id: RouteId }

const printDiff = (diff: {
  added: ScopedDiff[]
  updated: ScopedDiff[]
  removed: ScopedDiff[]
  stale: ScopedDiff[]
}) => {
  const out = (label: string, prefix: string, items: ScopedDiff[]) => {
    if (!items.length) return
    console.log(`${label} (${items.length}):`)
    for (const x of items) console.log(`  ${prefix} ${x.id}  \x1b[2m(scope: ${x.scope})\x1b[0m`)
  }
  out('Added', '\x1b[32m+\x1b[0m', diff.added)
  out('Updated', '\x1b[33m~\x1b[0m', diff.updated)
  out('Removed', '\x1b[31m-\x1b[0m', diff.removed)
  out('Stale (kept in code)', '\x1b[2m·\x1b[0m', diff.stale)
}

export default (cmd: Command) => {
  cmd
    .description('generate \x1b[1;30m\x1b[36mGalbe\x1b[0m sources')
    .argument('<input>', 'input file')
    .addOption(
      new Option('-f, --format <format>', `input format ${fmtList(inputFormats)}`)
        .argParser(v => {
          if (inputFormats.includes(v)) return v
          console.log(`error: format must be one of ${fmtList(inputFormats)}`)
          process.exit(1)
        })
        .default(null, fmtVal('openapi:3.0:{yaml,json}'))
    )
    .addOption(
      new Option('-t, --target <target>', `source target ${fmtList(srcTargets)}`)
        .argParser(v => {
          if (srcTargets.includes(v)) return v
          console.log(`error: target must be one of ${fmtList(srcTargets)}`)
          process.exit(1)
        })
        .default('ts', fmtVal('ts'))
    )
    .addOption(new Option('-o, --out <dir>', 'output dir').default('src', fmtVal('src')))
    .addOption(new Option('-n, --dry-run', 'show planned changes without writing'))
    .addOption(new Option('--remove-stale', 'delete routes present in code but absent from spec'))
    .addOption(
      new Option('--rename <pair>', '"OLD=NEW" preserve handler when route id changes (repeatable)')
        .argParser(collectFlag)
        .default([])
    )
    .addOption(
      new Option('--ignore-route <route>', '"METHOD /path" leave alone if absent from spec (repeatable)')
        .argParser(collectFlag)
        .default([])
    )
    .action(async (input, props) => {
      let { format, target, out, dryRun, removeStale, rename, ignoreRoute } = props

      let inputExt = extname(input)
      if (inputExt === '.yml') inputExt = '.yaml'
      if (!['.yaml', '.json'].includes(inputExt)) console.log('error: unknown input extension')

      if (!format) format = `openapi:3.0:${inputExt.slice(1)}`

      let renameMap: Map<RouteId, RouteId>
      try {
        renameMap = new Map<RouteId, RouteId>((rename as string[]).map(parseRename))
      } catch (err) {
        console.log(`error: ${(err as Error).message}`)
        process.exit(1)
      }
      const ignoreSet = new Set<RouteId>((ignoreRoute as string[]).map(s => s.trim()))
      const mergeOpts: MergeOptions = {
        removeStale: !!removeStale,
        rename: renameMap,
        ignore: ignoreSet,
      }

      let plan: GenerationPlan
      try {
        let match = format.match(/^([^:]*):([^:]*):(.*)$/)
        if (!match) throw new Error(`invalid format ${format}`)
        let [_, kind, version, ext] = match
        if (kind !== 'openapi') throw new Error('unknown format')
        plan = await planFromOapi(relative(CWD, input), { version, ext, target })
      } catch (err) {
        console.log(`error: ${(err as Error).message}`)
        process.exit(1)
      }

      const outDir = resolve(CWD, out)

      // Compute per-scope merge result.
      const mergeResults: {
        scopeKey: string
        content: string
        added: RouteId[]
        updated: RouteId[]
        removed: RouteId[]
        stale: RouteId[]
      }[] = []
      for (const scope of plan.scopes) {
        const routePath = resolve(outDir, `${scope.routeFile}.${target}`)
        const existing = existsSync(routePath) ? await readFile(routePath, 'utf-8') : null
        const r = mergeRouteFile(existing, scope, mergeOpts)
        mergeResults.push({ scopeKey: scope.scopeKey, ...r })
      }

      const diff = {
        added: mergeResults.flatMap(r => r.added.map(id => ({ scope: r.scopeKey, id }))),
        updated: mergeResults.flatMap(r => r.updated.map(id => ({ scope: r.scopeKey, id }))),
        removed: mergeResults.flatMap(r => r.removed.map(id => ({ scope: r.scopeKey, id }))),
        stale: mergeResults.flatMap(r => r.stale.map(id => ({ scope: r.scopeKey, id }))),
      }

      // Block when stale routes need an explicit decision (ignored ones are already resolved).
      const unresolved = diff.stale.filter(s => !ignoreSet.has(s.id))
      if (unresolved.length > 0 && !removeStale && !dryRun) {
        console.log('The following routes exist in code but are not in the spec:')
        for (const s of unresolved) console.log(`  - ${s.id}  \x1b[2m(scope: ${s.scope})\x1b[0m`)
        console.log()
        console.log('Re-run with one of:')
        console.log(`  ${fmtVal('--rename "OLD=NEW"')}          treat as a rename, preserve handler`)
        console.log(`  ${fmtVal('--ignore-route "ROUTE"')}      leave alone, keep as user-managed`)
        console.log(`  ${fmtVal('--remove-stale')}              confirm deletion of stale routes`)
        process.exit(1)
      }

      if (dryRun) {
        console.log('\x1b[1;30mDry run — no files will be written.\x1b[0m')
        printDiff(diff)
        return
      }

      Bun.write(Bun.stdout, '💻 \x1b[1;30mGenerating \x1b[36mGalbe\x1b[0m\x1b[1;30m sources\x1b[0m')
      try {
        const routeContents = new Map(mergeResults.map(r => [r.scopeKey, r.content]))
        await applyPlan(plan, outDir, { routeContents })
        await $`bunx prettier --write "${outDir}/**/*.{js,ts}" > ${devNull} && printf "​"`
      } catch (err) {
        console.log(`error: ${(err as Error).message}`)
        process.exit(1)
      }
      Bun.write(Bun.stdout, ' : \x1b[1;30m\x1b[32mdone\x1b[0m\n')
      printDiff(diff)
    })
}
