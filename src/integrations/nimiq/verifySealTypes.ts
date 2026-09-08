export const DEV_VERIFY_PATH = '/api/dev/verify-treasure-seal'

export type VerifyTreasureSealReason =
  | 'INVALID_SIGNATURE'
  | 'ADDRESS_MISMATCH'
  | 'INVALID_PUBLIC_KEY'
  | 'INVALID_WALLET'
  | 'MALFORMED_PAYLOAD'
  | 'PAYLOAD_TAMPERED'
  | 'UNSUPPORTED_MESSAGE_TYPE'
  | 'REQUEST_FAILED'

export type VerifyTreasureSealResult = {
  valid: boolean
  signatureValid: boolean
  addressMatches: boolean
  reason?: VerifyTreasureSealReason
  payloadHash?: string
  wallet?: string
}

export type VerifyTreasureSealRequest = {
  payload: string
  wallet: string
  publicKey: string
  signature: string
}
