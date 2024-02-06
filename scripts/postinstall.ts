import { $ } from 'bun'
import { existsSync } from 'node:fs'

if (existsSync('.git')) {
  console.log('Setting up dev environment')
  Bun.write('.git/hooks/prepare-commit-msg', Bun.file('scripts/hooks/prepare-commit-msg'))
  await $`chmod +x .git/hooks/prepare-commit-msg`
  console.log('done')
}
