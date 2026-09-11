import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { useMemo } from 'react'
import { playFixture } from '../../data/play.fixtures'
import { playMissions } from '../../data/play'
import type { ProductStartResult } from '../../api/expeditionProof.ts'
import {
  authorizeStart,
  ExpeditionProofApiError,
  fetchActiveExpedition,
  markGameplayStarted,
  requestStartChallenge,
  submitCheckpoint,
} from '../../api/expeditionProof.ts'
import { fetchDailyHuntStatus, fetchWalletDailyStatus } from '../../api/dailyHunt'
import type { ProductActiveExpedition } from '../../domain/expeditionProof.ts'
import { createNimHuntGame, type NimHuntGameInstance } from '../../game/createNimHuntGame'
import { createInitialRun } from '../../game/replay/engine.ts'
import { createRoom01Blueprint } from '../../game/world/room01.ts'
import { createNimiqError } from '../../integrations/nimiq/nimiqErrors'
import {
  initializeNimiqProvider,
  listNimiqAccounts,
  signNimiqMessage,
} from '../../integrations/nimiq/nimiqClient'
import { resolvePlayRoute } from './expeditionFlow'
import { ExpeditionView } from './ExpeditionView'
import { resolveHuntStatusView } from './huntStatusView'
import { PlayShell } from './PlayShell'
import { ProductExpeditionGate } from './ProductExpeditionGate'
import { clearRememberedProductWallet, getRememberedProductWallet, rememberProductWallet } from './productWallet'
import { useAngkorRun } from './useAngkorRun'
import { useDailyHuntStatus } from './useDailyHuntStatus'
import { useProductStart } from './useProductStart'

type HookSlot = {
  readonly kind: 'reducer' | 'ref' | 'memo' | 'effect'
  value: unknown
  reducer?: (state: unknown, action: unknown) => unknown
  deps?: readonly unknown[]
  cleanup?: () => void
}

type PendingEffect = {
  readonly index: number
  readonly effect: () => void | (() => void)
  readonly deps?: readonly unknown[]
}

const hookRuntime = vi.hoisted(() => ({
  index: 0,
  slots: [] as HookSlot[],
  pendingEffects: [] as PendingEffect[],
  pendingRender: false,
  rendering: false,
  runningEffects: false,
  render: null as (() => void) | null,
  nullRefValue: null as unknown,
}))

vi.mock('react', () => {
  function requestRender(): void {
    if (hookRuntime.rendering || hookRuntime.runningEffects) {
      hookRuntime.pendingRender = true
      return
    }
    hookRuntime.render?.()
  }

  function dependenciesChanged(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
    if (!previous || !next || previous.length !== next.length) return true
    return next.some((value, index) => !Object.is(value, previous[index]))
  }

  return {
    useReducer: (reducer: (state: unknown, action: unknown) => unknown, initial: unknown) => {
      const index = hookRuntime.index++
      let slot = hookRuntime.slots[index]
      if (!slot) {
        slot = { kind: 'reducer', value: initial, reducer }
        hookRuntime.slots[index] = slot
      }
      const dispatch = (action: unknown) => {
        slot.value = slot.reducer?.(slot.value, action)
        requestRender()
      }
      return [slot.value, dispatch] as const
    },
    useRef: (initial: unknown) => {
      const index = hookRuntime.index++
      let slot = hookRuntime.slots[index]
      if (!slot) {
        slot = { kind: 'ref', value: { current: initial === null ? hookRuntime.nullRefValue : initial } }
        hookRuntime.slots[index] = slot
      }
      return slot.value
    },
    useState: (initial: unknown) => {
      const index = hookRuntime.index++
      let slot = hookRuntime.slots[index]
      if (!slot) {
        slot = { kind: 'reducer', value: typeof initial === 'function' ? (initial as () => unknown)() : initial }
        hookRuntime.slots[index] = slot
      }
      const setState = (next: unknown | ((current: unknown) => unknown)) => {
        slot!.value = typeof next === 'function'
          ? (next as (current: unknown) => unknown)(slot!.value)
          : next
        requestRender()
      }
      return [slot.value, setState] as const
    },
    useMemo: (factory: () => unknown, deps: readonly unknown[]) => {
      const index = hookRuntime.index++
      let slot = hookRuntime.slots[index]
      if (!slot || dependenciesChanged(slot.deps, deps)) {
        slot = { kind: 'memo', value: factory(), deps }
        hookRuntime.slots[index] = slot
      }
      return slot.value
    },
    useCallback: (callback: (...args: never[]) => unknown, deps: readonly unknown[]) => {
      const index = hookRuntime.index++
      let slot = hookRuntime.slots[index]
      if (!slot || dependenciesChanged(slot.deps, deps)) {
        slot = { kind: 'memo', value: callback, deps }
        hookRuntime.slots[index] = slot
      }
      return slot.value
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const index = hookRuntime.index++
      const slot = hookRuntime.slots[index]
      if (!slot || dependenciesChanged(slot.deps, deps)) {
        hookRuntime.slots[index] = { kind: 'effect', value: effect, deps, cleanup: slot?.cleanup }
        hookRuntime.pendingEffects.push({ index, effect, deps })
        return
      }
      slot.value = effect
    },
  }
})

vi.mock('react-router-dom', () => ({
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}))

vi.mock('../../api/expeditionProof.ts', async () => {
  const actual = await vi.importActual<typeof import('../../api/expeditionProof.ts')>('../../api/expeditionProof.ts')
  return {
    ...actual,
    authorizeStart: vi.fn(),
    fetchActiveExpedition: vi.fn(),
    markGameplayStarted: vi.fn(),
    requestStartChallenge: vi.fn(),
    submitCheckpoint: vi.fn(),
  }
})

vi.mock('../../api/dailyHunt', () => ({
  fetchDailyHuntStatus: vi.fn(),
  fetchWalletDailyStatus: vi.fn(),
}))

vi.mock('../../integrations/nimiq/nimiqClient', () => ({
  initializeNimiqProvider: vi.fn(),
  listNimiqAccounts: vi.fn(),
  signNimiqMessage: vi.fn(),
}))

vi.mock('../../game/createNimHuntGame', () => ({
  createNimHuntGame: vi.fn(),
}))

function createHookHarness<T>(hook: () => T) {
  let current!: T

  const render = () => {
    hookRuntime.index = 0
    hookRuntime.pendingEffects = []
    hookRuntime.rendering = true
    current = hook()
    hookRuntime.rendering = false
    runEffects()
    while (hookRuntime.pendingRender) {
      hookRuntime.pendingRender = false
      render()
    }
  }

  hookRuntime.render = render
  render()

  return {
    get current(): T {
      return current
    },
    rerender: render,
    unmount: () => {
      for (const slot of hookRuntime.slots) slot.cleanup?.()
      hookRuntime.render = null
    },
  }
}

