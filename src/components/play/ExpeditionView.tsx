import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Droplets, Gem, Heart, KeyRound, Package, Sword, Triangle } from 'lucide-react'
import { getMissionObjective, getMissionTitle } from '../../game/domain/mission'
import type { Direction } from '../../game/world/grid'
import type { ProductActiveExpedition } from '../../domain/expeditionProof.ts'
import type { CreateGameOptions } from '../../game/createNimHuntGame'
import { getExpeditionResult, type PlayableMission } from './expeditionFlow'
import {
  MISSION_COMPLETE_COPY,
  MISSION_INCOMPLETE_COPY,
  PROOF_LOST_DETAIL,
  PROOF_LOST_TITLE,
  SYNCING_COPY,
  VERIFIED_TITLE,
  VERIFY_REJECTED_DETAIL,
  VERIFY_REJECTED_TITLE,
  VERIFYING_COPY,
  useProductCheckpoint,
} from './productCheckpoint'
import { ProductRewardClaimOutcome } from './ProductRewardClaimOutcome'
import { ProductVaultOutcome } from './ProductVaultOutcome'
import { useAngkorRun } from './useAngkorRun'
import { useProductPayoutStatus } from './useProductPayoutStatus'
import { useProductRewardClaim } from './useProductRewardClaim'
import { useProductVaultSeal } from './useProductVaultSeal'
import styles from './ExpeditionView.module.css'

const directions = [
  { direction: 'UP', label: 'Up', Icon: ArrowUp },
  { direction: 'LEFT', label: 'Left', Icon: ArrowLeft },
  { direction: 'RIGHT', label: 'Right', Icon: ArrowRight },
  { direction: 'DOWN', label: 'Down', Icon: ArrowDown },
] as const

type ExpeditionViewProps = {
  mission: PlayableMission
  onBackToMissions: () => void
  onReturnToHunt: () => void
} & (
  | { mode: 'product'; active: ProductActiveExpedition }
  | { mode: 'practice' }
)

