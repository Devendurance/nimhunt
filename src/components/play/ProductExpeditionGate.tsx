import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  fetchActiveExpedition,
  markGameplayStarted,
  ExpeditionProofApiError,
} from '../../api/expeditionProof.ts'
import type { ProductActiveExpedition } from '../../domain/expeditionProof.ts'
import type { PlayableMission } from './expeditionFlow'
import { HuntHeader } from './HuntHeader'
import { createProductGateAttemptGuard, canMountProduct, reduceProductGate, validateProductActive, INITIAL_PRODUCT_GATE_STATE } from './productGateState.ts'
import styles from './PlayShell.module.css'
import type { ProductGateError } from './productGateState.ts'

export function ProductExpeditionGate({ mission, runId, onBackToMissions, children }: {
  readonly mission: PlayableMission
  readonly runId: string
  readonly onBackToMissions: () => void
  readonly children: (active: ProductActiveExpedition) => ReactNode
}) {
  const [state, dispatch] = useReducer(reduceProductGate, INITIAL_PRODUCT_GATE_STATE)
  const mountedRef = useRef(true)
  const routeKeyRef = useRef(`${mission}:${runId}`)
  const attemptGuardRef = useRef(createProductGateAttemptGuard())
  const routeKey = `${mission}:${runId}`

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const isCurrent = useCallback((): boolean => {
    return mountedRef.current && routeKeyRef.current === routeKey
  }, [routeKey])

  useEffect(() => {
    routeKeyRef.current = routeKey
  }, [routeKey])

  useEffect(() => {
    if (!attemptGuardRef.current.begin(routeKey)) return
    dispatch({ type: 'RESET' })
    void loadGate()

    async function loadGate(): Promise<void> {
      try {
        const active = await fetchActiveExpedition(runId)
        if (!isCurrent()) return
        const validation = validateProductActive(active, mission, runId)
        if (validation) {
          dispatch({ type: 'ERROR', error: validation })
          return
        }
        dispatch({ type: 'ACTIVE_RECEIVED', active })
        try {
          const gameplayStart = await markGameplayStarted(active.runId)
          if (!isCurrent()) return
           dispatch({ type: 'GAMEPLAY_STARTED', runId: gameplayStart.runId, outcome: gameplayStart.outcome })
        } catch (error) {
          if (!isCurrent()) return
          if (error instanceof ExpeditionProofApiError && error.code === 'NETWORK_ERROR') {
            dispatch({ type: 'GAMEPLAY_START_RETRYABLE' })
            return
          }
          dispatch({ type: 'ERROR', error: mapGateError(error, true) })
        }
      } catch (error) {
        if (!isCurrent()) return
        dispatch({ type: 'ERROR', error: mapGateError(error, false) })
      }
    }
  }, [isCurrent, mission, routeKey, runId])

  const retryGameplayStart = useCallback(() => {
    if (state.status !== 'RETRY_GAMEPLAY_START' || !state.active || !isCurrent()) return
    void markGameplayStarted(state.active.runId)
      .then(result => {
        if (!isCurrent()) return
         dispatch({ type: 'GAMEPLAY_STARTED', runId: result.runId, outcome: result.outcome })
      })
      .catch(error => {
        if (!isCurrent()) return
        if (error instanceof ExpeditionProofApiError && error.code === 'NETWORK_ERROR') return
        dispatch({ type: 'ERROR', error: mapGateError(error, true) })
      })
  }, [isCurrent, state])

  if (canMountProduct(state) && state.active) return <>{children(state.active)}</>

  return <div className={styles.shell}><div className={styles.viewport}>
    <HuntHeader />
    <main className={styles.main}>
      <section className={styles.gateCard} aria-labelledby="product-gate-heading" aria-busy={state.status === 'LOADING_ACTIVE' || state.status === 'MARKING_GAMEPLAY_START'}>
        <span className={styles.kicker}>AUTHENTICATED EXPEDITION</span>
        <h1 id="product-gate-heading">Preparing the ruins</h1>
        {state.status === 'LOADING_ACTIVE' && <p className={styles.gateStatus} role="status">Checking your expedition session…</p>}
        {state.status === 'MARKING_GAMEPLAY_START' && <p className={styles.gateStatus} role="status">Opening the server-bound route…</p>}
        {state.status === 'RETRY_GAMEPLAY_START' && <>
          <div className={styles.productNotice} role="status">
            <strong>Connection interrupted before the ruins opened.</strong>
            <p>Retrying uses the same expedition and does not create a new attempt.</p>
          </div>
          <button className={styles.sheetPrimary} type="button" onClick={retryGameplayStart}>Retry opening the expedition</button>
        </>}
        {state.status === 'ERROR' && state.error && <div className={styles.productError} role="alert">
          <strong>{gateErrorCopy(state.error)}</strong>
          <p>This route will not start a local substitute.</p>
        </div>}
        {state.status === 'ERROR' && <button className={styles.sheetSecondary} type="button" onClick={onBackToMissions}>Back to missions</button>}
      </section>
    </main>
  </div></div>

}

function mapGateError(error: unknown, gameplayStart: boolean): ProductGateError {
  if (error instanceof ExpeditionProofApiError) {
    if (error.code === 'RUN_SESSION_INVALID') return 'RUN_SESSION_INVALID'
    if (error.code === 'ACTIVE_RUN_UNAVAILABLE') return 'ACTIVE_RUN_UNAVAILABLE'
    if (error.code === 'PROOF_UNAVAILABLE') return 'PROOF_UNAVAILABLE'
    if (error.code === 'NETWORK_ERROR') return 'NETWORK_ERROR'
  }
  return gameplayStart ? 'GAMEPLAY_START_FAILED' : 'PROOF_UNAVAILABLE'
}

function gateErrorCopy(error: ProductGateError): string {
  if (error === 'RUN_SESSION_INVALID') return 'This expedition session is no longer valid.'
  if (error === 'ACTIVE_RUN_UNAVAILABLE') return 'This expedition is no longer ready to enter.'
  if (error === 'MISSION_MISMATCH') return 'This route does not match the authorized expedition.'
  if (error === 'MALFORMED_ACTIVE') return 'The expedition data could not be trusted.'
  if (error === 'PROOF_UNAVAILABLE') return 'Reward expeditions are temporarily unavailable.'
  if (error === 'NETWORK_ERROR') return 'The expedition session could not be reached.'
  return 'The expedition could not be opened.'
}
