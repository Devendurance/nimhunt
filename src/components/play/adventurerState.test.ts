import { describe, expect, it } from 'vitest'
import { resolveRealExpeditionGate } from './adventurerState.ts'

describe('real expedition Adventurer gate', () => {
  it('allows practice/legacy gate-off callers through without profile checks', () => {
    expect(resolveRealExpeditionGate({ enabled: false, wallet: null, adventurerStatus: 'DISCONNECTED' })).toBe('ALLOW')
  })

  it('connects first, then onboards, without authorizing a start', () => {
    expect(resolveRealExpeditionGate({ enabled: true, wallet: null, adventurerStatus: 'DISCONNECTED' })).toBe('CONNECT_WALLET')
    expect(resolveRealExpeditionGate({ enabled: true, wallet: 'NQ123', adventurerStatus: 'NEEDS_PROFILE' })).toBe('ONBOARD')
    expect(resolveRealExpeditionGate({ enabled: true, wallet: 'NQ123', adventurerStatus: 'ERROR' })).toBe('ONBOARD')
  })

  it('allows only a ready profile to reach real expedition authorization', () => {
    expect(resolveRealExpeditionGate({ enabled: true, wallet: 'NQ123', adventurerStatus: 'READY' })).toBe('ALLOW')
    expect(resolveRealExpeditionGate({ enabled: true, wallet: 'NQ123', adventurerStatus: 'RESTORING' })).toBe('ONBOARD')
  })
})
