import { formatTreasureDay, type TreasureBankDisplayStatus, type TreasureBankResponse } from '../../domain/treasureBank.ts'
import styles from './TreasureBank.module.css'
import type { TreasureBankState } from './useTreasureBank.ts'

const STATUS_LABEL: Record<TreasureBankDisplayStatus, string> = {
  SECURED: 'Secured',
  PROCESSING: 'Processing',
  DELIVERED: 'Delivered',
  REVIEW: 'Review',
}

export function TreasureBankSection({
  state,
  onRetry,
}: {
  readonly state: TreasureBankState
  readonly onRetry: () => void
}) {
  if (state.status === 'loading') {
    return <section className={styles.bank} aria-labelledby="treasure-bank-heading" aria-busy="true">
      <div className={styles.bankEyebrow}><span id="treasure-bank-heading">TREASURE BANK</span></div>
      <p className={styles.bankState} role="status">Loading your treasure…</p>
    </section>
  }
  if (state.status === 'unauthorized') {
    return <section className={styles.bank} aria-labelledby="treasure-bank-heading">
      <div className={styles.bankEyebrow}><span id="treasure-bank-heading">TREASURE BANK</span></div>
      <p className={styles.bankState} role="status">Restoring your treasure…</p>
    </section>
  }
  if (state.status === 'unavailable') {
    return <section className={styles.bank} aria-labelledby="treasure-bank-heading">
      <div className={styles.bankEyebrow}><span id="treasure-bank-heading">TREASURE BANK</span></div>
      <p className={styles.bankState} role="alert">Treasure is unavailable right now. Retry is safe.</p>
      <button className={styles.bankRetry} type="button" onClick={onRetry}>Retry</button>
    </section>
  }
  return <TreasureBankReady bank={state.bank} empty={state.status === 'empty'} onRetry={onRetry} />
}

function TreasureBankReady({ bank, empty, onRetry }: { readonly bank: TreasureBankResponse; readonly empty: boolean; readonly onRetry: () => void }) {
  const hasPending = bank.pendingCount > 0
  const hasDelivered = bank.deliveredCount > 0
  return <section className={styles.bank} aria-labelledby="treasure-bank-heading">
    <div className={styles.bankEyebrow}><span id="treasure-bank-heading">TREASURE BANK</span></div>
    <div className={styles.bankGrid}>
      <div className={styles.bankMetric}>
        <strong>{bank.pendingNim} <span>NIM</span></strong>
        <span className={styles.bankCaption}>Pending treasure</span>
      </div>
      <div className={styles.bankMetric}>
        <strong>{bank.deliveredNim} <span>NIM</span></strong>
        <span className={styles.bankCaption}>Delivered</span>
      </div>
      <div className={styles.bankMetric}>
        <strong>{bank.lifetimeEarnedNim} <span>NIM</span></strong>
        <span className={styles.bankCaption}>Lifetime earned</span>
      </div>
    </div>
    {empty && <p className={styles.bankState} role="status">No treasure yet. Complete a mission to secure your first reward.</p>}
    {!empty && <>
      {hasPending && <p className={styles.bankNote}>Your treasure is secured.</p>}
      {hasPending && <p className={styles.bankNote}>If today&apos;s payout has already run, it will be included in a later payout batch.</p>}
      {hasDelivered && <p className={styles.bankNote}>Sent to your Nimiq wallet.</p>}
      <ul className={styles.bankList} aria-label="Recent treasure">
        {bank.rewards.slice(0, 10).map(reward => <li key={`${reward.rewardDay}:${reward.mission}`} className={styles.bankRow}>
          <span className={styles.bankRowMain}>{formatTreasureDay(reward.rewardDay)} · {reward.missionLabel} · {reward.amountNim} NIM</span>
          <span className={styles.bankRowStatus} data-status={reward.status}>{STATUS_LABEL[reward.status]}</span>
        </li>)}
      </ul>
    </>}
    {empty && <button className={styles.bankRetry} type="button" onClick={onRetry} hidden>Retry</button>}
  </section>
}
