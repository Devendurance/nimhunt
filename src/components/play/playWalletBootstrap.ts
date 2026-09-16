export type PlayWalletBootstrapStatus =
  | 'IDLE'
  | 'CONNECTING'
  | 'SELECTING_ACCOUNT'
  | 'CONNECTED'
  | 'CANCELLED'
  | 'UNAVAILABLE'

export type PlayWalletBootstrapState = {
  readonly status: PlayWalletBootstrapStatus
  readonly accounts: readonly string[]
  readonly wallet: string | null
}

export type PlayWalletBootstrapAction =
  | { readonly type: 'CONNECT_START' }
  | { readonly type: 'ACCOUNTS_RECEIVED'; readonly accounts: readonly string[] }
  | { readonly type: 'ACCOUNT_SELECTED'; readonly account: string }
  | { readonly type: 'CONNECTED'; readonly wallet: string }
  | { readonly type: 'CANCEL' }
  | { readonly type: 'UNAVAILABLE' }

export const INITIAL_PLAY_WALLET_BOOTSTRAP: PlayWalletBootstrapState = {
  status: 'IDLE',
  accounts: [],
  wallet: null,
}

export const PLAY_WALLET_BOOTSTRAP_COPY = {
  CONNECTING: 'Connecting your Nimiq wallet…',
  CONNECT: 'Connect wallet',
  SELECTING: 'Choose the Nimiq account for today\'s hunt.',
  RECOVERING: 'Restoring today\'s hunt…',
} as const

export function reducePlayWalletBootstrap(
  state: PlayWalletBootstrapState,
  action: PlayWalletBootstrapAction,
): PlayWalletBootstrapState {
  switch (action.type) {
    case 'CONNECT_START':
      if (state.status === 'CONNECTING' || state.status === 'CONNECTED') return state
      return { status: 'CONNECTING', accounts: [], wallet: null }
    case 'ACCOUNTS_RECEIVED':
      if (state.status !== 'CONNECTING') return state
      if (action.accounts.length === 0) return { status: 'CANCELLED', accounts: [], wallet: null }
      if (action.accounts.length === 1 && action.accounts[0]) {
        return { status: 'CONNECTED', accounts: [...action.accounts], wallet: action.accounts[0] }
      }
      return { status: 'SELECTING_ACCOUNT', accounts: [...action.accounts], wallet: null }
    case 'ACCOUNT_SELECTED':
      if (state.status !== 'SELECTING_ACCOUNT' || !state.accounts.includes(action.account)) return state
      return { status: 'CONNECTED', accounts: state.accounts, wallet: action.account }
    case 'CONNECTED':
      return { status: 'CONNECTED', accounts: state.accounts, wallet: action.wallet }
    case 'CANCEL':
      if (state.status === 'CONNECTED') return state
      return { status: 'CANCELLED', accounts: [], wallet: null }
    case 'UNAVAILABLE':
      if (state.status === 'CONNECTED') return state
      return { status: 'UNAVAILABLE', accounts: [], wallet: null }
  }
}
