export const PUBLIC_STATS_ERRORS = ['MALFORMED_REQUEST', 'STATS_UNAVAILABLE'] as const
export type PublicStatsErrorCode = (typeof PUBLIC_STATS_ERRORS)[number]

export class PublicStatsError extends Error {
  readonly code: PublicStatsErrorCode
  constructor(code: PublicStatsErrorCode) {
    super(code)
    this.name = 'PublicStatsError'
    this.code = code
  }
}
