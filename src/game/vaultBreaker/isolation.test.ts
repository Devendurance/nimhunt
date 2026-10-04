import { readFileSync,existsSync } from 'node:fs'
import { resolve,dirname } from 'node:path'
import { it,expect } from 'vitest'
import { replayEnvelope,stageFactory,type VaultBreakerEnvelope } from './runtime'
import { templeApproachAdapter } from './adapters'
it('replays the real mobile MOVE/TICK recording through completion and exact StageII carry',()=>{
  const envelope=JSON.parse(readFileSync(resolve('docs/angkor-v2/vault-breaker-stage1/qa/vault-breaker-stage1-replay.json'),'utf8')) as VaultBreakerEnvelope
  const runtime=replayEnvelope(envelope,{'temple-approach':stageFactory(templeApproachAdapter)})
  expect(runtime.envelope()).toEqual(envelope)
  expect(runtime.state).toMatchObject({status:'PLAYING',currentStage:'ancient-mechanism',optionalGemCount:0})
  expect(runtime.state.hp).toBe(runtime.state.stageResults[0].hpRemaining)
  expect(runtime.state.stageResults[0]).toMatchObject({bronzeKeyCollected:true,outerSealUnlocked:true,mechanismActivated:true,optionalGemCount:3,carriedItems:{potion:{owned:true,consumed:true}}})
  expect(runtime.state.stageResults).toHaveLength(1)
})
it('Vault Breaker is dev-gated and unreachable from the production import graph',()=>{
  const seen=new Set<string>()
  function visit(file:string){
    if(seen.has(file))return;seen.add(file)
    for(const m of readFileSync(file,'utf8').matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)){
      const base=resolve(dirname(file),m[1]),next=[base,base+'.ts',base+'.tsx',resolve(base,'index.ts'),resolve(base,'index.tsx')].find(p=>/\.tsx?$/.test(p)&&existsSync(p))
      if(next)visit(next)
    }
  }
  visit(resolve('src/main.tsx'))
  expect([...seen].some(p=>p.includes('vaultBreaker'))).toBe(false)
  expect(readFileSync(resolve('src/dev/vaultBreakerStage1.tsx'),'utf8')).toContain('if(import.meta.env.DEV)')
  expect(readFileSync(resolve('dev/angkor-v2-vault-breaker.html'),'utf8')).toContain('/src/dev/vaultBreakerStage1.tsx')
})
