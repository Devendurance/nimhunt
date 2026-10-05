import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { KeyPair } from '@nimiq/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createV2Blueprint } from '../../src/game/angkorV2Proof/blueprint.ts'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { serializeStartPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { createPgProofRpcClient } from './proofDb.ts'
import { createPostgresProofService } from './postgresProofStore.ts'

describe('migration 022 V2 checkpoint throughput compatibility', () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  const rpc = createPgProofRpcClient(async (sql, params) => {
    const result = await db.query<{ result: unknown }>(sql, [...params])
    return result.rows[0]?.result
  })

  beforeAll(async () => {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;')
    for (const file of readdirSync('server/ledger/sql').filter(file => /^\d+.*\.sql$/.test(file)).sort()) {
      try { await db.exec(readFileSync(`server/ledger/sql/${file}`, 'utf8')) }
      catch (error) { throw new Error(`${file}: ${(error as Error).message}`, { cause: error }) }
    }
  }, 120_000)

  afterAll(async () => { await db.close() })

  it('keeps 8-action callers working and scopes 64 to exact V2 without rewriting rows', async () => {
    const day = new Date().toISOString().slice(0, 10)
    const v2Blueprint = createV2Blueprint(day, 'gem-runner')
    const legacySource = createRoom01Blueprint(day, 'gem-runner')
    const legacyBlueprint = { ...legacySource, status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(legacySource) }
    const v2Service = await createPostgresProofService({ rpc, blueprints: [v2Blueprint] })
    const legacyService = await createPostgresProofService({ rpc, blueprints: [legacyBlueprint] })

    async function start(service: Awaited<ReturnType<typeof createPostgresProofService>>) {
      const key = KeyPair.generate(), wallet = key.toAddress().toUserFriendlyAddress()
      const sign = (payload: string) => ({ payload, publicKey: key.publicKey.toHex(), signature: key.sign(nimiqSignedMessageHash(payload)).toHex() })
      const challenge = await service.issueStartChallenge(wallet, 'gem-runner')
      const started = await service.authorizeStart(sign(serializeStartPayload({
        version: 1, type: 'NIMHUNT_START_EXPEDITION', wallet, mission: 'gem-runner', dayKey: day,
        challenge: challenge.challenge, blueprintId: challenge.blueprintId, blueprintHash: challenge.blueprintHash,
      })))
      const session = await service.authenticateSession(started.sessionCapability)
      await service.markGameplayStarted(started.start.runId, session)
      await db.query("update expedition_runs set gameplay_started_at = now() - interval '1 hour' where id=$1", [started.start.runId])
      return { service, session, runId: started.start.runId }
    }

    const v2 = await start(v2Service)
    const legacy = await start(legacyService)
    const v2Hash = (await v2.service.getRun(v2.runId))!.checkpointHash
    const legacyHash = (await legacy.service.getRun(legacy.runId))!.checkpointHash

    const v2Eight = await v2.service.appendCheckpoint({
      runId: v2.runId, session: v2.session, previousCheckpointHash: v2Hash,
      actions: Array.from({ length: 8 }, (_, i) => ({ seq: i + 1, type: 'V2_TICK' as const, stageId: 'outer-ruins' })),
    })
    const legacyEight = await legacy.service.appendCheckpoint({
      runId: legacy.runId, session: legacy.session, previousCheckpointHash: legacyHash,
      actions: Array.from({ length: 8 }, (_, i) => ({ seq: i + 1, type: 'MOVE' as const, direction: i % 2 ? 'RIGHT' as const : 'LEFT' as const })),
    })
    const storedEight = await db.query<{
      run_id: string; seq_start: number; seq_end: number; previous_checkpoint_hash: string
      actions: unknown; batch_fingerprint: string; checkpoint_hash: string
    }>('select run_id, seq_start, seq_end, previous_checkpoint_hash, actions, batch_fingerprint, checkpoint_hash from expedition_checkpoint_batches order by run_id, seq_start')
    expect(storedEight.rows).toHaveLength(2)

    expect((await v2.service.appendCheckpoint({
      runId: v2.runId, session: v2.session, previousCheckpointHash: v2Hash,
      actions: Array.from({ length: 8 }, (_, i) => ({ seq: i + 1, type: 'V2_TICK' as const, stageId: 'outer-ruins' })),
    })).checkpointHash).toBe(v2Eight.checkpointHash)
    expect((await legacy.service.appendCheckpoint({
      runId: legacy.runId, session: legacy.session, previousCheckpointHash: legacyHash,
      actions: Array.from({ length: 8 }, (_, i) => ({ seq: i + 1, type: 'MOVE' as const, direction: i % 2 ? 'RIGHT' as const : 'LEFT' as const })),
    })).checkpointHash).toBe(legacyEight.checkpointHash)

    await expect(legacy.service.appendCheckpoint({
      runId: legacy.runId, session: legacy.session, previousCheckpointHash: legacyEight.checkpointHash,
      actions: Array.from({ length: 9 }, (_, i) => ({ seq: i + 9, type: 'MOVE' as const, direction: 'LEFT' as const })),
    })).rejects.toMatchObject({ code: 'MALFORMED_REQUEST' })

    const thirtyTwo = await v2.service.appendCheckpoint({
      runId: v2.runId, session: v2.session, previousCheckpointHash: v2Eight.checkpointHash,
      actions: Array.from({ length: 32 }, (_, i) => ({ seq: i + 9, type: 'V2_TICK' as const, stageId: 'outer-ruins' })),
    })
    expect(thirtyTwo.seqEnd).toBe(40)
    const sixtyFour = await v2.service.appendCheckpoint({
      runId: v2.runId, session: v2.session, previousCheckpointHash: thirtyTwo.checkpointHash,
      actions: Array.from({ length: 64 }, (_, i) => ({ seq: i + 41, type: 'V2_TICK' as const, stageId: 'outer-ruins' })),
    })
    expect(sixtyFour.seqEnd).toBe(104)
    await expect(v2.service.appendCheckpoint({
      runId: v2.runId, session: v2.session, previousCheckpointHash: sixtyFour.checkpointHash,
      actions: Array.from({ length: 65 }, (_, i) => ({ seq: i + 105, type: 'V2_TICK' as const, stageId: 'outer-ruins' })),
    })).rejects.toMatchObject({ code: 'MALFORMED_REQUEST' })

    const reread = await db.query<{
      run_id: string; seq_start: number; seq_end: number; previous_checkpoint_hash: string
      actions: unknown; batch_fingerprint: string; checkpoint_hash: string
    }>('select run_id, seq_start, seq_end, previous_checkpoint_hash, actions, batch_fingerprint, checkpoint_hash from expedition_checkpoint_batches where seq_end = 8 order by run_id')
    expect(reread.rows).toEqual(storedEight.rows)

    const persisted = await v2.service.getRun(v2.runId)
    expect(persisted?.seq).toBe(104)
    expect(persisted?.batches.map(batch => batch.seqEnd)).toEqual([8, 40, 104])

    const rejected = await rpc.rpc('append_checkpoint_batch', {
      p_run_id: v2.runId,
      p_run_session_hash: v2.session.sessionHash,
      p_previous_checkpoint_hash: sixtyFour.checkpointHash,
      p_actions: Array.from({ length: 65 }, (_, i) => ({ seq: i + 105, type: 'V2_TICK', stageId: 'outer-ruins' })),
      p_seq_start: 105,
      p_seq_end: 169,
      p_batch_fingerprint: 'c'.repeat(64),
      p_transcript_hash: 'd'.repeat(64),
      p_state_hash: 'e'.repeat(64),
      p_checkpoint_hash: 'f'.repeat(64),
      p_replay_snapshot: {},
      p_acknowledgement: {},
    })
    expect(rejected).toMatchObject({ ok: false, error: 'MALFORMED_REQUEST' })
    expect((await v2.service.getRun(v2.runId))?.seq).toBe(104)
  }, 120_000)
})
