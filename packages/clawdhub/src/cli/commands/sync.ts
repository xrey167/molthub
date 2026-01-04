import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { intro, isCancel, multiselect, note, outro, text } from '@clack/prompts'
import {
  ApiCliWhoamiResponseSchema,
  ApiRoutes,
  ApiSkillMetaResponseSchema,
  ApiSkillResolveResponseSchema,
} from 'clawdhub-schema'
import semver from 'semver'
import { readGlobalConfig } from '../../config.js'
import { apiRequest, downloadZip } from '../../http.js'
import { hashSkillFiles, hashSkillZip, listTextFiles } from '../../skills.js'
import { getRegistry } from '../registry.js'
import { findSkillFolders, getFallbackSkillRoots, type SkillFolder } from '../scanSkills.js'
import type { GlobalOpts } from '../types.js'
import { createSpinner, fail, formatError, isInteractive } from '../ui.js'
import { cmdPublish } from './publish.js'

type SyncOptions = {
  root?: string[]
  all?: boolean
  dryRun?: boolean
  bump?: 'patch' | 'minor' | 'major'
  changelog?: string
  tags?: string
}

type Candidate = SkillFolder & {
  fingerprint: string
  fileCount: number
  status: 'synced' | 'new' | 'update'
  matchVersion: string | null
  latestVersion: string | null
}

type LocalSkill = SkillFolder & {
  fingerprint: string
  fileCount: number
}

export async function cmdSync(opts: GlobalOpts, options: SyncOptions, inputAllowed: boolean) {
  const allowPrompt = isInteractive() && inputAllowed !== false
  intro('ClawdHub sync')

  const cfg = await readGlobalConfig()
  const token = cfg?.token
  if (!token) fail('Not logged in. Run: clawdhub login')

  const registry = await getRegistryWithAuth(opts, token)
  const selectedRoots = buildScanRoots(opts, options.root)

  const spinner = createSpinner('Scanning for local skills')
  let scan = await scanRoots(selectedRoots)
  if (scan.skills.length === 0) {
    const fallback = getFallbackSkillRoots(opts.workdir)
    scan = await scanRoots(fallback)
    spinner.stop()
    if (scan.skills.length === 0)
      fail('No skills found (checked workdir and known Clawdis/Clawd locations)')
    note(
      `No skills in workdir. Found ${scan.skills.length} in legacy locations.`,
      formatList(scan.rootsWithSkills, 10),
    )
  } else {
    spinner.stop()
  }
  const deduped = dedupeSkillsBySlug(scan.skills)
  const skills = deduped.skills
  if (deduped.duplicates.length > 0) {
    note('Skipped duplicate slugs', formatCommaList(deduped.duplicates, 16))
  }
  const parsingSpinner = createSpinner('Parsing local skills')
  const locals: LocalSkill[] = []
  try {
    let index = 0
    for (const skill of skills) {
      index += 1
      parsingSpinner.text = `Parsing local skills ${index}/${skills.length}`
      const filesOnDisk = await listTextFiles(skill.folder)
      const hashed = hashSkillFiles(filesOnDisk)
      locals.push({
        ...skill,
        fingerprint: hashed.fingerprint,
        fileCount: filesOnDisk.length,
      })
    }
  } catch (error) {
    parsingSpinner.fail(formatError(error))
    throw error
  } finally {
    parsingSpinner.stop()
  }

  const candidatesSpinner = createSpinner('Checking registry sync state')
  const candidates: Candidate[] = []
  let supportsResolve: boolean | null = null
  try {
    let index = 0
    for (const skill of locals) {
      index += 1
      candidatesSpinner.text = `Checking registry sync state ${index}/${locals.length}`

      const meta = await apiRequest(
        registry,
        { method: 'GET', path: `${ApiRoutes.skill}?slug=${encodeURIComponent(skill.slug)}` },
        ApiSkillMetaResponseSchema,
      ).catch(() => null)

      const latestVersion = meta?.latestVersion?.version ?? null
      if (!latestVersion) {
        candidates.push({
          ...skill,
          status: 'new',
          matchVersion: null,
          latestVersion: null,
        })
        continue
      }

      let matchVersion: string | null = null
      if (supportsResolve !== false) {
        try {
          const resolved = await apiRequest(
            registry,
            {
              method: 'GET',
              path: `${ApiRoutes.skillResolve}?slug=${encodeURIComponent(skill.slug)}&hash=${encodeURIComponent(skill.fingerprint)}`,
            },
            ApiSkillResolveResponseSchema,
          )
          supportsResolve = true
          matchVersion = resolved.match?.version ?? null
        } catch (error) {
          const message = formatError(error)
          if (/skill not found/i.test(message)) {
            matchVersion = null
          } else if (/no matching routes found/i.test(message) || /not found/i.test(message)) {
            supportsResolve = false
          } else {
            throw error
          }
        }
      }

      if (supportsResolve === false) {
        const zip = await downloadZip(registry, { slug: skill.slug, version: latestVersion })
        const remote = hashSkillZip(zip).fingerprint
        matchVersion = remote === skill.fingerprint ? latestVersion : null
      }

      candidates.push({
        ...skill,
        status: matchVersion ? 'synced' : 'update',
        matchVersion,
        latestVersion,
      })
    }
  } catch (error) {
    candidatesSpinner.fail(formatError(error))
    throw error
  } finally {
    candidatesSpinner.stop()
  }

  const synced = candidates.filter((candidate) => candidate.status === 'synced')
  const actionable = candidates.filter((candidate) => candidate.status !== 'synced')
  const bump = options.bump ?? 'patch'

  if (actionable.length === 0) {
    if (synced.length > 0) {
      note('Already synced', formatCommaList(synced.map(formatSyncedSummary), 16))
    }
    outro('Nothing to sync.')
    return
  }

  note(
    'To sync',
    formatBulletList(
      actionable.map((candidate) => formatActionableLine(candidate, bump)),
      20,
    ),
  )
  if (synced.length > 0) {
    note('Already synced', formatSyncedDisplay(synced))
  }

  const selected = await selectToUpload(actionable, {
    allowPrompt,
    all: Boolean(options.all),
    bump,
  })
  if (selected.length === 0) {
    outro('Nothing selected.')
    return
  }

  if (options.dryRun) {
    outro(`Dry run: would upload ${selected.length} skill(s).`)
    return
  }

  const tags = options.tags ?? 'latest'

  for (const skill of selected) {
    const { publishVersion, changelog } = await resolvePublishMeta(skill, {
      bump,
      allowPrompt,
      changelogFlag: options.changelog,
    })
    await cmdPublish(opts, skill.folder, {
      slug: skill.slug,
      name: skill.displayName,
      version: publishVersion,
      changelog,
      tags,
    })
  }

  outro(`Uploaded ${selected.length} skill(s).`)
}

