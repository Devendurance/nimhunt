import { describe, expect, it } from 'vitest'
import {
  createRandomInstallId,
  getOrCreateInstallId,
  INSTALL_ID_STORAGE_KEY,
  isInstallId,
  readInstallId,
} from './installId.ts'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null
    },
    setItem(key: string, value: string) {
      data[key] = value
    },
    snapshot() {
      return { ...data }
    },
  }
}

describe('random install id', () => {
  it('creates a crypto-random UUID and reuses the stored value', () => {
    const first = createRandomInstallId()
    const second = createRandomInstallId()
    expect(isInstallId(first)).toBe(true)
    expect(first).not.toBe(second)
    const storage = memoryStorage()
    const created = getOrCreateInstallId(storage, () => '11111111-1111-4111-8111-111111111111')
    expect(created).toBe('11111111-1111-4111-8111-111111111111')
    expect(storage.snapshot()[INSTALL_ID_STORAGE_KEY]).toBe(created)
    expect(getOrCreateInstallId(storage, () => '22222222-2222-4222-8222-222222222222')).toBe(created)
    expect(readInstallId(storage)).toBe(created)
  })

  it('is not derived from hardware, wallet, UA, or IP attributes', () => {
    const source = createRandomInstallId.toString()
    expect(source).not.toMatch(/userAgent|screen|font|language|wallet|address|ip/i)
    expect(isInstallId('NQ07 33E4 6T32 24Y7 X4BA 7SP2 27TX 32PL 54JG')).toBe(false)
    expect(isInstallId('not-an-id')).toBe(false)
    expect(readInstallId(null)).toBeNull()
  })
})
