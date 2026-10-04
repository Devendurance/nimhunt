import { createRoot } from 'react-dom/client'
import { AngkorV2Gameplay } from '../components/play/AngkorV2Gameplay'
import { createV2Blueprint } from '../game/angkorV2Proof/blueprint'
import { V2Session } from '../game/angkorV2Proof/session'
import { createInitialRun } from '../game/replay/engine'
import { initialStageState as initialSanctuary } from '../game/stage3/model'
import '../index.css'

// Dev-only presentation fixtures. No reward transport, stage shortcut in /play,
// or fabricated state accepted by the authoritative pipeline.
if (!import.meta.env.DEV) throw new Error('Development layout QA only')
const query = new URLSearchParams(location.search)
const blueprint = createV2Blueprint('2000-01-01', 'gem-runner')
const initial = createInitialRun({ blueprint, mission: blueprint.mission, rulesVersion: blueprint.rulesVersion, roomVersion: blueprint.roomVersion })
const v2 = initial.angkorV2!, expedition = v2.expedition
const hp = Math.max(0, Math.min(100, Number(query.get('hp') ?? 100)))
Object.assign(expedition, { hp })
// A fresh stage requires living carry-in; the zero-health HUD is applied below.
Object.assign(expedition.stageCarryIn, { hp: Math.max(1, hp) })
if (expedition.mission !== 'gem-runner') throw new Error('Gem layout fixture required')
if (query.get('scenario') === 'stage3') {
  Object.assign(expedition, { currentStage: 'inner-sanctuary', currentStageIndex: 2 })
  Object.assign(v2, { local: initialSanctuary(expedition.stageCarryIn) })
  if (query.get('boss') === '1') Object.assign(v2.local as object, { player: { x: 24, y: 16 } })
}
if (query.get('scenario') === 'transition') Object.assign(expedition, { status: 'TRANSITION' })
Object.assign(v2.local as object, { hp })
document.documentElement.style.setProperty('--v2-safe-bottom', `${Number(query.get('safe') ?? 34)}px`)
const session = new V2Session({ initial })
const root = createRoot(document.getElementById('root')!)
const render = () => root.render(<AngkorV2Gameplay session={session} practice={query.get('reward') !== '1'} onLeave={() => location.assign('/play')} />)
Object.assign(window, { __v2LayoutQA: { session, setHp: (value: number) => {
  // HUD fixture only: no action/proof submission or production shortcut.
  Object.assign(session.state.angkorV2!.expedition, { hp: value })
  Object.assign(session.state.angkorV2!.local as object, { hp: value })
  render()
} } })
render()
