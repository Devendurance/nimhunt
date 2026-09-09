import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Droplets, Gem, Heart, KeyRound, Package, Sword, Triangle } from 'lucide-react'
import { getMissionObjective, getMissionTitle } from '../../game/domain/mission'
import type { Direction } from '../../game/world/grid'
import { shortenNimiqAddress } from '../../integrations/nimiq/treasureSeal'
import { getExpeditionResult, type PlayableMission } from './expeditionFlow'
import { useAngkorRun } from './useAngkorRun'
import { useVaultSeal } from './useVaultSeal'
import { isVaultBreakerComplete, shouldShowVaultOverlay } from './vaultSeal'
import { VaultSealOverlay } from './VaultSealOverlay'
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
}

export function ExpeditionView({ mission, onBackToMissions, onReturnToHunt }: ExpeditionViewProps) {
  const { containerRef, hud, move } = useAngkorRun(mission)
  const { seal, sealTreasure } = useVaultSeal()
  const terminal = hud.runStatus !== 'PLAYING'
  const result = getExpeditionResult(hud)
  const isChestHunter = mission === 'chest-hunter'
  const isVault = mission === 'vault-breaker'
  const vaultOverlayOpen = shouldShowVaultOverlay(hud, mission) && seal.status !== 'VERIFIED'
  const vaultComplete = isVaultBreakerComplete({
    vaultReached: hud.objectiveReached && hud.hp > 0,
    sealVerified: seal.status === 'VERIFIED',
  })
  const inputLocked = terminal || vaultOverlayOpen || vaultComplete
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
    if (vaultComplete) headingRef.current?.focus({ preventScroll: true })
  }, [vaultComplete])

  useEffect(() => {
    if (confirmingLeave) confirmHeadingRef.current?.focus({ preventScroll: true })
  }, [confirmingLeave])

  const closeConfirm = useCallback(() => {
    setConfirmingLeave(false)
    requestAnimationFrame(() => leaveButtonRef.current?.focus())
  }, [])

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
      if (confirmingLeave || vaultOverlayOpen) return
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
  }, [move, inputLocked, confirmingLeave, vaultOverlayOpen])

  const missionTitle = getMissionTitle(mission)
  const missionObjective = getMissionObjective(mission)

  return <div className={styles.shell}><main className={styles.viewport}>
    <header className={styles.header}>
      <div><span className={styles.kicker}>ANGKOR RUINS</span><h1 className={styles.title}>{missionTitle}</h1></div>
      <button ref={leaveButtonRef} type="button" className={styles.leaveBtn} onClick={() => setConfirmingLeave(true)}>Leave expedition</button>
    </header>
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
      {vaultComplete ? <section className={styles.outcome} aria-labelledby="run-outcome">
        <h2 id="run-outcome" ref={headingRef} tabIndex={-1}>MISSION COMPLETE</h2>
        <><strong>Vault Breaker</strong><p>Temple Vault reached</p><p>Treasure seal verified</p><p><strong>TREASURE SEALED</strong> — Your Nimiq signature was verified.</p>
          <div className={styles.sealProof}>
            {seal.wallet && <p><span>WALLET</span> {shortenNimiqAddress(seal.wallet)}</p>}
            {seal.verification?.payloadHash && <p><span>SEAL HASH</span> {seal.verification.payloadHash.slice(0, 12)}…</p>}
            <p><span>STATUS</span> Verified ✓</p>
          </div>
          <p className={styles.subtle}>No NIM has been awarded in this build yet.</p></>
        <div className={styles.actions}><button type="button" onClick={onBackToMissions}>Back to missions</button><button type="button" onClick={onReturnToHunt}>Return to Hunt</button></div>
      </section> : terminal && result.status !== 'playing' ? <section className={styles.outcome} aria-labelledby="run-outcome">
        <h2 id="run-outcome" ref={headingRef} tabIndex={-1}>{result.status === 'complete' ? 'MISSION COMPLETE' : 'EXPEDITION FAILED'}</h2>
        {result.status === 'complete'
          ? <><strong>{result.title}</strong><p>{result.detail}</p><p>You survived the expedition.</p><p className={styles.subtle}>NIM reward sealing is not enabled in this build yet.</p></>
          : <><p>{result.title}</p><p>{result.detail}</p></>}
        <div className={styles.actions}><button type="button" onClick={onBackToMissions}>Back to missions</button><button type="button" onClick={onReturnToHunt}>Return to Hunt</button></div>
      </section> : <div className={styles.dpad} role="group" aria-label="Directional Controls" onContextMenu={event => event.preventDefault()}>
        {directions.map(({ direction, label, Icon }) => <button key={direction} ref={direction === 'UP' ? upRef : undefined} type="button" className={styles.dpadBtn + ' ' + styles[direction.toLowerCase()]} aria-label={'Move ' + label} onPointerDown={event => { if (event.button !== 0 || inputLocked) return; event.preventDefault(); move(direction) }} onClick={event => { if (event.detail === 0 && !inputLocked) move(direction) }}><Icon size={24} aria-hidden="true" /></button>)}
        <span className={styles.dpadCenter} aria-hidden="true" />
      </div>}
    </div>
    {vaultOverlayOpen && <VaultSealOverlay seal={seal} onSealTreasure={sealTreasure} onLeaveUnsealed={onBackToMissions} />}
    {confirmingLeave && <div className={styles.confirmBackdrop} onClick={event => { if (event.target === event.currentTarget) closeConfirm() }}>
      <section className={styles.confirm} role="alertdialog" aria-modal="true" aria-labelledby="leave-heading" aria-describedby="leave-description">
        <h2 id="leave-heading" ref={confirmHeadingRef} tabIndex={-1}>Leave this expedition?</h2>
        <p id="leave-description">Leaving ends this local run. Nothing is consumed or saved yet.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.stayBtn} onClick={closeConfirm}>Stay</button>
          <button type="button" onClick={onBackToMissions}>Leave</button>
        </div>
      </section>
    </div>}
  </main></div>
}