function buildScanRoots(opts: GlobalOpts, extraRoots: string[] | undefined) {
  const roots = [opts.workdir, opts.dir, ...(extraRoots ?? [])]
  return Array.from(new Set(roots.map((root) => resolve(root))))
}

async function scanRoots(roots: string[]) {
  const all: SkillFolder[] = []
  const rootsWithSkills: string[] = []
  const uniqueRoots = await dedupeRoots(roots)
  for (const root of uniqueRoots) {
    const found = await findSkillFolders(root)
    if (found.length > 0) rootsWithSkills.push(root)
    all.push(...found)
  }
  const byFolder = new Map<string, SkillFolder>()
  for (const folder of all) {
    byFolder.set(folder.folder, folder)
  }
  return { skills: Array.from(byFolder.values()), rootsWithSkills }
}

async function dedupeRoots(roots: string[]) {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const root of roots) {
    const resolved = resolve(root)
    const canonical = await realpath(resolved).catch(() => null)
    const key = canonical ?? resolved
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(key)
  }
  return unique
}

async function selectToUpload(
  candidates: Candidate[],
  params: { allowPrompt: boolean; all: boolean; bump: 'patch' | 'minor' | 'major' },
): Promise<Candidate[]> {
  if (params.all || !params.allowPrompt) return candidates

  const valueByKey = new Map<string, Candidate>()
  const choices = candidates.map((candidate) => {
    const key = candidate.folder
    valueByKey.set(key, candidate)
    return {
      value: key,
      label: `${candidate.slug}  ${formatActionableStatus(candidate, params.bump)}`,
      hint: `${abbreviatePath(candidate.folder)} | ${candidate.fileCount} files`,
    }
  })

  const picked = await multiselect({
    message: 'Select skills to upload',
    options: choices,
    initialValues: choices.map((choice) => choice.value),
    required: false,
  })
  if (isCancel(picked)) fail('Canceled')
  const selected = picked.map((key) => valueByKey.get(String(key))).filter(Boolean) as Candidate[]
  return selected
}

