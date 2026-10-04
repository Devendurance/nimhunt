import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'

describe('021 permanent pool and amount authority in isolated PostgreSQL', () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  let preMigrationClaim: string
  beforeAll(async () => {
    await db.exec('create role anon;create role authenticated;create role service_role bypassrls;')
    for (const file of readdirSync('server/ledger/sql').filter(f => /^\d+.*\.sql$/.test(f)).sort()) {
      if (file.startsWith('021')) {
        await db.exec("insert into daily_reward_pools(day_key,reserved_slots) values((now() at time zone 'UTC')::date-1,2)")
        const old=await seed(randomUUID(),-1)
        preMigrationClaim=old.claim
        await db.query("update reward_claims set status='RESERVED',reward_amount_luna=1449275 where claim_id=$1",[old.claim])
      }
      await db.exec(readFileSync(`server/ledger/sql/${file}`, 'utf8'))
    }
    await db.exec("update permanent_reward_policy set starts_at=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'")
  }, 120_000)
  afterAll(async () => { await db.close() })
  async function seed(wallet = randomUUID(), dayOffset = 0) {
    const run=randomUUID(), claim=randomUUID(), hash=randomUUID().replaceAll('-', '').padEnd(64,'0')
    await db.query("insert into daily_reward_pools(day_key) values((now() at time zone 'UTC')::date+$1::integer) on conflict do nothing",[dayOffset])
    await db.query("insert into daily_wallet_state(day_key,wallet) values((now() at time zone 'UTC')::date+$2::integer,$1) on conflict do nothing", [wallet,dayOffset])
    await db.query("insert into expedition_runs(id,day_key,wallet,mission_type,status) values($1,(now() at time zone 'UTC')::date+$3::integer,$2,'gem-runner','COMPLETED')",[run,wallet,dayOffset])
    await db.query("insert into run_sessions(run_session_hash,run_id,wallet,created_at,expires_at) values($1,$2,$3,now(),now()+interval '1 day')",[hash,run,wallet])
    await db.query("insert into reward_claims(claim_id,run_id,wallet,mission,day_key,canonical_payload,claim_payload_hash,status,expires_at) values($1,$2,$3,'gem-runner',(now() at time zone 'UTC')::date+$5::integer,'payload',$4,'PREPARED',public.next_utc_reset_at((now() at time zone 'UTC')::date+$5::integer))",[claim,run,wallet,hash,dayOffset])
    return {run,claim,wallet,hash}
  }
  async function finish(s: Awaited<ReturnType<typeof seed>>, amount=100_000_000) {
    const r=await db.query<{result:{ok:boolean;outcome:string;error?:string;claim:{total_slots:number;reservation_number:number;reward_amount_luna:string}}}>("select public.finalize_reward_claim($1,$2,$3,$4,'payload',$3,'key','sig',$5) result",[s.claim,s.run,s.hash,s.wallet,amount])
    return r.rows[0].result
  }
  it('preserves historical69 pools and creates7-slot pools at every new UTC day', async () => {
    expect((await db.query<{total_slots:number;reserved_slots:number}>("select total_slots,reserved_slots from daily_reward_pools where day_key=(now() at time zone 'UTC')::date-1")).rows[0]).toEqual({total_slots:69,reserved_slots:2})
    await db.exec("insert into daily_reward_pools(day_key) values((now() at time zone 'UTC')::date+1)")
    expect((await db.query<{total_slots:number;reserved_slots:number}>("select total_slots,reserved_slots from daily_reward_pools where day_key=(now() at time zone 'UTC')::date+1")).rows[0]).toEqual({total_slots:7,reserved_slots:0})
  })
  it('freezes preparation amount; rejects changed economics without consuming a slot', async () => {
    const s=await seed()
    expect((await finish(s,99_000_000)).error).toBe('REWARD_UNAVAILABLE')
    await expect(db.query('update reward_claims set reward_amount_luna=99000000 where claim_id=$1',[s.claim])).rejects.toThrow('PROOF_LOST')
    expect((await db.query<{amount:string}>('select reward_amount_luna::text amount from reward_claims where claim_id=$1',[s.claim])).rows[0].amount).toBe('100000000')
  })
  it('retains historical event amounts and rejects prepared claims beyond their UTC window', async () => {
    expect((await db.query<{amount:string}>('select reward_amount_luna::text amount from reward_claims where claim_id=$1',[preMigrationClaim])).rows[0].amount).toBe('1449275')
    const old=await seed(randomUUID(),-1)
    expect((await finish(old,1_449_275)).error).toBe('CLAIM_WINDOW_EXPIRED')
    // Simulate an already-reserved historical event claim: no current-day slot consumed.
    const historical=await seed(randomUUID(),-1)
    await db.query("update reward_claims set status='RESERVED',reward_amount_luna=1449275 where claim_id=$1",[historical.claim])
    await expect(db.query('update reward_claims set reward_amount_luna=100000000 where claim_id=$1',[historical.claim])).rejects.toThrow('PROOF_LOST')
    const result=await db.query<{result:{total_slots:number;reward_amount_luna:string}}>('select public.claim_json(c,2,7) result from reward_claims c where claim_id=$1',[historical.claim])
    expect(result.rows[0].result).toMatchObject({total_slots:69,reward_amount_luna:'1449275'})
    await expect(db.exec("update daily_reward_pools set total_slots=7 where day_key=(now() at time zone 'UTC')::date-1")).rejects.toThrow('REWARD_POOL_POLICY_IMMUTABLE')
  })
  it('atomically reserves exactly7, returns SOLD_OUT for8+, and retains retry numbers', async () => {
    const claims=[]
    for(let i=0;i<10;i++)claims.push(await seed())
    const results=await Promise.all(claims.map(s=>finish(s)))
    expect(results.filter(r=>r.outcome==='RESERVED')).toHaveLength(7)
    expect(results.filter(r=>r.outcome==='SOLD_OUT')).toHaveLength(3)
    expect(results.filter(r=>r.outcome==='RESERVED').map(r=>r.claim.reservation_number)).toEqual([1,2,3,4,5,6,7])
    expect((await finish(claims[0])).claim.reservation_number).toBe(1)
    await expect(db.query('update reward_claims set reservation_number=2 where claim_id=$1',[claims[0].claim])).rejects.toThrow('PROOF_LOST')
    const second=await seed(claims[0].wallet)
    expect((await finish(second)).outcome).toBe('ALREADY_REWARDED')
    const liability=(await db.query<{amount:string}>("select sum(reward_amount_luna)::text amount from reward_claims where status='RESERVED' and day_key=(now() at time zone 'UTC')::date")).rows[0].amount
    expect(liability).toBe('700000000')
  })
})
