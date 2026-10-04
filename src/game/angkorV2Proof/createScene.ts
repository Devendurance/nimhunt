import type Phaser from 'phaser'
import type { TileTraversal } from '../traversal/angkorV2/movement'
import type { V2Session } from './session'
import type { LocalAction } from './model'

export interface ProofScene extends Phaser.Scene { start(): void; traversal?: TileTraversal }
interface CommonOptions {
  initialState: unknown; carry: unknown; viewport: { width: number; height: number }; canAct: () => boolean
  reduceAction: (a: LocalAction) => unknown; onReady: (scene: ProofScene) => void; onState: (state: unknown) => void
  onError: (error: string) => void; onNotice: (notice: string) => void; onSound: (kind: 'gem' | 'unlock' | 'hurt') => void
}
/** This registry chooses a presentation constructor only. The production
 * session is the sole reducer callback, including fresh Practice sessions. */
export async function createProofScene(session: V2Session, options: Pick<CommonOptions, 'viewport' | 'onReady' | 'onError' | 'onNotice' | 'onSound'>): Promise<ProofScene> {
  const v2 = session.state.angkorV2!, e = v2.expedition
  const common: CommonOptions = { ...options, initialState: v2.local, carry: e.stageCarryIn,
    canAct: () => session.canAct, reduceAction: a => session.dispatch(a), onState: () => undefined }
  function create<O, S extends ProofScene>(Ctor: new(options: O) => S): ProofScene { return new Ctor(common as O) }
  switch (e.currentStage) {
    case 'outer-ruins': return create((await import('../stage1/StageScene')).StageScene)
    case 'overgrown-temple': return create((await import('../stage2/Stage2Scene')).Stage2Scene)
    case 'inner-sanctuary': return create((await import('../stage3/Stage3Scene')).Stage3Scene)
    case 'lost-courtyard': return create((await import('../chestHunter/stage1/ChestHunterScene')).ChestHunterScene)
    case 'forgotten-galleries': return create((await import('../chestHunter/stage2/ForgottenGalleriesScene')).ForgottenGalleriesScene)
    case 'royal-treasury': return create((await import('../chestHunter/stage3/RoyalTreasuryScene')).RoyalTreasuryScene)
    case 'temple-approach': return create((await import('../vaultBreaker/stage1/TempleApproachScene')).TempleApproachScene)
    case 'ancient-mechanism': return create((await import('../vaultBreaker/stage2/AncientMechanismScene')).AncientMechanismScene)
    case 'inner-vault': return create((await import('../vaultBreaker/stage3/InnerVaultScene')).InnerVaultScene)
  }
}
