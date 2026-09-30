import { describe, expect, it, vi } from 'vitest'
import { AdventurerIdentityStatus } from './AdventurerIdentityStatus.tsx'

describe('Adventurer identity recovery surface', () => {
  it('shows retry without profile creation controls for ERROR', () => {
    const retryRestore = vi.fn()
    const view = AdventurerIdentityStatus({ status: 'ERROR', error: 'ADVENTURER_UNAVAILABLE', retryRestore })
    const text = collectText(view).join(' ')
    const retry = findButtonWithText(view, 'Retry identity session')

    expect(text).not.toContain('Create Adventurer profile')
    expect(text).toContain('Adventurer identity needs attention.')
    expect(retry).not.toBeNull()
    retry?.onClick?.()
    expect(retryRestore).toHaveBeenCalledTimes(1)
  })

  it('shows restoring state without a retry or creation action while RESTORING', () => {
    const retryRestore = vi.fn()
    const view = AdventurerIdentityStatus({ status: 'RESTORING', error: null, retryRestore })

    expect(collectText(view).join(' ')).toContain('Restoring your Adventurer identity…')
    expect(findButtonWithText(view, 'Retry identity session')).toBeNull()
    expect(collectText(view).join(' ')).not.toContain('Create Adventurer profile')
  })
})

function collectText(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(collectText)
  if (!isRecord(value) || !isRecord(value.props)) return []
  return collectText(value.props.children)
}

function findButtonWithText(value: unknown, text: string): { readonly onClick?: () => void } | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const button = findButtonWithText(child, text)
      if (button) return button
    }
    return null
  }
  if (!isRecord(value) || !isRecord(value.props)) return null
  if (value.type === 'button' && collectText(value).join(' ').includes(text)) return value.props as { readonly onClick?: () => void }
  return findButtonWithText(value.props.children, text)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
