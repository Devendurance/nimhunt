import type { Mission } from '../types/play'

export const playMissions: readonly Mission[] = [
  {
    id: 'gem-runner',
    number: '01',
    title: 'GEM RUNNER',
    objective: 'Collect 12 gems and escape alive.',
    icon: 'gem',
    status: 'available',
  },
  {
    id: 'chest-hunter',
    number: '02',
    title: 'CHEST HUNTER',
    objective: 'Open 4 chests and finish alive.',
    icon: 'chest',
    status: 'available',
  },
  {
    id: 'vault-breaker',
    number: '03',
    title: 'VAULT BREAKER',
    objective: 'Find the Temple Key, reach the Vault, and seal the treasure.',
    icon: 'key',
    status: 'available',
  },
]
