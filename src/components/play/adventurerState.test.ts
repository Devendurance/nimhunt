import { describe, expect, it } from 'vitest'
import { resolveAdventurerIdentityPanel, resolveRealExpeditionGate } from './adventurerState.ts'

describe('real expedition Adventurer gate', () => {
  it('allows practice/legacy gate-off callers through without profile checks', () => {
    expect(resolveRealExpeditionGate({ enabled: false, wallet: null, adventurerStatus: 'DISCONNECTED' })).toBe('ALLOW')
  })

  it('connects first, onboards only when the profile is genuinely missing, and recovers otherwise', () => {
    expect(resolveRealExpeditionGate({ enabled: true, wallet: null, adventurerStatus: 'DISCONNECTED' })).toBe('CONNECT_WALLET')
    expect(resolveRealExpeditionGate({ enabled: true, wallet: 'NQ123', adventurerStatus: 'NEEDS_PROFILE' })).toBe('ONBOARD')
    expect(resolveRealExpeditionGate({ enabled: true, wallet: 'NQ123', adventurerStatus: 'ERROR' })).toBe('RECOVER_IDENTITY')
  })

  it('allows only a ready profile to reach real expedition authorization', () => {
    expect(resolveRealExpeditionGate({ enabled: true, wallet: 'NQ123', adventurerStatus: 'READY' })).toBe('ALLOW')
    expect(resolveRealExpeditionGate({ enabled: true, wallet: 'NQ123', adventurerStatus: 'RESTORING' })).toBe('RECOVER_IDENTITY')
  })
})

describe('Adventurer identity panel rendering contract', () => {
  it('renders profile creation only for NEEDS_PROFILE', () => {
    expect(resolveAdventurerIdentityPanel('NEEDS_PROFILE', false)).toBe('CREATE_PROFILE')
    expect(resolveAdventurerIdentityPanel('ERROR', false)).toBe('RECOVERY')
    expect(resolveAdventurerIdentityPanel('RESTORING', false)).toBe('RESTORING')
  })

  it('keeps a ready profile on the existing profile surface', () => {
    expect(resolveAdventurerIdentityPanel('READY', true)).toBe('PROFILE')
    expect(resolveAdventurerIdentityPanel('READY', false)).not.toBe('CREATE_PROFILE')
  })
})
