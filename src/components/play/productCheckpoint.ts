import { useEffect, useMemo, useRef, useState } from 'react'
import {
  abandonExpedition,
  ExpeditionProofApiError,
  submitCheckpoint,
  verifyExpedition,
} from '../../api/expeditionProof.ts'
import type {
  ProductActiveExpedition,
  ProductProofState,
  VerifyExpeditionResult,
} from '../../domain/expeditionProof.ts'
import type { ProductProofBridge } from '../../game/productProof.ts'
import { deriveCheckpointProgress, progressConflicts } from '../../game/replay/checkpointProgress.ts'
import { createCheckpointQueue } from '../../game/replay/checkpointQueue.ts'
import { advanceRun, replayActions } from '../../game/replay/engine.ts'
import type { Direction } from '../../game/world/grid.ts'
import type { MoveAction, ReplayState } from '../../game/replay/types.ts'
import { rememberProductTerminal } from './productRunSession.ts'

export const SYNCING_COPY = 'Syncing expedition…'
export const VERIFYING_COPY = 'Verifying expedition…'
export const VERIFIED_TITLE = 'Expedition verified'
export const MISSION_COMPLETE_COPY = 'MISSION COMPLETE'
export const CLAIM_TODAY_COPY = "Claim today's treasure"
export const SIGNING_CLAIM_COPY = 'Signing reward claim…'
export const TREASURE_RESERVED_TITLE = 'TREASURE RESERVED'
export const TREASURE_RESERVED_DETAIL = "You secured one of today's 69 reward slots."
export const TREASURE_RESERVED_NOTE = 'Reservation confirmed.'
export const TODAY_FULL_TITLE = "TODAY'S TREASURE IS FULL"
export const TODAY_FULL_DETAIL = 'All 69 reward slots have been reserved.'
export const ALREADY_REWARDED_TITLE = "TODAY'S REWARD ALREADY RESERVED"
export const REWARD_REVIEW_TITLE = 'REWARD CHECK IN PROGRESS'
export const REWARD_REVIEW_DETAIL = 'Your expedition is verified, but this reward needs an additional eligibility check.'
export const REWARD_BLOCK_TITLE = 'REWARD NOT ELIGIBLE'
export const REWARD_BLOCK_DETAIL = 'This reward could not be confirmed for this expedition.'
export const VAULT_GAMEPLAY_VERIFIED_TITLE = 'TEMPLE VAULT REACHED'
export const VAULT_GAMEPLAY_VERIFIED_DETAIL = 'Vault gameplay verified.'
export const SEAL_TREASURE_COPY = 'Seal treasure'
export const SEALING_TREASURE_COPY = 'Sealing treasure…'
export const TREASURE_SEALED_TITLE = 'TREASURE SEALED'
export const TREASURE_SEALED_DETAIL = 'Your Nimiq signature was verified for this expedition.'
export const SIGNATURE_CANCELLED_COPY = 'Signature request was cancelled.'
export const PROOF_LOST_TITLE = 'Reward proof was interrupted.'
export const PROOF_LOST_DETAIL = "You can keep exploring, but this run can no longer reserve today's treasure."
export const VERIFY_REJECTED_TITLE = 'Expedition could not be verified.'
export const VERIFY_REJECTED_DETAIL = 'Reward proof does not match the server record.'
export const MISSION_INCOMPLETE_COPY = 'Mission objective is not complete yet.'

export type ProductCheckpointView = {
  readonly proofState: ProductProofState
  readonly movementPaused: boolean
  readonly proofLost: boolean
  readonly syncing: boolean
  readonly verifying: boolean
  readonly verifiedEligible: boolean
  readonly vaultGameplayVerified: boolean
  readonly verifyRejected: boolean
  readonly missionIncomplete: boolean
  readonly verifiedResult: VerifyExpeditionResult | null
}

export type ProductCheckpointSession = {
  readonly proof: ProductProofBridge
  canAcceptMove(): boolean
  recordAcceptedMove(direction: Direction): void
  notifyGameplayEvent(event: 'MISSION_COMPLETE' | 'DEATH' | 'VAULT_REACHED'): void
  flushPending(): Promise<void>
  leaveAndAbandon(): Promise<void>
  snapshot(): ProductCheckpointView
  stop(): void
}

