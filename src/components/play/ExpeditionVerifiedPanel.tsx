import { getMissionTitle } from '../../game/domain/mission'
import type { VerifyExpeditionResult } from '../../domain/expeditionProof.ts'
import { CHEST_HUNTER_PLAY_TARGET, GEM_RUNNER_PLAY_TARGET, getExpeditionResult, type PlayableMission } from './expeditionFlow'
import {
  MISSION_COMPLETE_COPY,
  VERIFIED_TITLE,
} from './productCheckpoint'
import { ProductRewardClaimOutcome } from './ProductRewardClaimOutcome'
import { ProductVaultOutcome } from './ProductVaultOutcome'
import type { ProductRewardClaimState } from './productRewardClaim'
import type { ProductVaultSealState } from './productVaultSeal'
import styles from './ExpeditionView.module.css'

export function ExpeditionVerifiedPanel({
  mission,
  result,
  vaultSeal,
  rewardClaim,
  onSealTreasure,
  onClaimTreasure,
  onBackToMissions,
  onReturnToHunt,
}: {
  readonly mission: PlayableMission
  readonly result: VerifyExpeditionResult
  readonly vaultSeal?: ProductVaultSealState
  readonly rewardClaim?: ProductRewardClaimState
  readonly onSealTreasure?: () => void
  readonly onClaimTreasure?: () => void
  readonly onBackToMissions: () => void
  readonly onReturnToHunt: () => void
}) {
  const vault = result.outcome === 'VAULT_GAMEPLAY_VERIFIED'
  const summary = getExpeditionResult({
    runStatus: 'MISSION_COMPLETE',
    selectedMission: mission,
    gemsCollected: result.gemsCollected,
    gemTarget: GEM_RUNNER_PLAY_TARGET,
    chestsOpened: result.chestsOpened,
    chestTarget: CHEST_HUNTER_PLAY_TARGET,
    hasTempleKey: result.hasTempleKey,
    objectiveReached: result.objectiveReached,
  })
  return <div className={styles.shell}><main className={styles.viewport}>
    <header className={styles.header}>
      <div><span className={styles.kicker}>ANGKOR RUINS</span><h1 className={styles.title}>{getMissionTitle(mission)}</h1></div>
    </header>
    {vault && vaultSeal && onSealTreasure
      ? <ProductVaultOutcome
          seal={vaultSeal}
          claim={rewardClaim}
          onSealTreasure={onSealTreasure}
          onClaimTreasure={onClaimTreasure}
          onBackToMissions={onBackToMissions}
          onReturnToHunt={onReturnToHunt}
        />
      : rewardClaim && onClaimTreasure
        ? <ProductRewardClaimOutcome
            claim={rewardClaim}
            heading={VERIFIED_TITLE}
            detail={summary.status === 'complete' ? `${MISSION_COMPLETE_COPY} ${summary.title} ${summary.detail}` : undefined}
            onClaimTreasure={onClaimTreasure}
            onBackToMissions={onBackToMissions}
            onReturnToHunt={onReturnToHunt}
          />
        : <section className={styles.outcome} aria-labelledby="run-outcome">
        <h2 id="run-outcome" tabIndex={-1}>{VERIFIED_TITLE}</h2>
        {summary.status === 'complete' && <>
          <strong>{MISSION_COMPLETE_COPY}</strong>
          <p>{summary.title}</p>
          <p>{summary.detail}</p>
        </>}
        <div className={styles.actions}>
          <button type="button" onClick={onBackToMissions}>Back to missions</button>
          <button type="button" onClick={onReturnToHunt}>Return to Hunt</button>
        </div>
      </section>}
  </main></div>
}
