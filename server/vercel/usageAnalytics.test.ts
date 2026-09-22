// Usage-analytics integration tests: Vercel Analytics mounted exactly once
// at the root, the presence beacon mounted globally, the live strip placed
// on the production landing, and the public-stats endpoint wired through
// the product adapter + Vercel rewrites.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function read(relative: string): string {
  return readFileSync(join(root, relative), 'utf8')
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

describe('vercel analytics integration', () => {
  it('renders <Analytics /> exactly once, at the root render', () => {
    const main = read('src/main.tsx')
    expect(main).toContain("import { Analytics } from '@vercel/analytics/react'")
    expect(countMatches(main, /<Analytics\s*\/>/g)).toBe(1)

    // No route or component duplicates the Analytics mount.
    const duplicates = ['src/App.tsx', 'src/routes/HomePage.tsx', 'src/routes/PlayPage.tsx']
      .flatMap(path => {
        const text = read(path)
        return text.includes('<Analytics') ? [path] : []
      })
    expect(duplicates).toEqual([])
  })

  it('renders <SpeedInsights /> exactly once, at the root render', () => {
    const main = read('src/main.tsx')
    expect(main).toContain("import { SpeedInsights } from '@vercel/speed-insights/react'")
    expect(countMatches(main, /<SpeedInsights\s*\/>/g)).toBe(1)

    const duplicates = ['src/App.tsx', 'src/routes/HomePage.tsx', 'src/routes/PlayPage.tsx']
      .flatMap(path => {
        const text = read(path)
        return text.includes('<SpeedInsights') ? [path] : []
      })
    expect(duplicates).toEqual([])
  })

  it('orders the root render as App, Analytics, SpeedInsights', () => {
    const main = read('src/main.tsx')
    const app = main.indexOf('<App />')
    const analytics = main.indexOf('<Analytics />')
    const speed = main.indexOf('<SpeedInsights />')
    expect(app).toBeGreaterThanOrEqual(0)
    expect(analytics).toBeGreaterThan(app)
    expect(speed).toBeGreaterThan(analytics)
  })

  it('declares the analytics + speed-insights dependencies in package.json + lockfile', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string> }
    expect(pkg.dependencies?.['@vercel/analytics']).toBeTruthy()
    expect(pkg.dependencies?.['@vercel/speed-insights']).toBeTruthy()
    expect(read('package-lock.json')).toContain('"node_modules/@vercel/analytics"')
    expect(read('package-lock.json')).toContain('"node_modules/@vercel/speed-insights"')
  })
})

describe('presence beacon wiring', () => {
  it('mounts the global beacon once in App so / and /play share one channel', () => {
    const app = read('src/App.tsx')
    expect(app).toContain('SitePresenceBeacon')
    expect(countMatches(app, /<SitePresenceBeacon\s*\/>/g)).toBe(1)
    expect(read('src/routes/PlayPage.tsx')).not.toContain('SitePresenceBeacon')
  })

  it('uses one shared channel keyed by the anonymous visitor id', () => {
    const hook = read('src/hooks/useSitePresence.ts')
    const client = read('src/integrations/supabase/browserPresenceClient.ts')
    expect(hook).toContain('nimhunt:site-presence')
    expect(hook).toContain('SITE_VISITOR_STORAGE_KEY')
    expect(client).toContain('nimhunt:visitor-id')
    expect(hook).toContain('channel.track(')
    const trackLine = hook.split('\n').find(line => line.includes('channel.track(')) ?? ''
    expect(trackLine).toContain('visitorId')
    expect(trackLine).toContain('route')
    expect(trackLine).toContain('joinedAt')
    expect(trackLine).not.toMatch(/wallet|email|address|\bip\b/i)
    expect(client).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/)
    expect(client).toContain('VITE_SUPABASE_URL')
  })
})

describe('production landing live strip', () => {
  it('renders the live strip between hero and hunt status', () => {
    const home = read('src/routes/HomePage.tsx')
    expect(home).toContain('LiveCommunityStrip')
    const hero = home.indexOf('<HeroSection')
    const strip = home.indexOf('<LiveCommunityStrip')
    const status = home.indexOf('<LandingHuntStatus')
    expect(hero).toBeGreaterThanOrEqual(0)
    expect(strip).toBeGreaterThan(hero)
    expect(status).toBeGreaterThan(strip)
  })

  it('keeps the live dot subtle and motion-safe', () => {
    const css = read('src/index.css')
    expect(css).toContain('.live-dot')
    expect(css).toContain('@keyframes live-pulse')
    const reduced = css.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(reduced).toBeGreaterThanOrEqual(0)
    expect(css.slice(reduced)).toContain('.live-dot')
  })

  it('keeps the hero untouched and the strip accessible', () => {
    const hero = read('src/components/marketing/HeroSection.tsx')
    expect(hero).not.toContain('LiveCommunityStrip')
    expect(hero).toContain('Explore the ruins.')
    const strip = read('src/components/marketing/LiveCommunityStrip.tsx')
    expect(strip).toContain('aria-label="Live community"')
    expect(strip).toContain('aria-live="polite"')
    expect(strip).not.toMatch(/wallet\s*:|address\s*:|\bNQ[A-Z0-9]/)
  })
})

describe('public-stats wiring', () => {
  it('follows the product adapter + explicit rewrite architecture', () => {
    const adapter = read('server/vercel/productAdapter.ts')
    expect(adapter).toContain('PUBLIC_STATS_PATH')
    expect(adapter).toContain('dispatchPublicStatsHttp')
    expect(adapter).not.toContain(':path*')
    const vercel = JSON.parse(read('vercel.json')) as {
      rewrites?: { source: string; destination: string }[]
    }
    const rewrite = vercel.rewrites?.find(entry => entry.source === '/api/public-stats')
    expect(rewrite?.destination).toBe('/api/product?__nimhunt_route=/api/public-stats')
  })

  it('keeps payout-cycle isolated from the product adapter', () => {
    const adapter = read('server/vercel/productAdapter.ts')
    expect(adapter).toContain('isPayoutCyclePath')
    const vercel = JSON.parse(read('vercel.json')) as { rewrites?: { source: string }[] }
    expect(vercel.rewrites?.some(entry => entry.source === '/api/internal/payout-cycle')).toBe(false)
  })
})