function runEffects(): void {
  const effects = hookRuntime.pendingEffects
  hookRuntime.pendingEffects = []
  hookRuntime.runningEffects = true
  for (const pending of effects) {
    const slot = hookRuntime.slots[pending.index]
    slot?.cleanup?.()
    if (slot) slot.cleanup = pending.effect() ?? undefined
  }
  hookRuntime.runningEffects = false
}

function simulateStrictModeRemount(): void {
  hookRuntime.runningEffects = true
  for (const slot of hookRuntime.slots) {
    if (slot.kind !== 'effect') continue
    slot.cleanup?.()
    const effect = slot.value
    slot.cleanup = typeof effect === 'function'
      ? (effect as () => void | (() => void))() ?? undefined
      : undefined
  }
  hookRuntime.runningEffects = false
  while (hookRuntime.pendingRender) {
    hookRuntime.pendingRender = false
    hookRuntime.render?.()
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(value => { resolve = value })
  return { promise, resolve }
}

function resetHookRuntime(): void {
  hookRuntime.index = 0
  hookRuntime.slots = []
  hookRuntime.pendingEffects = []
  hookRuntime.pendingRender = false
  hookRuntime.rendering = false
  hookRuntime.runningEffects = false
  hookRuntime.render = null
  hookRuntime.nullRefValue = null
}

const provider = { listAccounts: vi.fn(), sign: vi.fn() } as unknown as NimiqProvider
const challenge = {
  wallet: 'NQ00 NORMALIZED WALLET',
  challenge: 'challenge-1',
  blueprintId: 'blueprint-1',
  blueprintHash: 'a'.repeat(64),
  dayKey: '2026-09-09',
  expiresAt: '2026-09-09T12:05:00.000Z',
}
const signed = { payload: 'signed-payload', publicKey: 'public-key', signature: 'signature' }
const started = {
  runId: 'run-1',
  outcome: 'START_CREATED',
  attemptsRemaining: 2,
  blueprint: { mission: 'gem-runner' },
} as unknown as ProductStartResult

describe('actual product-start coordinator', () => {
  const initialize = vi.mocked(initializeNimiqProvider)
  const listAccounts = vi.mocked(listNimiqAccounts)
  const sign = vi.mocked(signNimiqMessage)
  const requestChallenge = vi.mocked(requestStartChallenge)
  const submitStart = vi.mocked(authorizeStart)

  beforeEach(() => {
    vi.clearAllMocks()
    resetHookRuntime()
    initialize.mockResolvedValue(provider)
    listAccounts.mockResolvedValue(['NQ00 FIRST ACCOUNT'])
    sign.mockResolvedValue(signed)
    requestChallenge.mockResolvedValue(challenge)
    submitStart.mockResolvedValue(started)
  })

  it('does not initialize Nimiq Pay until deliberate Start', async () => {
    const harness = createHookHarness(() => useProductStart())

    expect(harness.current.status).toBe('IDLE')
    expect(initialize).not.toHaveBeenCalled()
    expect(listAccounts).not.toHaveBeenCalled()
    expect(requestChallenge).not.toHaveBeenCalled()

    await settle()
    expect(initialize).not.toHaveBeenCalled()
  })

  it('requests accounts after StrictMode effect cleanup and leaves REQUESTING_ACCOUNT', async () => {
    const init = deferred<NimiqProvider>()
    initialize.mockReturnValueOnce(init.promise)
    const harness = createHookHarness(() => useProductStart())
    simulateStrictModeRemount()

    const begin = harness.current.begin('gem-runner')
    expect(harness.current.status).toBe('REQUESTING_ACCOUNT')
    expect(listAccounts).not.toHaveBeenCalled()
    expect(requestChallenge).not.toHaveBeenCalled()
    expect(submitStart).not.toHaveBeenCalled()

    init.resolve(provider)
    await begin
    await settle()

    expect(initialize).toHaveBeenCalledTimes(1)
    expect(listAccounts).toHaveBeenCalledTimes(1)
    expect(listAccounts).toHaveBeenCalledWith(provider)
    expect(harness.current.status).toBe('AWAITING_START_SIGNATURE')
    expect(requestChallenge).toHaveBeenCalledTimes(1)
    expect(submitStart).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('exits REQUESTING_ACCOUNT when provider init fails and keeps retry possible', async () => {
    initialize.mockRejectedValueOnce(createNimiqError('PROVIDER_INIT_FAILED'))
    const harness = createHookHarness(() => useProductStart())

    await harness.current.begin('gem-runner')
    await settle()

    expect(harness.current.status).toBe('PROOF_UNAVAILABLE')
    expect(harness.current.errorCode).toBe('NIMIQ_ERROR')
    expect(listAccounts).not.toHaveBeenCalled()
    expect(requestChallenge).not.toHaveBeenCalled()
    expect(submitStart).not.toHaveBeenCalled()

    harness.current.reset()
    expect(harness.current.status).toBe('IDLE')
    await harness.current.begin('gem-runner')
    await settle()

    expect(initialize).toHaveBeenCalledTimes(2)
    expect(listAccounts).toHaveBeenCalledTimes(1)
    expect(harness.current.status).toBe('AWAITING_START_SIGNATURE')
    expect(submitStart).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('exits REQUESTING_ACCOUNT when listAccounts fails without consuming an attempt', async () => {
    listAccounts.mockRejectedValueOnce(createNimiqError('UNKNOWN'))
    const harness = createHookHarness(() => useProductStart())

    await harness.current.begin('gem-runner')
    await settle()

    expect(harness.current.status).toBe('CANCELLED')
    expect(requestChallenge).not.toHaveBeenCalled()
    expect(submitStart).not.toHaveBeenCalled()
    expect(harness.current.normalizedWallet).toBeNull()

    harness.current.reset()
    expect(harness.current.status).toBe('IDLE')
    await harness.current.begin('gem-runner')
    await settle()

    expect(listAccounts).toHaveBeenCalledTimes(2)
    expect(harness.current.status).toBe('AWAITING_START_SIGNATURE')
    expect(submitStart).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('runs one deliberate start through exact account, challenge, authorization, and server success states', async () => {
    const onStarted = vi.fn()
    const harness = createHookHarness(() => useProductStart({ onStarted }))
    const begin = harness.current.begin('gem-runner')

    expect(harness.current.status).toBe('REQUESTING_ACCOUNT')
    expect(sign).not.toHaveBeenCalled()
    await begin
    await settle()

    expect(initialize).toHaveBeenCalledTimes(1)
    expect(listAccounts).toHaveBeenCalledTimes(1)
    expect(listAccounts).toHaveBeenCalledWith(provider)
    expect(requestChallenge).toHaveBeenCalledTimes(1)
    expect(requestChallenge).toHaveBeenCalledWith('NQ00 FIRST ACCOUNT', 'gem-runner')
    expect(harness.current).toMatchObject({
      status: 'AWAITING_START_SIGNATURE',
      selectedAccount: 'NQ00 FIRST ACCOUNT',
      normalizedWallet: 'NQ00 NORMALIZED WALLET',
    })
    expect(harness.current.canonicalPayload).toBe(`{
  "version": 1,
  "type": "NIMHUNT_START_EXPEDITION",
  "wallet": "NQ00 NORMALIZED WALLET",
  "mission": "gem-runner",
  "dayKey": "2026-09-09",
  "challenge": "challenge-1",
  "blueprintId": "blueprint-1",
  "blueprintHash": "${'a'.repeat(64)}"
}`)
    expect(sign).not.toHaveBeenCalled()
    expect(submitStart).not.toHaveBeenCalled()

    const serverStart = deferred<ProductStartResult>()
    submitStart.mockReturnValueOnce(serverStart.promise)
    await harness.current.authorize()

    expect(harness.current.status).toBe('SUBMITTING_START')
    expect(harness.current.start).toBeNull()
    serverStart.resolve(started)
    await settle()

    expect(sign).toHaveBeenCalledTimes(1)
    expect(sign).toHaveBeenCalledWith(provider, harness.current.canonicalPayload)
    expect(submitStart).toHaveBeenCalledTimes(1)
    expect(submitStart).toHaveBeenCalledWith({
      payload: harness.current.canonicalPayload,
      publicKey: signed.publicKey,
      signature: signed.signature,
    })
    expect(harness.current.status).toBe('STARTED')
    expect(harness.current.start).toBe(started)
    expect(onStarted).toHaveBeenCalledTimes(1)
    expect(onStarted).toHaveBeenCalledWith(started, 'NQ00 NORMALIZED WALLET')
  })

  it('cancels account access without requesting a challenge or starting a run', async () => {
    initialize.mockRejectedValueOnce(createNimiqError('ACCOUNT_CANCELLED'))
    const harness = createHookHarness(() => useProductStart())

    await harness.current.begin('gem-runner')
    await settle()

    expect(harness.current.status).toBe('CANCELLED')
    expect(requestChallenge).not.toHaveBeenCalled()
    expect(submitStart).not.toHaveBeenCalled()
    expect(harness.current.normalizedWallet).toBeNull()
  })

  it('treats an empty account result as a cancelled no-attempt path', async () => {
    listAccounts.mockRejectedValueOnce(createNimiqError('ACCOUNT_EMPTY'))
    const harness = createHookHarness(() => useProductStart())

    await harness.current.begin('gem-runner')
    await settle()

    expect(harness.current.status).toBe('CANCELLED')
    expect(harness.current.errorCode).toBeNull()
    expect(requestChallenge).not.toHaveBeenCalled()
    expect(submitStart).not.toHaveBeenCalled()
    expect(harness.current.selectedAccount).toBeNull()
    expect(harness.current.normalizedWallet).toBeNull()
  })

  it('cancels account selection without consuming an attempt', async () => {
    listAccounts.mockResolvedValueOnce(['NQ00 FIRST ACCOUNT', 'NQ00 SECOND ACCOUNT'])
    const harness = createHookHarness(() => useProductStart())

    await harness.current.begin('gem-runner')
    await settle()
    expect(harness.current.status).toBe('SELECTING_ACCOUNT')

    harness.current.cancel()
    await settle()

    expect(harness.current.status).toBe('CANCELLED')
    expect(requestChallenge).not.toHaveBeenCalled()
    expect(submitStart).not.toHaveBeenCalled()
  })

  it('cancels a signature request and gets a fresh challenge on explicit retry', async () => {
    requestChallenge
      .mockResolvedValueOnce(challenge)
      .mockResolvedValueOnce({ ...challenge, challenge: 'challenge-2' })
    sign.mockRejectedValueOnce(createNimiqError('SIGN_CANCELLED'))
    const harness = createHookHarness(() => useProductStart())

    await harness.current.begin('gem-runner')
    await settle()
    await harness.current.authorize()
    await settle()

    expect(harness.current.status).toBe('CANCELLED')
    expect(submitStart).not.toHaveBeenCalled()
    expect(harness.current.signed).toBeNull()
    expect(harness.current.challenge).toBeNull()
    expect(harness.current.canonicalPayload).toBeNull()
    expect(harness.current.selectedAccount).toBeNull()

    harness.current.reset()
    expect(harness.current.status).toBe('IDLE')
    await harness.current.begin('gem-runner')
    await settle()

    expect(requestChallenge).toHaveBeenCalledTimes(2)
    expect(listAccounts).toHaveBeenCalledTimes(2)
    expect(harness.current.status).toBe('AWAITING_START_SIGNATURE')
    expect(harness.current.challenge?.challenge).toBe('challenge-2')
    expect(submitStart).not.toHaveBeenCalled()
  })

  it('requires an explicit account choice and keeps it fixed through signing', async () => {
    listAccounts.mockResolvedValueOnce(['NQ00 FIRST ACCOUNT', 'NQ00 SECOND ACCOUNT'])
    requestChallenge.mockResolvedValueOnce({ ...challenge, wallet: 'NQ00 SECOND NORMALIZED' })
    const harness = createHookHarness(() => useProductStart())

    await harness.current.begin('gem-runner')
    await settle()
    expect(harness.current.status).toBe('SELECTING_ACCOUNT')
    expect(requestChallenge).not.toHaveBeenCalled()

    harness.current.selectAccount('NQ00 SECOND ACCOUNT')
    await settle()
    harness.current.selectAccount('NQ00 FIRST ACCOUNT')
    await settle()

    expect(requestChallenge).toHaveBeenCalledTimes(1)
    expect(requestChallenge).toHaveBeenCalledWith('NQ00 SECOND ACCOUNT', 'gem-runner')
    expect(harness.current).toMatchObject({
      status: 'AWAITING_START_SIGNATURE',
      selectedAccount: 'NQ00 SECOND ACCOUNT',
      normalizedWallet: 'NQ00 SECOND NORMALIZED',
    })

    await harness.current.authorize()
    await settle()

    expect(listAccounts).toHaveBeenCalledTimes(1)
    expect(sign).toHaveBeenCalledWith(provider, expect.stringContaining('NQ00 SECOND NORMALIZED'))
    expect(submitStart).toHaveBeenCalledTimes(1)
  })

  it('reaches AWAITING_START_SIGNATURE from a real start-challenge response shape', async () => {
    const { requestStartChallenge: actualRequestStartChallenge } = await vi.importActual<typeof import('../../api/expeditionProof.ts')>('../../api/expeditionProof.ts')
    const body = {
      ok: true,
      wallet: 'NQ00 SECOND NORMALIZED',
      challenge: 'challenge-1',
      blueprintId: 'blueprint-1',
      blueprintHash: 'a'.repeat(64),
      dayKey: '2026-09-09',
      expiresAt: '2026-09-09T12:05:00.000Z',
    }
    listAccounts.mockResolvedValueOnce(['NQ00 FIRST ACCOUNT', 'NQ00 SECOND ACCOUNT'])
    requestChallenge.mockImplementation((wallet, mission) => actualRequestStartChallenge(wallet, mission, async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null },
      json: async () => body,
    } as unknown as Response)))
    const harness = createHookHarness(() => useProductStart())

    await harness.current.begin('gem-runner')
    await settle()
    expect(harness.current.status).toBe('SELECTING_ACCOUNT')
    expect(requestChallenge).not.toHaveBeenCalled()

    harness.current.selectAccount('NQ00 SECOND ACCOUNT')
    await settle()

    expect(requestChallenge).toHaveBeenCalledWith('NQ00 SECOND ACCOUNT', 'gem-runner')
    expect(harness.current.status).toBe('AWAITING_START_SIGNATURE')
    expect(harness.current.canonicalPayload).toContain('NIMHUNT_START_EXPEDITION')
    expect(harness.current.canonicalPayload).toContain('"blueprintHash": "' + 'a'.repeat(64) + '"')
    expect(harness.current.normalizedWallet).toBe('NQ00 SECOND NORMALIZED')
    expect(submitStart).not.toHaveBeenCalled()
    expect(sign).not.toHaveBeenCalled()
  })

  it('preserves INVALID_WALLET from a start-challenge error envelope', async () => {
    const { requestStartChallenge: actualRequestStartChallenge } = await vi.importActual<typeof import('../../api/expeditionProof.ts')>('../../api/expeditionProof.ts')
    listAccounts.mockResolvedValueOnce(['NQ00 FIRST ACCOUNT', 'NQ00 SECOND ACCOUNT'])
    requestChallenge.mockImplementation((wallet, mission) => actualRequestStartChallenge(wallet, mission, async () => ({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json; charset=utf-8' },
      json: async () => ({ ok: false, error: 'INVALID_WALLET' }),
    } as unknown as Response)))
    const harness = createHookHarness(() => useProductStart())

    await harness.current.begin('gem-runner')
    await settle()
    harness.current.selectAccount('NQ00 SECOND ACCOUNT')
    await settle()

    expect(harness.current.status).toBe('REJECTED')
    expect(harness.current.errorCode).toBe('INVALID_WALLET')
    expect(submitStart).not.toHaveBeenCalled()
    expect(sign).not.toHaveBeenCalled()
  })

  it('keeps extra start-challenge fields fail-closed as MALFORMED_RESPONSE', async () => {
    const { requestStartChallenge: actualRequestStartChallenge } = await vi.importActual<typeof import('../../api/expeditionProof.ts')>('../../api/expeditionProof.ts')
    listAccounts.mockResolvedValueOnce(['NQ00 FIRST ACCOUNT', 'NQ00 SECOND ACCOUNT'])
    requestChallenge.mockImplementation((wallet, mission) => actualRequestStartChallenge(wallet, mission, async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json; charset=utf-8' },
      json: async () => ({
        ok: true,
        wallet: 'NQ00 SECOND NORMALIZED',
        challenge: 'challenge-1',
        blueprintId: 'blueprint-1',
        blueprintHash: 'a'.repeat(64),
        dayKey: '2026-09-09',
        expiresAt: '2026-09-09T12:05:00.000Z',
        mission: 'gem-runner',
      }),
    } as unknown as Response)))
    const harness = createHookHarness(() => useProductStart())

    await harness.current.begin('gem-runner')
    await settle()
    harness.current.selectAccount('NQ00 SECOND ACCOUNT')
    await settle()

    expect(harness.current.status).toBe('PROOF_UNAVAILABLE')
    expect(harness.current.errorCode).toBe('MALFORMED_RESPONSE')
    expect(harness.current.canonicalPayload).toBeNull()
    expect(submitStart).not.toHaveBeenCalled()
  })

  it.each(['START_CHALLENGE_INVALID', 'START_CHALLENGE_EXPIRED'] as const)(
    'maps %s to rejection without entering lost-response recovery',
    async code => {
      requestChallenge.mockRejectedValueOnce(new ExpeditionProofApiError(code))
      const harness = createHookHarness(() => useProductStart())

      await harness.current.begin('gem-runner')
      await settle()

      expect(harness.current.status).toBe('REJECTED')
      expect(submitStart).not.toHaveBeenCalled()
      expect(sign).not.toHaveBeenCalled()
    },
  )

  it('retries a lost start response with the exact signed request and accepts START_ALREADY_CREATED', async () => {
    const alreadyStarted = { ...started, outcome: 'START_ALREADY_CREATED' as const }
    let consumedAttempts = 0
    submitStart
      .mockImplementationOnce(async () => {
        consumedAttempts += 1
        throw new ExpeditionProofApiError('NETWORK_ERROR')
      })
      .mockImplementationOnce(async () => alreadyStarted)
    const harness = createHookHarness(() => useProductStart())

    await harness.current.begin('gem-runner')
    await settle()
    await harness.current.authorize()
    await settle()

    expect(harness.current.status).toBe('RECOVERING_START')
    expect(submitStart).toHaveBeenCalledTimes(1)
    expect(sign).toHaveBeenCalledTimes(1)

    await harness.current.retryStart()
    await settle()

    expect(submitStart).toHaveBeenCalledTimes(2)
    expect(submitStart.mock.calls[1]?.[0]).toEqual(submitStart.mock.calls[0]?.[0])
    expect(requestChallenge).toHaveBeenCalledTimes(1)
    expect(listAccounts).toHaveBeenCalledTimes(1)
    expect(sign).toHaveBeenCalledTimes(1)
    expect(harness.current.status).toBe('STARTED')
    expect(harness.current.start).toBe(alreadyStarted)
    expect(alreadyStarted.attemptsRemaining).toBe(2)
    expect(consumedAttempts).toBe(1)
  })
})

function createActiveExpedition(): ProductActiveExpedition {
  const source = createRoom01Blueprint('2026-09-09', 'gem-runner', 'active-blueprint')
  const blueprint = { ...source, status: 'PUBLISHED' as const, blueprintHash: 'b'.repeat(64) }
  const state = createInitialRun({
    mission: blueprint.mission,
    rulesVersion: blueprint.rulesVersion,
    roomVersion: blueprint.roomVersion,
    blueprint,
  })
  return {
    runId: 'run-1',
    dayKey: '2026-09-09',
    mission: 'gem-runner',
    status: 'STARTED',
    startedAt: '2026-09-09T12:00:00.000Z',
    expiresAt: '2026-09-10T00:00:00.000Z',
    gameplayStartedAt: null,
    rulesVersion: blueprint.rulesVersion,
    roomVersion: blueprint.roomVersion,
    blueprintVersion: blueprint.blueprintVersion,
    blueprintId: blueprint.blueprintId,
    blueprintHash: blueprint.blueprintHash,
    blueprint,
    state,
    checkpoint: {
      version: 1,
      runId: 'run-1',
      runChallenge: 'run-challenge',
      seq: 0,
      previousCheckpointHash: null,
      stateHash: 'c'.repeat(64),
      transcriptHash: 'd'.repeat(64),
      checkpointHash: 'e'.repeat(64),
    },
  }
}

function createFakeGame(): NimHuntGameInstance {
  return {
    game: {} as NimHuntGameInstance['game'],
    move: vi.fn(),
    reset: vi.fn(),
    getState: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    destroy: vi.fn(),
  }
}

function ProductGameProbe({ active }: { readonly active: ProductActiveExpedition }): null {
  const options = useMemo(() => ({
    mode: 'product' as const,
    mission: active.mission,
    blueprint: active.blueprint,
    initialState: active.state,
  }), [active])
  useAngkorRun(options)
  return null
}

function PlayShellWalletProbe() {
  return {
    shell: PlayShell({}),
  }
}

function findButton(value: unknown): { readonly onClick?: () => void } | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const button = findButton(child)
      if (button) return button
    }
    return null
  }
  if (!isRecord(value) || !isRecord(value.props)) return null
  if (value.type === 'button') return value.props as { readonly onClick?: () => void }
  return findButton(value.props.children)
}

