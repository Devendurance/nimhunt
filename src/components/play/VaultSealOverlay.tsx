import { useEffect, useRef } from 'react'
import { vaultRejectionCopy, type VaultSealState } from './vaultSeal'
import styles from './ExpeditionView.module.css'

type VaultSealOverlayProps = {
  seal: VaultSealState
  onSealTreasure: () => void
  onLeaveUnsealed: () => void
}

const BUSY_COPY: Partial<Record<VaultSealState['status'], string>> = {
  REQUESTING_ACCOUNT: 'Requesting Nimiq account…',
  AWAITING_SIGNATURE: 'Waiting for your seal. Confirm in Nimiq Pay to continue.',
  VERIFYING: 'Verifying your seal…',
}

export function VaultSealOverlay({ seal, onSealTreasure, onLeaveUnsealed }: VaultSealOverlayProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const busy = seal.status === 'REQUESTING_ACCOUNT' || seal.status === 'AWAITING_SIGNATURE' || seal.status === 'VERIFYING'
  const rejected = seal.status === 'REJECTED'

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  const heading = rejected ? 'Seal rejected.' : seal.status === 'AWAITING_SIGNATURE' ? 'Waiting for your seal.' : seal.status === 'VERIFYING' ? 'Verifying your seal…' : 'TREASURE FOUND'

  return <div className={styles.confirmBackdrop}>
    <section className={styles.confirm} role="alertdialog" aria-modal="true" aria-labelledby="vault-heading" aria-busy={busy || undefined}>
      <span className={styles.kicker}>TEMPLE VAULT</span>
      <h2 id="vault-heading" ref={headingRef} tabIndex={-1}>{heading}</h2>
      {!rejected && seal.status !== 'AWAITING_SIGNATURE' && seal.status !== 'VERIFYING' && <>
        <p>You reached the Temple Vault.</p>
        <p>Seal the treasure in Nimiq Pay to complete Vault Breaker.</p>
      </>}
      {seal.status === 'AWAITING_SIGNATURE' && <p>Confirm in Nimiq Pay to continue.</p>}
      {seal.status === 'VERIFYING' && <p>Checking your signature and wallet binding.</p>}
      {rejected && <p>{vaultRejectionCopy(seal.verification?.reason)}</p>}
      {busy && <p role="status">{BUSY_COPY[seal.status]}</p>}
      {seal.error && !rejected && <p role="alert" className={styles.sealError}>{seal.error}</p>}
      {!rejected && <p className={styles.subtle}>No NIM is awarded in this build yet.</p>}
      <div className={styles.actions}>
        {rejected
          ? <><button type="button" onClick={onSealTreasure}>Try again</button><button type="button" className={styles.stayBtn} onClick={onLeaveUnsealed}>Leave unsealed</button></>
          : <><button type="button" onClick={onSealTreasure} disabled={busy}>{busy ? 'Sealing…' : 'Seal treasure'}</button><button type="button" className={styles.stayBtn} onClick={onLeaveUnsealed} disabled={busy}>Leave unsealed</button></>}
      </div>
    </section>
  </div>
}
