// Static development preview; never production availability or a live timer.
import type { LeaderboardPreview } from './marketing.types'

export const huntPreviewFixture = { claimed: 26, total: 69, previewReset: '08:42:17', preview: true } as const
export const leaderboardPreviewFixture: readonly LeaderboardPreview[] = [
  { rank: 1, heroName: 'Demo Explorer 01', value: '2,480 points' },
  { rank: 2, heroName: 'Demo Explorer 02', value: '2,160 points' },
  { rank: 3, heroName: 'Demo Explorer 03', value: '1,940 points' },
]
