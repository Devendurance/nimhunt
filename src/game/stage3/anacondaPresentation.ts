import { ANACONDA, PITS } from './level'
import type { StageEvent, StageState } from './model'

/** Presentation only. Timelines read recorded state; they cannot dispatch actions. */
export const PIT_PRESENTATION = {
  width: 64, height: 40, frontCropY: 192,
  serpentWidth: 64, serpentHeight: 112, anchorY: 752 / 768,
  recoilTicks: 4, sinkTicks: 8, shakeTicks: 2,
  // Visible source heights after shared-canvas export, measured from alpha > 32.
  poseHeights: { peek: 39.958333333333336, emerge: 78.02083333333333, upright: 108.5, attack: 92.16666666666667, hit: 97.125, retract: 59.5 },
  headOffset: 14, rockRadius: 15, cradleLift: 52, undergroundBase: 8,
} as const
export type PitPose = keyof typeof PIT_PRESENTATION.poseHeights
export const PIT_POSE_KEYS = {
  peek: 'anaconda-pit-peek-v3', emerge: 'anaconda-emerge-v3', upright: 'anaconda-upright-v3',
  attack: 'anaconda-attack-v3', hit: 'anaconda-hit-v3', retract: 'anaconda-retract-v3',
} as const
const clamp = (n: number) => Math.min(1, Math.max(0, n))
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t) }
function lastTick(state: StageState, type: StageEvent['type']): number {
  for (let i = state.events.length - 1; i >= 0; i--) if (state.events[i].type === type) return state.events[i].tick
  return -Infinity
}
export function anacondaPresentation(state: StageState, fraction = 0) {
  const p = PIT_PRESENTATION, boss = state.anaconda, time = state.tick + clamp(fraction)
  const pit = PITS[boss.activePit], mouthY = pit.y * 32 + 16
  const base = { x: pit.x * 32 + 16, y: mouthY + p.undergroundBase }
  const fullHeight = p.poseHeights.upright
  let pose: PitPose = 'upright', height: number = fullHeight, shaking = false
  const hitAge = time - lastTick(state, 'ANACONDA_HIT')
  if (boss.mode === 'DORMANT') height = 0
  else if (boss.mode === 'EMERGING') {
    const elapsed = ANACONDA.emergenceTicks - (boss.nextTick - time)
    shaking = elapsed < p.shakeTicks
    height = fullHeight * smooth((elapsed - p.shakeTicks) / (ANACONDA.emergenceTicks - p.shakeTicks))
    pose = height < p.poseHeights.peek - 2 ? 'peek' : height < p.poseHeights.emerge - 2 ? 'emerge' : 'upright'
  } else if (boss.mode === 'DEFEATED') {
    const elapsed = time - boss.defeatedAt!
    height = fullHeight * (1 - smooth((elapsed - p.recoilTicks) / (ANACONDA.defeatTicks - p.recoilTicks)))
    pose = elapsed < p.recoilTicks ? 'hit' : height > p.poseHeights.retract - 2 ? 'hit' : 'retract'
  } else if (boss.mode === 'RECOVERING') {
    const elapsed = time - lastTick(state, 'ANACONDA_RETALIATION_IMPACT')
    height = fullHeight * (1 - smooth(elapsed / p.sinkTicks))
    pose = height > p.poseHeights.retract - 2 ? 'attack' : 'retract'
  } else if (hitAge < p.recoilTicks) pose = 'hit'
  else if (boss.mode === 'RETALIATING' && boss.nextTick - time <= 5) pose = 'attack'
  // Translation under a fixed pit-mouth mask, never scaling/fading the serpent away.
  height = Math.min(height, p.poseHeights[pose])
  const y = base.y + p.poseHeights[pose] - height
  return {
    pit: boss.activePit, pose, key: PIT_POSE_KEYS[pose], base, mouthY, depthY: mouthY, y,
    visible: height > p.undergroundBase + .25, height, shaking,
    head: { x: base.x, y: base.y - fullHeight + p.headOffset },
  }
}

/** A released rock falls from its raised cradle onto the head at the recorded impact. */
export function headDropPosition(state: StageState, fraction = 0) {
  const visual = anacondaPresentation(state, fraction), drop = state.anaconda.pendingDrop
  if (!drop) return null
  const t = clamp(1 - (drop.impactTick - state.tick - fraction) / ANACONDA.dropTicks)
  const fromY = 11 * 32 + 16 - PIT_PRESENTATION.cradleLift - PIT_PRESENTATION.rockRadius
  const landingY = visual.head.y - PIT_PRESENTATION.rockRadius
  return { x: visual.head.x, y: fromY + (landingY - fromY) * t * t, t }
}
