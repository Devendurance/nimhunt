import { describe, expect, it, vi } from 'vitest'

describe('retained product wallet context', () => {
  it('exists only in the module instance and disappears after a module reset', async () => {
    vi.resetModules()
    const firstModule = await import('./productWallet')
    firstModule.rememberProductWallet('NQ00 NORMALIZED WALLET')

    expect(firstModule.getRememberedProductWallet()).toBe('NQ00 NORMALIZED WALLET')

    vi.resetModules()
    const reloadedModule = await import('./productWallet')
    expect(reloadedModule.getRememberedProductWallet()).toBeNull()

    reloadedModule.rememberProductWallet('NQ00 NORMALIZED WALLET')
    reloadedModule.clearRememberedProductWallet()
    expect(reloadedModule.getRememberedProductWallet()).toBeNull()
  })
})
