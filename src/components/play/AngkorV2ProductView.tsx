import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProductActiveExpedition, VerifyExpeditionResult } from '../../domain/expeditionProof'
import { submitCheckpoint, verifyExpedition } from '../../api/expeditionProof'
import { V2Session } from '../../game/angkorV2Proof/session'
import { AngkorV2Gameplay } from './AngkorV2Gameplay'
import { rememberProductTerminal } from './productRunSession'
import { useProductVaultSeal } from './useProductVaultSeal'
import { useProductRewardClaim } from './useProductRewardClaim'
import { useProductPayoutStatus } from './useProductPayoutStatus'
import { ProductRewardClaimOutcome } from './ProductRewardClaimOutcome'
import { ProductVaultOutcome } from './ProductVaultOutcome'

export default function AngkorV2ProductView({ active, onBackToMissions, onReturnToHunt }: {
  active: ProductActiveExpedition; onBackToMissions: () => void; onReturnToHunt: () => void
}) {
  const [session] = useState(() => new V2Session({ initial: active.state, runId: active.runId,
    checkpointHash: active.checkpoint.checkpointHash, send: submitCheckpoint }))
  const [result, setResult] = useState<VerifyExpeditionResult | null>(null)
  const [error, setError] = useState(''), [verifying, setVerifying] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null), busy = useRef(false), done = useRef(false)
  const verify = useCallback(async () => {
    if (busy.current || done.current || !['COMPLETE', 'FAILED'].includes(session.state.angkorV2!.expedition.status)) return
    busy.current = true; setVerifying(true); setError('')
    try {
      await session.flush()
      if (session.error || session.acknowledgedSeq !== session.state.seq) throw new Error('UNACKNOWLEDGED_PROGRESS')
      const checked = await verifyExpedition({ runId: active.runId, checkpointHash: session.checkpointHash })
      if (checked.runId !== active.runId || checked.checkpointHash !== session.checkpointHash) throw new Error('VERIFY_BINDING_MISMATCH')
      setResult(checked); rememberProductTerminal(active.mission, checked); done.current = true
    } catch { setError('Verification did not finish. Your saved expedition remains available; retry when connected.') }
    finally { busy.current = false; setVerifying(false) }
  }, [active, session])
  useEffect(() => { const unsubscribe = session.subscribe(() => { void verify() }); queueMicrotask(() => { void verify() }); return unsubscribe }, [session, verify])
  useEffect(() => { if (result || error) heading.current?.focus({ preventScroll: true }) }, [result, error])
  const vault = useProductVaultSeal({ enabled: result?.outcome === 'VAULT_GAMEPLAY_VERIFIED', runId: active.runId })
  const claim = useProductRewardClaim({ enabled: result?.outcome === 'VERIFIED_ELIGIBLE' || vault.status === 'VERIFIED', mission: active.mission, runId: active.runId })
  const payout = useProductPayoutStatus({ enabled: claim.status === 'RESERVED', claimId: claim.result && 'claimId' in claim.result ? claim.result.claimId : null })
  const completion = result?.outcome === 'VERIFIED_ELIGIBLE'
    ? <ProductRewardClaimOutcome claim={claim} payout={payout} heading="Expedition verified" headingRef={heading}
      onClaimTreasure={claim.claimTreasure} onBackToMissions={onBackToMissions} onReturnToHunt={onReturnToHunt} />
    : result?.outcome === 'VAULT_GAMEPLAY_VERIFIED'
      ? <ProductVaultOutcome seal={vault} claim={claim} payout={payout} headingRef={heading} onSealTreasure={vault.sealTreasure}
        onClaimTreasure={claim.claimTreasure} onBackToMissions={onBackToMissions} onReturnToHunt={onReturnToHunt} />
      : <section aria-live="polite"><h2 ref={heading} tabIndex={-1}>{result ? 'Expedition ended · no reward eligibility' : verifying ? 'Verifying all three stages…' : error}</h2>
        {error && <button disabled={verifying} onClick={() => void verify()}>Retry verification</button>}
        {result && <button onClick={onBackToMissions}>Back to missions</button>}</section>
  return <AngkorV2Gameplay session={session} practice={false} onLeave={onBackToMissions} completion={completion} />
}
