import { describe, test, expect } from 'bun:test'
import { resolveReloadStrategy } from '../bin/util'

describe('dev watch-mode reload strategy', () => {
  test('respawn when Loader.registry is not available', () => {
    expect(resolveReloadStrategy({})).toBe('respawn')
    expect(resolveReloadStrategy({ Loader: undefined })).toBe('respawn')
    expect(resolveReloadStrategy({ Loader: {} })).toBe('respawn')
    expect(resolveReloadStrategy({ Loader: { registry: {} } })).toBe('respawn')
  })

  test('registry when Loader.registry.clear exists', () => {
    expect(resolveReloadStrategy({ Loader: { registry: { clear: () => {} } } })).toBe('registry')
  })

  test('current Bun runtime resolves to respawn', () => {
    expect(resolveReloadStrategy()).toBe('respawn')
  })
})
