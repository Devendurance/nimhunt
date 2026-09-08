import { createNimiqError, type NimiqIntegrationError } from './nimiqErrors'
import type {
  NimiqAsyncStatus,
  NimiqEnvironment,
  NimiqProviderStatus,
  NimiqSignatureProof,
} from './nimiqTypes'
import type { VerifyTreasureSealResult } from './verifySealTypes'

export type NimiqUiState = {
  environment: NimiqEnvironment
  providerStatus: NimiqProviderStatus
  account: string | null
  accounts: string[]
  accountStatus: NimiqAsyncStatus
  signature: NimiqSignatureProof | null
  signStatus: NimiqAsyncStatus
  verifyStatus: NimiqAsyncStatus
  verification: VerifyTreasureSealResult | null
  error: NimiqIntegrationError | null
}

export type NimiqUiAction =
  | { type: 'HOST_UNAVAILABLE' }
  | { type: 'INIT_START' }
  | { type: 'INIT_READY' }
  | { type: 'INIT_ERROR'; error: NimiqIntegrationError }
  | { type: 'ACCOUNT_START' }
  | { type: 'ACCOUNT_SUCCESS'; address: string; accounts: string[] }
  | { type: 'ACCOUNT_ERROR'; error: NimiqIntegrationError }
  | { type: 'SIGN_START' }
  | { type: 'SIGN_SUCCESS'; proof: NimiqSignatureProof }
  | { type: 'SIGN_ERROR'; error: NimiqIntegrationError }
  | { type: 'VERIFY_START' }
  | { type: 'VERIFY_SUCCESS'; result: VerifyTreasureSealResult }
  | { type: 'VERIFY_REJECTED'; result: VerifyTreasureSealResult }
  | { type: 'VERIFY_ERROR'; error: NimiqIntegrationError }

export const initialNimiqState: NimiqUiState = {
  environment: 'unknown',
  providerStatus: 'uninitialized',
  account: null,
  accounts: [],
  accountStatus: 'idle',
  signature: null,
  signStatus: 'idle',
  verifyStatus: 'idle',
  verification: null,
  error: null,
}

export function reduceNimiqState(state: NimiqUiState, action: NimiqUiAction): NimiqUiState {
  switch (action.type) {
    case 'HOST_UNAVAILABLE':
      return {
        ...initialNimiqState,
        environment: 'browser',
        providerStatus: 'unavailable',
        error: createNimiqError('PROVIDER_UNAVAILABLE'),
      }
    case 'INIT_START':
      return {
        ...state,
        environment: 'nimiq-pay',
        providerStatus: 'initializing',
        error: null,
      }
    case 'INIT_READY':
      return {
        ...state,
        environment: 'nimiq-pay',
        providerStatus: 'ready',
        error: null,
      }
    case 'INIT_ERROR':
      return {
        ...state,
        environment: 'nimiq-pay',
        providerStatus: action.error.code === 'PROVIDER_UNAVAILABLE' ? 'unavailable' : 'error',
        error: action.error,
      }
    case 'ACCOUNT_START':
      return {
        ...state,
        accountStatus: 'loading',
        error: null,
      }
    case 'ACCOUNT_SUCCESS':
      return {
        ...state,
        account: action.address,
        accounts: action.accounts,
        accountStatus: 'success',
        signature: null,
        signStatus: 'idle',
        verifyStatus: 'idle',
        verification: null,
        error: null,
      }
    case 'ACCOUNT_ERROR':
      return {
        ...state,
        accountStatus: 'error',
        error: action.error,
      }
    case 'SIGN_START':
      return {
        ...state,
        signStatus: 'loading',
        error: null,
      }
    case 'SIGN_SUCCESS':
      return {
        ...state,
        signature: action.proof,
        signStatus: 'success',
        verifyStatus: 'idle',
        verification: null,
        error: null,
      }
    case 'SIGN_ERROR':
      return {
        ...state,
        signStatus: 'error',
        error: action.error,
      }
    case 'VERIFY_START':
      return {
        ...state,
        verifyStatus: 'loading',
        verification: null,
        error: null,
      }
    case 'VERIFY_SUCCESS':
      return {
        ...state,
        verifyStatus: 'success',
        verification: action.result,
        error: null,
      }
    case 'VERIFY_REJECTED':
      return {
        ...state,
        verifyStatus: 'error',
        verification: action.result,
        error: null,
      }
    case 'VERIFY_ERROR':
      return {
        ...state,
        verifyStatus: 'error',
        verification: null,
        error: action.error,
      }
  }
}