export function ExpeditionView(props: ExpeditionViewProps) {
  const { mission, mode, onBackToMissions, onReturnToHunt } = props
  const active = props.mode === 'product' ? props.active : null
  const checkpoint = useProductCheckpoint(active)
  const vaultSeal = useProductVaultSeal({
    enabled: mode === 'product' && mission === 'vault-breaker' && checkpoint.view.vaultGameplayVerified,
    runId: active?.runId ?? null,
  })
  const rewardClaim = useProductRewardClaim({
    enabled: mode === 'product' && (checkpoint.view.verifiedEligible || vaultSeal.status === 'VERIFIED'),
    mission,
    runId: active?.runId ?? null,
  })
  const payout = useProductPayoutStatus({
    enabled: mode === 'product' && rewardClaim.status === 'RESERVED',
    claimId: rewardClaim.result && 'claimId' in rewardClaim.result ? rewardClaim.result.claimId : null,
  })
  const gameOptions = useMemo<CreateGameOptions>(() => {
    if (mode === 'practice') return { mode: 'dev', mission }
    if (!active) throw new Error('PRODUCT_ACTIVE_EXPEDITION_REQUIRED')
    return { mode: 'product', mission, blueprint: active.blueprint, initialState: active.state, proof: checkpoint.proof }
  }, [active, checkpoint.proof, mission, mode])
  const { containerRef, hud, move } = useAngkorRun(gameOptions)
  const terminal = hud.runStatus !== 'PLAYING'
  const result = getExpeditionResult(hud)
  const isChestHunter = mission === 'chest-hunter'
  const isVault = mission === 'vault-breaker'
  const inputLocked = terminal || checkpoint.view.movementPaused
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const leaveButtonRef = useRef<HTMLButtonElement>(null)
  const confirmHeadingRef = useRef<HTMLHeadingElement>(null)
  const upRef = useRef<HTMLButtonElement>(null)
  const previousStatus = useRef(hud.runStatus)

  useEffect(() => {
    if (hud.runStatus !== 'PLAYING') headingRef.current?.focus({ preventScroll: true })
    else if (previousStatus.current !== 'PLAYING') upRef.current?.focus({ preventScroll: true })
    previousStatus.current = hud.runStatus
  }, [hud.runStatus])

  useEffect(() => {
    if (confirmingLeave) confirmHeadingRef.current?.focus({ preventScroll: true })
  }, [confirmingLeave])

  const closeConfirm = useCallback(() => {
    setConfirmingLeave(false)
    requestAnimationFrame(() => leaveButtonRef.current?.focus())
  }, [])

  const leaveExpedition = useCallback(() => {
    void (mode === 'product' ? checkpoint.leaveAndAbandon() : checkpoint.flushPending()).finally(onBackToMissions)
  }, [checkpoint, mode, onBackToMissions])

  useEffect(() => {
    if (!confirmingLeave) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmingLeave, closeConfirm])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))) return
      if (confirmingLeave) return
      const mapping: Record<string, Direction> = { ArrowUp: 'UP', w: 'UP', ArrowDown: 'DOWN', s: 'DOWN', ArrowLeft: 'LEFT', a: 'LEFT', ArrowRight: 'RIGHT', d: 'RIGHT' }
      const direction = mapping[event.key] ?? mapping[event.key.toLowerCase()]
      if (direction) {
        event.preventDefault()
        if (!inputLocked) move(direction)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setConfirmingLeave(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, inputLocked, confirmingLeave])

  const missionTitle = getMissionTitle(mission)
  const missionObjective = getMissionObjective(mission)

  return <div className={styles.shell}><main className={styles.viewport}>
    <header className={styles.header}>
      <div><span className={styles.kicker}>ANGKOR RUINS</span><h1 className={styles.title}>{missionTitle}</h1></div>
      <button ref={leaveButtonRef} type="button" className={styles.leaveBtn} onClick={() => setConfirmingLeave(true)}>Leave expedition</button>
    </header>
    {mode === 'practice' && <section className={styles.practiceNotice} aria-label="Practice run status">
      <strong>PRACTICE RUN</strong>
      <span>No daily expedition used.</span>
      <span>No NIM reward can be reserved.</span>
    </section>}
    {checkpoint.view.verifyRejected && <section className={styles.proofLost} role="status" aria-label="Expedition verification failed">
      <strong>{VERIFY_REJECTED_TITLE}</strong>
      <span>{VERIFY_REJECTED_DETAIL}</span>
    </section>}
    {checkpoint.view.proofLost && !checkpoint.view.verifyRejected && <section className={styles.proofLost} role="status" aria-label="Reward proof interrupted">
      <strong>{PROOF_LOST_TITLE}</strong>
      <span>{PROOF_LOST_DETAIL}</span>
    </section>}
    {checkpoint.view.verifying && <p className={styles.syncNotice} role="status">{VERIFYING_COPY}</p>}
    {checkpoint.view.syncing && !checkpoint.view.proofLost && !checkpoint.view.verifying && <p className={styles.syncNotice} role="status">{SYNCING_COPY}</p>}
    {checkpoint.view.missionIncomplete && !checkpoint.view.verifying && !checkpoint.view.proofLost && <p className={styles.syncNotice} role="status">{MISSION_INCOMPLETE_COPY}</p>}
    <section className={styles.hudCard} aria-label={`${missionTitle} mission progress`}>
      <p className={styles.objective}>{missionObjective}</p>
      <div className={styles.metrics}>
        <div><span><Heart size={16} aria-hidden="true" /> HP <strong data-testid="hp">{hud.hp} / 100</strong></span><progress max={100} value={hud.hp} aria-label="Health" /></div>
        {isChestHunter
          ? <span><Package size={18} aria-hidden="true" /> CHESTS <strong data-testid="chests">{hud.chestsOpened} / {hud.chestTarget}</strong></span>
          : isVault
            ? <span><KeyRound size={18} aria-hidden="true" /> VAULT <strong data-testid="vault">{hud.objectiveReached ? 'Reached' : hud.hasTempleKey ? 'Key found' : 'Locked'}</strong></span>
            : <span><Gem size={18} aria-hidden="true" /> GEMS <strong data-testid="gems">{hud.gemsCollected} / {hud.gemTarget}</strong></span>}
      </div>
      <div className={styles.keyState}>
        <span className={styles.itemBadge}><KeyRound size={14} aria-hidden="true" />KEY <strong>{hud.hasTempleKey ? 'Found' : 'Not found'}</strong></span>
        <span className={styles.itemBadge}><Sword size={14} aria-hidden="true" />SWORD <strong>{hud.hasSword ? 'Ready' : 'None'}</strong></span>
        <span className={styles.notice} role="status">{hud.notice}</span>
      </div>
    </section>
    <div className={styles.canvasWrapper}><div ref={containerRef} className={styles.canvasInner} role="img" aria-label="Angkor Ruins expedition. Use the directional controls to move." /></div>
    <p className={styles.legend}><span><Triangle size={14} aria-hidden="true" />Spikes −25 HP</span><span><Droplets size={14} aria-hidden="true" />Poison −20 HP</span></p>
    <div className={styles.controlsArea}>
      {checkpoint.view.verifyRejected ? <section className={styles.outcome} aria-labelledby="run-outcome">
        <h2 id="run-outcome" ref={headingRef} tabIndex={-1}>{VERIFY_REJECTED_TITLE}</h2>
        <p>{VERIFY_REJECTED_DETAIL}</p>
        <div className={styles.actions}><button type="button" onClick={onBackToMissions}>Back to missions</button><button type="button" onClick={onReturnToHunt}>Return to Hunt</button></div>
      </section> : checkpoint.view.verifiedEligible ? <ProductRewardClaimOutcome
        claim={rewardClaim}
        payout={payout}
        heading={VERIFIED_TITLE}
        headingRef={headingRef}
        detail={result.status === 'complete' ? `${MISSION_COMPLETE_COPY} ${result.title} ${result.detail}` : undefined}
        onClaimTreasure={rewardClaim.claimTreasure}
        onBackToMissions={onBackToMissions}
        onReturnToHunt={onReturnToHunt}
      /> : checkpoint.view.vaultGameplayVerified ? <ProductVaultOutcome
        seal={vaultSeal}
        claim={rewardClaim}
        payout={payout}
        headingRef={headingRef}
        onSealTreasure={vaultSeal.sealTreasure}
        onClaimTreasure={rewardClaim.claimTreasure}
        onBackToMissions={onBackToMissions}
        onReturnToHunt={onReturnToHunt}
      /> : checkpoint.view.verifying || (mode === 'product' && result.status === 'complete') ? <section className={styles.outcome} aria-labelledby="run-outcome">
        <h2 id="run-outcome" ref={headingRef} tabIndex={-1}>{VERIFYING_COPY}</h2>
      </section> : mode === 'practice' && terminal && result.status !== 'playing' ? <section className={styles.outcome} aria-labelledby="run-outcome">
        <h2 id="run-outcome" ref={headingRef} tabIndex={-1}>{result.status === 'complete' ? 'MISSION COMPLETE' : 'EXPEDITION FAILED'}</h2>
        {result.status === 'complete'
          ? <><strong>{result.title}</strong><p>{result.detail}</p><p>You survived the expedition.</p></>
          : <><p>{result.title}</p><p>{result.detail}</p></>}
        <div className={styles.actions}><button type="button" onClick={onBackToMissions}>Back to missions</button><button type="button" onClick={onReturnToHunt}>Return to Hunt</button></div>
      </section> : terminal && result.status === 'failed' ? <section className={styles.outcome} aria-labelledby="run-outcome">
        <h2 id="run-outcome" ref={headingRef} tabIndex={-1}>EXPEDITION FAILED</h2>
        <p>{result.title}</p><p>{result.detail}</p>
        <div className={styles.actions}><button type="button" onClick={onBackToMissions}>Back to missions</button><button type="button" onClick={onReturnToHunt}>Return to Hunt</button></div>
      </section> : <div className={styles.dpad} role="group" aria-label="Directional Controls" onContextMenu={event => event.preventDefault()}>
        {directions.map(({ direction, label, Icon }) => <button key={direction} ref={direction === 'UP' ? upRef : undefined} type="button" className={styles.dpadBtn + ' ' + styles[direction.toLowerCase()]} aria-label={'Move ' + label} onPointerDown={event => { if (event.button !== 0 || inputLocked) return; event.preventDefault(); move(direction) }} onClick={event => { if (event.detail === 0 && !inputLocked) move(direction) }}><Icon size={24} aria-hidden="true" /></button>)}
        <span className={styles.dpadCenter} aria-hidden="true" />
      </div>}
    </div>
    {confirmingLeave && <div className={styles.confirmBackdrop} onClick={event => { if (event.target === event.currentTarget) closeConfirm() }}>
      <section className={styles.confirm} role="alertdialog" aria-modal="true" aria-labelledby="leave-heading" aria-describedby="leave-description">
        <h2 id="leave-heading" ref={confirmHeadingRef} tabIndex={-1}>Leave this expedition?</h2>
        <p id="leave-description">{mode === 'product' ? 'Leaving exits this expedition. The reward attempt remains recorded.' : 'Leaving ends this local run. Nothing is consumed or saved yet.'}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.stayBtn} onClick={closeConfirm}>Stay</button>
          <button type="button" onClick={leaveExpedition}>Leave</button>
        </div>
      </section>
    </div>}
  </main></div>
}
