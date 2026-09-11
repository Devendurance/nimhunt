import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ExpeditionProofApiError,
  submitCheckpoint,
} from '../../api/expeditionProof.ts'
import type {
  ProductActiveExpedition,
  ProductProofState,
} from '../../domain/expeditionProof.ts'
import type { ProductProofBridge } from '../../game/productProof.ts'
import { deriveCheckpointProgress, progressConflicts } from '../../game/replay/checkpointProgress.ts'
import { createCheckpointQueue } from '../../game/replay/checkpointQueue.ts'
import { advanceRun, replayActions } from '../../game/replay/engine.ts'
import type { Direction } from '../../game/world/grid.ts'
import type { MoveAction, ReplayState } from '../../game/replay/types.ts'

export const SYNCING_COPY = 'Syncing expedition…'
export const PROOF_LOST_TITLE = 'Reward proof was interrupted.'
export const PROOF_LOST_DETAIL = "You can keep exploring, but this run can no longer reserve today's treasure."

export type ProductCheckpointView = {
  readonly proofState: ProductProofState
  readonly movementPaused: boolean
  readonly proofLost: boolean
  readonly syncing: boolean
}

export type ProductCheckpointSession = {
  readonly proof: ProductProofBridge
  canAcceptMove(): boolean
  recordAcceptedMove(direction: Direction): void
  notifyGameplayEvent(event: 'MISSION_COMPLETE' | 'DEATH' | 'VAULT_REACHED'): void
  flushPending(): Promise<void>
  snapshot(): ProductCheckpointView
  stop(): void
}

const IDLE_VIEW: ProductCheckpointView = {
  proofState: 'NOT_APPLICABLE',
  movementPaused: false,
  proofLost: false,
  syncing: false,
}

export function createProductCheckpointSession(
  active: ProductActiveExpedition,
  options: {
    readonly submit?: typeof submitCheckpoint
    readonly retryDelayMs?: number
    readonly onChange?: (view: ProductCheckpointView) => void
  } = {},
): ProductCheckpointSession {
  const submit = options.submit ?? submitCheckpoint
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

  const proof: ProductProofBridge = {
    canAcceptMove: () => queue.canAcceptMove(),
    recordAcceptedMove: (direction) => recordAcceptedMove(direction),
    notifyGameplayEvent: () => {
      queue.requestFlush()
      emit()
      schedulePump()
    },
  }

  return {
    proof,
    canAcceptMove: () => queue.canAcceptMove(),
    recordAcceptedMove,
    notifyGameplayEvent: proof.notifyGameplayEvent,
    flushPending,
    snapshot: viewFromQueue,
    stop() {
      stopped = true
    },
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
    emit()
    schedulePump()
  }

  async function flushPending(): Promise<void> {
    if (stopped || queue.snapshot().proofState === 'PROOF_LOST') return
    queue.requestFlush()
    emit()
    await Promise.resolve()
    await pump()
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
      if (!request) return
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
  }

  function loseProof(reason: string): void {
    traceCheckpoint('PROOF_LOST_REASON', reason)
    queue.failUnrecoverable()
    emit()
  }

  function emit(): void {
    options.onChange?.(viewFromQueue())
  }

  function viewFromQueue(): ProductCheckpointView {
    const snapshot = queue.snapshot()
    return {
      proofState: snapshot.proofState,
      movementPaused: snapshot.movementPaused,
      proofLost: snapshot.proofState === 'PROOF_LOST',
      syncing: snapshot.movementPaused,
    }
  }
}

export function useProductCheckpoint(active: ProductActiveExpedition | null): {
  readonly proof: ProductProofBridge
  readonly view: ProductCheckpointView
  readonly flushPending: () => Promise<void>
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
