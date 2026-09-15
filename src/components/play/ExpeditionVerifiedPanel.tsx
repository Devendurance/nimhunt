import { getMissionTitle } from '../../game/domain/mission'
import type { VerifyExpeditionResult } from '../../domain/expeditionProof.ts'
import { CHEST_HUNTER_PLAY_TARGET, GEM_RUNNER_PLAY_TARGET, getExpeditionResult, type PlayableMission } from './expeditionFlow'
import {
  CLAIM_NOT_ENABLED_COPY,
  MISSION_COMPLETE_COPY,
  VERIFIED_TITLE,
} from './productCheckpoint'
import { ProductVaultOutcome } from './ProductVaultOutcome'
import type { ProductVaultSealState } from './productVaultSeal'
import styles from './ExpeditionView.module.css'

export function ExpeditionVerifiedPanel({
  mission,
  result,
  vaultSeal,
  onSealTreasure,
  onBackToMissions,
  onReturnToHunt,
}: {
  readonly mission: PlayableMission
  readonly result: VerifyExpeditionResult
  readonly vaultSeal?: ProductVaultSealState
  readonly onSealTreasure?: () => void
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
          onSealTreasure={onSealTreasure}
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
        <p className={styles.subtle}>{CLAIM_NOT_ENABLED_COPY}</p>
        <div className={styles.actions}>
          <button type="button" onClick={onBackToMissions}>Back to missions</button>
          <button type="button" onClick={onReturnToHunt}>Return to Hunt</button>
        </div>
      </section>}
  </main></div>
}
