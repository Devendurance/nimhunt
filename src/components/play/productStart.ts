import type {
  StartChallengeResponse,
} from '../../domain/expeditionProof.ts'
import type { MissionType } from '../../game/replay/types.ts'
import type { ExpeditionProofApiErrorCode, ProductStartResult, SignedStartRequest } from '../../api/expeditionProof.ts'

export type ProductStartStatus =
  | 'IDLE'
  | 'REQUESTING_ACCOUNT'
  | 'SELECTING_ACCOUNT'
  | 'REQUESTING_CHALLENGE'
  | 'AWAITING_START_SIGNATURE'
  | 'SUBMITTING_START'
  | 'RECOVERING_START'
  | 'STARTED'
  | 'CANCELLED'
  | 'LIMIT_REACHED'
  | 'BLUEPRINT_UNAVAILABLE'
  | 'PROOF_UNAVAILABLE'
  | 'REJECTED'

export type ProductStartFailureStatus =
  | 'LIMIT_REACHED'
  | 'BLUEPRINT_UNAVAILABLE'
  | 'PROOF_UNAVAILABLE'
  | 'REJECTED'

export type ProductStartErrorCode = ExpeditionProofApiErrorCode | 'ACCOUNT_EMPTY' | 'NIMIQ_ERROR'

export type ProductStartState = {
  readonly status: ProductStartStatus
  readonly mission: MissionType | null
  readonly accounts: readonly string[]
  readonly selectedAccount: string | null
  readonly normalizedWallet: string | null
  readonly challenge: StartChallengeResponse | null
  readonly canonicalPayload: string | null
  readonly signed: SignedStartRequest | null
  readonly start: ProductStartResult | null
  readonly errorCode: ProductStartErrorCode | null
}

export type ProductStartAction =
  | { readonly type: 'BEGIN'; readonly mission: MissionType }
  | { readonly type: 'ACCOUNTS_RECEIVED'; readonly accounts: readonly string[] }
  | { readonly type: 'ACCOUNT_SELECTED'; readonly account: string }
  | { readonly type: 'CHALLENGE_RECEIVED'; readonly challenge: StartChallengeResponse; readonly canonicalPayload: string }
  | { readonly type: 'SIGNATURE_SUBMITTED'; readonly signed: SignedStartRequest }
  | { readonly type: 'START_NETWORK_FAILURE' }
  | { readonly type: 'START_SUCCEEDED'; readonly start: ProductStartResult }
  | { readonly type: 'FAILURE'; readonly status: ProductStartFailureStatus; readonly errorCode: ProductStartErrorCode }
  | { readonly type: 'CANCEL' }
  | { readonly type: 'RESET' }

export const INITIAL_PRODUCT_START_STATE: ProductStartState = {
  status: 'IDLE',
  mission: null,
  accounts: [],
  selectedAccount: null,
  normalizedWallet: null,
  challenge: null,
  canonicalPayload: null,
  signed: null,
  start: null,
  errorCode: null,
}

export const PRODUCT_START_COPY = {
  REQUESTING_ACCOUNT: 'Requesting Nimiq account…',
  SELECTING_ACCOUNT: 'Choose the Nimiq account for this expedition.',
  REQUESTING_CHALLENGE: 'Preparing this expedition…',
  AWAITING_START_SIGNATURE: 'Authorize this expedition',
  SUBMITTING_START: 'Starting expedition…',
  RECOVERING_START: 'Connection interrupted. Retry the same authorization.',
  CANCELLED: 'Expedition start was cancelled. No daily expedition was used.',
  LIMIT_REACHED: "You've used today's 3 reward-eligible expeditions.",
  BLUEPRINT_UNAVAILABLE: "Today's reward expedition isn't available yet.",
  PROOF_UNAVAILABLE: 'Reward expeditions are temporarily unavailable.',
  REJECTED: 'The expedition authorization was rejected. Start again to request a fresh authorization.',
  NO_ATTEMPT_USED: 'No daily expedition has been used yet.',
} as const

