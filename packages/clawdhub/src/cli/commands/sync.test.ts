/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalOpts } from '../types'

const mockIntro = vi.fn()
const mockOutro = vi.fn()
const mockNote = vi.fn()
const mockMultiselect = vi.fn<Promise<string[]>, [unknown?]>(async () => [])
let interactive = false

const defaultFindSkillFolders = async (root: string) => {
  if (!root.endsWith('/scan')) return []
  return [
    { folder: '/scan/new-skill', slug: 'new-skill', displayName: 'New Skill' },
    { folder: '/scan/synced-skill', slug: 'synced-skill', displayName: 'Synced Skill' },
    { folder: '/scan/update-skill', slug: 'update-skill', displayName: 'Update Skill' },
  ]
}

vi.mock('@clack/prompts', () => ({
  intro: (value: string) => mockIntro(value),
  outro: (value: string) => mockOutro(value),
  note: (message: string, body?: string) => mockNote(message, body),
  multiselect: (args: unknown) => mockMultiselect(args),
  text: vi.fn(async () => ''),
  isCancel: () => false,
}))

vi.mock('../../config.js', () => ({
  readGlobalConfig: vi.fn(async () => ({ registry: 'https://clawdhub.com', token: 'tkn' })),
}))

const mockGetRegistry = vi.fn(async () => 'https://clawdhub.com')
vi.mock('../registry.js', () => ({
  getRegistry: () => mockGetRegistry(),
}))

const mockApiRequest = vi.fn()
vi.mock('../../http.js', () => ({
  apiRequest: (registry: unknown, args: unknown, schema?: unknown) =>
    mockApiRequest(registry, args, schema),
}))

const mockFail = vi.fn((message: string) => {
  throw new Error(message)
})
const mockSpinner = { succeed: vi.fn(), fail: vi.fn(), stop: vi.fn() }
vi.mock('../ui.js', () => ({
  createSpinner: vi.fn(() => mockSpinner),
  fail: (message: string) => mockFail(message),
  formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  isInteractive: () => interactive,
}))

vi.mock('../scanSkills.js', () => ({
  findSkillFolders: vi.fn(defaultFindSkillFolders),
  getFallbackSkillRoots: vi.fn(() => []),
}))

vi.mock('../../skills.js', async () => {
  const actual = await vi.importActual<typeof import('../../skills.js')>('../../skills.js')
  return {
    ...actual,
    listTextFiles: vi.fn(async (folder: string) => [
      { relPath: 'SKILL.md', bytes: new TextEncoder().encode(folder) },
    ]),
  }
})

const mockCmdPublish = vi.fn()
vi.mock('./publish.js', () => ({
  cmdPublish: (...args: unknown[]) => mockCmdPublish(...args),
}))

const { cmdSync } = await import('./sync')

function makeOpts(): GlobalOpts {
  return {
    workdir: '/work',
    dir: '/work/skills',
    site: 'https://clawdhub.com',
    registry: 'https://clawdhub.com',
  }
}

afterEach(async () => {
  vi.clearAllMocks()
  const { findSkillFolders } = await import('../scanSkills.js')
  vi.mocked(findSkillFolders).mockImplementation(defaultFindSkillFolders)
})

