import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

describe('production /play routing', () => {
  it('has a Vercel SPA rewrite for /play', () => {
    const vercel = JSON.parse(read('vercel.json')) as {
      rewrites?: Array<{ source: string; destination: string }>
      crons?: Array<{ path: string; schedule: string }>
    }
    const rewrites = vercel.rewrites ?? []
    const play = rewrites.find(entry => entry.source === '/play')
    expect(play).toBeDefined()
    expect(play?.destination).toBe('/index.html')
  })

  it('does NOT rewrite /api/* to index.html', () => {
    const vercel = JSON.parse(read('vercel.json')) as {
      rewrites?: Array<{ source: string; destination: string }>
    }
    const rewrites = vercel.rewrites ?? []
    for (const entry of rewrites) {
      expect(entry.destination).not.toContain('/api')
      expect(entry.source.startsWith('/api')).toBe(false)
      expect(entry.source.includes('*')).toBe(false)
    }
    const raw = read('vercel.json')
    expect(raw).not.toContain('/api/*')
  })

  it('keeps payout cron config unchanged', () => {
    const vercel = JSON.parse(read('vercel.json')) as {
      crons?: Array<{ path: string; schedule: string }>
    }
    expect(vercel.crons).toHaveLength(1)
    expect(vercel.crons?.[0]).toEqual({
      path: '/api/internal/payout-cycle',
      schedule: '0 14 * * *',
    })
  })

  it('keeps query-string /play routes client-side via React Router', () => {
    const app = read('src/App.tsx')
    expect(app).toContain('BrowserRouter')
    expect(app).toContain('"/play"')
    expect(app).toContain('PlayPage')
  })
})

describe('production in-app CTA navigation', () => {
  it('uses client-side /play navigation for in-app CTA', () => {
    const source = read('src/components/marketing/HuntCTA.tsx')
    expect(source).toContain("from 'react-router-dom'")
    expect(source).toContain('<Link')
    expect(source).toContain('to={cta.href}')
    expect(source).toContain("cta.kind === 'in-app'")
    expect(source).not.toContain('href="/play"')
  })

  it('keeps external deep-link CTA as a normal anchor', () => {
    const source = read('src/components/marketing/HuntCTA.tsx')
    expect(source).toContain("cta.kind === 'deep-link'")
    expect(source).toContain('<a className="button primary" href={cta.href}>')
  })
})

describe('live landing hunt status (static)', () => {
  it('no longer renders huntPreviewFixture on the landing path', () => {
    const home = read('src/routes/HomePage.tsx')
    expect(home).not.toContain('huntPreviewFixture')
    expect(home).not.toContain('LiveHuntStatus {...huntPreviewFixture}')
    expect(home).toContain('LandingHuntStatus')
    const landing = read('src/components/marketing/LandingHuntStatus.tsx')
    expect(landing).not.toContain('huntPreviewFixture')
    expect(landing).not.toContain('08:42:17')
    expect(landing).not.toContain('Sample data')
  })

  it('derives countdown from server nextResetAt and refreshes', () => {
    const hook = read('src/components/marketing/useLandingHuntStatus.ts')
    expect(hook).toContain('fetchDailyHuntStatus')
    expect(hook).toContain('nextResetAt')
    expect(hook).not.toContain('08:42:17')
    const live = read('src/components/marketing/LiveHuntStatus.tsx')
    expect(live).toContain('resetsAt')
    expect(live).toContain('setInterval')
    expect(live).toContain('1000')
  })

  it('refetches on reset boundary, visibility, and polling', () => {
    const hook = read('src/components/marketing/useLandingHuntStatus.ts')
    expect(hook).toContain('visibilitychange')
    expect(hook).toContain('setInterval')
    expect(hook).toContain('setTimeout')
    expect(hook).toContain('nextResetAt')
    expect(hook).toMatch(/45_000|45000|30_000|30000|60_000|60000/)
  })

  it('exposes no mock number in loading/unavailable states', () => {
    const landing = read('src/components/marketing/LandingHuntStatus.tsx')
    expect(landing).toContain('—')
    expect(landing).not.toContain('previewReset')
    expect(landing).not.toContain('preview={true')
    expect(landing).not.toContain('huntPreviewFixture')
    const live = read('src/components/marketing/LiveHuntStatus.tsx')
    expect(live).not.toContain('claimed: 26')
    expect(live).not.toContain('08:42:17')
  })

  it('requires no wallet access on the landing path', () => {
    const landing = read('src/components/marketing/LandingHuntStatus.tsx')
    const hook = read('src/components/marketing/useLandingHuntStatus.ts')
    expect(landing).not.toContain('wallet')
    expect(landing).not.toContain('getRememberedProductWallet')
    expect(landing).not.toContain('fetchWalletDailyStatus')
    expect(hook).not.toContain('fetchWalletDailyStatus')
    expect(hook).not.toContain('getRememberedProductWallet')
    expect(hook).toContain('fetchDailyHuntStatus')
  })
})