function findPropsWith(value: unknown, property: string): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const props = findPropsWith(child, property)
      if (props) return props
    }
    return null
  }
  if (!isRecord(value) || !isRecord(value.props)) return null
  if (property in value.props) return value.props
  return findPropsWith(value.props.children, property)
}

function collectText(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectText)
  if (!isRecord(value) || !isRecord(value.props)) return []
  return collectText(value.props.children)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

describe('actual authenticated gate, game lifecycle, and Practice route', () => {
  const initialize = vi.mocked(initializeNimiqProvider)
  const listAccounts = vi.mocked(listNimiqAccounts)
  const sign = vi.mocked(signNimiqMessage)
  const requestChallenge = vi.mocked(requestStartChallenge)
  const fetchActive = vi.mocked(fetchActiveExpedition)
  const gameplayStart = vi.mocked(markGameplayStarted)
  const checkpoint = vi.mocked(submitCheckpoint)
  const createGame = vi.mocked(createNimHuntGame)
  const productStart = vi.mocked(authorizeStart)
  const submitStart = vi.mocked(authorizeStart)
  const fetchPublicStatus = vi.mocked(fetchDailyHuntStatus)
  const fetchWalletStatus = vi.mocked(fetchWalletDailyStatus)

  beforeEach(() => {
    vi.clearAllMocks()
    resetHookRuntime()
    clearRememberedProductWallet()
    initialize.mockResolvedValue(provider)
    listAccounts.mockResolvedValue(['NQ00 FIRST ACCOUNT'])
    sign.mockResolvedValue(signed)
    requestChallenge.mockResolvedValue(challenge)
    submitStart.mockResolvedValue(started)
    fetchPublicStatus.mockResolvedValue({ kind: 'live', status: {
      totalSlots: 69,
      reservedSlots: 0,
      remainingSlots: 69,
      dayKey: '2026-09-09',
      nextResetAt: '2026-09-10T00:00:00.000Z',
    } })
    hookRuntime.nullRefValue = {
      replaceChildren: vi.fn(),
      showModal: vi.fn(),
      close: vi.fn(),
      open: false,
    }
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      callback()
      return 0
    })
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval: vi.fn(),
      clearInterval: vi.fn(),
    })
  })

  it('keeps /play and opening a mission brief wallet-free until Start is pressed', async () => {
    const harness = createHookHarness(() => PlayShell({}))
    const missionListProps = findPropsWith(harness.current, 'onEnter')
    expect(missionListProps).not.toBeNull()
    const openMission = missionListProps?.onEnter
    if (typeof openMission !== 'function') throw new Error('MISSION_LIST_START_HANDLER_MISSING')
    openMission(playMissions[0]!, { } as HTMLButtonElement)
    await settle()

    expect(initializeNimiqProvider).not.toHaveBeenCalled()
    expect(listNimiqAccounts).not.toHaveBeenCalled()
    expect(requestStartChallenge).not.toHaveBeenCalled()
    expect(authorizeStart).not.toHaveBeenCalled()
    expect(fetchWalletStatus).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('fetches active then gameplay-start once and mounts one Phaser instance across rerenders', async () => {
    const active = createActiveExpedition()
    const game = createFakeGame()
    fetchActive.mockResolvedValue(active)
    gameplayStart.mockResolvedValue({ runId: active.runId, outcome: 'GAMEPLAY_STARTED' })
    createGame.mockReturnValue(game)

    const harness = createHookHarness(() => ProductExpeditionGate({
      mission: 'gem-runner',
      runId: active.runId,
      onBackToMissions: vi.fn(),
      children: value => ProductGameProbe({ active: value }),
    }))
    harness.rerender()
    harness.rerender()
    await settle()

    expect(fetchActive).toHaveBeenCalledTimes(1)
    expect(fetchActive).toHaveBeenCalledWith(active.runId)
    expect(gameplayStart).toHaveBeenCalledTimes(1)
    expect(gameplayStart).toHaveBeenCalledWith(active.runId)
    expect(createGame).toHaveBeenCalledTimes(1)
    expect(createGame).toHaveBeenCalledWith(hookRuntime.nullRefValue, {
      mode: 'product',
      mission: 'gem-runner',
      blueprint: active.blueprint,
      initialState: active.state,
    })

    harness.rerender()
    harness.rerender()
    await settle()

    expect(fetchActive).toHaveBeenCalledTimes(1)
    expect(gameplayStart).toHaveBeenCalledTimes(1)
    expect(createGame).toHaveBeenCalledTimes(1)

    harness.unmount()
    expect(game.destroy).toHaveBeenCalledTimes(1)
  })

  it('keeps one product Phaser instance when checkpoint proof is wired and sends no traffic before moves', async () => {
    const active = createActiveExpedition()
    const game = createFakeGame()
    createGame.mockReturnValue(game)
    const harness = createHookHarness(() => ExpeditionView({
      mode: 'product',
      mission: 'gem-runner',
      active,
      onBackToMissions: vi.fn(),
      onReturnToHunt: vi.fn(),
    }))
    harness.rerender()
    await settle()

    expect(createGame).toHaveBeenCalledTimes(1)
    expect(createGame.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      mode: 'product',
      mission: 'gem-runner',
      blueprint: active.blueprint,
      initialState: active.state,
      proof: expect.objectContaining({
        canAcceptMove: expect.any(Function),
        recordAcceptedMove: expect.any(Function),
        notifyGameplayEvent: expect.any(Function),
      }),
    }))
    expect(checkpoint).not.toHaveBeenCalled()
    harness.rerender()
    await settle()
    expect(createGame).toHaveBeenCalledTimes(1)
    harness.unmount()
    expect(game.destroy).toHaveBeenCalledTimes(1)
  })

  it('retries lost gameplay-start with the same run and mounts from retained active data', async () => {
    const active = createActiveExpedition()
    const game = createFakeGame()
    fetchActive.mockResolvedValue(active)
    gameplayStart
      .mockRejectedValueOnce(new ExpeditionProofApiError('NETWORK_ERROR'))
      .mockResolvedValueOnce({ runId: active.runId, outcome: 'GAMEPLAY_ALREADY_STARTED' })
    createGame.mockReturnValue(game)

    const harness = createHookHarness(() => ProductExpeditionGate({
      mission: 'gem-runner',
      runId: active.runId,
      onBackToMissions: vi.fn(),
      children: value => ProductGameProbe({ active: value }),
    }))
    await settle()

    expect(createGame).not.toHaveBeenCalled()
    const retry = findButton(harness.current)
    expect(retry).not.toBeNull()
    retry?.onClick?.()
    await settle()

    expect(fetchActive).toHaveBeenCalledTimes(1)
    expect(gameplayStart).toHaveBeenCalledTimes(2)
    expect(gameplayStart.mock.calls).toEqual([[active.runId], [active.runId]])
    expect(createGame).toHaveBeenCalledTimes(1)

    harness.rerender()
    expect(createGame).toHaveBeenCalledTimes(1)
    harness.unmount()
    expect(game.destroy).toHaveBeenCalledTimes(1)
  })

  it('does not remount after a fresh active lookup reports gameplay already started', async () => {
    const active = createActiveExpedition()
    fetchActive.mockRejectedValueOnce(new ExpeditionProofApiError('ACTIVE_RUN_UNAVAILABLE'))

    const harness = createHookHarness(() => ProductExpeditionGate({
      mission: 'gem-runner',
      runId: active.runId,
      onBackToMissions: vi.fn(),
      children: value => ProductGameProbe({ active: value }),
    }))
    await settle()

    expect(fetchActive).toHaveBeenCalledTimes(1)
    expect(gameplayStart).not.toHaveBeenCalled()
    expect(createGame).not.toHaveBeenCalled()
    expect(collectText(harness.current).join(' ')).toContain('no longer ready to enter')
  })

  it('fails closed when a fresh active response carries the gameplay-start marker', async () => {
    const active = { ...createActiveExpedition(), gameplayStartedAt: '2026-09-09T12:01:00.000Z' }
    fetchActive.mockResolvedValueOnce(active)

    const harness = createHookHarness(() => ProductExpeditionGate({
      mission: 'gem-runner',
      runId: active.runId,
      onBackToMissions: vi.fn(),
      children: value => ProductGameProbe({ active: value }),
    }))
    await settle()

    expect(fetchActive).toHaveBeenCalledTimes(1)
    expect(gameplayStart).not.toHaveBeenCalled()
    expect(createGame).not.toHaveBeenCalled()
    expect(collectText(harness.current).join(' ')).toContain('no longer ready to enter')
  })

  it('keeps Practice local and proof-free while mounting the local game', async () => {
    const game = createFakeGame()
    createGame.mockReturnValue(game)
    fetchPublicStatus.mockResolvedValue({ kind: 'live', status: {
      totalSlots: 69,
      reservedSlots: 0,
      remainingSlots: 69,
      dayKey: '2026-09-09',
      nextResetAt: '2026-09-10T00:00:00.000Z',
    } })
    fetchWalletStatus.mockResolvedValue(null)

    expect(resolvePlayRoute({ dev: null, run: null, runId: null, practice: 'gem-runner', mission: null })).toEqual({
      view: 'practice',
      mission: 'gem-runner',
    })
    const harness = createHookHarness(() => ExpeditionView({
      mode: 'practice',
      mission: 'gem-runner',
      onBackToMissions: vi.fn(),
      onReturnToHunt: vi.fn(),
    }))
    await settle()

    expect(createGame).toHaveBeenCalledTimes(1)
    expect(createGame).toHaveBeenCalledWith(hookRuntime.nullRefValue, { mode: 'dev', mission: 'gem-runner' })
    expect(fetchActive).not.toHaveBeenCalled()
    expect(gameplayStart).not.toHaveBeenCalled()
    expect(requestStartChallenge).not.toHaveBeenCalled()
    expect(productStart).not.toHaveBeenCalled()
    expect(fetchPublicStatus).not.toHaveBeenCalled()
    expect(fetchWalletStatus).not.toHaveBeenCalled()
    expect(checkpoint).not.toHaveBeenCalled()
    expect(collectText(harness.current).join(' ')).toContain('PRACTICE RUN')
    expect(collectText(harness.current).join(' ')).toContain('No daily expedition used.')
    expect(collectText(harness.current).join(' ')).toContain('No NIM reward can be reserved.')
    harness.unmount()
    expect(game.destroy).toHaveBeenCalledTimes(1)
  })

  it('keeps a second Practice mission local and proof-free', async () => {
    const game = createFakeGame()
    createGame.mockReturnValue(game)

    expect(resolvePlayRoute({ dev: null, run: null, runId: null, practice: 'chest-hunter', mission: null })).toEqual({
      view: 'practice',
      mission: 'chest-hunter',
    })
    const harness = createHookHarness(() => ExpeditionView({
      mode: 'practice',
      mission: 'chest-hunter',
      onBackToMissions: vi.fn(),
      onReturnToHunt: vi.fn(),
    }))
    await settle()

    expect(createGame).toHaveBeenCalledTimes(1)
    expect(createGame).toHaveBeenCalledWith(hookRuntime.nullRefValue, { mode: 'dev', mission: 'chest-hunter' })
    expect(fetchActive).not.toHaveBeenCalled()
    expect(gameplayStart).not.toHaveBeenCalled()
    expect(requestStartChallenge).not.toHaveBeenCalled()
    expect(productStart).not.toHaveBeenCalled()
    expect(fetchPublicStatus).not.toHaveBeenCalled()
    expect(fetchWalletStatus).not.toHaveBeenCalled()
    expect(checkpoint).not.toHaveBeenCalled()
    expect(collectText(harness.current).join(' ')).toContain('PRACTICE RUN')
    harness.unmount()
    expect(game.destroy).toHaveBeenCalledTimes(1)
  })

  it('does not refresh wallet attempts when the real PlayShell start is cancelled', async () => {
    initialize.mockRejectedValueOnce(createNimiqError('ACCOUNT_CANCELLED'))
    hookRuntime.nullRefValue = null
    fetchPublicStatus.mockResolvedValue({ kind: 'live', status: {
      totalSlots: 69,
      reservedSlots: 0,
      remainingSlots: 69,
      dayKey: '2026-09-09',
      nextResetAt: '2026-09-10T00:00:00.000Z',
    } })

    const harness = createHookHarness(() => PlayShellWalletProbe())
    const missionListProps = findPropsWith(harness.current.shell, 'onEnter')
    if (typeof missionListProps?.onEnter !== 'function') throw new Error('MISSION_LIST_START_HANDLER_MISSING')
    const briefProps = findPropsWith(harness.current.shell, 'onStartExpedition')
    if (briefProps) throw new Error('MISSION_BRIEF_SHOULD_NOT_BE_OPEN')
    missionListProps.onEnter(playMissions[0]!, {} as HTMLButtonElement)
    await settle()

    const openedBrief = findPropsWith(harness.current.shell, 'onStartExpedition')
    const productStart = openedBrief?.productStart
    if (!isRecord(productStart) || typeof productStart.begin !== 'function') throw new Error('PRODUCT_START_HANDLER_MISSING')
    productStart.begin('gem-runner')
    await settle()

    expect(initialize).toHaveBeenCalledTimes(1)
    expect(fetchWalletStatus).not.toHaveBeenCalled()
    const cancelledBrief = findPropsWith(harness.current.shell, 'onStartExpedition')
    expect(cancelledBrief?.productStart).toMatchObject({ status: 'CANCELLED' })
    harness.unmount()
  })

  it('does not refresh wallet attempts when the real PlayShell start is rejected', async () => {
    hookRuntime.nullRefValue = null
    requestChallenge.mockRejectedValueOnce(new ExpeditionProofApiError('START_CHALLENGE_EXPIRED'))
    fetchPublicStatus.mockResolvedValue({ kind: 'live', status: {
      totalSlots: 69,
      reservedSlots: 0,
      remainingSlots: 69,
      dayKey: '2026-09-09',
      nextResetAt: '2026-09-10T00:00:00.000Z',
    } })

    const harness = createHookHarness(() => PlayShellWalletProbe())
    const missionListProps = findPropsWith(harness.current.shell, 'onEnter')
    if (typeof missionListProps?.onEnter !== 'function') throw new Error('MISSION_LIST_START_HANDLER_MISSING')
    missionListProps.onEnter(playMissions[0]!, {} as HTMLButtonElement)
    await settle()

    const openedBrief = findPropsWith(harness.current.shell, 'onStartExpedition')
    const productStart = openedBrief?.productStart
    if (!isRecord(productStart) || typeof productStart.begin !== 'function') throw new Error('PRODUCT_START_HANDLER_MISSING')
    productStart.begin('gem-runner')
    await settle()

    const rejectedBrief = findPropsWith(harness.current.shell, 'onStartExpedition')
    expect(rejectedBrief?.productStart).toMatchObject({ status: 'REJECTED', errorCode: 'START_CHALLENGE_EXPIRED' })
    expect(fetchWalletStatus).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('refreshes authoritative wallet attempts only after the real PlayShell start succeeds', async () => {
    hookRuntime.nullRefValue = null
    fetchPublicStatus.mockResolvedValue({ kind: 'live', status: {
      totalSlots: 69,
      reservedSlots: 0,
      remainingSlots: 69,
      dayKey: '2026-09-09',
      nextResetAt: '2026-09-10T00:00:00.000Z',
    } })
    fetchWalletStatus.mockResolvedValue({
      dayKey: '2026-09-09',
      expeditionsStarted: 1,
      expeditionsRemaining: 2,
      rewardAlreadyReserved: false,
      nextResetAt: '2026-09-10T00:00:00.000Z',
    })

    const harness = createHookHarness(() => PlayShellWalletProbe())
    await settle()
    expect(fetchWalletStatus).not.toHaveBeenCalled()

    const missionListProps = findPropsWith(harness.current.shell, 'onEnter')
    if (typeof missionListProps?.onEnter !== 'function') throw new Error('MISSION_LIST_START_HANDLER_MISSING')
    missionListProps.onEnter(playMissions[0]!, {} as HTMLButtonElement)
    await settle()

    const openedBrief = findPropsWith(harness.current.shell, 'onStartExpedition')
    const startModel = openedBrief?.productStart
    if (!isRecord(startModel) || typeof startModel.begin !== 'function') throw new Error('PRODUCT_START_HANDLER_MISSING')
    startModel.begin('gem-runner')
    await settle()

    const awaitingBrief = findPropsWith(harness.current.shell, 'onStartExpedition')
    const productStart = awaitingBrief?.productStart
    if (!isRecord(productStart) || typeof productStart.authorize !== 'function') throw new Error('PRODUCT_AUTHORIZE_HANDLER_MISSING')
    expect(productStart).toMatchObject({ status: 'AWAITING_START_SIGNATURE' })
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(listAccounts).toHaveBeenCalledTimes(1)
    expect(requestChallenge).toHaveBeenCalledTimes(1)
    productStart.authorize()
    await settle()

    expect(submitStart).toHaveBeenCalledTimes(1)
    expect(getRememberedProductWallet()).toBe('NQ00 NORMALIZED WALLET')
    expect(fetchWalletStatus).toHaveBeenCalledTimes(1)
    expect(fetchWalletStatus).toHaveBeenCalledWith('NQ00 NORMALIZED WALLET')
    expect(resolveHuntStatusView({
      kind: 'live',
      remainingSlots: 69,
      totalSlots: 69,
      nextResetAt: '2026-09-10T00:00:00.000Z',
      walletStatus: {
        dayKey: '2026-09-09',
        expeditionsStarted: 1,
        expeditionsRemaining: 2,
        rewardAlreadyReserved: false,
        nextResetAt: '2026-09-10T00:00:00.000Z',
      },
    }, playFixture).expeditionsRemaining).toBe('2')
    const huntStatus = findPropsWith(harness.current.shell, 'hunt')
    expect(huntStatus?.hunt).toMatchObject({
      walletStatus: { expeditionsStarted: 1, expeditionsRemaining: 2 },
    })
    const missionList = findPropsWith(harness.current.shell, 'expeditionsLeftToday')
    expect(missionList?.expeditionsLeftToday).toBe('2 EXPEDITIONS LEFT TODAY')
    harness.unmount()
  })
})