describe('cmdSync', () => {
  it('classifies skills as new/update/synced (dry-run, mocked HTTP)', async () => {
    interactive = false
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === '/api/cli/whoami') return { user: { handle: 'steipete' } }
      if (args.path.startsWith('/api/skill?slug=')) {
        const slug = new URL(`https://x.test${args.path}`).searchParams.get('slug')
        if (slug === 'new-skill') return { latestVersion: undefined, skill: null }
        if (slug === 'synced-skill') return { latestVersion: { version: '1.2.3' }, skill: {} }
        if (slug === 'update-skill') return { latestVersion: { version: '1.0.0' }, skill: {} }
      }
      if (args.path.startsWith('/api/skill/resolve?')) {
        const u = new URL(`https://x.test${args.path}`)
        const slug = u.searchParams.get('slug')
        if (slug === 'synced-skill') {
          return { match: { version: '1.2.3' }, latestVersion: { version: '1.2.3' } }
        }
        if (slug === 'update-skill') {
          return { match: null, latestVersion: { version: '1.0.0' } }
        }
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`)
    })

    await cmdSync(makeOpts(), { root: ['/scan'], all: true, dryRun: true }, true)

    expect(mockCmdPublish).not.toHaveBeenCalled()

    const alreadySyncedNote = mockNote.mock.calls.find((call) => call[0] === 'Already synced')
    expect(alreadySyncedNote?.[1]).toMatch(/synced-skill/)

    const dryRunOutro = mockOutro.mock.calls.at(-1)?.[0]
    expect(String(dryRunOutro)).toMatch(/Dry run: would upload 2 skill/)
  })

  it('prints bullet lists and selects all actionable by default', async () => {
    interactive = true
    mockMultiselect.mockImplementation(async (args?: unknown) => {
      const { initialValues } = args as { initialValues: string[] }
      return initialValues
    })
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === '/api/cli/whoami') return { user: { handle: 'steipete' } }
      if (args.path.startsWith('/api/skill?slug=')) {
        const slug = new URL(`https://x.test${args.path}`).searchParams.get('slug')
        if (slug === 'new-skill') return { latestVersion: undefined, skill: null }
        if (slug === 'synced-skill') return { latestVersion: { version: '1.2.3' }, skill: {} }
        if (slug === 'update-skill') return { latestVersion: { version: '1.0.0' }, skill: {} }
      }
      if (args.path.startsWith('/api/skill/resolve?')) {
        const u = new URL(`https://x.test${args.path}`)
        const slug = u.searchParams.get('slug')
        if (slug === 'synced-skill') {
          return { match: { version: '1.2.3' }, latestVersion: { version: '1.2.3' } }
        }
        if (slug === 'update-skill') {
          return { match: null, latestVersion: { version: '1.0.0' } }
        }
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`)
    })

    await cmdSync(makeOpts(), { root: ['/scan'], all: false, dryRun: false, bump: 'patch' }, true)

    const toSyncNote = mockNote.mock.calls.find((call) => call[0] === 'To sync')
    expect(toSyncNote?.[1]).toMatch(/- new-skill/)
    expect(toSyncNote?.[1]).toMatch(/- update-skill/)

    const syncedNote = mockNote.mock.calls.find((call) => call[0] === 'Already synced')
    expect(syncedNote?.[1]).toMatch(/- synced-skill/)

    const lastCall = mockMultiselect.mock.calls.at(-1)
    const promptArgs = lastCall ? (lastCall[0] as { initialValues: string[] }) : undefined
    expect(promptArgs?.initialValues.length).toBe(2)
    expect(mockCmdPublish).toHaveBeenCalledTimes(2)
  })

  it('shows condensed synced list when nothing to sync', async () => {
    interactive = false
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === '/api/cli/whoami') return { user: { handle: 'steipete' } }
      if (args.path.startsWith('/api/skill?slug=')) {
        return { latestVersion: { version: '1.0.0' }, skill: {} }
      }
      if (args.path.startsWith('/api/skill/resolve?')) {
        return { match: { version: '1.0.0' }, latestVersion: { version: '1.0.0' } }
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`)
    })

    await cmdSync(makeOpts(), { root: ['/scan'], all: true, dryRun: false }, true)

    const syncedNote = mockNote.mock.calls.find((call) => call[0] === 'Already synced')
    expect(syncedNote?.[1]).toMatch(/new-skill@1.0.0/)
    expect(syncedNote?.[1]).toMatch(/synced-skill@1.0.0/)
    expect(String(syncedNote?.[1])).not.toMatch(/\n-/)

    const outro = mockOutro.mock.calls.at(-1)?.[0]
    expect(String(outro)).toMatch(/Nothing to sync/)
  })

  it('dedupes duplicate slugs before publishing', async () => {
    interactive = false
    const { findSkillFolders } = await import('../scanSkills.js')
    vi.mocked(findSkillFolders).mockImplementation(async (root: string) => {
      if (!root.endsWith('/scan')) return []
      return [
        { folder: '/scan/dup-skill', slug: 'dup-skill', displayName: 'Dup Skill' },
        { folder: '/scan/dup-skill-copy', slug: 'dup-skill', displayName: 'Dup Skill' },
      ]
    })

    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === '/api/cli/whoami') return { user: { handle: 'steipete' } }
      if (args.path.startsWith('/api/skill?slug=')) {
        return { latestVersion: undefined, skill: null }
      }
      if (args.path.startsWith('/api/skill/resolve?')) {
        return { match: null, latestVersion: null }
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`)
    })

    await cmdSync(makeOpts(), { root: ['/scan'], all: true, dryRun: false }, true)

    expect(mockCmdPublish).toHaveBeenCalledTimes(1)
    const duplicateNote = mockNote.mock.calls.find((call) => call[0] === 'Skipped duplicate slugs')
    expect(duplicateNote?.[1]).toMatch(/dup-skill/)
  })

  it('allows empty changelog for updates (interactive)', async () => {
    interactive = true
    mockApiRequest.mockImplementation(async (_registry: string, args: { path: string }) => {
      if (args.path === '/api/cli/whoami') return { user: { handle: 'steipete' } }
      if (args.path.startsWith('/api/skill?slug=')) {
        const slug = new URL(`https://x.test${args.path}`).searchParams.get('slug')
        if (slug === 'new-skill') return { latestVersion: undefined, skill: null }
        if (slug === 'synced-skill') return { latestVersion: { version: '1.2.3' }, skill: {} }
        if (slug === 'update-skill') return { latestVersion: { version: '1.0.0' }, skill: {} }
      }
      if (args.path.startsWith('/api/skill/resolve?')) {
        const u = new URL(`https://x.test${args.path}`)
        const slug = u.searchParams.get('slug')
        if (slug === 'synced-skill') {
          return { match: { version: '1.2.3' }, latestVersion: { version: '1.2.3' } }
        }
        if (slug === 'update-skill') {
          return { match: null, latestVersion: { version: '1.0.0' } }
        }
      }
      throw new Error(`Unexpected apiRequest: ${args.path}`)
    })

    await cmdSync(makeOpts(), { root: ['/scan'], all: true, dryRun: false, bump: 'patch' }, true)

    const calls = mockCmdPublish.mock.calls.map(
      (call) => call[2] as { slug: string; changelog: string },
    )
    const update = calls.find((c) => c.slug === 'update-skill')
    if (!update) throw new Error('Missing update-skill publish')
    expect(update.changelog).toBe('')
  })
})
