import { describe, expect, it } from 'vitest'
import {
  INITIAL_PLAY_WALLET_BOOTSTRAP,
  PLAY_WALLET_BOOTSTRAP_COPY,
  reducePlayWalletBootstrap,
} from './playWalletBootstrap.ts'

describe('play wallet bootstrap state', () => {
  it('connects a single approved account without starting an expedition', () => {
    const connecting = reducePlayWalletBootstrap(INITIAL_PLAY_WALLET_BOOTSTRAP, { type: 'CONNECT_START' })
    const connected = reducePlayWalletBootstrap(connecting, {
      type: 'ACCOUNTS_RECEIVED',
      accounts: ['NQ00 FIRST ACCOUNT'],
    })

    expect(connecting.status).toBe('CONNECTING')
    expect(connected).toMatchObject({ status: 'CONNECTED', wallet: 'NQ00 FIRST ACCOUNT' })
    expect(PLAY_WALLET_BOOTSTRAP_COPY.CONNECTING).toBe('Connecting your Nimiq wallet…')
    expect(PLAY_WALLET_BOOTSTRAP_COPY.CONNECT).toBe('Connect wallet')
  })

  it('cancels without a wallet and keeps the board usable', () => {
    const connecting = reducePlayWalletBootstrap(INITIAL_PLAY_WALLET_BOOTSTRAP, { type: 'CONNECT_START' })
    const cancelled = reducePlayWalletBootstrap(connecting, { type: 'CANCEL' })

    expect(cancelled).toMatchObject({ status: 'CANCELLED', wallet: null })
  })
})
