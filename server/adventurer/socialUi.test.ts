import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')

describe('P4 Allies mobile UI contract', () => {
  it('wires every public relationship state without discovery/search or wallet identity', () => {
    const sheet = read('src/components/play/PublicAdventurerProfileSheet.tsx')
    for (const state of ['NONE', 'OUTGOING_PENDING', 'INCOMING_PENDING', 'ALLY', 'BLOCKED_BY_ME', 'UNAVAILABLE']) expect(sheet).toContain(`'${state}'`)
    for (const label of ['Add Adventurer', 'Request sent', 'Accept', 'Decline', 'Remove Ally', 'Block Adventurer', 'Unblock Adventurer']) expect(sheet).toContain(label)
    expect(sheet).not.toMatch(/global search|wallet|display name search/i)
  })

  it('puts incoming requests before Allies and renders only compact curated identity rows', () => {
    const panel = read('src/components/play/AlliesPanel.tsx')
    expect(panel.indexOf('Incoming requests')).toBeLessThan(panel.indexOf('Your Allies'))
    expect(panel).toContain('state.overview.incomingRequests.map')
    expect(panel).toContain('AdventurerAvatarToken')
    expect(panel).toContain('onOpenPublicProfile')
    expect(panel).toContain('acceptAdventurerRequest(request.requestId)')
    expect(panel).toContain('declineAdventurerRequest(request.requestId)')
    expect(panel).toContain('Accept')
    expect(panel).toContain('Decline')
    expect(panel).not.toMatch(/wallet|search|achievement|notification/i)
  })

  it('keeps a parsed incoming request on the My Adventurer ready path', () => {
    const profile = read('src/components/play/AdventurerProfilePanel.tsx')
    expect(profile).toContain("social.status === 'ready'")
    expect(profile).toContain('social.overview.incomingPendingCount')
    expect(profile).toContain('onOpenAllies')
    expect(profile).toContain('Allies are temporarily unavailable.')
  })

  it('keeps tap targets, narrow names, safe-area sheet scrolling, and double-submit guards', () => {
    const css = read('src/components/play/Adventurer.module.css')
    const shell = read('src/components/play/PlayShell.module.css')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain('text-overflow: ellipsis')
    expect(css).toContain('min-width: 0')
    expect(shell).toContain('env(safe-area-inset-bottom)')
    expect(read('src/components/play/AlliesPanel.tsx')).toContain('if (busy) return')
    expect(read('src/components/play/PublicAdventurerProfileSheet.tsx')).toContain('if (action) return')
  })
})
