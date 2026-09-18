import type { Mission } from '../types/play'

export const playMissions: readonly Mission[] = [
  {
    id: 'gem-runner',
    number: '01',
    title: 'GEM RUNNER',
    objective: 'Collect 6 gems and survive.',
    icon: 'gem',
    status: 'available',
  },
  {
    id: 'chest-hunter',
    number: '02',
    title: 'CHEST HUNTER',
    objective: 'Open 4 chests and survive.',
    icon: 'chest',
    status: 'available',
  },
  {
    id: 'vault-breaker',
    number: '03',
    title: 'VAULT BREAKER',
    objective: 'Find the key. Unlock the gate. Reach the vault.',
    icon: 'key',
    status: 'available',
  },
]
