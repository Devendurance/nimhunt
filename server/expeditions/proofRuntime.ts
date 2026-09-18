import { WALLET_DAILY_STATUS_PATH } from '../../src/domain/dailyLedger.js'
import { RECOVER_SESSION_CHALLENGE_PATH, RECOVER_SESSION_PATH } from '../../src/domain/walletRecovery.js'
import {
  ABANDON_EXPEDITION_PATH,
  ACTIVE_EXPEDITION_PATH,
  CHECKPOINT_PATH,
  FINALIZE_REWARD_CLAIM_PATH,
  GAMEPLAY_START_PATH,
  GET_REWARD_PAYOUT_PATH,
  PREPARE_REWARD_CLAIM_PATH,
  PRODUCT_VAULT_SEAL_PREPARE_PATH,
  PRODUCT_VAULT_SEAL_VERIFY_PATH,
  START_CHALLENGE_PATH,
  START_EXPEDITION_PATH,
  VERIFY_EXPEDITION_PATH,
} from '../../src/domain/expeditionProof.js'
import { createLazyValue, type LazyValue } from './lazyValue.js'
import type { ExpeditionProofService, MemoryProofService } from './types.js'

const OWNED_EXPEDITION_PATHS = new Set([
  START_CHALLENGE_PATH,
  START_EXPEDITION_PATH,
  ACTIVE_EXPEDITION_PATH,
  GAMEPLAY_START_PATH,
  CHECKPOINT_PATH,
  VERIFY_EXPEDITION_PATH,
  ABANDON_EXPEDITION_PATH,
  PRODUCT_VAULT_SEAL_PREPARE_PATH,
  PRODUCT_VAULT_SEAL_VERIFY_PATH,
  PREPARE_REWARD_CLAIM_PATH,
  FINALIZE_REWARD_CLAIM_PATH,
  GET_REWARD_PAYOUT_PATH,
  WALLET_DAILY_STATUS_PATH,
  RECOVER_SESSION_CHALLENGE_PATH,
  RECOVER_SESSION_PATH,
])

export function isOwnedExpeditionPath(path: string): boolean {
  return OWNED_EXPEDITION_PATHS.has(path)
}

export function isOwnedPayoutSchedulerPath(path: string): boolean {
  return path === '/api/internal/payout-cycle'
}

export type ExpeditionRuntimeInput = {
  readonly mode: string
  readonly backend: string | undefined
  readonly appOrigin: string | undefined
}

export type ExpeditionRuntime = {
  readonly backend: 'memory' | 'postgres' | 'unavailable'
  readonly appOrigin: string
  readonly expectedOrigin: string
  readonly expectedHost: string
  readonly expectedProtocol: 'http' | 'https'
  readonly secureCookie: boolean
  readonly allowAuthorizedLocalHttpOrigins: boolean
}

const UNAVAILABLE_RUNTIME: ExpeditionRuntime = {
  backend: 'unavailable',
  appOrigin: '',
  expectedOrigin: '',
  expectedHost: '',
  expectedProtocol: 'https',
  secureCookie: true,
  allowAuthorizedLocalHttpOrigins: false,
}

export function resolveExpeditionRuntime(input: ExpeditionRuntimeInput): ExpeditionRuntime {
  const origin = parseOrigin(input.appOrigin)
  if (!origin) return UNAVAILABLE_RUNTIME

  const memoryEnabled = input.backend === 'memory' && (input.mode === 'development' || input.mode === 'test')
  const postgresEnabled = input.backend === 'postgres'
  const backend = memoryEnabled ? 'memory' : postgresEnabled ? 'postgres' : 'unavailable'
  const localHttp = origin.protocol === 'http' && isAuthorizedHttpOrigin(origin, input.mode)

  return {
    backend,
    appOrigin: origin.origin,
    expectedOrigin: origin.origin,
    expectedHost: origin.host,
    expectedProtocol: origin.protocol,
    secureCookie: backend === 'unavailable' ? true : !localHttp,
    allowAuthorizedLocalHttpOrigins: backend !== 'unavailable' && localHttp,
  }
}

