import { useState } from 'react'
import type { MissionType } from '../../game/replay/types'
import { createV2Blueprint } from '../../game/angkorV2Proof/blueprint'
import { createInitialRun } from '../../game/replay/engine'
import { V2Session } from '../../game/angkorV2Proof/session'
import { AngkorV2Gameplay } from './AngkorV2Gameplay'

/** No product start, wallet/provider, proof API, claim or recovery hooks. */
export default function AngkorV2PracticeView({ mission, onBackToMissions }: { mission: MissionType; onBackToMissions: () => void }) {
  const [session] = useState(() => {
    const blueprint = createV2Blueprint('2000-01-01', mission)
    return new V2Session({ initial: createInitialRun({ mission, blueprint, rulesVersion: blueprint.rulesVersion, roomVersion: blueprint.roomVersion }) })
  })
  return <AngkorV2Gameplay session={session} practice onLeave={onBackToMissions} />
}