const IDLE_VIEW: ProductCheckpointView = {
  proofState: 'NOT_APPLICABLE',
  movementPaused: false,
  proofLost: false,
  syncing: false,
  verifying: false,
  verifiedEligible: false,
  vaultGameplayVerified: false,
  verifyRejected: false,
  missionIncomplete: false,
  verifiedResult: null,
}

export function createProductCheckpointSession(
  active: ProductActiveExpedition,
  options: {
    readonly submit?: typeof submitCheckpoint
    readonly verify?: typeof verifyExpedition
    readonly abandon?: typeof abandonExpedition
    readonly retryDelayMs?: number
    readonly onChange?: (view: ProductCheckpointView) => void
  } = {},
): ProductCheckpointSession {
  const submit = options.submit ?? submitCheckpoint
  const verify = options.verify ?? verifyExpedition
  const abandon = options.abandon ?? abandonExpedition
  const retryDelayMs = options.retryDelayMs ?? 250
  const queue = createCheckpointQueue({
    runId: active.runId,
    checkpointHash: active.checkpoint.checkpointHash,
  })
  const initialInput = {
    mission: active.state.mission,
    rulesVersion: active.state.rulesVersion,
    roomVersion: active.state.roomVersion,
    blueprint: active.state.blueprint,
  }
  const accepted: MoveAction[] = []
  let localReplay: ReplayState = cloneReplay(active.state)
  let stopped = false
  let pumping: Promise<void> | null = null
  let scheduled = false
  let pendingVerify = false
  let terminalLocked = false
  let overlayState: ProductProofState | null = null
  let verifiedResult: VerifyExpeditionResult | null = null
  let verifyRejected = false
  let missionIncomplete = false

  const proof: ProductProofBridge = {
    canAcceptMove: () => canAcceptMove(),
    recordAcceptedMove: (direction) => recordAcceptedMove(direction),
    notifyGameplayEvent: (event) => notifyGameplayEvent(event),
  }

  return {
    proof,
    canAcceptMove,
    recordAcceptedMove,
    notifyGameplayEvent,
    flushPending,
    leaveAndAbandon,
    snapshot: viewFromQueue,
    stop() {
      stopped = true
    },
  }

  function canAcceptMove(): boolean {
    if (overlayState === 'PROOF_LOST') return true
    if (terminalLocked || overlayState === 'VERIFYING' || overlayState === 'VERIFIED_ELIGIBLE' || overlayState === 'VAULT_GAMEPLAY_VERIFIED') {
      return false
    }
    return queue.canAcceptMove()
  }

  function recordAcceptedMove(direction: Direction): void {
    const action = queue.recordAcceptedMove(direction)
    if (!action) return
    const result = advanceRun(localReplay, action)
    if (!result.accepted) {
      loseProof(`LOCAL_REPLAY_REJECTED:${result.reason ?? 'unknown'}`)
      return
    }
    accepted.push(action)
    localReplay = result.state
    if (missionIncomplete) missionIncomplete = false
    emit()
    schedulePump()
  }

  function notifyGameplayEvent(event: 'MISSION_COMPLETE' | 'DEATH' | 'VAULT_REACHED'): void {
    if (stopped || overlayState === 'PROOF_LOST') return
    if (!shouldVerifyGameplayEvent(active.mission, event)) return
    terminalLocked = true
    pendingVerify = true
    missionIncomplete = false
    queue.requestFlush()
    emit()
    schedulePump()
  }

  async function flushPending(): Promise<void> {
    if (stopped || overlayState === 'PROOF_LOST') return
    queue.requestFlush()
    emit()
    await Promise.resolve()
    await pump()
  }

  async function leaveAndAbandon(): Promise<void> {
    if (stopped) return
    await flushPending()
    if (stopped || verifiedResult || overlayState === 'PROOF_LOST' || overlayState === 'VERIFIED_ELIGIBLE' || overlayState === 'VAULT_GAMEPLAY_VERIFIED') return
    const snapshot = queue.snapshot()
    if (snapshot.unacked.length > 0 || snapshot.inFlight) {
      loseProof('LEAVE_UNACKED')
      return
    }
    try {
      await abandon({ runId: active.runId, checkpointHash: snapshot.checkpointHash })
    } catch (error) {
      const code = error instanceof ExpeditionProofApiError ? error.code : 'UNKNOWN'
      loseProof(`ABANDON_ERROR:${code}`)
    }
  }

  function schedulePump(): void {
    if (stopped || scheduled) return
    scheduled = true
    void Promise.resolve().then(() => {
      scheduled = false
      void pump()
    })
  }

  async function pump(): Promise<void> {
    if (pumping) return pumping
    pumping = runPump().finally(() => {
      pumping = null
    })
    return pumping
  }

  async function runPump(): Promise<void> {
    while (!stopped) {
      const request = queue.nextRequest()
      if (request) {
        const seqStart = request.actions[0]?.seq
        const seqEnd = request.actions[request.actions.length - 1]?.seq
        traceCheckpoint(
          'CHECKPOINT_BATCH_READY',
          `seq=${seqStart ?? '?'}-${seqEnd ?? '?'} prev=${truncateHash(request.previousCheckpointHash)} dirs=${request.actions.map(action => action.direction).join(',')}`,
        )
        emit()
        try {
          const ack = await submit(request)
          traceCheckpoint(
            'CHECKPOINT_ACK',
            `seq=${ack.seqStart}-${ack.seqEnd} acknowledgedSeq=${ack.acknowledgedSeq} prev=${truncateHash(ack.previousCheckpointHash)} hash=${truncateHash(ack.checkpointHash)}`,
          )
          if (queue.acknowledge(ack) !== 'ok') {
            loseProof('ACK_CONFLICT')
            return
          }
          const expectedState = replayActions(initialInput, accepted.filter(action => action.seq <= ack.acknowledgedSeq))
          const expected = deriveCheckpointProgress(expectedState, ack.checkpointHash)
          if (progressConflicts(expected, ack)) {
            loseProof('PROGRESS_CONFLICT')
            return
          }
          emit()
          continue
        } catch (error) {
          const code = error instanceof ExpeditionProofApiError ? error.code : 'UNKNOWN'
          traceCheckpoint('CHECKPOINT_ERROR_CODE', `code=${code}`)
          if (isTransient(error)) {
            queue.failTransient()
            emit()
            if (stopped) return
            await wait(retryDelayMs)
            continue
          }
          loseProof(`API_ERROR:${code}`)
          return
        }
      }

      if (pendingVerify && overlayState !== 'PROOF_LOST') {
        const snapshot = queue.snapshot()
        if (snapshot.unacked.length > 0 || snapshot.inFlight) return
        pendingVerify = false
        await runVerify(snapshot.checkpointHash)
        continue
      }
      return
    }
  }

  async function runVerify(checkpointHash: string): Promise<void> {
    overlayState = 'VERIFYING'
    emit()
    try {
      const result = await verify({ runId: active.runId, checkpointHash })
      verifiedResult = result
      if (result.outcome === 'VERIFIED_ELIGIBLE') overlayState = 'VERIFIED_ELIGIBLE'
      else if (result.outcome === 'VAULT_GAMEPLAY_VERIFIED') overlayState = 'VAULT_GAMEPLAY_VERIFIED'
      else overlayState = 'CHECKPOINT_SYNCED'
      if (overlayState === 'VERIFIED_ELIGIBLE' || overlayState === 'VAULT_GAMEPLAY_VERIFIED') {
        rememberProductTerminal(active.mission, result)
      }
      emit()
    } catch (error) {
      const code = error instanceof ExpeditionProofApiError ? error.code : 'UNKNOWN'
      if (code === 'RUN_INCOMPLETE') {
        terminalLocked = false
        pendingVerify = false
        overlayState = null
        verifyRejected = false
        missionIncomplete = true
        emit()
        return
      }
      verifyRejected = true
      loseProof(`VERIFY_ERROR:${code}`)
    }
  }

  function loseProof(reason: string): void {
    traceCheckpoint('PROOF_LOST_REASON', reason)
    overlayState = 'PROOF_LOST'
    queue.failUnrecoverable()
    emit()
  }

  function emit(): void {
    options.onChange?.(viewFromQueue())
  }

  function viewFromQueue(): ProductCheckpointView {
    const snapshot = queue.snapshot()
    const proofState = overlayState ?? (pendingVerify && snapshot.unacked.length === 0 && !snapshot.inFlight ? 'VERIFYING' : snapshot.proofState)
    const proofLost = proofState === 'PROOF_LOST'
    const verifying = proofState === 'VERIFYING'
    const flushingTerminal = pendingVerify && (snapshot.unacked.length > 0 || Boolean(snapshot.inFlight))
    return {
      proofState,
      movementPaused: !proofLost && (terminalLocked || snapshot.movementPaused || verifying),
      proofLost,
      syncing: !proofLost && !verifying && (snapshot.movementPaused || flushingTerminal),
      verifying,
      verifiedEligible: proofState === 'VERIFIED_ELIGIBLE',
      vaultGameplayVerified: proofState === 'VAULT_GAMEPLAY_VERIFIED',
      verifyRejected: verifyRejected || (proofLost && terminalLocked),
      missionIncomplete,
      verifiedResult,
    }
  }
}

