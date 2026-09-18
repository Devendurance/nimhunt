export const MONTHLY_HEROES_ERRORS = ['MALFORMED_REQUEST', 'RUN_SESSION_INVALID', 'HEROES_UNAVAILABLE'] as const
export type MonthlyHeroesErrorCode = (typeof MONTHLY_HEROES_ERRORS)[number]

export class MonthlyHeroesError extends Error {
  readonly code: MonthlyHeroesErrorCode
  constructor(code: MonthlyHeroesErrorCode) {
    super(code)
    this.name = 'MonthlyHeroesError'
    this.code = code
  }
}
