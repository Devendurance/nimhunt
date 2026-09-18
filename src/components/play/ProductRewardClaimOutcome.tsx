import type { Ref } from 'react'
import {
  ALREADY_REWARDED_DETAIL,
  ALREADY_REWARDED_TITLE,
  CLAIM_TODAY_COPY,
  REWARD_BLOCK_DETAIL,
  REWARD_BLOCK_TITLE,
  REWARD_REVIEW_DETAIL,
  REWARD_REVIEW_TITLE,
  SIGNATURE_CANCELLED_COPY,
  SIGNING_CLAIM_COPY,
  TODAY_FULL_DETAIL,
  TODAY_FULL_TITLE,
} from './productCheckpoint'
import { payoutStatusCopy, type ProductPayoutView } from './productPayoutStatus'
import type { ProductRewardClaimState } from './productRewardClaim'
import styles from './ExpeditionView.module.css'

export function ProductRewardClaimOutcome({
  claim,
  payout,
  heading,
  headingRef,
  detail,
  onClaimTreasure,
  onBackToMissions,
  onReturnToHunt,
}: {
  readonly claim: ProductRewardClaimState
  readonly payout?: ProductPayoutView | null
  readonly heading: string
  readonly headingRef?: Ref<HTMLHeadingElement>
  readonly detail?: string
  readonly onClaimTreasure: () => void
  readonly onBackToMissions: () => void
  readonly onReturnToHunt: () => void
}) {
  if (claim.status === 'RESERVED') {
    const copy = payoutStatusCopy(payout ?? { status: 'PENDING', payoutId: null, claimId: claim.result && 'claimId' in claim.result ? claim.result.claimId : null, amountLuna: null, network: null, txHashSafe: null, submittedAt: null, confirmedAt: null })
    return <ClaimTerminal
      headingRef={headingRef}
      title={copy.title}
      lines={copy.lines}
      amountLabel={copy.amountLabel}
      txHashShort={copy.txHashShort}
      verified={copy.verified}
      onBackToMissions={onBackToMissions}
      onReturnToHunt={onReturnToHunt}
    />
  }
  if (claim.status === 'SOLD_OUT') {
    return <ClaimTerminal
      headingRef={headingRef}
      title={TODAY_FULL_TITLE}
      lines={[TODAY_FULL_DETAIL]}
      onBackToMissions={onBackToMissions}
      onReturnToHunt={onReturnToHunt}
    />
  }
  if (claim.status === 'ALREADY_REWARDED') {
    return <ClaimTerminal
      headingRef={headingRef}
      title={ALREADY_REWARDED_TITLE}
      lines={[ALREADY_REWARDED_DETAIL]}
      onBackToMissions={onBackToMissions}
      onReturnToHunt={onReturnToHunt}
    />
  }
  if (claim.status === 'REVIEW') {
    return <ClaimTerminal
      headingRef={headingRef}
      title={REWARD_REVIEW_TITLE}
      lines={[REWARD_REVIEW_DETAIL]}
      onBackToMissions={onBackToMissions}
      onReturnToHunt={onReturnToHunt}
    />
  }
  if (claim.status === 'BLOCK') {
    const sessionRetryable = claim.result !== null
      && 'reasonCategory' in claim.result
      && claim.result.reasonCategory === 'SESSION'
    return <ClaimTerminal
      headingRef={headingRef}
      title={REWARD_BLOCK_TITLE}
      lines={[REWARD_BLOCK_DETAIL]}
      onPrimary={sessionRetryable ? onClaimTreasure : undefined}
      primaryLabel={sessionRetryable ? 'Retry eligibility check' : undefined}
      onBackToMissions={onBackToMissions}
      onReturnToHunt={onReturnToHunt}
    />
  }

  const signing = claim.status === 'SIGNING'
  return <section className={styles.outcome} aria-labelledby="run-outcome" aria-busy={signing || undefined}>
    <h2 id="run-outcome" ref={headingRef} tabIndex={-1}>{signing ? SIGNING_CLAIM_COPY : heading}</h2>
    {!signing && detail && <p className={styles.subtle}>{detail}</p>}
    {signing && <p role="status">{SIGNING_CLAIM_COPY}</p>}
    {claim.status === 'CANCELLED' && <p role="status">{SIGNATURE_CANCELLED_COPY}</p>}
    {claim.error && claim.status !== 'CANCELLED' && <p role="alert" className={styles.sealError}>{claim.error}</p>}
    <div className={styles.actions}>
      <button type="button" onClick={onClaimTreasure} disabled={signing}>{signing ? SIGNING_CLAIM_COPY : CLAIM_TODAY_COPY}</button>
      <button type="button" onClick={onBackToMissions} disabled={signing}>Back to missions</button>
      <button type="button" onClick={onReturnToHunt} disabled={signing}>Return to Hunt</button>
    </div>
  </section>
}

export function ProductPayoutStatusCard({
  payout,
  headingRef,
}: {
  readonly payout: ProductPayoutView
  readonly headingRef?: Ref<HTMLHeadingElement>
}) {
  const copy = payoutStatusCopy(payout)
  return <section className={styles.outcome} aria-labelledby="payout-status">
    <h2 id="payout-status" ref={headingRef} tabIndex={-1}>{copy.title}</h2>
    {copy.lines.map(line => <p key={line}>{line}</p>)}
    {copy.amountLabel && <p className={styles.treasureAmount}>{copy.amountLabel}</p>}
    {copy.txHashShort && <p className={styles.subtle}>{copy.txHashShort}</p>}
    {copy.verified && <p className={styles.verified}>Verified ✓</p>}
  </section>
}

function ClaimTerminal({
  headingRef,
  title,
  lines,
  amountLabel,
  txHashShort,
  verified,
  onPrimary,
  primaryLabel,
  onBackToMissions,
  onReturnToHunt,
}: {
  readonly headingRef?: Ref<HTMLHeadingElement>
  readonly title: string
  readonly lines: readonly string[]
  readonly amountLabel?: string | null
  readonly txHashShort?: string | null
  readonly verified?: boolean
  readonly onPrimary?: () => void
  readonly primaryLabel?: string
  readonly onBackToMissions: () => void
  readonly onReturnToHunt: () => void
}) {
  return <section className={styles.outcome} aria-labelledby="run-outcome">
    <h2 id="run-outcome" ref={headingRef} tabIndex={-1}>{title}</h2>
    {lines.map(line => <p key={line}>{line}</p>)}
    {amountLabel && <p className={styles.treasureAmount}>{amountLabel}</p>}
    {txHashShort && <p className={styles.subtle}>{txHashShort}</p>}
    {verified && <p className={styles.verified}>Verified ✓</p>}
    <div className={styles.actions}>
      {onPrimary && primaryLabel && <button type="button" onClick={onPrimary}>{primaryLabel}</button>}
      <button type="button" onClick={onBackToMissions}>Back to missions</button>
      <button type="button" onClick={onReturnToHunt}>Return to Hunt</button>
    </div>
  </section>
}
