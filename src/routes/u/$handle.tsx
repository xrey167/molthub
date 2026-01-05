import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { SkillCard } from '../../components/SkillCard'

export const Route = createFileRoute('/u/$handle')({
  component: UserProfile,
})

function UserProfile() {
  const { handle } = Route.useParams()
  const user = useQuery(api.users.getByHandle, { handle }) as Doc<'users'> | null | undefined
  const starredSkills = useQuery(
    api.stars.listByUser,
    user ? { userId: user._id, limit: 50 } : 'skip',
  ) as Doc<'skills'>[] | undefined

  if (user === undefined) {
    return (
      <main className="section">
        <div className="card">
          <div className="loading-indicator">Loading user…</div>
        </div>
      </main>
    )
  }

  if (user === null) {
    return (
      <main className="section">
        <div className="card">User not found.</div>
      </main>
    )
  }

  const avatar = user.image
  const displayName = user.displayName ?? user.name ?? user.handle ?? 'User'
  const displayHandle = user.handle ?? user.name ?? handle
  const initial = displayName.charAt(0).toUpperCase()
  const isLoadingSkills = starredSkills === undefined
  const skills = starredSkills ?? []

  return (
    <main className="section">
      <div className="card settings-profile" style={{ marginBottom: 22 }}>
        <div className="settings-avatar" aria-hidden="true">
          {avatar ? <img src={avatar} alt="" /> : <span>{initial}</span>}
        </div>
        <div className="settings-profile-body">
          <div className="settings-name">{displayName}</div>
          <div className="settings-handle">@{displayHandle}</div>
        </div>
      </div>

      <h2 className="section-title" style={{ fontSize: '1.3rem' }}>
        Stars
      </h2>
      <p className="section-subtitle">Skills this user has starred.</p>

      {isLoadingSkills ? (
        <div className="card">
          <div className="loading-indicator">Loading stars…</div>
        </div>
      ) : skills.length === 0 ? (
        <div className="card">No stars yet.</div>
      ) : (
        <div className="grid">
          {skills.map((skill) => (
            <SkillCard
              key={skill._id}
              skill={skill}
              badge={skill.batch === 'highlighted' ? 'Highlighted' : undefined}
              summaryFallback="Agent-ready skill pack."
              meta={
                <div className="stat">
                  ⭐ {skill.stats.stars} · ⤓ {skill.stats.downloads}
                </div>
              }
            />
          ))}
        </div>
      )}
    </main>
  )
}