export function reduceProductStart(state: ProductStartState, action: ProductStartAction): ProductStartState {
  switch (action.type) {
    case 'BEGIN':
      if (state.status !== 'IDLE') return state
      return {
        ...INITIAL_PRODUCT_START_STATE,
        status: 'REQUESTING_ACCOUNT',
        mission: action.mission,
      }
    case 'ACCOUNTS_RECEIVED':
      if (state.status !== 'REQUESTING_ACCOUNT') return state
      if (action.accounts.length === 0) {
        return {
          ...clearTransient(state),
          status: 'REJECTED',
          errorCode: 'ACCOUNT_EMPTY',
        }
      }
      return {
        ...state,
        accounts: [...action.accounts],
        selectedAccount: action.accounts.length === 1 ? action.accounts[0] ?? null : null,
        status: action.accounts.length === 1 ? 'REQUESTING_CHALLENGE' : 'SELECTING_ACCOUNT',
        errorCode: null,
      }
    case 'ACCOUNT_SELECTED':
      if (state.status !== 'SELECTING_ACCOUNT' || !state.accounts.includes(action.account)) return state
      return { ...state, selectedAccount: action.account, status: 'REQUESTING_CHALLENGE', errorCode: null }
    case 'CHALLENGE_RECEIVED':
      if (state.status !== 'REQUESTING_CHALLENGE') return state
      return {
        ...state,
        normalizedWallet: action.challenge.wallet,
        challenge: action.challenge,
        canonicalPayload: action.canonicalPayload,
        status: 'AWAITING_START_SIGNATURE',
        errorCode: null,
      }
    case 'SIGNATURE_SUBMITTED':
      if (state.status !== 'AWAITING_START_SIGNATURE') return state
      return { ...state, signed: action.signed, status: 'SUBMITTING_START', errorCode: null }
    case 'START_NETWORK_FAILURE':
      if (state.status !== 'SUBMITTING_START') return state
      return { ...state, status: 'RECOVERING_START', errorCode: 'NETWORK_ERROR' }
    case 'START_SUCCEEDED':
      if (state.status !== 'SUBMITTING_START' && state.status !== 'RECOVERING_START') return state
      return { ...state, status: 'STARTED', start: action.start, errorCode: null }
    case 'FAILURE':
      if (!isFlowActive(state.status) && state.status !== 'RECOVERING_START') return state
      return {
        ...clearTransient(state),
        status: action.status,
        errorCode: action.errorCode,
      }
    case 'CANCEL':
      if (state.status === 'STARTED') return state
      return { ...clearTransient(state), status: 'CANCELLED' }
    case 'RESET':
      return INITIAL_PRODUCT_START_STATE
  }
}

export function isFlowActive(status: ProductStartStatus): boolean {
  return status === 'REQUESTING_ACCOUNT'
    || status === 'SELECTING_ACCOUNT'
    || status === 'REQUESTING_CHALLENGE'
    || status === 'AWAITING_START_SIGNATURE'
    || status === 'SUBMITTING_START'
    || status === 'RECOVERING_START'
}

export function canBeginProductStart(state: ProductStartState): boolean {
  return state.status === 'IDLE'
}

export function createProductStartAttemptGuard(): {
  start: () => number
  invalidate: () => void
  isCurrent: (token: number) => boolean
} {
  let nextToken = 0
  let activeToken: number | null = null
  return {
    start: () => {
      activeToken = ++nextToken
      return activeToken
    },
    invalidate: () => {
      activeToken = null
    },
    isCurrent: (token: number) => activeToken === token,
  }
}

function clearTransient(state: ProductStartState): ProductStartState {
  return {
    ...state,
    mission: null,
    accounts: [],
    selectedAccount: null,
    normalizedWallet: null,
    challenge: null,
    canonicalPayload: null,
    signed: null,
    start: null,
  }
}
