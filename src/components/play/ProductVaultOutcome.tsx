import type { Ref } from 'react'
import type { VerifiedProductVaultSeal } from '../../domain/expeditionProof.ts'
import {
  SEAL_TREASURE_COPY,
  SEALING_TREASURE_COPY,
  TREASURE_SEALED_DETAIL,
  TREASURE_SEALED_TITLE,
  VAULT_GAMEPLAY_VERIFIED_DETAIL,
  VAULT_GAMEPLAY_VERIFIED_TITLE,
} from './productCheckpoint'
import { ProductRewardClaimOutcome } from './ProductRewardClaimOutcome'
import type { ProductPayoutView } from './productPayoutStatus'
import type { ProductRewardClaimState } from './productRewardClaim'
import { shortenNqWallet, shortenProofHash, type ProductVaultSealState } from './productVaultSeal'
import styles from './ExpeditionView.module.css'

export function ProductVaultOutcome({
  seal,
  claim,
  payout,
  headingRef,
  onSealTreasure,
  onClaimTreasure,
  onBackToMissions,
  onReturnToHunt,
}: {
  readonly seal: ProductVaultSealState
  readonly claim?: ProductRewardClaimState & { claimTreasure?: () => void }
  readonly payout?: ProductPayoutView | null
  readonly headingRef?: Ref<HTMLHeadingElement>
  readonly onSealTreasure: () => void
  readonly onClaimTreasure?: () => void
  readonly onBackToMissions: () => void
  readonly onReturnToHunt: () => void
}) {
  if (seal.status === 'VERIFIED' && seal.proof) {
    return <VaultSealedCard
      proof={seal.proof}
      claim={claim}
      payout={payout}
      headingRef={headingRef}
      onClaimTreasure={onClaimTreasure ?? claim?.claimTreasure}
      onBackToMissions={onBackToMissions}
      onReturnToHunt={onReturnToHunt}
    />
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
  claim,
  payout,
  headingRef,
  onClaimTreasure,
  onBackToMissions,
  onReturnToHunt,
}: {
  readonly proof: VerifiedProductVaultSeal
  readonly claim?: ProductRewardClaimState
  readonly payout?: ProductPayoutView | null
  readonly headingRef?: Ref<HTMLHeadingElement>
  readonly onClaimTreasure?: () => void
  readonly onBackToMissions: () => void
  readonly onReturnToHunt: () => void
}) {
  if (claim && onClaimTreasure && (claim.status === 'RESERVED' || claim.status === 'SOLD_OUT' || claim.status === 'ALREADY_REWARDED' || claim.status === 'REVIEW' || claim.status === 'BLOCK' || claim.status === 'SIGNING' || claim.status === 'CANCELLED' || claim.status === 'REJECTED')) {
    return <ProductRewardClaimOutcome
      claim={claim}
      payout={payout}
      heading={TREASURE_SEALED_TITLE}
      headingRef={headingRef}
      detail={TREASURE_SEALED_DETAIL}
      onClaimTreasure={onClaimTreasure}
      onBackToMissions={onBackToMissions}
      onReturnToHunt={onReturnToHunt}
    />
  }

  return <section className={styles.outcome} aria-labelledby="run-outcome">
    <h2 id="run-outcome" ref={headingRef} tabIndex={-1}>{TREASURE_SEALED_TITLE}</h2>
    <p>{TREASURE_SEALED_DETAIL}</p>
    <div className={styles.sealProof}>
      <p><span>WALLET</span>{shortenNqWallet(proof.wallet)}</p>
      <p><span>VAULT SEAL</span>{shortenProofHash(proof.vaultSealHash)}</p>
      <p><span>STATUS</span>Verified ✓</p>
    </div>
    {claim && onClaimTreasure
      ? <div className={styles.actions}>
        <button type="button" onClick={onClaimTreasure}>Claim today's treasure</button>
        <button type="button" onClick={onBackToMissions}>Back to missions</button>
        <button type="button" onClick={onReturnToHunt}>Return to Hunt</button>
      </div>
      : <div className={styles.actions}>
        <button type="button" onClick={onBackToMissions}>Back to missions</button>
        <button type="button" onClick={onReturnToHunt}>Return to Hunt</button>
      </div>}
  </section>
}
