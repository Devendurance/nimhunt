export type PlayTab = 'hunt' | 'missions' | 'heroes'

export type MissionId = 'gem-runner' | 'chest-hunter' | 'vault-breaker'

export type MissionIcon = 'gem' | 'chest' | 'key'

export type MissionStatus = 'available' | 'coming-next'

export type Mission = {
  id: MissionId
  number: string
  title: string
  objective: string
  icon: MissionIcon
  status: MissionStatus
}

export type PlayFixture = {
  treasuresRemaining: number
  treasuresTotal: number
  resetIn: string
  expeditionsRemaining: number
  gems: number
  points: number
  streakDays: number
  startingHp: number
  heroName: string
  sampleRank: number
}
