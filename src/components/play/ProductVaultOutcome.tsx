import type { Ref } from 'react'
import type { VerifiedProductVaultSeal } from '../../domain/expeditionProof.ts'
import {
  CLAIM_NOT_ENABLED_COPY,
  SEAL_TREASURE_COPY,
  SEALING_TREASURE_COPY,
  TREASURE_SEALED_DETAIL,
  TREASURE_SEALED_TITLE,
  VAULT_GAMEPLAY_VERIFIED_DETAIL,
  VAULT_GAMEPLAY_VERIFIED_TITLE,
} from './productCheckpoint'
import { shortenNqWallet, shortenProofHash, type ProductVaultSealState } from './productVaultSeal'
import styles from './ExpeditionView.module.css'

export function ProductVaultOutcome({
  seal,
  headingRef,
  onSealTreasure,
  onBackToMissions,
  onReturnToHunt,
}: {
  readonly seal: ProductVaultSealState
  readonly headingRef?: Ref<HTMLHeadingElement>
  readonly onSealTreasure: () => void
  readonly onBackToMissions: () => void
  readonly onReturnToHunt: () => void
}) {
  if (seal.status === 'VERIFIED' && seal.proof) {
    return <VaultSealedCard proof={seal.proof} headingRef={headingRef} onBackToMissions={onBackToMissions} onReturnToHunt={onReturnToHunt} />
  }

  const sealing = seal.status === 'SEALING'
  return <section className={styles.outcome} aria-labelledby="run-outcome" aria-busy={sealing || undefined}>
    <h2 id="run-outcome" ref={headingRef} tabIndex={-1}>{sealing ? SEALING_TREASURE_COPY : VAULT_GAMEPLAY_VERIFIED_TITLE}</h2>
    {!sealing && <p className={styles.subtle}>{VAULT_GAMEPLAY_VERIFIED_DETAIL}</p>}
    {sealing && <p role="status">{SEALING_TREASURE_COPY}</p>}
    {seal.error && <p role="alert" className={styles.sealError}>{seal.error}</p>}
    <div className={styles.actions}>
      <button type="button" onClick={onSealTreasure} disabled={sealing}>{sealing ? SEALING_TREASURE_COPY : SEAL_TREASURE_COPY}</button>
      <button type="button" onClick={onBackToMissions} disabled={sealing}>Back to missions</button>
      <button type="button" onClick={onReturnToHunt} disabled={sealing}>Return to Hunt</button>
    </div>
  </section>
}

function VaultSealedCard({
  proof,
  headingRef,
  onBackToMissions,
  onReturnToHunt,
}: {
  readonly proof: VerifiedProductVaultSeal
  readonly headingRef?: Ref<HTMLHeadingElement>
  readonly onBackToMissions: () => void
  readonly onReturnToHunt: () => void
}) {
  return <section className={styles.outcome} aria-labelledby="run-outcome">
    <h2 id="run-outcome" ref={headingRef} tabIndex={-1}>{TREASURE_SEALED_TITLE}</h2>
    <p>{TREASURE_SEALED_DETAIL}</p>
    <div className={styles.sealProof}>
      <p><span>WALLET</span>{shortenNqWallet(proof.wallet)}</p>
      <p><span>VAULT SEAL</span>{shortenProofHash(proof.vaultSealHash)}</p>
      <p><span>STATUS</span>Verified ✓</p>
    </div>
    <p className={styles.subtle}>{CLAIM_NOT_ENABLED_COPY}</p>
    <div className={styles.actions}>
      <button type="button" onClick={onBackToMissions}>Back to missions</button>
      <button type="button" onClick={onReturnToHunt}>Return to Hunt</button>
    </div>
  </section>
}
