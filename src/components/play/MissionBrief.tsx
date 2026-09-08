import { useEffect, useRef, type RefObject } from 'react'
import type { Mission } from '../../types/play'
import { PlayIcon } from './PlayIcon'
import styles from './PlayShell.module.css'

type MissionSheetProps = {
  mission: Mission
  mode: 'brief' | 'development'
  dialogRef: RefObject<HTMLDialogElement | null>
  onBack: () => void
  onStart: () => void
  onReturnToMissions: () => void
  onClose: () => void
}

export function MissionBrief({ mission, mode, dialogRef, onBack, onStart, onReturnToMissions, onClose }: MissionSheetProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => headingRef.current?.focus())
  }, [mode, mission.id])

  return <dialog ref={dialogRef} className={styles.sheetDialog} aria-labelledby="mission-sheet-heading" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) event.preventDefault() }}>
    <div className={styles.sheet}>
      <div className={styles.sheetHandle} aria-hidden="true" />
      <div className={styles.sheetBody}>
        <div className={styles.sheetTopline}><span className={styles.kicker}>{mode === 'brief' ? 'MISSION BRIEF · PREVIEW' : 'DEVELOPMENT STATE'}</span><span className={styles.fixtureBadge}>SAMPLE DATA</span></div>
        {mode === 'brief' ? <>
          <h2 id="mission-sheet-heading" tabIndex={-1} ref={headingRef}>{mission.title}</h2>
          <p className={styles.sheetObjective}>{mission.objective}</p>
          <div className={styles.runStats}><span><strong>100</strong> HP</span><span><strong>3</strong> expeditions left</span><span>ANGKOR RUINS</span></div>
          <div className={styles.eligibility}><strong>Before you enter</strong><p>Complete the task alive to become reward-eligible while NIM treasures remain.</p><p>Chest contents do not determine NIM eligibility.</p></div>
        </> : <>
          <h2 id="mission-sheet-heading" tabIndex={-1} ref={headingRef}>The ruins are being mapped.</h2>
          <p className={styles.sheetObjective}>Angkor Ruins gameplay coming in the next build milestone.</p>
          <div className={styles.devNote}><span className={styles.devNoteIcon}><PlayIcon name="sparkles" size={20} /></span><p>Your mission brief is ready. Movement, hazards, and the Temple Vault arrive when the game loop is connected.</p></div>
        </>}
      </div>
      <div className={styles.sheetActions}>
        {mode === 'brief' ? <><button className={styles.sheetSecondary} type="button" onClick={onBack}><PlayIcon name="arrowLeft" size={16} />Back</button><button className={styles.sheetPrimary} type="button" onClick={onStart}>Start expedition<PlayIcon name="play" size={16} /></button></> : <><button className={styles.sheetSecondary} type="button" onClick={onBack}><PlayIcon name="arrowLeft" size={16} />Back to brief</button><button className={styles.sheetPrimary} type="button" onClick={onReturnToMissions}>Return to missions<PlayIcon name="listChecks" size={16} /></button></>}
      </div>
    </div>
  </dialog>
}
