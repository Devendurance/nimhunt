import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

const BACKEND_TERMS = /gameplayStartedAt|terminal|checkpointHash|transcriptHash|stateHash|installId|runId|claimId|payoutId|amountLuna|Luna\b|day_key|mission_type|reward_status/i

describe('monthly heroes live UI (static)', () => {
  it('shows six hero cards with Adventurer identity and a You marker', () => {
    const ui = read('src/components/play/MonthlyHeroes.tsx')
    expect(ui).toContain('MONTHLY HEROES')
    expect(ui).toContain('Hall of Heroes')
    expect(ui).toContain('YOU')
    expect(ui).toContain('displayName')
    expect(ui).toContain('AdventurerAvatarToken')
    expect(ui).toContain('leaderIdentityButton')
    expect(ui).not.toContain('maskedWallet')
    expect(ui).toContain('No heroes crowned yet')
    expect(ui).not.toMatch(BACKEND_TERMS)
    expect(ui).not.toMatch(/Demo Explorer|Sample Hero|SAMPLE/i)
  })

  it('shows YOUR MONTH with the required wallet stats and no backend terminology', () => {
    const ui = read('src/components/play/MonthlyHeroes.tsx')
    for (const label of ['Points', 'Gems', 'Chests', 'Completed', 'Failed', 'Vaults sealed', 'Expedition time', 'Current streak', 'Best streak', 'NIM delivered']) {
      expect(ui).toContain(label)
    }
    expect(ui).toContain('Ranked #')
    expect(ui).not.toMatch(BACKEND_TERMS)
  })

  it('covers loading and unavailable states with retry', () => {
    const ui = read('src/components/play/MonthlyHeroes.tsx')
    expect(ui).toContain('Loading this month')
    expect(ui).toContain('Loading your month')
    expect(ui).toContain('unavailable right now')
    expect(ui).toContain('Retry')
  })

  it('wires the /play heroes tab to live data without preview fixtures', () => {
    const shell = read('src/components/play/PlayShell.tsx')
    expect(shell).toContain('MonthlyHeroesBlock')
    expect(shell).toContain('YourMonthBlock')
    expect(shell).toContain('HALL OF HEROES</span>')
    expect(shell).not.toContain('HeroesPreview')
    expect(shell).not.toContain('HALL OF HEROES · PREVIEW')
    expect(shell).not.toContain('leaderboardPreviewFixture')
  })

  it('wires the landing Hall of Heroes to live data without fixtures', () => {
    const home = read('src/routes/HomePage.tsx')
    expect(home).toContain('HallOfHeroesLive')
    expect(home).not.toContain('leaderboardPreviewFixture')
    expect(home).not.toContain('HallOfHeroesSection previewRows')
    const live = read('src/components/marketing/HallOfHeroesLive.tsx')
    expect(live).toContain('Live standings')
    expect(live).toContain('Live rankings')
    expect(live).toContain('AdventurerAvatarToken')
    expect(live).toContain('displayName')
    expect(live).not.toContain('maskedWallet')
    expect(live).toContain('No heroes crowned yet')
    expect(live).toContain('unavailable right now')
    expect(live).toContain('Retry')
    expect(live).not.toContain('leaderboardPreviewFixture')
    expect(live).not.toContain('Demo Explorer')
    expect(live).not.toMatch(BACKEND_TERMS)
  })

  it('uses the approved public Adventurer sheet with only P4 social actions and no financial expansion', () => {
    const sheet = read('src/components/play/PublicAdventurerProfileSheet.tsx')
    for (const label of ['LIFETIME GEMS', 'EXPEDITIONS', 'BEST STREAK', 'ALLIES', 'Add Adventurer', 'Close profile']) expect(sheet).toContain(label)
    expect(sheet).not.toMatch(/Achievements|\bXP\b|\bwallet\b|\breward\b|\bpayout\b|\bNIM\b/i)
  })

  it('stays mobile-first with no horizontal overflow', () => {
    const css = read('src/components/play/MonthlyHeroes.module.css')
    expect(css).toContain('min-width: 0')
    expect(css).toContain('text-overflow: ellipsis')
    expect(css).toContain('white-space: nowrap')
    expect(css).toContain('minmax(0, 1fr)')
    expect(css).not.toMatch(/overflow-x|100vw/)
  })
})
