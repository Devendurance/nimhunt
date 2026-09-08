export type LeaderboardPreview = {
  heroName: string
  value: string
  rank: number
}

export type LaunchTrigger = HTMLElement | null

export type HuntLaunchConfig =
  | { kind: 'unavailable' }
  | { kind: 'configured'; deepLink: string; qrImage?: string }