async function resolvePublishMeta(
  skill: Candidate,
  params: { bump: 'patch' | 'minor' | 'major'; allowPrompt: boolean; changelogFlag?: string },
) {
  if (skill.status === 'new') {
    return { publishVersion: '1.0.0', changelog: '' }
  }

  const latest = skill.latestVersion
  if (!latest) fail(`Could not resolve latest version for ${skill.slug}`)
  const publishVersion = semver.inc(latest, params.bump)
  if (!publishVersion) fail(`Could not bump version for ${skill.slug}`)

  const fromFlag = params.changelogFlag?.trim()
  if (fromFlag) return { publishVersion, changelog: fromFlag }

  if (!params.allowPrompt) {
    return { publishVersion, changelog: 'Sync update' }
  }

  const entered = await text({
    message: `Changelog (optional) for ${skill.slug}@${publishVersion}`,
    placeholder: 'What changed?',
    defaultValue: '',
  })
  if (isCancel(entered)) fail('Canceled')
  const changelog = String(entered ?? '').trim()
  return { publishVersion, changelog }
}

async function getRegistryWithAuth(opts: GlobalOpts, token: string) {
  const registry = await getRegistry(opts, { cache: true })
  await apiRequest(
    registry,
    { method: 'GET', path: ApiRoutes.cliWhoami, token },
    ApiCliWhoamiResponseSchema,
  )
  return registry
}

function formatList(values: string[], max: number) {
  if (values.length === 0) return ''
  const shown = values.map(abbreviatePath)
  if (shown.length <= max) return shown.join('\n')
  const head = shown.slice(0, Math.max(1, max - 1))
  const rest = values.length - head.length
  return [...head, `… +${rest} more`].join('\n')
}

function abbreviatePath(value: string) {
  const home = homedir()
  if (value.startsWith(home)) return `~${value.slice(home.length)}`
  return value
}

function dedupeSkillsBySlug(skills: SkillFolder[]) {
  const bySlug = new Map<string, SkillFolder[]>()
  for (const skill of skills) {
    const existing = bySlug.get(skill.slug)
    if (existing) existing.push(skill)
    else bySlug.set(skill.slug, [skill])
  }
  const unique: SkillFolder[] = []
  const duplicates: string[] = []
  for (const [slug, entries] of bySlug.entries()) {
    unique.push(entries[0] as SkillFolder)
    if (entries.length > 1) duplicates.push(`${slug} (${entries.length})`)
  }
  return { skills: unique, duplicates }
}

function formatActionableStatus(candidate: Candidate, bump: 'patch' | 'minor' | 'major'): string {
  if (candidate.status === 'new') return 'NEW'
  const latest = candidate.latestVersion
  const next = latest ? semver.inc(latest, bump) : null
  if (latest && next) return `UPDATE ${latest} → ${next}`
  return 'UPDATE'
}

function formatActionableLine(candidate: Candidate, bump: 'patch' | 'minor' | 'major'): string {
  return `${candidate.slug}  ${formatActionableStatus(candidate, bump)}  (${candidate.fileCount} files)`
}

function formatSyncedLine(candidate: Candidate): string {
  const version = candidate.matchVersion ?? candidate.latestVersion ?? 'unknown'
  return `${candidate.slug}  synced (${version})`
}

function formatSyncedSummary(candidate: Candidate): string {
  const version = candidate.matchVersion ?? candidate.latestVersion
  return version ? `${candidate.slug}@${version}` : candidate.slug
}

function formatBulletList(lines: string[], max: number): string {
  if (lines.length <= max) return lines.map((line) => `- ${line}`).join('\n')
  const head = lines.slice(0, max)
  const rest = lines.length - head.length
  return [...head, `... +${rest} more`].map((line) => `- ${line}`).join('\n')
}

function formatSyncedDisplay(synced: Candidate[]) {
  const lines = synced.map(formatSyncedLine)
  if (lines.length <= 12) return formatBulletList(lines, 12)
  return formatCommaList(synced.map(formatSyncedSummary), 24)
}

function formatCommaList(values: string[], max: number) {
  if (values.length === 0) return ''
  if (values.length <= max) return values.join(', ')
  const head = values.slice(0, Math.max(1, max - 1))
  const rest = values.length - head.length
  return `${head.join(', ')}, ... +${rest} more`
}
