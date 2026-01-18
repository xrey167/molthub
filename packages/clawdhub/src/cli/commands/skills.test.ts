/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalOpts } from '../types'

const mockApiRequest = vi.fn()
vi.mock('../../http.js', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}))

const mockGetRegistry = vi.fn(async () => 'https://clawdhub.com')
vi.mock('../registry.js', () => ({
  getRegistry: () => mockGetRegistry(),
}))

const mockSpinner = { stop: vi.fn(), fail: vi.fn() }
vi.mock('../ui.js', () => ({
  createSpinner: vi.fn(() => mockSpinner),
  formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}))

const { clampLimit, cmdExplore, formatExploreLine } = await import('./skills')

const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {})

function makeOpts(): GlobalOpts {
  return {
    workdir: '/work',
    dir: '/work/skills',
    site: 'https://clawdhub.com',
    registry: 'https://clawdhub.com',
    registrySource: 'default',
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('explore helpers', () => {
  it('clamps explore limits and handles non-finite values', () => {
    expect(clampLimit(-5)).toBe(1)
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(1)).toBe(1)
    expect(clampLimit(50)).toBe(50)
    expect(clampLimit(99)).toBe(50)
    expect(clampLimit(Number.NaN)).toBe(25)
    expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(25)
    expect(clampLimit(Number.NaN, 10)).toBe(10)
  })

  it('formats explore lines with relative time and truncation', () => {
    const now = 4 * 60 * 60 * 1000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
    const summary = 'a'.repeat(60)
    const line = formatExploreLine({
      slug: 'weather',
      summary,
      updatedAt: now - 2 * 60 * 60 * 1000,
      latestVersion: null,
    })
    expect(line).toBe(`weather  v?  2h ago  ${'a'.repeat(49)}…`)
    nowSpy.mockRestore()
  })
})

describe('cmdExplore', () => {
  it('clamps limit and handles empty results', async () => {
    mockApiRequest.mockResolvedValue({ items: [] })

    await cmdExplore(makeOpts(), 0)

    const [, args] = mockApiRequest.mock.calls[0] ?? []
    const url = new URL(String(args?.url))
    expect(url.searchParams.get('limit')).toBe('1')
    expect(mockLog).toHaveBeenCalledWith('No skills found.')
  })

  it('prints formatted results', async () => {
    const now = 10 * 60 * 1000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
    const item = {
      slug: 'gog',
      summary: 'Google Workspace CLI for Gmail, Calendar, Drive and more.',
      updatedAt: now - 90 * 1000,
      latestVersion: { version: '1.2.3' },
    }
    mockApiRequest.mockResolvedValue({ items: [item] })

    await cmdExplore(makeOpts(), 100)

    const [, args] = mockApiRequest.mock.calls[0] ?? []
    const url = new URL(String(args?.url))
    expect(url.searchParams.get('limit')).toBe('50')
    expect(mockLog).toHaveBeenCalledWith(formatExploreLine(item))
    nowSpy.mockRestore()
  })
})
