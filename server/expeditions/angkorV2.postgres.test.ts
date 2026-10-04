import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { KeyPair } from '@nimiq/core'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { createPgProofRpcClient } from './proofDb.ts'
import { createPostgresProofService } from './postgresProofStore.ts'
import { serializeStartPayload } from './canonical.ts'
import { nimiqSignedMessageHash } from './crypto.ts'
import { createV2Blueprint } from '../../src/game/angkorV2Proof/blueprint.ts'
import { hashBlueprint } from '../../src/game/replay/canonical.ts'
import { createRoom01Blueprint } from '../../src/game/world/room01.ts'
import { recordedActions } from '../../src/game/angkorV2Proof/fixtures.testSupport.ts'
import { parseActiveExpedition } from '../../src/api/expeditionProof.ts'

// Real PostgreSQL SQL/PLpgSQL in an ephemeral WASM engine. No URLs, credentials,
// production rows, Docker dependency, or payout workers are used by this harness.
describe('isolated PostgreSQL V2 migration, persistence and legacy coexistence', () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  const rpc = createPgProofRpcClient(async (sql, params) => {
    const result = await db.query<{ result: unknown }>(sql, [...params])
    return result.rows[0]?.result
  })
  beforeAll(async () => {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;')
    for (const file of readdirSync('server/ledger/sql').filter(f => /^\d+.*\.sql$/.test(f)).sort()) {
      try { await db.exec(readFileSync(`server/ledger/sql/${file}`, 'utf8')) } catch (error) { throw new Error(`${file}: ${(error as Error).message}`, { cause: error }) }
    }
  }, 120_000)
  afterAll(async () => { await db.close() })
  for (const mission of ['gem-runner', 'chest-hunter', 'vault-breaker'] as const) it(`${mission}: persisted full replay, service restart and one reservation through unchanged pipeline`, async () => {
    const day = new Date().toISOString().slice(0, 10), blueprint = createV2Blueprint(day, mission)
    let service = await createPostgresProofService({ rpc, blueprints: [blueprint] })
    expect((await service.getPublishedBlueprint(day, mission))?.blueprintHash).toBe(blueprint.blueprintHash)
    const source = createRoom01Blueprint(day, mission)
    const old = { ...source, status: 'PUBLISHED' as const, blueprintHash: hashBlueprint(source) }
    const legacy = await createPostgresProofService({ rpc, blueprints: [old] })
    expect((await legacy.getPublishedBlueprint(day, mission))?.rulesVersion).toBe('nimhunt-rules-v1')
    const key = KeyPair.generate(), wallet = key.toAddress().toUserFriendlyAddress()
    const sign = (payload: string) => ({ payload, publicKey: key.publicKey.toHex(), signature: key.sign(nimiqSignedMessageHash(payload)).toHex() })
    const challenge = await service.issueStartChallenge(wallet, mission)
    const signed = sign(serializeStartPayload({ version: 1, type: 'NIMHUNT_START_EXPEDITION', wallet, mission, dayKey: day,
      challenge: challenge.challenge, blueprintId: challenge.blueprintId, blueprintHash: challenge.blueprintHash }))
    const start = await service.authorizeStart(signed), runId = start.start.runId
    expect((await service.authorizeStart(signed)).start.runId).toBe(runId)
    let session = await service.authenticateSession(start.sessionCapability)
    await service.markGameplayStarted(runId, session)
    // Simulated elapsed time only in this ephemeral DB, avoiding a many-minute
    // real-time recording wait. Production admission clocks remain untouched.
    await db.query("update expedition_runs set gameplay_started_at = now() - interval '1 hour' where id=$1", [runId])
    const { actions, envelope } = recordedActions(mission)
    let hash = (await service.getRun(runId))!.checkpointHash
    for (let i = 0; i < actions.length; i += 8) {
      const request = { runId, session, previousCheckpointHash: hash, actions: actions.slice(i, i + 8) }
      const ack = await service.appendCheckpoint(request)
      if (i === 0 || i === 256 || i + 8 >= actions.length) expect((await service.appendCheckpoint(request)).checkpointHash).toBe(ack.checkpointHash)
      hash = ack.checkpointHash
      if (i === Math.floor(actions.length / 16) * 8) {
        service = await createPostgresProofService({ rpc, blueprints: [blueprint] })
        session = await service.authenticateSession(start.sessionCapability)
        const active = await service.getActiveExpedition(runId, session)
        expect(active.state.seq).toBe(ack.seqEnd)
        expect(parseActiveExpedition({ ok: true, ...active })).not.toBeNull()
      }
    }
    const run = (await service.getRun(runId))!
    expect(run.state.angkorV2!.expedition).toEqual(envelope.snapshot)
    expect(run.seq).toBeGreaterThan(256)
    const result = await service.verifyExpedition({ runId, session, checkpointHash: hash })
    expect(result.finalHp).toBe(envelope.snapshot.hp)
    if (mission === 'vault-breaker') {
      await expect(service.prepareRewardClaim(runId, session)).rejects.toMatchObject({ code: 'VAULT_SEAL_REQUIRED' })
      const seal = await service.prepareVaultSeal(runId, session)
      await service.verifyVaultSeal({ session, ...sign(seal.canonicalPayload) })
    }
    const claim = await service.prepareRewardClaim(runId, session)
    expect(claim.outcome).toBe('PREPARED')
    if (claim.outcome !== 'PREPARED') throw new Error('PREPARED_REQUIRED')
    expect((await service.finalizeRewardClaim({ session, claimId: claim.claimId, ...sign(claim.canonicalPayload) })).outcome).toBe('RESERVED')
    expect((await service.getWalletDailyStatus(wallet)).expeditionsRemaining).toBe(2)
    expect((await db.query<{ count: number }>('select count(*)::int as count from reward_payouts')).rows[0].count).toBe(0)
  }, 180_000)
  it('denies new publication RPC to unprivileged roles and keeps the legacy256 limit scoped', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      await expect(db.query("select get_published_angkor_v2_blueprint(current_date, 'gem-runner')")).rejects.toThrow(/permission denied/)
      await db.exec('reset role')
    }
    const source = readFileSync('server/ledger/sql/020_angkor_v2_expeditions.sql', 'utf8')
    expect(source).toContain('else 256 end)' )
    expect(source).toContain("blueprint_version = 'angkor-expedition-blueprint-v1' then 30000")
  })
})
