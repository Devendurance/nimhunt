import type { AdventurerClientError, AdventurerClientStatus } from './adventurerState.ts'
import styles from './PlayShell.module.css'

type AdventurerIdentityStatusProps = {
  readonly status: AdventurerClientStatus
  readonly error: AdventurerClientError | null
  readonly retryRestore: () => void
}

export function AdventurerIdentityStatus({ status, error, retryRestore }: AdventurerIdentityStatusProps) {
  if (status === 'RESTORING') {
    return <div className={styles.profileDialogError} role="status" aria-live="polite">
      <strong id="adventurer-identity-restoring-title">Restoring your Adventurer identity…</strong>
      <p>Checking this wallet session. Your profile is not being changed.</p>
    </div>
  }

  if (status === 'ERROR') {
    return <div className={styles.profileDialogError} role="alert">
      <strong id="adventurer-identity-recovery-title">Adventurer identity needs attention.</strong>
      <p>{error === 'SIGNATURE_CANCELLED' ? 'Signature cancelled. Retry when ready.' : 'Reconnect or retry to restore your profile session.'}</p>
      <button type="button" className={styles.sheetSecondary} onClick={retryRestore}>Retry identity session</button>
    </div>
  }

  return <div className={styles.profileDialogError} role="status" aria-live="polite">
    <strong id="adventurer-identity-connect-title">Connect your wallet to manage an Adventurer identity.</strong>
  </div>
}
