import { useEffect, useRef, type RefObject } from 'react'
import type { Mission } from '../../types/play'
import { getBriefState } from './expeditionFlow'
import { PlayIcon } from './PlayIcon'
import { ProductStartPanel } from './ProductStartPanel'
import { isFlowActive } from './productStart.ts'
import type { ProductStartModel } from './useProductStart'
import styles from './PlayShell.module.css'

type MissionSheetProps = {
  mission: Mission
  dialogRef: RefObject<HTMLDialogElement | null>
  onBack: () => void
  onStartExpedition: (mission: Mission) => void
  onClose: () => void
  productStart: ProductStartModel
  onStartPractice: (mission: Mission) => void
  onFreshStart: () => void
}

export function MissionBrief({ mission, dialogRef, onBack, onStartExpedition, onClose, productStart, onStartPractice, onFreshStart }: MissionSheetProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const brief = getBriefState(mission.id)
  const productStartVisible = productStart.status !== 'IDLE' && productStart.status !== 'STARTED'

  useEffect(() => {
    requestAnimationFrame(() => headingRef.current?.focus())
  }, [mission.id])

  return <dialog ref={dialogRef} className={styles.sheetDialog} aria-labelledby={productStartVisible ? 'product-start-heading' : 'mission-sheet-heading'} onClose={onClose} onCancel={event => { if (isFlowActive(productStart.status)) event.preventDefault() }} onClick={event => { if (event.target === event.currentTarget) event.preventDefault() }}>
    <div className={styles.sheet}>
      <div className={styles.sheetHandle} aria-hidden="true" />
      {productStartVisible
        ? <div className={styles.sheetBody}><ProductStartPanel
          mission={mission}
          state={productStart}
          onSelectAccount={productStart.selectAccount}
          onAuthorize={productStart.authorize}
          onRetryStart={productStart.retryStart}
          onCancel={productStart.cancel}
          onBack={() => { productStart.reset() }}
          onPractice={() => onStartPractice(mission)}
          onFreshStart={onFreshStart}
        /></div>
        : <>
          <div className={styles.sheetBody}>
            <div className={styles.sheetTopline}><span className={styles.kicker}>MISSION BRIEF</span><span className={styles.fixtureBadge}>REWARD RUN</span></div>
            <h2 id="mission-sheet-heading" tabIndex={-1} ref={headingRef}>{mission.title}</h2>
            <p className={styles.sheetObjective}>{mission.objective}</p>
            <div className={styles.runStats}><span><strong>100</strong> starting HP</span><span><strong>—</strong> daily status</span><span>ANGKOR RUINS</span></div>
            {mission.id === 'vault-breaker' && <p className={styles.sheetObjective}>Complete the route alive, then seal the Vault through Nimiq Pay.</p>}
            <div className={styles.eligibility}><strong>Before you enter</strong><p>Complete the task alive to become reward-eligible while NIM treasures remain.</p><p>Chest contents do not determine NIM eligibility.</p></div>
            {!brief.canStart && <div className={styles.devNote}><span className={styles.devNoteIcon}><PlayIcon name="sparkles" size={20} /></span><p>Vault Breaker is coming next. Key, gate, and vault sealing arrive in a later build.</p></div>}
          </div>
          <div className={styles.sheetActions}>
            <button className={styles.sheetSecondary} type="button" onClick={onBack}><PlayIcon name="arrowLeft" size={16} />Back</button>
            {brief.canStart
              ? <button className={styles.sheetPrimary} type="button" onClick={() => onStartExpedition(mission)}>Start expedition<PlayIcon name="play" size={16} /></button>
              : <button className={styles.sheetPrimary} type="button" disabled aria-disabled="true" title="Vault Breaker arrives in a later build">Coming next</button>}
          </div>
        </>}
    </div>
  </dialog>
}
