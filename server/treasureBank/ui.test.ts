import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

describe('treasure bank mobile UI (static)', () => {
  it('renders pending, delivered, and lifetime totals with required copy', () => {
    const ui = read('src/components/play/TreasureBank.tsx')
    expect(ui).toContain('TREASURE BANK')
    expect(ui).toContain('Pending treasure')
    expect(ui).toContain('Delivered')
    expect(ui).toContain('Lifetime earned')
    expect(ui).toContain('Your treasure is secured.')
    expect(ui).toContain('If today&apos;s payout has already run, it will be included in a later payout batch.')
    expect(ui).toContain('Sent to your Nimiq wallet.')
    expect(ui).not.toMatch(/withdraw/i)
    expect(ui).not.toMatch(/sample|placeholder.*NIM/i)
  })

  it('covers loading, empty, and unavailable states', () => {
    const ui = read('src/components/play/TreasureBank.tsx')
    expect(ui).toContain('Loading your treasure')
    expect(ui).toContain('No treasure yet')
    expect(ui).toContain('Treasure is unavailable')
    expect(ui).toContain('Retry')
  })

  it('is mounted inside /play for connected wallets only', () => {
    const shell = read('src/components/play/PlayShell.tsx')
    expect(shell).toContain('TreasureBankSection')
    expect(shell).toContain('useTreasureBank')
    expect(shell).toContain('treasureWalletConnected')
  })

  it('does not imply manual withdrawal anywhere in the bank UI', () => {
    const ui = read('src/components/play/TreasureBank.tsx')
    const hook = read('src/components/play/useTreasureBank.ts')
    const api = read('src/api/treasureBank.ts')
    for (const source of [ui, hook, api]) {
      expect(source).not.toMatch(/withdraw|manual.*payout|claim.*on-chain/i)
    }
  })
})
