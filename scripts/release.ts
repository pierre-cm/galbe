#!/usr/bin/env bun

import { $ } from 'bun'
import { existsSync } from 'fs'

const PKG_PATH = new URL('../package.json', import.meta.url).pathname
const CHANGELOG_PATH = new URL('../CHANGELOG.md', import.meta.url).pathname
const REMOTE = 'git@github.com:pierre-cm/galbe.git'

type BumpType = 'major' | 'minor' | 'patch'
type CommitKind = 'breaking' | 'feat' | 'fix'

interface Commit {
  kind: CommitKind
  scope?: string
  message: string
}

// --- arg parsing ---

const argv = process.argv.slice(2)
const isCI = argv.includes('--ci')
const scopeIdx = argv.indexOf('--scope')
const scopeArg = scopeIdx !== -1 ? argv[scopeIdx + 1] : null

if (scopeArg && !['patch', 'minor', 'major'].includes(scopeArg)) {
  console.error(`error: --scope must be patch, minor, or major`)
  process.exit(1)
}

// --- helpers ---

function classify(subject: string): Commit | null {
  if (/^(Release \d|Merge branch)/.test(subject)) return null

  if (subject.includes('BREAKING CHANGE') || /^[^:]+!:/.test(subject))
    return { kind: 'breaking', message: subject.replace(/^[^:]+!?:\s*/, '') }

  const feat = subject.match(/^feat(?:\(([^)]+)\))?:\s*(.+)/)
  if (feat) return { kind: 'feat', scope: feat[1], message: feat[2] }

  const fix = subject.match(/^fix(?:\(([^)]+)\))?:\s*(.+)/)
  if (fix) return { kind: 'fix', scope: fix[1], message: fix[2] }

  return null
}

function bump(version: string, type: BumpType): string {
  const [maj, min, pat] = version.split('.').map(Number)
  if (type === 'major') return `${maj + 1}.0.0`
  if (type === 'minor') return `${maj}.${min + 1}.0`
  return `${maj}.${min}.${pat + 1}`
}

function suggest(commits: Commit[], preRelease: boolean): BumpType {
  if (!preRelease && commits.some(c => c.kind === 'breaking')) return 'major'
  if (commits.some(c => c.kind === 'breaking') || commits.some(c => c.kind === 'feat')) return 'minor'
  return 'patch'
}

function formatEntry(version: string, commits: Commit[], date: string): string {
  const sections: string[] = []
  const fmt = (c: Commit) => `- ${c.scope ? `**${c.scope}**: ` : ''}${c.message}`

  const breaking = commits.filter(c => c.kind === 'breaking')
  const feats = commits.filter(c => c.kind === 'feat')
  const fixes = commits.filter(c => c.kind === 'fix')

  if (breaking.length) sections.push(`### Breaking Changes\n${breaking.map(fmt).join('\n')}`)
  if (feats.length) sections.push(`### Features\n${feats.map(fmt).join('\n')}`)
  if (fixes.length) sections.push(`### Fixes\n${fixes.map(fmt).join('\n')}`)

  return `## ${version} — ${date}\n\n${sections.join('\n\n')}`
}

