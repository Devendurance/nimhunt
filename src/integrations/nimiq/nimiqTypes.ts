export type NimiqEnvironment = 'unknown' | 'nimiq-pay' | 'browser'

export type NimiqProviderStatus =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'unavailable'
  | 'error'

export type NimiqAsyncStatus = 'idle' | 'loading' | 'success' | 'error'

export type NimiqErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_INIT_FAILED'
  | 'ACCOUNT_CANCELLED'
  | 'ACCOUNT_EMPTY'
  | 'SIGN_CANCELLED'
  | 'UNKNOWN'

export type NimiqOperation = 'init' | 'account' | 'sign' | 'verify'

export type NimiqSignatureResult = {
  publicKey: string
  signature: string
}

import type { TestTreasureSealPayload } from '../../domain/treasureSeal'

export type { TestTreasureSealPayload }

export type NimiqSignatureProof = {
  publicKey: string
  signature: string
  message: string
  payload: TestTreasureSealPayload
  completedAt: string
}
