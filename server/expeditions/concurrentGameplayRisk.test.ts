import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import type { Direction, MoveAction } from '../../src/game/replay/types.ts'
import { PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES } from './room01BootstrapPrevalidation.ts'
import { serializeStartPayload, type StartExpeditionPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { createMemoryProofService } from './memoryProofStore.ts'
import {
  countsAsConcurrentGameplayRun,
  minimumPlausibleCompletionMs,
} from './riskGate.ts'
import type { DurableExpeditionRun } from './types.ts'

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n')

function candidate(overrides: Partial<DurableExpeditionRun> = {}): DurableExpeditionRun {
  return {
    runId: 'candidate-run',
    dayKey: '2026-09-09',
    wallet: 'NQ-WALLET-A',
    mission: 'gem-runner',
    status: 'STARTED',
    rewardStatus: 'NONE',
    startedAt: '2026-09-09T12:00:00.000Z',
    expiresAt: '2026-09-10T00:00:00.000Z',
    gameplayStartedAt: '2026-09-09T12:00:05.000Z',
    runChallenge: 'aa'.repeat(32),
    blueprint: {} as DurableExpeditionRun['blueprint'],
    state: {} as DurableExpeditionRun['state'],
    checkpoint: {} as DurableExpeditionRun['checkpoint'],
    initialStateHash: '11'.repeat(32),
    initialTranscriptHash: '22'.repeat(32),
    initialCheckpointHash: '33'.repeat(32),
    checkpointHash: '44'.repeat(32),
    seq: 3,
    actions: [],
    batches: [],
    terminal: null,
    vaultSeal: null,
    ...overrides,
  }
}

const NOW = new Date('2026-09-09T12:30:00.000Z')
const CURRENT = { runId: 'current-run', wallet: 'NQ-WALLET-A', dayKey: '2026-09-09' }

describe('concurrent gameplay predicate (012)', () => {
  it('leaves migration 008 untouched (forward-only)', () => {
    const sql008 = read('server/ledger/sql/008_reward_risk_gate.sql')
    expect(sql008).toContain('and status = \'STARTED\'\n    and id <> v_run.id;')
    expect(sql008).not.toContain('gameplay_started_at is not null')
  })

  it('scopes migration 012 to the single concurrent predicate', () => {
    const sql012 = read('server/ledger/sql/012_concurrent_gameplay_risk.sql')
    expect(sql012).toContain('and id <> v_run.id')
    expect(sql012).toContain('and gameplay_started_at is not null')
    expect(sql012).toContain('and terminal is null')
    expect(sql012).toContain('and public.next_utc_reset_at(day_key) > v_now;')
    expect(sql012).toContain('security definer')
    expect(sql012).toContain('set search_path = pg_catalog, public')
    expect(sql012).not.toContain('upsert_reward_risk_assessment')
    expect(sql012).not.toContain('create table')
    expect(sql012).not.toContain('INSTALL_WALLET_FANOUT')
    expect(sql012).not.toContain('144')
  })

  it('A: never-played STARTED run does not count', () => {
    expect(countsAsConcurrentGameplayRun(
      candidate({ gameplayStartedAt: null }),
      CURRENT,
      NOW,
    )).toBe(false)
  })

  it('B: real gameplay-started, non-terminal, unexpired run still counts', () => {
    expect(countsAsConcurrentGameplayRun(candidate(), CURRENT, NOW)).toBe(true)
  })

  it('C: expired gameplay run does not count', () => {
    expect(countsAsConcurrentGameplayRun(
      candidate(),
      CURRENT,
      new Date('2026-09-10T00:00:01.000Z'),
    )).toBe(false)
  })

  it('D: terminal run does not count', () => {
    expect(countsAsConcurrentGameplayRun(
      candidate({ terminal: { type: 'ABANDONED', result: { runId: 'candidate-run', checkpointHash: '44'.repeat(32), outcome: 'ABANDONED', status: 'ABANDONED', rewardStatus: 'NONE' } } }),
      CURRENT,
      NOW,
    )).toBe(false)
  })

  it('E: current run, foreign wallet, other day, and non-STARTED runs do not count', () => {
    expect(countsAsConcurrentGameplayRun(candidate({ runId: 'current-run' }), CURRENT, NOW)).toBe(false)
    expect(countsAsConcurrentGameplayRun(candidate({ wallet: 'NQ-WALLET-B' }), CURRENT, NOW)).toBe(false)
    expect(countsAsConcurrentGameplayRun(candidate({ dayKey: '2026-09-08' }), CURRENT, NOW)).toBe(false)
    expect(countsAsConcurrentGameplayRun(candidate({ status: 'COMPLETED' }), CURRENT, NOW)).toBe(false)
  })
})

function publishedBlueprint(id: string) {
  const source = createRoom01Blueprint('2026-09-09', 'gem-runner', id)
  return { ...source, status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(source) }
}

function createClock(initial = '2026-09-09T12:00:00.000Z') {
  let current = new Date(initial)
  return { now: () => current, advance: (ms: number) => { current = new Date(current.getTime() + ms) } }
}

function decodeSequence(encoded: string): Direction[] {
  return [...encoded].map(character => {
    if (character === 'U') return 'UP'
    if (character === 'D') return 'DOWN'
    if (character === 'L') return 'LEFT'
    if (character === 'R') return 'RIGHT'
    throw new Error(`INVALID_SEQUENCE_CHAR:${character}`)
  })
}

function moves(start: number, directions: readonly Direction[]): MoveAction[] {
  return directions.map((direction, index) => ({ seq: start + index, type: 'MOVE' as const, direction }))
}

async function startRun(
  service: ReturnType<typeof createMemoryProofService>,
  keyPair: KeyPair,
  wallet: string,
) {
  const challenge = await service.issueStartChallenge(wallet, 'gem-runner')
  const payload: StartExpeditionPayload = {
    version: 1,
    type: 'NIMHUNT_START_EXPEDITION',
    wallet: challenge.wallet,
    mission: 'gem-runner',
    dayKey: challenge.dayKey,
    challenge: challenge.challenge,
    blueprintId: challenge.blueprintId,
    blueprintHash: challenge.blueprintHash,
  }
  const canonicalPayload = serializeStartPayload(payload)
  return service.authorizeStart({
    payload: canonicalPayload,
    publicKey: keyPair.publicKey.toHex(),
    signature: keyPair.sign(nimiqSignedMessageHash(canonicalPayload)).toHex(),
  })
}

async function verifyRun(
  service: ReturnType<typeof createMemoryProofService>,
  session: { readonly sessionHash: string; readonly runId: string; readonly wallet: string; readonly createdAt: string; readonly expiresAt: string; readonly revokedAt: string | null },
  runId: string,
  clock: { now: () => Date; advance: (ms: number) => void },
  humanTiming = true,
) {
  const directions = decodeSequence(PREVALIDATED_ROOM_01_BOOTSTRAP_WINNING_SEQUENCES['gem-runner'])
  for (let index = 0; index < directions.length; index += 8) {
    const current = service.getRun(runId)
    if (!current) throw new Error('RUN_MISSING')
    await service.appendCheckpoint({
      runId,
      session,
      previousCheckpointHash: current.checkpointHash,
      actions: moves(index + 1, directions.slice(index, index + 8)),
    })
  }
  const finished = service.getRun(runId)
  if (!finished) throw new Error('RUN_MISSING')
  if (humanTiming) clock.advance((minimumPlausibleCompletionMs(finished.seq) ?? 0) + 1_000)
  return service.verifyExpedition({ runId, session, checkpointHash: finished.checkpointHash })
}

describe('concurrent gameplay risk at the claim gate', () => {
  it('production replay: stranded never-played run no longer blocks the verified run', async () => {
    const clock = createClock()
    const keyPair = KeyPair.generate()
    const wallet = keyPair.toAddress().toUserFriendlyAddress()
    const service = createMemoryProofService({ clock, blueprints: [publishedBlueprint('concurrent-gem')] })

    await startRun(service, keyPair, wallet)

    const authorized = await startRun(service, keyPair, wallet)
    service.markGameplayStarted(authorized.start.runId, authorized.session)
    await verifyRun(service, authorized.session, authorized.start.runId, clock)
    const prepared = await service.prepareRewardClaim(authorized.start.runId, authorized.session)

    expect(prepared.outcome).toBe('PREPARED')
    expect(service.getWalletDailyStatus(wallet)).toMatchObject({ expeditionsStarted: 2, expeditionsRemaining: 1 })
  }, 15_000)

  it('genuine simultaneous gameplay run still BLOCKs with SESSION category', async () => {
    const clock = createClock()
    const keyPair = KeyPair.generate()
    const wallet = keyPair.toAddress().toUserFriendlyAddress()
    const service = createMemoryProofService({ clock, blueprints: [publishedBlueprint('concurrent-gem-block')] })

    const first = await startRun(service, keyPair, wallet)
    service.markGameplayStarted(first.start.runId, first.session)

    const second = await startRun(service, keyPair, wallet)
    service.markGameplayStarted(second.start.runId, second.session)
    await verifyRun(service, second.session, second.start.runId, clock)
    const blocked = await service.prepareRewardClaim(second.start.runId, second.session)

    expect(blocked).toMatchObject({ outcome: 'BLOCK', reasonCategory: 'SESSION' })
  }, 15_000)

  it('impossible speed still BLOCKs with TIMING category', async () => {
    const clock = createClock()
    const keyPair = KeyPair.generate()
    const wallet = keyPair.toAddress().toUserFriendlyAddress()
    const service = createMemoryProofService({ clock, blueprints: [publishedBlueprint('concurrent-gem-speed')] })

    const authorized = await startRun(service, keyPair, wallet)
    service.markGameplayStarted(authorized.start.runId, authorized.session)
    await verifyRun(service, authorized.session, authorized.start.runId, clock, false)
    const blocked = await service.prepareRewardClaim(authorized.start.runId, authorized.session)

    expect(blocked).toMatchObject({ outcome: 'BLOCK', reasonCategory: 'TIMING' })
  }, 15_000)
})
