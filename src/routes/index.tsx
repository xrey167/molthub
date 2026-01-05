import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Doc } from '../../convex/_generated/dataModel'
import { InstallSwitcher } from '../components/InstallSwitcher'
import { SkillCard } from '../components/SkillCard'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const highlighted =
    (useQuery(api.skills.list, { batch: 'highlighted', limit: 6 }) as Doc<'skills'>[]) ?? []
  const latest = (useQuery(api.skills.list, { limit: 12 }) as Doc<'skills'>[]) ?? []

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-inner">
          <div className="fade-up" data-delay="1">
            <span className="hero-badge">Lobster-light. Agent-right.</span>
            <h1 className="hero-title">ClawdHub, the skill dock for sharp agents.</h1>
            <p className="hero-subtitle">
              Upload AgentSkills bundles, version them like npm, and make them searchable with
              vectors. No gatekeeping, just signal.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <Link to="/upload" className="btn btn-primary">
                Publish a skill
              </Link>
              <Link to="/search" className="btn">
                Explore search
              </Link>
            </div>
          </div>
          <div className="hero-card fade-up" data-delay="2">
            <div className="search-bar">
              <span className="mono">/</span>
              <input
                className="search-input"
                placeholder="Search skills, tags, or capabilities"
                disabled
              />
              <Link to="/search" className="btn">
                Search
              </Link>
            </div>
            <div className="hero-install" style={{ marginTop: 18 }}>
              <div className="stat">Search skills. Versioned, rollback-ready.</div>
              <InstallSwitcher exampleSlug="sonoscli" />
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Highlighted batch</h2>
        <p className="section-subtitle">Curated signal — highlighted for quick trust.</p>
        <div className="grid">
          {highlighted.length === 0 ? (
            <div className="card">No highlighted skills yet.</div>
          ) : (
            highlighted.map((skill) => (
              <SkillCard
                key={skill._id}
                skill={skill}
                badge="Highlighted"
                summaryFallback="A fresh skill bundle."
                meta={
                  <div className="stat">
                    ⭐ {skill.stats.stars} · ⤓ {skill.stats.downloads}
                  </div>
                }
              />
            ))
          )}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Latest drops</h2>
        <p className="section-subtitle">Newest uploads across the registry.</p>
        <div className="grid">
          {latest.length === 0 ? (
            <div className="card">No skills yet. Be the first.</div>
          ) : (
            latest.map((skill) => (
              <SkillCard
                key={skill._id}
                skill={skill}
                summaryFallback="Agent-ready skill pack."
                meta={
                  <div className="stat">
                    {skill.stats.versions} versions · {skill.stats.downloads} downloads
                  </div>
                }
              />
            ))
          )}
        </div>
      </section>
    </main>
  )
}
