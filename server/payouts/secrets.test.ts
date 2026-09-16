import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('treasury secret isolation', () => {
  it('does not expose treasury secrets through VITE_ or client source', () => {
    const example = readFileSync(join(root, '.env.example'), 'utf8')
    expect(example).toMatch(/NIMHUNT_PAYOUT_NETWORK=testnet/)
    expect(example).toMatch(/NIMHUNT_REWARD_AMOUNT_LUNA=/)
    expect(example).not.toMatch(/VITE_.*TREASURY|VITE_.*PRIVATE_KEY|VITE_.*MNEMONIC/)
    expect(example).not.toMatch(/[0-9a-fA-F]{64}/)

    const clientHits = collectFiles(join(root, 'src')).flatMap(path => {
      const text = readFileSync(path, 'utf8')
      const matches = []
      if (/NIMHUNT_TREASURY|TREASURY_PRIVATE_KEY|TREASURY_MNEMONIC/.test(text)) matches.push(path)
      if (/VITE_.*TREASURY/.test(text)) matches.push(path)
      if (/executeNext|markSubmitted|markConfirmed|signTransfer|acquire_reward_payout|create_reward_payout/.test(text)) {
        matches.push(path)
      }
      return matches
    })
    expect(clientHits).toEqual([])

    const scriptText = [
      'scripts/generate-treasury.ts',
      'scripts/preflight-treasury.ts',
      'scripts/sweep-treasury.ts',
      'server/payouts/generateTreasury.ts',
      'server/payouts/preflightTreasury.ts',
      'server/payouts/sweepTreasury.ts',
    ].map(path => readFileSync(join(root, path), 'utf8')).join('\n')
    expect(scriptText).not.toMatch(/VITE_[A-Z]/)
    expect(readFileSync(join(root, 'scripts/preflight-treasury.ts'), 'utf8')).not.toMatch(
      /console\.(log|info|debug)\(.*mnemonic|console\.(log|info|debug)\(.*secret/i,
    )
    expect(readFileSync(join(root, 'scripts/sweep-treasury.ts'), 'utf8')).not.toMatch(
      /console\.(log|info|debug)\(.*mnemonic|console\.(log|info|debug)\(.*secret/i,
    )
  })
})

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) return collectFiles(path)
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : []
  })
}
