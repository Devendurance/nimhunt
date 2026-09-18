import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'dist-ssr') continue
      listSourceFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

function prodSourceFiles(): string[] {
  return listSourceFiles(join(root, 'src')).filter(file => {
    const normalized = file.split(join(root)).join('').replace(/\\/g, '/')
    return !/\.test\.tsx?$/.test(normalized) && !normalized.endsWith('/data/play.fixtures.ts')
  })
}

describe('production-truth cleanup (no preview fallbacks)', () => {
  it('imports no fixture data from any production source file', () => {
    const offenders: string[] = []
    for (const file of prodSourceFiles()) {
      const source = readFileSync(file, 'utf8')
      if (source.includes('data/play.fixtures') || source.includes('playFixture') || source.includes('marketing.fixtures')) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it('renders no fake identity, timer, or sample-ranking copy in production UI', () => {
    const haystack = prodSourceFiles()
      .map(file => readFileSync(file, 'utf8'))
      .join('\n')
    expect(haystack).not.toContain('Demo Explorer')
    expect(haystack).not.toContain('08:42:17')
    expect(haystack).not.toContain('SAMPLE RANKING')
    expect(haystack).not.toContain('previewReset')
    expect(haystack).not.toContain('leaderboardPreviewFixture')
    expect(haystack).not.toContain('huntPreviewFixture')
  })

  it('removed dead preview modules', () => {
    expect(existsSync(join(root, 'src/components/marketing/HallOfHeroesSection.tsx'))).toBe(false)
    expect(existsSync(join(root, 'src/data/marketing.fixtures.ts'))).toBe(false)
  })

  it('keeps hunt-status loading/unavailable honest at the source level', () => {
    const view = read('src/components/play/huntStatusView.ts')
    expect(view).not.toContain('playFixture')
    expect(view).not.toContain('fixture.treasuresTotal')
    expect(view.match(/treasuresTotal: '—'/g)).toHaveLength(2)
  })

  it('still renders real API values when the daily hunt is live', () => {
    const view = read('src/components/play/huntStatusView.ts')
    expect(view).toContain('source.remainingSlots')
    expect(view).toContain('source.totalSlots')
    expect(view).toContain('source.nextResetAt')
    expect(view).toContain("'LIVE'")
  })

  it('keeps the progress strip free of fabricated player stats', () => {
    const strip = read('src/components/play/ProgressStrip.tsx')
    expect(strip).not.toContain('playFixture')
    expect(strip).not.toContain('148')
    expect(strip).not.toContain('2,480')
    expect(strip).not.toContain('Preview progress')
    expect(strip).toContain('—')
  })

  it('keeps live integrations wired: daily status, Treasure Bank, Monthly Heroes, audio', () => {
    const shell = read('src/components/play/PlayShell.tsx')
    expect(shell).toContain('useDailyHuntStatus')
    expect(shell).toContain('TreasureBankSection')
    expect(shell).toContain('MonthlyHeroesBlock')
    expect(shell).toContain('YourMonthBlock')
    expect(shell).toContain("useNimhuntBgm('main', 'shell')")
    const status = read('src/components/play/HuntStatus.tsx')
    expect(status).toContain('resolveHuntStatusView')
    expect(status).toContain('treasuresRemaining')
    const view = read('src/components/play/huntStatusView.ts')
    expect(view).toContain('remainingSlots')
    expect(view).toContain('totalSlots')
    expect(view).toContain('nextResetAt')
    const audio = read('src/audio/nimhuntAudio.ts')
    expect(audio).toContain('WORLD_TRACK_URLS')
    expect(audio).toContain('SFX_URLS')
  })
})
