import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, net: {} }))
const { isNewer } = await import('../src/main/updates')

describe('isNewer', () => {
  it('compares semver-ish versions numerically', () => {
    expect(isNewer('v0.3.0', '0.2.0')).toBe(true)
    expect(isNewer('0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('v0.1.9', '0.2.0')).toBe(false)
    expect(isNewer('1.0.0-beta', '0.9.0')).toBe(true)
  })
})
