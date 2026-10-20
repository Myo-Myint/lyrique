import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, net: {} }))
const { isNewer, pickRelease } = await import('../src/main/updates')

describe('isNewer', () => {
  it('compares semver-ish versions numerically', () => {
    expect(isNewer('v0.3.0', '0.2.0')).toBe(true)
    expect(isNewer('0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('v0.1.9', '0.2.0')).toBe(false)
    expect(isNewer('1.0.0-beta', '0.9.0')).toBe(true)
  })
})

describe('pickRelease', () => {
  // Newest first, as GitHub lists them: a Windows beta published just before the Mac release.
  const releases = [
    { tag_name: 'v0.6.2', prerelease: false, assets: [{ name: 'Lyrique-0.6.2-arm64.dmg' }] },
    { tag_name: 'v0.6.2-beta.1', prerelease: true, assets: [{ name: 'Lyrique-0.6.2-x64.exe' }] },
    { tag_name: 'v0.7.0', draft: true, assets: [{ name: 'Lyrique-0.7.0-x64.exe' }] }
  ]

  it('gives the Mac the latest full release', () => {
    expect(pickRelease(releases, 'darwin')?.tag_name).toBe('v0.6.2')
  })

  it('gives Windows the newest release with an installer, skipping drafts', () => {
    expect(pickRelease([releases[2]!, ...releases.slice(0, 2)], 'win32')?.tag_name).toBe('v0.6.2-beta.1')
  })

  it('finds nothing when there is no match', () => {
    expect(pickRelease([releases[1]!], 'darwin')).toBeNull()
    expect(pickRelease([releases[0]!], 'win32')).toBeNull()
  })
})
