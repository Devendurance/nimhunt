import type { Ref } from 'react'
import {
  ALREADY_REWARDED_TITLE,
  CLAIM_TODAY_COPY,
  SIGNATURE_CANCELLED_COPY,
  SIGNING_CLAIM_COPY,
  TODAY_FULL_DETAIL,
  TODAY_FULL_TITLE,
  TREASURE_RESERVED_DETAIL,
  TREASURE_RESERVED_NOTE,
  TREASURE_RESERVED_TITLE,
} from './productCheckpoint'
import type { ProductRewardClaimState } from './productRewardClaim'
import styles from './ExpeditionView.module.css'

export function ProductRewardClaimOutcome({
  claim,
  heading,
  headingRef,
  detail,
  onClaimTreasure,
  onBackToMissions,
  onReturnToHunt,
}: {
  readonly claim: ProductRewardClaimState
  readonly heading: string
  readonly headingRef?: Ref<HTMLHeadingElement>
  readonly detail?: string
  readonly onClaimTreasure: () => void
  readonly onBackToMissions: () => void
  readonly onReturnToHunt: () => void
}) {
  if (claim.status === 'RESERVED') {
    return <ClaimTerminal
      headingRef={headingRef}
      title={TREASURE_RESERVED_TITLE}
      lines={[TREASURE_RESERVED_DETAIL, TREASURE_RESERVED_NOTE]}
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
      lines={[]}
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

function ClaimTerminal({
  headingRef,
  title,
  lines,
  onBackToMissions,
  onReturnToHunt,
}: {
  readonly headingRef?: Ref<HTMLHeadingElement>
  readonly title: string
  readonly lines: readonly string[]
  readonly onBackToMissions: () => void
  readonly onReturnToHunt: () => void
}) {
  return <section className={styles.outcome} aria-labelledby="run-outcome">
    <h2 id="run-outcome" ref={headingRef} tabIndex={-1}>{title}</h2>
    {lines.map(line => <p key={line}>{line}</p>)}
    <div className={styles.actions}>
      <button type="button" onClick={onBackToMissions}>Back to missions</button>
      <button type="button" onClick={onReturnToHunt}>Return to Hunt</button>
    </div>
  </section>
}