export function shouldVerifyGameplayEvent(
  mission: ProductActiveExpedition['mission'],
  event: 'MISSION_COMPLETE' | 'DEATH' | 'VAULT_REACHED',
): boolean {
  if (event === 'DEATH' || event === 'MISSION_COMPLETE') return true
  return event === 'VAULT_REACHED' && mission === 'vault-breaker'
}

export function useProductCheckpoint(active: ProductActiveExpedition | null): {
  readonly proof: ProductProofBridge
  readonly view: ProductCheckpointView
  readonly flushPending: () => Promise<void>
  readonly leaveAndAbandon: () => Promise<void>
} {
  const [view, setView] = useState<ProductCheckpointView>(IDLE_VIEW)
  const sessionRef = useRef<ProductCheckpointSession | null>(null)
  const proof = useMemo<ProductProofBridge>(() => ({
    canAcceptMove: () => sessionRef.current?.canAcceptMove() ?? true,
    recordAcceptedMove: (direction) => {
      sessionRef.current?.recordAcceptedMove(direction)
    },
    notifyGameplayEvent: (event) => {
      sessionRef.current?.notifyGameplayEvent(event)
    },
  }), [])

  useEffect(() => {
    if (!active) {
      sessionRef.current = null
      return
    }
    const session = createProductCheckpointSession(active, { onChange: setView })
    sessionRef.current = session
    return () => {
      session.stop()
      if (sessionRef.current === session) sessionRef.current = null
    }
  }, [active])

  return {
    proof,
    view,
    flushPending: () => sessionRef.current?.flushPending() ?? Promise.resolve(),
    leaveAndAbandon: () => sessionRef.current?.leaveAndAbandon() ?? Promise.resolve(),
  }
}

function cloneReplay(state: ReplayState): ReplayState {
  return JSON.parse(JSON.stringify(state)) as ReplayState
}

function isTransient(error: unknown): boolean {
  if (!(error instanceof ExpeditionProofApiError)) return false
  return error.code === 'NETWORK_ERROR' || error.code === 'PROOF_UNAVAILABLE'
}

function truncateHash(value: string): string {
  return /^[0-9a-f]{64}$/.test(value) ? `${value.slice(0, 8)}…` : 'invalid'
}

function traceCheckpoint(boundary: string, details = ''): void {
  const env = (import.meta as ImportMeta & { env?: { DEV?: boolean; MODE?: string } }).env
  if (!env?.DEV || env.MODE === 'test') return
  console.info(`[product-checkpoint] ${boundary}${details ? ` ${details}` : ''}`)
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}
