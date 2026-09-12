import { getMissionTitle } from '../../game/domain/mission'
import type { VerifyExpeditionResult } from '../../domain/expeditionProof.ts'
import { CHEST_HUNTER_PLAY_TARGET, GEM_RUNNER_PLAY_TARGET, getExpeditionResult, type PlayableMission } from './expeditionFlow'
import {
  CLAIM_NOT_ENABLED_COPY,
  MISSION_COMPLETE_COPY,
  VAULT_GAMEPLAY_VERIFIED_DETAIL,
  VAULT_GAMEPLAY_VERIFIED_TITLE,
  VERIFIED_TITLE,
} from './productCheckpoint'
import styles from './ExpeditionView.module.css'

export function ExpeditionVerifiedPanel({
  mission,
  result,
  onBackToMissions,
  onReturnToHunt,
}: {
  readonly mission: PlayableMission
  readonly result: VerifyExpeditionResult
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
    <section className={styles.outcome} aria-labelledby="run-outcome">
      <h2 id="run-outcome" tabIndex={-1}>{vault ? VAULT_GAMEPLAY_VERIFIED_TITLE : VERIFIED_TITLE}</h2>
      {!vault && summary.status === 'complete' && <>
        <strong>{MISSION_COMPLETE_COPY}</strong>
        <p>{summary.title}</p>
        <p>{summary.detail}</p>
      </>}
      <p className={styles.subtle}>{vault ? VAULT_GAMEPLAY_VERIFIED_DETAIL : CLAIM_NOT_ENABLED_COPY}</p>
      <div className={styles.actions}>
        <button type="button" onClick={onBackToMissions}>Back to missions</button>
        <button type="button" onClick={onReturnToHunt}>Return to Hunt</button>
      </div>
    </section>
  </main></div>
}
