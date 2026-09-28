import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  normalizeAdventurerDisplayName,
} from '../../domain/adventurer.ts'
import type { AdventurerApiErrorCode } from '../../api/adventurer.ts'

export type AdventurerClientStatus = 'DISCONNECTED' | 'RESTORING' | 'NEEDS_PROFILE' | 'READY' | 'ERROR'
export type AdventurerClientError = Extract<AdventurerApiErrorCode, 'NETWORK_ERROR' | 'ADVENTURER_UNAVAILABLE' | 'ADVENTURER_SESSION_INVALID' | 'SIGNATURE_INVALID' | 'CHALLENGE_INVALID'> | 'SIGNATURE_CANCELLED'
export type AdventurerCreationStatus = 'IDLE' | 'CHECKING' | 'AVAILABLE' | 'TAKEN' | 'INVALID' | 'RESERVED' | 'SIGNING' | 'CREATING' | 'CANCELLED' | 'ERROR' | 'SUCCESS'

export type ClientNameState =
  | { readonly status: 'IDLE'; readonly normalizedName: string | null }
  | { readonly status: 'INVALID'; readonly normalizedName: string | null }
  | { readonly status: 'CHECKING'; readonly normalizedName: string }
  | { readonly status: 'AVAILABLE'; readonly normalizedName: string }
  | { readonly status: 'TAKEN'; readonly normalizedName: string }
  | { readonly status: 'RESERVED'; readonly normalizedName: string }
  | { readonly status: 'ERROR'; readonly normalizedName: string }

export function inspectClientName(value: string): ClientNameState {
  if (value.length === 0) return { status: 'IDLE', normalizedName: null }
  const normalizedName = normalizeAdventurerDisplayName(value)
  if (value.trim() !== value
    || value.length < DISPLAY_NAME_MIN_LENGTH
    || value.length > DISPLAY_NAME_MAX_LENGTH
    || !/^[A-Za-z0-9_]+(?: [A-Za-z0-9_]+)*$/.test(value)) {
    return { status: 'INVALID', normalizedName }
  }
  return { status: 'CHECKING', normalizedName }
}

export function mapNameApiError(code: AdventurerApiErrorCode): ClientNameState['status'] | null {
  if (code === 'DISPLAY_NAME_RESERVED') return 'RESERVED'
  if (code === 'DISPLAY_NAME_INVALID') return 'INVALID'
  if (code === 'DISPLAY_NAME_TAKEN') return 'TAKEN'
  return null
}

export function mapAdventurerClientError(code: AdventurerApiErrorCode): AdventurerClientError {
  if (code === 'ADVENTURER_SESSION_INVALID') return code
  if (code === 'SIGNATURE_INVALID') return code
  if (code === 'CHALLENGE_INVALID' || code === 'NETWORK_ERROR' || code === 'ADVENTURER_UNAVAILABLE') return code
  return 'ADVENTURER_UNAVAILABLE'
}

export function isProfileReady(status: AdventurerClientStatus): boolean {
  return status === 'READY'
}

export type RealExpeditionGateDecision = 'ALLOW' | 'CONNECT_WALLET' | 'ONBOARD'

export function resolveRealExpeditionGate(input: {
  readonly enabled: boolean
  readonly wallet: string | null
  readonly adventurerStatus: AdventurerClientStatus
}): RealExpeditionGateDecision {
  if (!input.enabled) return 'ALLOW'
  if (!input.wallet) return 'CONNECT_WALLET'
  return input.adventurerStatus === 'READY' ? 'ALLOW' : 'ONBOARD'
}
