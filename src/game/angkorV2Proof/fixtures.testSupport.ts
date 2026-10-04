import { readFileSync } from 'node:fs'
import type { MissionType } from '../replay/types.js'
import type { V2Action } from './model.js'
const fixtures = {
  'gem-runner': 'docs/angkor-v2/anaconda-vertical/qa/full-expedition-envelope.json',
  'chest-hunter': 'docs/angkor-v2/chest-hunter-stage3/qa/chest-hunter-full-expedition-replay.json',
  'vault-breaker': 'docs/angkor-v2/vault-breaker-stage3/qa/vault-breaker-stage3-replay.json',
}
export function recordedActions(mission: MissionType) {
  const envelope = JSON.parse(readFileSync(fixtures[mission], 'utf8'))
  const actions: V2Action[] = []
  for (const entry of envelope.entries) {
    if (entry.type === 'STAGE_ACTION') actions.push(entry.action.type === 'MOVE'
      ? { seq: actions.length + 1, type: 'V2_MOVE', stageId: entry.stageId, direction: entry.action.direction }
      : { seq: actions.length + 1, type: 'V2_TICK', stageId: entry.stageId })
    else if (entry.type === 'STAGE_ADVANCED') actions.push({ seq: actions.length + 1, type: 'V2_CONTINUE', stageId: entry.fromStage })
  }
  return { actions, envelope }
}
