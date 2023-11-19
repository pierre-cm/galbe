console.log('Setting up dev environment')
Bun.write('.git/hooks/prepare-commit-msg', Bun.file('scripts/hooks/prepare-commit-msg'))
Bun.spawn(['chmod', '+x', '.git/hooks/prepare-commit-msg'])
console.log('done')
