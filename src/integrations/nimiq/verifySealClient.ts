import { DEV_VERIFY_PATH, type VerifyTreasureSealRequest, type VerifyTreasureSealResult } from './verifySealTypes'

export async function requestDevSealVerification(
  input: VerifyTreasureSealRequest,
): Promise<VerifyTreasureSealResult> {
  try {
    const response = await fetch(DEV_VERIFY_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        payload: input.payload,
        wallet: input.wallet,
        publicKey: input.publicKey,
        signature: input.signature,
      }),
    })

    const data: unknown = await response.json()
    if (!isVerifyResult(data)) {
      return { valid: false, signatureValid: false, addressMatches: false, reason: 'REQUEST_FAILED' }
    }
    return data
  } catch {
    return { valid: false, signatureValid: false, addressMatches: false, reason: 'REQUEST_FAILED' }
  }
}

function isVerifyResult(value: unknown): value is VerifyTreasureSealResult {
  if (typeof value !== 'object' || value === null) return false
  const result = value as Partial<VerifyTreasureSealResult>
  return typeof result.valid === 'boolean'
    && typeof result.signatureValid === 'boolean'
    && typeof result.addressMatches === 'boolean'
}
