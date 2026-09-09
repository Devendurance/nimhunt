import { describe, expect, it } from 'vitest'
import {
  clearRunFromSearch,
  DEV_HUD_MODE,
  getBriefState,
  getExpeditionResult,
  isMissionLaunchable,
  parseRunParam,
  PRODUCT_HUD_MODE,
  resolvePlayRoute,
} from './expeditionFlow'
import { createInitialHUDState } from '../../game/events/gameEvents'

describe('Real /play expedition flow', () => {
  it('launches a real game for Gem Runner', () => {
    expect(parseRunParam('gem-runner')).toBe('gem-runner')
    expect(isMissionLaunchable('gem-runner')).toBe(true)
    expect(resolvePlayRoute({ dev: null, run: 'gem-runner', mission: null })).toEqual({
      view: 'expedition',
      mission: 'gem-runner',
    })
  })

  it('launches a real game for Chest Hunter', () => {
    expect(parseRunParam('chest-hunter')).toBe('chest-hunter')
    expect(isMissionLaunchable('chest-hunter')).toBe(true)
    expect(resolvePlayRoute({ dev: null, run: 'chest-hunter', mission: null })).toEqual({
      view: 'expedition',
      mission: 'chest-hunter',
    })
  })

  it('passes the selected mission through to Phaser', () => {
    expect(resolvePlayRoute({ dev: 'game', run: null, mission: 'chest-hunter' })).toEqual({
      view: 'dev-game',
      mission: 'chest-hunter',
    })
    expect(resolvePlayRoute({ dev: 'game', run: null, mission: null })).toEqual({
      view: 'dev-game',
      mission: 'gem-runner',
    })
  })

  it('launches a real game for Vault Breaker', () => {
    expect(parseRunParam('vault-breaker')).toBe('vault-breaker')
    expect(isMissionLaunchable('vault-breaker')).toBe(true)
    expect(resolvePlayRoute({ dev: null, run: 'vault-breaker', mission: null })).toEqual({
      view: 'expedition',
      mission: 'vault-breaker',
    })
  })

  it('offers Start expedition for every mission', () => {
    expect(getBriefState('gem-runner')).toMatchObject({ canStart: true, badge: 'AVAILABLE' })
    expect(getBriefState('chest-hunter')).toMatchObject({ canStart: true, badge: 'AVAILABLE' })
    expect(getBriefState('vault-breaker')).toMatchObject({ canStart: true, badge: 'AVAILABLE' })
  })

  it('transitions a Gem Runner completion to the product result', () => {
    const hud = { ...createInitialHUDState('gem-runner'), runStatus: 'MISSION_COMPLETE' as const, gemsCollected: 6 }
    expect(getExpeditionResult(hud)).toMatchObject({
      status: 'complete',
      title: 'Gem Runner',
      detail: '6 / 6 gems collected',
    })
  })

  it('transitions a Chest Hunter completion to the product result', () => {
    const hud = { ...createInitialHUDState('chest-hunter'), runStatus: 'MISSION_COMPLETE' as const, chestsOpened: 4 }
    expect(getExpeditionResult(hud)).toMatchObject({
      status: 'complete',
      title: 'Chest Hunter',
      detail: '4 / 4 chests opened',
    })
  })

  it('transitions failure to the product result with progress reached', () => {
    const gemFail = { ...createInitialHUDState('gem-runner'), runStatus: 'FAILED' as const, gemsCollected: 3 }
    expect(getExpeditionResult(gemFail)).toMatchObject({ status: 'failed', detail: '3 / 6 gems' })
    const chestFail = { ...createInitialHUDState('chest-hunter'), runStatus: 'FAILED' as const, chestsOpened: 2 }
    expect(getExpeditionResult(chestFail)).toMatchObject({ status: 'failed', detail: '2 / 4 chests' })
  })

  it('transitions a Vault Breaker failure to the product result with route progress', () => {
    const withoutKey = { ...createInitialHUDState('vault-breaker'), runStatus: 'FAILED' as const }
    expect(getExpeditionResult(withoutKey)).toMatchObject({ status: 'failed', detail: 'Temple Key not found' })
    const withKey = { ...createInitialHUDState('vault-breaker'), runStatus: 'FAILED' as const, hasTempleKey: true }
    expect(getExpeditionResult(withKey)).toMatchObject({ status: 'failed', detail: 'Temple Key found' })
  })
  it('stays in playing state while the run is active', () => {
    expect(getExpeditionResult(createInitialHUDState('gem-runner'))).toEqual({ status: 'playing' })
  })

  it('clears the run param when leaving back to the board', () => {
    expect(clearRunFromSearch('?run=gem-runner')).toBe('')
    expect(clearRunFromSearch('?run=chest-hunter&foo=bar')).toBe('?foo=bar')
    expect(clearRunFromSearch('')).toBe('')
  })

  it('hides debug HUD in product mode and retains it in dev mode', () => {
    expect(PRODUCT_HUD_MODE.showDebug).toBe(false)
    expect(PRODUCT_HUD_MODE.showResetAction).toBe(false)
    expect(DEV_HUD_MODE.showDebug).toBe(true)
    expect(DEV_HUD_MODE.showResetAction).toBe(true)
  })

  it('keeps /play?dev=nimiq routing intact', () => {
    expect(resolvePlayRoute({ dev: 'nimiq', run: null, mission: null })).toEqual({ view: 'nimiq' })
    expect(resolvePlayRoute({ dev: 'nimiq', run: 'gem-runner', mission: null })).toEqual({ view: 'nimiq' })
  })

  it('falls back to the shell for unknown params', () => {
    expect(resolvePlayRoute({ dev: null, run: null, mission: null })).toEqual({ view: 'shell' })
    expect(resolvePlayRoute({ dev: 'other', run: null, mission: null })).toEqual({ view: 'shell' })
  })
})
