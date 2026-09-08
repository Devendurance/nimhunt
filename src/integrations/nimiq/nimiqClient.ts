import { init, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { createNimiqError, isErrorResponse, normalizeNimiqError } from './nimiqErrors'
import type { NimiqSignatureResult } from './nimiqTypes'

type NimiqHost = {
  nimiq?: unknown
  nimiqPay?: unknown
}

const INIT_TIMEOUT_MS = 10_000

let initPromise: Promise<NimiqProvider> | null = null

export function detectNimiqPayHost(host: NimiqHost = globalThis as NimiqHost): boolean {
  return Boolean(host.nimiqPay || host.nimiq)
}

export async function initializeNimiqProvider(): Promise<NimiqProvider> {
  if (!detectNimiqPayHost()) {
    throw createNimiqError('PROVIDER_UNAVAILABLE')
  }

  if (!initPromise) {
    initPromise = init({ timeout: INIT_TIMEOUT_MS }).catch((error: unknown) => {
      initPromise = null
      throw normalizeNimiqError(error, 'init')
    })
  }

  return initPromise
}

export async function listNimiqAccounts(provider: NimiqProvider): Promise<string[]> {
  try {
    const result = await provider.listAccounts()
    if (isErrorResponse(result)) throw result
    if (!Array.isArray(result)) throw createNimiqError('UNKNOWN', result)
    const accounts = result.filter(account => typeof account === 'string' && account.trim().length > 0)
    if (accounts.length === 0) throw createNimiqError('ACCOUNT_EMPTY', result)
    return accounts
  } catch (error) {
    throw normalizeNimiqError(error, 'account')
  }
}

export async function signNimiqMessage(
  provider: NimiqProvider,
  message: string,
): Promise<NimiqSignatureResult> {
  try {
    const result = await provider.sign(message)
    if (isErrorResponse(result)) throw result
    if (!isSignatureResult(result)) {
      throw createNimiqError('UNKNOWN', result, 'The provider did not return a publicKey and signature.')
    }
    return {
      publicKey: result.publicKey,
      signature: result.signature,
    }
  } catch (error) {
    throw normalizeNimiqError(error, 'sign')
  }
}

export function resetNimiqClientForTests(): void {
  initPromise = null
}

function isSignatureResult(value: unknown): value is NimiqSignatureResult {
  if (typeof value !== 'object' || value === null) return false
  const result = value as Partial<NimiqSignatureResult>
  return typeof result.publicKey === 'string' && typeof result.signature === 'string'
    && result.publicKey.length > 0 && result.signature.length > 0
}

