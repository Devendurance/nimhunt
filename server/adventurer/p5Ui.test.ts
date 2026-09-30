import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')

describe('P5 Bank, profile, and settings UI contract', () => {
  it('keeps My Adventurer compact and moves editing into a subview', () => {
    const profile = read('src/components/play/AdventurerProfilePanel.tsx')
    const edit = read('src/components/play/AdventurerEditProfilePanel.tsx')
    for (const label of ['LIFETIME GEMS', 'EXPEDITIONS', 'BEST STREAK', 'Edit Profile', 'Settings']) expect(profile).toContain(label)
    expect(profile).not.toContain('AvatarPicker')
    expect(edit).toContain('AvatarPicker')
    expect(edit).toContain('renameProfile(displayName)')
    expect(read('src/components/play/useAdventurer.ts')).toContain('NIMHUNT_RENAME_ADVENTURER_V1')
    expect(edit).toContain('You can rename again on')
  })

  it('ships one real sound control, connected wallet info, and private blocked management', () => {
    const settings = read('src/components/play/AdventurerSettingsPanel.tsx')
    const blocked = read('src/components/play/BlockedAdventurersPanel.tsx')
    expect(settings).toContain('useSoundEnabled')
    expect(settings).toContain('Connected wallet')
    expect(settings).toContain('Blocked Adventurers')
    expect(blocked).toContain('fetchAdventurerBlockedProfiles')
    expect(blocked).toContain('unblockAdventurer(playerId)')
    expect(blocked).toContain('private to your Adventurer')
  })

  it('keeps identity creation fail-closed to NEEDS_PROFILE and gives ERROR a retry-only surface', () => {
    const onboarding = read('src/components/play/AdventurerOnboarding.tsx')
    const shell = read('src/components/play/PlayShell.tsx')
    const recovery = read('src/components/play/AdventurerIdentityStatus.tsx')
    expect(onboarding).toContain("if (identityStatus !== 'NEEDS_PROFILE')")
    expect(onboarding).toContain('Create Adventurer profile')
    expect(onboarding).toContain('Browse Practice Missions')
    expect(shell).toContain("changeTab('missions')")
    expect(shell).toContain("identityPanel === 'CREATE_PROFILE'")
    expect(shell).toContain('onRetryIdentity={adventurer.retryRestore}')
    expect(recovery).toContain('Retry identity session')
    expect(recovery).not.toContain('Create Adventurer profile')
  })

  it('uses four tabs and only mounts the full Bank in the Bank destination', () => {
    const nav = read('src/components/play/PlayBottomNav.tsx')
    const shell = read('src/components/play/PlayShell.tsx')
    for (const label of ["id: 'hunt'", "id: 'missions'", "id: 'heroes'", "id: 'bank'"]) expect(nav).toContain(label)
    expect(shell).toContain("activeTab === 'bank'")
    const hunt = shell.slice(shell.indexOf("activeTab === 'hunt'"), shell.indexOf("activeTab === 'missions'"))
    const missions = shell.slice(shell.indexOf("activeTab === 'missions'"), shell.indexOf("activeTab === 'heroes'"))
    expect(hunt).not.toContain('TreasureBankSection')
    expect(missions).not.toContain('TreasureBankSection')
  })
})
