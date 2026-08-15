/**
 * Structural diff between two OpenAPI documents, used to measure how much of a
 * spec survives the `generate code` -> `generate spec` roundtrip.
 *
 * The comparison is semantic, not textual: constructs that OpenAPI itself
 * treats as equivalent (parameter order, `$ref`s into `components.parameters`,
 * path-item level parameter inheritance) are normalised away first, so what is
 * left in the report is genuine information loss.
 */

export type Diff = { kind: 'missing' | 'added' | 'changed'; path: string; expected?: any; actual?: any }

const isObj = (v: any): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** OpenAPI parameter arrays are unordered; key them by `in:name` instead of index. */
const paramKey = (p: any) => (isObj(p) && typeof p.name === 'string' && typeof p.in === 'string' ? `${p.in}:${p.name}` : null)

export const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'] as const

/** Every operation of a document, in declaration order. `trace` is left out: Galbe has no route builder for it. */
export const operations = (spec: any): { path: string; method: string; op: any }[] => {
  const out: { path: string; method: string; op: any }[] = []
  for (const [path, item] of Object.entries<any>(spec?.paths || {}))
    for (const method of METHODS) if (item?.[method]) out.push({ path, method, op: item[method] })
  return out
}

/**
 * Push path-item level `parameters` down into each operation, the way a spec
 * reader resolves them. Operation-level entries win over inherited ones.
 */
const inlinePathItemParams = (spec: any) => {
  const paths = Object.fromEntries(
    Object.entries<any>(spec?.paths || {}).map(([path, item]) => {
      const inherited = item?.parameters
      if (!Array.isArray(inherited)) return [path, item]
      const { parameters: _drop, ...rest } = item
      for (const m of METHODS) {
        if (!rest[m]) continue
        const own = rest[m].parameters || []
        const ownKeys = new Set(own.map(paramKey))
        rest[m] = { ...rest[m], parameters: [...inherited.filter(p => !ownKeys.has(paramKey(p))), ...own] }
      }
      return [path, rest]
    })
  )
  return { ...spec, paths }
}

/**
 * Inline `#/components/parameters/*` refs. Whether a parameter lives inline or
 * in `components` is a packaging choice — the serializer promotes any shape it
 * sees twice — so it must not register as a difference.
 */
const inlineParamRefs = (spec: any) => {
  const walk = (n: any): any => {
    if (Array.isArray(n)) return n.map(walk)
    if (!isObj(n)) return n
    if (typeof n.$ref === 'string' && n.$ref.startsWith('#/components/parameters/')) {
      const target = spec?.components?.parameters?.[n.$ref.split('/').pop()!]
      if (target) return walk(target)
    }
    return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, walk(v)]))
  }
  const { parameters: _drop, ...components } = spec?.components || {}
  return { ...walk(spec), components }
}

/**
 * Trim `summary`/`description` values. YAML block scalars keep a trailing
 * newline that the JSDoc roundtrip drops; that is formatting, not content.
 */
const trimProse = (n: any): any => {
  if (Array.isArray(n)) return n.map(trimProse)
  if (!isObj(n)) return n
  return Object.fromEntries(
    Object.entries(n).map(([k, v]) => [
      k,
      (k === 'summary' || k === 'description') && typeof v === 'string' ? v.trim() : trimProse(v),
    ])
  )
}

export const normalize = (spec: any) => trimProse(inlineParamRefs(inlinePathItemParams(spec)))

export const diffSpec = (a: any, b: any, path = ''): Diff[] => {
  const out: Diff[] = []
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(a)) {
      if (!(k in b)) out.push({ kind: 'missing', path: `${path}/${k}`, expected: a[k] })
      else out.push(...diffSpec(a[k], b[k], `${path}/${k}`))
    }
    for (const k of Object.keys(b)) if (!(k in a)) out.push({ kind: 'added', path: `${path}/${k}`, actual: b[k] })
    return out
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length && b.length && a.every(paramKey) && b.every(paramKey)) {
      const ma = new Map(a.map(p => [paramKey(p)!, p]))
      const mb = new Map(b.map(p => [paramKey(p)!, p]))
      for (const [k, v] of ma) {
        if (!mb.has(k)) out.push({ kind: 'missing', path: `${path}/${k}`, expected: v })
        else out.push(...diffSpec(v, mb.get(k), `${path}/${k}`))
      }
      for (const [k, v] of mb) if (!ma.has(k)) out.push({ kind: 'added', path: `${path}/${k}`, actual: v })
      return out
    }
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length) out.push({ kind: 'added', path: `${path}/${i}`, actual: b[i] })
      else if (i >= b.length) out.push({ kind: 'missing', path: `${path}/${i}`, expected: a[i] })
      else out.push(...diffSpec(a[i], b[i], `${path}/${i}`))
    }
    return out
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ kind: 'changed', path, expected: a, actual: b })
  return out
}

const short = (v: any, max = 110) => {
  const s = JSON.stringify(v) ?? String(v)
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** Render a diff list as a stable, reviewable report. */
export const report = (diffs: Diff[]): string =>
  diffs
    .map(d =>
      d.kind === 'changed'
        ? `changed ${d.path}\n           spec: ${short(d.expected)}\n           gen:  ${short(d.actual)}`
        : d.kind === 'missing'
          ? `missing ${d.path}  ${short(d.expected)}`
          : `added   ${d.path}  ${short(d.actual)}`
    )
    .join('\n')
