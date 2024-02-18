const METHOD_COLOR: Record<string, string> = {
  get: '\x1b[32m',
  post: '\x1b[34m',
  put: '\x1b[36m',
  patch: '\x1b[33m',
  delete: '\x1b[31m',
  options: ''
}
export const logRoute = (r: { method: string; path: string }) => {
  let color = METHOD_COLOR?.[r.method] || ''
  console.log(`    [${color}${`${r.method.toUpperCase()}\x1b[0m]`.padEnd(12, ' ')} ${r.path}`)
}
