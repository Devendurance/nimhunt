import type { ProductGameplayStartResponse, ProductActiveExpedition } from '../../domain/expeditionProof.ts'
import { BLUEPRINT_VERSION, ROOM_VERSION, RULES_VERSION } from '../../game/replay/versions.ts'
import type { PlayableMission } from './expeditionFlow'

export type ProductGateError =
  | 'MISSION_MISMATCH'
  | 'ACTIVE_RUN_UNAVAILABLE'
  | 'MALFORMED_ACTIVE'
  | 'RUN_SESSION_INVALID'
  | 'PROOF_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'GAMEPLAY_START_FAILED'

export type ProductGateStatus = 'LOADING_ACTIVE' | 'MARKING_GAMEPLAY_START' | 'RETRY_GAMEPLAY_START' | 'READY' | 'ERROR'

export type ProductGateState = {
  readonly status: ProductGateStatus
  readonly active: ProductActiveExpedition | null
  readonly error: ProductGateError | null
}

export const INITIAL_PRODUCT_GATE_STATE: ProductGateState = {
  status: 'LOADING_ACTIVE',
  active: null,
  error: null,
}

export type ProductGateAction =
  | { readonly type: 'RESET' }
  | { readonly type: 'ACTIVE_RECEIVED'; readonly active: ProductActiveExpedition }
  | { readonly type: 'GAMEPLAY_STARTED'; readonly runId: string; readonly outcome: ProductGameplayStartResponse['outcome'] }
  | { readonly type: 'GAMEPLAY_START_RETRYABLE' }
  | { readonly type: 'ERROR'; readonly error: ProductGateError }

export function reduceProductGate(state: ProductGateState, action: ProductGateAction): ProductGateState {
  switch (action.type) {
    case 'RESET':
      return { status: 'LOADING_ACTIVE', active: null, error: null }
    case 'ACTIVE_RECEIVED':
      return { status: 'MARKING_GAMEPLAY_START', active: action.active, error: null }
    case 'GAMEPLAY_STARTED':
      if ((state.status !== 'MARKING_GAMEPLAY_START' && state.status !== 'RETRY_GAMEPLAY_START') || !state.active) return state
      if (state.active.runId !== action.runId) return { status: 'ERROR', active: null, error: 'GAMEPLAY_START_FAILED' }
      return { status: 'READY', active: state.active, error: null }
    case 'GAMEPLAY_START_RETRYABLE':
      if (state.status !== 'MARKING_GAMEPLAY_START' || !state.active) return state
      return { ...state, status: 'RETRY_GAMEPLAY_START' }
    case 'ERROR':
      return { ...state, status: 'ERROR', error: action.error }
  }
}

export function canMountProduct(state: ProductGateState): boolean {
  return state.status === 'READY' && state.active !== null
}

export function createProductGateAttemptGuard(): {
  begin: (routeKey: string) => boolean
} {
  let currentRouteKey: string | null = null
  return {
    begin(routeKey) {
      if (currentRouteKey === routeKey) return false
      currentRouteKey = routeKey
      return true
    },
  }
}

export function validateProductActive(active: ProductActiveExpedition, mission: PlayableMission, runId: string): ProductGateError | null {
  if (active.runId !== runId || active.mission !== mission) return active.mission !== mission ? 'MISSION_MISMATCH' : 'MALFORMED_ACTIVE'
  if (active.gameplayStartedAt !== null || active.status !== 'STARTED') return 'ACTIVE_RUN_UNAVAILABLE'
  if (!active.runId
    || active.blueprint.mission !== mission
    || active.state.mission !== mission
    || active.state.seq !== 0
    || active.state.run.runStatus !== 'PLAYING'
    || active.state.run.missionStatus !== 'IN_PROGRESS'
    || active.rulesVersion !== RULES_VERSION
    || active.roomVersion !== ROOM_VERSION
    || active.blueprintVersion !== BLUEPRINT_VERSION
    || active.blueprint.rulesVersion !== RULES_VERSION
    || active.blueprint.roomVersion !== ROOM_VERSION
    || active.blueprint.blueprintVersion !== BLUEPRINT_VERSION
    || active.state.rulesVersion !== RULES_VERSION
    || active.state.roomVersion !== ROOM_VERSION
    || active.state.blueprintVersion !== BLUEPRINT_VERSION
    || active.blueprintId !== active.blueprint.blueprintId
    || active.blueprintHash !== active.blueprint.blueprintHash
    || active.state.blueprintId !== active.blueprintId
    || active.state.blueprintHash !== active.blueprintHash) return 'MALFORMED_ACTIVE'
  return null
}
