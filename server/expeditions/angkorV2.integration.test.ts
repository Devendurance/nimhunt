import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { recordedActions } from '../../src/game/angkorV2Proof/fixtures.testSupport.ts'
import { createV2Blueprint } from '../../src/game/angkorV2Proof/blueprint.ts'
import { hashReplayState, hashCheckpoint } from '../../src/game/replay/canonical.ts'
import { createMemoryProofService } from './memoryProofStore.ts'
import { serializeStartPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { verifyExpeditionRun } from './verify.ts'
import type { MissionType } from '../../src/game/replay/types.ts'

async function start(mission: MissionType) {
  const base = Date.parse('2026-10-04T12:00:00.000Z')
  let now = base
  const service = createMemoryProofService({ clock: { now: () => new Date(now) }, blueprints: [createV2Blueprint('2026-10-04', mission)] })
  const key = KeyPair.generate(), wallet = key.toAddress().toUserFriendlyAddress()
  const sign = (payload: string) => ({ payload, publicKey: key.publicKey.toHex(), signature: key.sign(nimiqSignedMessageHash(payload)).toHex() })
  const challenge = await service.issueStartChallenge(wallet, mission)
  const payload = serializeStartPayload({ version: 1, type: 'NIMHUNT_START_EXPEDITION', wallet, mission, dayKey: challenge.dayKey, challenge: challenge.challenge, blueprintId: challenge.blueprintId, blueprintHash: challenge.blueprintHash })
  const auth = await service.authorizeStart(sign(payload)), runId = auth.start.runId, session = service.authenticateSession(auth.sessionCapability)
  expect((await service.authorizeStart(sign(payload))).start.runId).toBe(runId)
  service.markGameplayStarted(runId, session)
  return { service, runId, session, sign, wallet, setTime: (seq: number) => { now = base + seq * 200 }, now: () => new Date(now) }
}
describe('wallet-authorized V2 production proof pipeline (local memory; no transfers)', () => {
  for (const mission of ['gem-runner', 'chest-hunter', 'vault-breaker'] as const) it(`${mission}: one attempt, exact mid-stage resume, full replay, existing signed claim reservation`, async () => {
    const f = await start(mission), { actions, envelope } = recordedActions(mission)
    let checkpointHash = f.service.getRun(f.runId)!.checkpointHash
    for (let i = 0; i < actions.length; i += 8) {
      const batch = actions.slice(i, i + 8)
      f.setTime(batch.at(-1)!.seq)
      const ack = await f.service.appendCheckpoint({ runId: f.runId, session: f.session, previousCheckpointHash: checkpointHash, actions: batch })
      expect((await f.service.appendCheckpoint({ runId: f.runId, session: f.session, previousCheckpointHash: checkpointHash, actions: batch })).checkpointHash).toBe(ack.checkpointHash)
      checkpointHash = ack.checkpointHash
      if (i === Math.floor(actions.length / 16) * 8) {
        const active = f.service.getActiveExpedition(f.runId, f.session)
        expect(active.state).toEqual(f.service.getRun(f.runId)!.state)
        expect(hashReplayState(active.state)).toBe(active.checkpoint.stateHash)
        expect(active.state.angkorV2!.expedition.currentStageIndex).toBeGreaterThanOrEqual(0)
      }
    }
    const run = f.service.getRun(f.runId)!
    expect(run.state.angkorV2!.expedition).toEqual(envelope.snapshot)
    expect(f.service.getWalletDailyStatus(f.wallet).expeditionsRemaining).toBe(2)
    expect(run.actions.length).toBeGreaterThan(256)
    const result = await f.service.verifyExpedition({ runId: f.runId, session: f.session, checkpointHash })
    expect(result.finalHp).toBe(envelope.snapshot.hp)
    expect((await f.service.verifyExpedition({ runId: f.runId, session: f.session, checkpointHash })).stateHash).toBe(result.stateHash)
    if (mission === 'vault-breaker') {
      expect(result.outcome).toBe('VAULT_GAMEPLAY_VERIFIED')
      await expect(f.service.prepareRewardClaim(f.runId, f.session)).rejects.toMatchObject({ code: 'VAULT_SEAL_REQUIRED' })
      const seal = await f.service.prepareVaultSeal(f.runId, f.session)
      await f.service.verifyVaultSeal({ session: f.session, ...f.sign(seal.canonicalPayload) })
    } else expect(result.outcome).toBe('VERIFIED_ELIGIBLE')
    const claim = await f.service.prepareRewardClaim(f.runId, f.session)
    expect(claim.outcome).toBe('PREPARED')
    if (claim.outcome !== 'PREPARED') throw new Error('Claim not prepared')
    const finalized = await f.service.finalizeRewardClaim({ session: f.session, claimId: claim.claimId, ...f.sign(claim.canonicalPayload) })
    expect(finalized.outcome).toBe('RESERVED')
    expect(finalized.totalSlots).toBe(7)
    expect(f.service.getRewardClaim(claim.claimId, f.session).rewardAmountLuna).toBe(100_000_000n)
    expect(f.service.getWalletDailyStatus(f.wallet).expeditionsRemaining).toBe(2)
    expect(() => verifyExpeditionRun({ ...run, actions: [], state: { ...run.state, angkorV2: { ...run.state.angkorV2!, local: { forgedBoss: true } } } }, { checkpointHash, now: f.now() })).toThrow()
    // Even a forged summary with internally recomputed hashes cannot replace
    // replayed carry, stage results or boss authority.
    const forged = structuredClone(run)
    Object.assign(forged.state.angkorV2!.expedition, { hp: 100 })
    Object.assign(forged.state.angkorV2!.expedition.stageResults[0], { hpRemaining: 100 })
    Object.assign(forged.state.run, { hp: 100 })
    Object.assign(forged, { checkpoint: { ...forged.checkpoint, stateHash: hashReplayState(forged.state) } })
    Object.assign(forged, { checkpoint: { ...forged.checkpoint, checkpointHash: hashCheckpoint(forged.checkpoint) } })
    Object.assign(forged, { checkpointHash: forged.checkpoint.checkpointHash })
    expect(() => verifyExpeditionRun(forged, { checkpointHash: forged.checkpointHash, now: f.now() })).toThrow()
    const mutated = structuredClone(run)
    const boundary = mutated.batches.flatMap(b => b.actions).find(a => a.type === 'V2_CONTINUE')!
    Object.assign(boundary, { stageId: run.state.angkorV2!.expedition.currentStage })
    expect(() => verifyExpeditionRun(mutated, { checkpointHash, now: f.now() })).toThrow()
    await expect(f.service.appendCheckpoint({ runId: f.runId, session: f.session, previousCheckpointHash: checkpointHash,
      actions: [{ seq: run.seq + 1, type: 'V2_CONTINUE', stageId: run.state.angkorV2!.expedition.currentStage }] })).rejects.toBeTruthy()

  }, 120_000)
  it('rejects asserted state, skipped boundary, accelerated ticks and wrong-version actions without consuming another attempt', async () => {
    const f = await start('vault-breaker'), hash = f.service.getRun(f.runId)!.checkpointHash
    for (const action of [
      { seq: 1, type: 'V2_CONTINUE', stageId: 'temple-approach' },
      { seq: 1, type: 'V2_TICK', stageId: 'inner-vault' },
      { seq: 1, type: 'V2_TICK', stageId: 'temple-approach', hp: 100 },
      { seq: 1, type: 'MOVE', direction: 'UP' },
    ]) await expect(f.service.appendCheckpoint({ runId: f.runId, session: f.session, previousCheckpointHash: hash, actions: [action as never] })).rejects.toBeTruthy()
    await expect(f.service.appendCheckpoint({ runId: f.runId, session: f.session, previousCheckpointHash: hash, actions: Array.from({ length: 8 }, (_, i) => ({ seq: i + 1, type: 'V2_TICK' as const, stageId: 'temple-approach' })) })).rejects.toMatchObject({ code: 'INVALID_ACTION' })
    expect(f.service.getRun(f.runId)!.seq).toBe(0)
    expect(f.service.getWalletDailyStatus(f.wallet).expeditionsRemaining).toBe(2)
  })
})
