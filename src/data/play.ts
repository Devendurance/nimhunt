import type { Mission } from '../types/play'

export const playMissions: readonly Mission[] = [
  {
    id: 'gem-runner',
    number: '01',
    title: 'GEM RUNNER',
    objective: 'Explore three stages, collect Gems, and outwit the Anaconda.',
    icon: 'gem',
    status: 'available',
  },
  {
    id: 'chest-hunter',
    number: '02',
    title: 'CHEST HUNTER',
    objective: 'Unlock treasure in three stages. Secure the Royal Cache.',
    icon: 'chest',
    status: 'available',
  },
  {
    id: 'vault-breaker',
    number: '03',
    title: 'VAULT BREAKER',
    objective: 'Break seals, solve mechanisms, and bait the Golem.',
    icon: 'key',
    status: 'available',
  },
]
