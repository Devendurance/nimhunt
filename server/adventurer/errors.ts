import type { AdventurerErrorCode } from '../../src/domain/adventurer.js'
import type { AdventurerSocialErrorCode } from '../../src/domain/adventurerSocial.js'

export class AdventurerSocialError extends Error {
  readonly code: AdventurerSocialErrorCode

  constructor(code: AdventurerSocialErrorCode) {
    super(code)
    this.name = 'AdventurerSocialError'
    this.code = code
  }
}

export class AdventurerError extends Error {
  readonly code: AdventurerErrorCode

  constructor(code: AdventurerErrorCode) {
    super(code)
    this.name = 'AdventurerError'
    this.code = code
  }
}

export class AdventurerUnavailableError extends Error {
  constructor() {
    super('ADVENTURER_UNAVAILABLE')
    this.name = 'AdventurerUnavailableError'
  }
}

export function isAdventurerSocialError(error: unknown): error is AdventurerSocialError {
  return error instanceof AdventurerSocialError
}

export function isAdventurerError(error: unknown): error is AdventurerError {
  return error instanceof AdventurerError
}

export function isAdventurerUnavailableError(error: unknown): error is AdventurerUnavailableError {
  return error instanceof AdventurerUnavailableError
}
