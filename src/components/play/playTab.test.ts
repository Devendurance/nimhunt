import { describe, expect, it } from 'vitest'
import { normalizePlayTabParams, resolvePlayTab, withPlayTab } from './playTab'

describe('P5 play tab URL contract', () => {
  it('uses Hunt for missing and invalid tabs', () => {
    expect(resolvePlayTab(null)).toBe('hunt')
    expect(resolvePlayTab('nope')).toBe('hunt')
    expect(resolvePlayTab('bank')).toBe('bank')
  })

  it('preserves run, practice, dev, and unrelated query parameters', () => {
    const params = new URLSearchParams('run=gem-runner&runId=run-1&practice=chest-hunter&dev=1&safe=keep')
    expect(withPlayTab(params, 'heroes').toString()).toBe('run=gem-runner&runId=run-1&practice=chest-hunter&dev=1&safe=keep&tab=heroes')
    expect(withPlayTab(params, 'hunt').toString()).toBe('run=gem-runner&runId=run-1&practice=chest-hunter&dev=1&safe=keep')
  })

  it('normalizes an invalid or explicit Hunt tab without touching other params', () => {
    const params = new URLSearchParams('tab=not-a-tab&safe=keep')
    expect(normalizePlayTabParams(params).toString()).toBe('safe=keep')
    expect(normalizePlayTabParams(new URLSearchParams('safe=keep'), 'missions').toString()).toBe('safe=keep&tab=missions')
  })
})
