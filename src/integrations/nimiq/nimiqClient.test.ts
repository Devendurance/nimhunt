import { beforeEach, describe, expect, it, vi } from 'vitest'
import { init, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { detectNimiqPayHost, initializeNimiqProvider, listNimiqAccounts, resetNimiqClientForTests, signNimiqMessage } from './nimiqClient'
import { NimiqIntegrationError } from './nimiqErrors'

vi.mock('@nimiq/mini-app-sdk', () => ({
  init: vi.fn(),
}))

function fakeProvider(overrides: Partial<NimiqProvider> = {}): NimiqProvider {
  return {
    listAccounts: vi.fn(),
    sign: vi.fn(),
    ...overrides,
  } as unknown as NimiqProvider
}

describe('Nimiq client', () => {
  const mockedInit = vi.mocked(init)

  beforeEach(() => {
    resetNimiqClientForTests()
    mockedInit.mockReset()
    Reflect.deleteProperty(globalThis, 'nimiq')
    Reflect.deleteProperty(globalThis, 'nimiqPay')
  })

  it('detects a normal browser as not Nimiq Pay', () => {
    expect(detectNimiqPayHost({})).toBe(false)
    expect(detectNimiqPayHost()).toBe(false)
  })

  it('detects the injected Nimiq Pay host', () => {
    expect(detectNimiqPayHost({ nimiqPay: { language: 'en' } })).toBe(true)
    expect(detectNimiqPayHost({ nimiq: {} })).toBe(true)
  })

  it('does not call init() when the provider host is missing', async () => {
    await expect(initializeNimiqProvider()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Nimiq Pay provider is unavailable in this browser.',
    })
    expect(mockedInit).not.toHaveBeenCalled()
  })

  it('initializes the provider once when the host is present', async () => {
    Object.assign(globalThis, { nimiqPay: { language: 'en' } })
    const provider = fakeProvider()
    mockedInit.mockResolvedValue(provider)

    const first = await initializeNimiqProvider()
    const second = await initializeNimiqProvider()

    expect(first).toBe(provider)
    expect(second).toBe(provider)
    expect(mockedInit).toHaveBeenCalledTimes(1)
    expect(mockedInit).toHaveBeenCalledWith({ timeout: 10_000 })
  })

  it('rejects an empty account list', async () => {
    const provider = fakeProvider({
      listAccounts: vi.fn().mockResolvedValue([]),
    })

    await expect(listNimiqAccounts(provider)).rejects.toMatchObject({
      code: 'ACCOUNT_EMPTY',
      message: 'No Nimiq account was returned.',
    })
  })

  it('returns accounts from the SDK', async () => {
    const provider = fakeProvider({
      listAccounts: vi.fn().mockResolvedValue(['NQ07 ABC', 'NQ08 DEF']),
    })

    await expect(listNimiqAccounts(provider)).resolves.toEqual(['NQ07 ABC', 'NQ08 DEF'])
  })

  it('normalizes a cancelled account request', async () => {
    const provider = fakeProvider({
      listAccounts: vi.fn().mockResolvedValue({ error: { type: 'PERMISSION_DENIED', message: 'User rejected' } }),
    })

    await expect(listNimiqAccounts(provider)).rejects.toBeInstanceOf(NimiqIntegrationError)
    await expect(listNimiqAccounts(provider)).rejects.toMatchObject({ code: 'ACCOUNT_CANCELLED' })
  })

  it('returns the publicKey and signature from sign()', async () => {
    const provider = fakeProvider({
      sign: vi.fn().mockResolvedValue({ publicKey: 'pub', signature: 'sig' }),
    })

    await expect(signNimiqMessage(provider, '{"version":1}')).resolves.toEqual({
      publicKey: 'pub',
      signature: 'sig',
    })
  })

  it('does not invent a signature when the SDK omits it', async () => {
    const provider = fakeProvider({
      sign: vi.fn().mockResolvedValue({ publicKey: 'pub' }),
    })

    await expect(signNimiqMessage(provider, 'message')).rejects.toMatchObject({ code: 'UNKNOWN' })
  })
})
