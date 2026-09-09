export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function nextUtcResetAt(dayKey: string): string {
  const year = Number(dayKey.slice(0, 4))
  const month = Number(dayKey.slice(5, 7))
  const day = Number(dayKey.slice(8, 10))
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString()
}