describe('wallet daily-status refresh lifecycle', () => {
  const initialize = vi.mocked(initializeNimiqProvider)
  const fetchPublicStatus = vi.mocked(fetchDailyHuntStatus)
  const fetchWalletStatus = vi.mocked(fetchWalletDailyStatus)

  beforeEach(() => {
    vi.clearAllMocks()
    resetHookRuntime()
    clearRememberedProductWallet()
    hookRuntime.nullRefValue = null
    fetchPublicStatus.mockResolvedValue({ kind: 'live', status: {
      totalSlots: 69,
      reservedSlots: 0,
      remainingSlots: 69,
      dayKey: '2026-09-09',
      nextResetAt: '2026-09-10T00:00:00.000Z',
    } })
  })

  it('keeps attempts unknown before a wallet is known and uses authoritative status after success', async () => {
    const beforeWallet = createHookHarness(() => useDailyHuntStatus(null))
    await settle()

    const beforeView = resolveHuntStatusView(beforeWallet.current, playFixture)
    expect(beforeView.expeditionsRemaining).toBe('—')
    expect(beforeView.expeditionsLabel).toBe('wallet required')
    expect(fetchWalletStatus).not.toHaveBeenCalled()
    beforeWallet.unmount()

    fetchWalletStatus.mockResolvedValue({
      dayKey: '2026-09-09',
      expeditionsStarted: 1,
      expeditionsRemaining: 2,
      rewardAlreadyReserved: false,
      nextResetAt: '2026-09-10T00:00:00.000Z',
    })
    const afterWallet = createHookHarness(() => useDailyHuntStatus('NQ00 NORMALIZED WALLET'))
    await settle()

    expect(fetchWalletStatus).toHaveBeenCalledTimes(1)
    expect(fetchWalletStatus).toHaveBeenCalledWith('NQ00 NORMALIZED WALLET')
    expect(afterWallet.current.walletStatus).toMatchObject({ expeditionsStarted: 1, expeditionsRemaining: 2 })
    expect(resolveHuntStatusView(afterWallet.current, playFixture).expeditionsRemaining).toBe('2')
    afterWallet.unmount()
  })

  it('does not refresh wallet attempts for a cancelled product start', async () => {
    initialize.mockRejectedValueOnce(createNimiqError('ACCOUNT_CANCELLED'))
    const started = vi.fn()
    const harness = createHookHarness(() => useProductStart({ onStarted: started }))

    await harness.current.begin('gem-runner')
    await settle()

    expect(harness.current.status).toBe('CANCELLED')
    expect(started).not.toHaveBeenCalled()
    expect(fetchWalletStatus).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('refreshes wallet daily status when returning to /play with remembered wallet', async () => {
    hookRuntime.nullRefValue = {
      replaceChildren: vi.fn(),
      showModal: vi.fn(),
      close: vi.fn(),
      open: false,
    }
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      callback()
      return 0
    })
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval: vi.fn(),
      clearInterval: vi.fn(),
    })
    rememberProductWallet('NQ00 NORMALIZED WALLET')
    fetchWalletStatus.mockResolvedValue({
      dayKey: '2026-09-09',
      expeditionsStarted: 1,
      expeditionsRemaining: 2,
      rewardAlreadyReserved: false,
      nextResetAt: '2026-09-10T00:00:00.000Z',
    })

    const first = createHookHarness(() => PlayShell({}))
    await settle()
    expect(fetchWalletStatus).toHaveBeenCalledTimes(1)
    expect(fetchWalletStatus).toHaveBeenCalledWith('NQ00 NORMALIZED WALLET')
    expect(initialize).not.toHaveBeenCalled()
    first.unmount()

    resetHookRuntime()
    hookRuntime.nullRefValue = {
      replaceChildren: vi.fn(),
      showModal: vi.fn(),
      close: vi.fn(),
      open: false,
    }
    const returned = createHookHarness(() => PlayShell({ initialTab: 'missions' }))
    await settle()

    expect(fetchWalletStatus).toHaveBeenCalledTimes(2)
    expect(fetchWalletStatus).toHaveBeenLastCalledWith('NQ00 NORMALIZED WALLET')
    expect(initialize).not.toHaveBeenCalled()
    const huntStatus = findPropsWith(returned.current, 'hunt')
    expect(huntStatus?.hunt).toMatchObject({
      walletStatus: { expeditionsStarted: 1, expeditionsRemaining: 2 },
    })
    const missionList = findPropsWith(returned.current, 'expeditionsLeftToday')
    expect(missionList?.expeditionsLeftToday).toBe('2 EXPEDITIONS LEFT TODAY')
    expect(missionList?.missions).toEqual(playMissions)
    returned.unmount()
  })

  it('does not decrement attempts a second time after returning from a finished run', async () => {
    hookRuntime.nullRefValue = {
      replaceChildren: vi.fn(),
      showModal: vi.fn(),
      close: vi.fn(),
      open: false,
    }
    rememberProductWallet('NQ00 NORMALIZED WALLET')
    fetchWalletStatus.mockResolvedValue({
      dayKey: '2026-09-09',
      expeditionsStarted: 1,
      expeditionsRemaining: 2,
      rewardAlreadyReserved: false,
      nextResetAt: '2026-09-10T00:00:00.000Z',
    })

    const afterComplete = createHookHarness(() => PlayShell({ initialTab: 'missions' }))
    await settle()
    expect(findPropsWith(afterComplete.current, 'expeditionsLeftToday')?.expeditionsLeftToday).toBe('2 EXPEDITIONS LEFT TODAY')
    expect(fetchWalletStatus).toHaveBeenCalledTimes(1)
    afterComplete.unmount()

    resetHookRuntime()
    hookRuntime.nullRefValue = {
      replaceChildren: vi.fn(),
      showModal: vi.fn(),
      close: vi.fn(),
      open: false,
    }
    fetchWalletStatus.mockResolvedValue({
      dayKey: '2026-09-09',
      expeditionsStarted: 1,
      expeditionsRemaining: 2,
      rewardAlreadyReserved: false,
      nextResetAt: '2026-09-10T00:00:00.000Z',
    })
    const afterPractice = createHookHarness(() => PlayShell({}))
    await settle()
    expect(fetchWalletStatus).toHaveBeenCalledTimes(2)
    expect(findPropsWith(afterPractice.current, 'expeditionsLeftToday')?.expeditionsLeftToday).toBe('2 EXPEDITIONS LEFT TODAY')
    afterPractice.unmount()
  })

  it('shows zero remaining after three starts without changing mission cards', async () => {
    hookRuntime.nullRefValue = {
      replaceChildren: vi.fn(),
      showModal: vi.fn(),
      close: vi.fn(),
      open: false,
    }
    rememberProductWallet('NQ00 NORMALIZED WALLET')
    fetchWalletStatus.mockResolvedValue({
      dayKey: '2026-09-09',
      expeditionsStarted: 3,
      expeditionsRemaining: 0,
      rewardAlreadyReserved: false,
      nextResetAt: '2026-09-10T00:00:00.000Z',
    })

    const harness = createHookHarness(() => PlayShell({ initialTab: 'missions' }))
    await settle()
    expect(findPropsWith(harness.current, 'expeditionsLeftToday')?.expeditionsLeftToday).toBe('0 EXPEDITIONS LEFT TODAY')
    expect(findPropsWith(harness.current, 'missions')?.missions).toEqual(playMissions)
    harness.unmount()
  })
})
