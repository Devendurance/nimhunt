import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AngkorV2HealthMeter } from './AngkorV2HealthMeter'
import { healthPresentation } from './healthPresentation'

describe('Angkor V2 health presentation', () => {
  it.each([
    [100, 'green'], [99, 'green'], [76, 'green'], [75, 'yellow'], [74, 'yellow'],
    [51, 'yellow'], [50, 'orange'], [49, 'orange'], [26, 'orange'],
    [25, 'red'], [24, 'red'], [1, 'red'], [0, 'empty'],
  ])('shows exact health %i with the correct whole-meter tone %s', (hp, tone) => {
    const presentation = healthPresentation(Number(hp))
    expect(presentation.tone).toBe(tone)
    expect(presentation.fills.reduce((sum, fill) => sum + fill * 25, 0)).toBe(hp)
    const html = renderToStaticMarkup(<AngkorV2HealthMeter hp={Number(hp)} />)
    expect(html).toContain(`Health ${hp} of 100`)
    expect(html).toContain(`aria-valuenow="${hp}"`)
    expect(html).toContain(`HP ${hp}`)
    expect(html.match(/class="v2-health-segment"/g)).toHaveLength(4)
  })
  it('preserves partial fill and immediately follows damage and healing', () => {
    expect(healthPresentation(87).fills).toEqual([1, 1, 1, .48])
    expect(healthPresentation(63).fills).toEqual([1, 1, .52, 0])
    expect(healthPresentation(38).fills).toEqual([1, .52, 0, 0])
    expect([76, 75, 50, 25, 0, 42, 67].map(hp => healthPresentation(hp).tone))
      .toEqual(['green', 'yellow', 'orange', 'red', 'empty', 'orange', 'yellow'])
  })
})