function prependChangelog(entry: string, existing: string): string {
  if (!existing) return `# Changelog\n\n${entry}\n`
  if (existing.startsWith('# Changelog')) {
    const body = existing.replace(/^# Changelog\s*/, '')
    return `# Changelog\n\n${entry}\n\n${body}`
  }
  return `# Changelog\n\n${entry}\n\n${existing}`
}

// --- main ---

async function main() {
  if (!isCI) {
    const branch = (await $`git rev-parse --abbrev-ref HEAD`.quiet().text()).trim()
    if (branch !== 'main') {
      console.error(`error: must be on main branch (currently on '${branch}')`)
      process.exit(1)
    }

    const dirty = (await $`git status --porcelain`.quiet().text()).trim()
    if (dirty) {
      console.error('error: working tree has uncommitted changes')
      process.exit(1)
    }
  }

  const lastTag = await $`git describe --tags --abbrev=0`
    .quiet()
    .text()
    .catch(() => '')
    .then(t => t.trim())

  const logRange = lastTag ? `${lastTag}..HEAD` : 'HEAD'
  const rawLog = (await $`git log --pretty=format:%s ${logRange}`.quiet().text()).trim()

  const commits = rawLog ? (rawLog.split('\n').map(classify).filter(Boolean) as Commit[]) : []

  const pkg = await Bun.file(PKG_PATH).json()
  const current: string = pkg.version
  const preRelease = current.startsWith('0.')

  console.log(`\ncurrent: ${current}${lastTag ? `  (since tag ${lastTag})` : ''}`)

  if (!commits.length && !scopeArg) {
    console.log('no feat/fix commits since last release — nothing to do.')
    process.exit(0)
  }

  let next: string

  if (scopeArg) {
    // CI / non-interactive: scope is given directly
    next = bump(current, scopeArg as BumpType)
    console.log(`scope: ${scopeArg}  →  ${next}`)
  } else {
    // Interactive
    const breaking = commits.filter(c => c.kind === 'breaking')
    const feats = commits.filter(c => c.kind === 'feat')
    const fixes = commits.filter(c => c.kind === 'fix')

    if (breaking.length) { console.log('\n  breaking:'); breaking.forEach(c => console.log(`    - ${c.message}`)) }
    if (feats.length) { console.log('\n  features:'); feats.forEach(c => console.log(`    - ${c.scope ? `[${c.scope}] ` : ''}${c.message}`)) }
    if (fixes.length) { console.log('\n  fixes:'); fixes.forEach(c => console.log(`    - ${c.scope ? `[${c.scope}] ` : ''}${c.message}`)) }

    const recommended = suggest(commits, preRelease)
    const versions = { patch: bump(current, 'patch'), minor: bump(current, 'minor'), major: bump(current, 'major') }
    const defaultChoice = recommended === 'patch' ? '1' : recommended === 'minor' ? '2' : '3'

    console.log(`\n  1) patch  →  ${versions.patch}${recommended === 'patch' ? '  ←' : ''}`)
    console.log(`  2) minor  →  ${versions.minor}${recommended === 'minor' ? '  ←' : ''}`)
    console.log(`  3) major  →  ${versions.major}${recommended === 'major' ? '  ←' : ''}`)
    console.log(`  4) custom`)
    if (preRelease) console.log(`\n  note: ${current} is pre-release (0.x) — breaking changes capped to minor`)

    const choice = prompt(`\nbump type [${defaultChoice}]:`)?.trim() || defaultChoice

    if (choice === '1') next = versions.patch
    else if (choice === '2') next = versions.minor
    else if (choice === '3') next = versions.major
    else if (choice === '4') {
      next = prompt('version:')?.trim() ?? ''
      if (!/^\d+\.\d+\.\d+$/.test(next)) {
        console.error('error: invalid semver format')
        process.exit(1)
      }
    } else {
      console.error('error: invalid choice')
      process.exit(1)
    }

    const ok = prompt(`\nrelease ${next}? (y/N):`)?.trim().toLowerCase()
    if (ok !== 'y') { console.log('aborted.'); process.exit(0) }
  }

  console.log()

  const date = new Date().toISOString().split('T')[0]
  const entry = formatEntry(next, commits, date)

  const existing = existsSync(CHANGELOG_PATH) ? await Bun.file(CHANGELOG_PATH).text() : ''
  await Bun.write(CHANGELOG_PATH, prependChangelog(entry, existing))
  console.log('updated CHANGELOG.md')

  pkg.version = next
  await Bun.write(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`bumped package.json → ${next}`)

  await $`git add package.json CHANGELOG.md`
  await $`git commit -m "Release ${next}"`
  await $`git tag ${next}`
  await $`git push ${REMOTE} main --tags`
  console.log(`pushed commit and tag ${next}`)

  await $`gh release create ${next} --title "Release ${next}" --notes ${entry}`
  console.log(`\ncreated GitHub release ${next}`)
}

main().catch(e => {
  console.error(e.message ?? e)
  process.exit(1)
})
