/** Display mapping only; never writes to expedition health. */
export function healthPresentation(hp: number) {
  const value = Math.max(0, Math.min(100, hp))
  const tone = value > 75 ? 'green' : value > 50 ? 'yellow' : value > 25 ? 'orange' : value > 0 ? 'red' : 'empty'
  return { value, tone, fills: [0, 1, 2, 3].map(index => Math.max(0, Math.min(1, (value - index * 25) / 25))) }
}
