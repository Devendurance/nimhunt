import type { ExpeditionProofErrorCode } from '../../src/domain/expeditionProof.js'

export class ProofError extends Error {
  readonly code: ExpeditionProofErrorCode

  constructor(code: ExpeditionProofErrorCode) {
    super(code)
    this.name = 'ProofError'
    this.code = code
  }
}

export function isProofError(error: unknown): error is ProofError {
  return error instanceof ProofError
}