export function resolveProductionExpeditionRuntime(
  env: Record<string, string | undefined> = process.env,
): ExpeditionRuntime {
  return resolveExpeditionRuntime({
    mode: 'production',
    backend: env.NIMHUNT_PROOF_BACKEND,
    appOrigin: env.NIMHUNT_APP_ORIGIN,
  })
}

export function createProofBackendLoader(
  getRuntime: () => ExpeditionRuntime,
  createService?: () => ExpeditionProofService | null | Promise<ExpeditionProofService | null>,
): LazyValue<ExpeditionProofService | null> {
  return createLazyValue(async () => {
    const runtime = getRuntime()
    if (runtime.backend === 'unavailable') return null
    if (createService) return createService()
    return createDefaultProofService(runtime)
  })
}

export async function createDefaultProofService(
  runtime: ExpeditionRuntime,
  env: Record<string, string | undefined> = process.env,
): Promise<ExpeditionProofService | null> {
  if (runtime.backend === 'memory') return createDevelopmentMemoryProofService()
  if (runtime.backend !== 'postgres') return null
  const { readServerSupabaseConfig, createSupabaseAdminClient } = await import('../ledger/config.js')
  const config = readServerSupabaseConfig(env)
  if (!config) return null
  const { utcDayKey } = await import('../ledger/utcDay.js')
  const { createDailyPublishedBlueprints } = await import('./blueprintBootstrap.js')
  const { createSupabaseProofService } = await import('./postgresProofStore.js')
  return createSupabaseProofService({
    client: createSupabaseAdminClient(config),
    blueprints: createDailyPublishedBlueprints(utcDayKey(new Date())),
  })
}

export async function createDevelopmentMemoryProofService(): Promise<MemoryProofService> {
  const { utcDayKey } = await import('../ledger/utcDay.js')
  const { createDailyPublishedBlueprints } = await import('./blueprintBootstrap.js')
  const { createMemoryProofService } = await import('./memoryProofStore.js')
  return createMemoryProofService({
    blueprints: createDailyPublishedBlueprints(utcDayKey(new Date())),
  })
}

export async function createDefaultPayoutStore(
  runtime: ExpeditionRuntime,
  env: Record<string, string | undefined> = process.env,
) {
  const { createMemoryPayoutStore, createPayoutStore } = await import('../payouts/store.js')
  if (runtime.backend === 'memory') return createMemoryPayoutStore()
  if (runtime.backend !== 'postgres') return null
  const { readServerSupabaseConfig, createSupabaseAdminClient } = await import('../ledger/config.js')
  const config = readServerSupabaseConfig(env)
  if (!config) return null
  const { createSupabasePayoutRpcClient } = await import('../payouts/db.js')
  return createPayoutStore(createSupabasePayoutRpcClient(createSupabaseAdminClient(config)))
}

export async function createDefaultDailyLedger(
  env: Record<string, string | undefined> = process.env,
) {
  const { readServerSupabaseConfig, createSupabaseAdminClient } = await import('../ledger/config.js')
  const config = readServerSupabaseConfig(env)
  if (!config) return null
  const { createPostgresDailyLedger } = await import('../ledger/postgresLedger.js')
  return createPostgresDailyLedger(createSupabaseAdminClient(config))
}

function parseOrigin(value: string | undefined): { origin: string; host: string; protocol: 'http' | 'https' } | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== value.replace(/\/$/, '')) return null
    return {
      origin: parsed.origin,
      host: parsed.host,
      protocol: parsed.protocol === 'https:' ? 'https' : 'http',
    }
  } catch {
    return null
  }
}

function isAuthorizedHttpOrigin(
  origin: { host: string; protocol: 'http' | 'https' },
  mode: string,
): boolean {
  if (origin.protocol !== 'http') return false
  if (mode === 'test') return isLoopbackHost(origin.host)
  return isLoopbackHost(origin.host) || isPrivateIpv4Host(origin.host)
}

function isLoopbackHost(host: string): boolean {
  const hostname = host.split(':')[0]?.replace('[', '').replace(']', '')
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function isPrivateIpv4Host(host: string): boolean {
  const hostname = host.split(':')[0]
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
}
