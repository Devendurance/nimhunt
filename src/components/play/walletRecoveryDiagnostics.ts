type DiagnosticValue = string | boolean | number | null

export type PlayRecoveryDiagnosticSnapshot = {
  readonly playWalletConnected: 'yes' | 'no'
  readonly playWallet: string
  readonly payoutInitialGetStarted: 'yes' | 'no'
  readonly payoutInitialGetStatus: string
  readonly walletRecoverySessionPresent: 'yes' | 'no' | '?'
  readonly recoveryChallengeRequested: 'yes' | 'no'
  readonly recoveryChallengeStatus: string
  readonly recoverySignatureRequested: 'yes' | 'no'
  readonly recoverySignatureResult: 'approved' | 'cancelled' | 'not-requested'
  readonly recoveryVerifyRequested: 'yes' | 'no'
  readonly recoveryVerifyStatus: string
  readonly walletSessionIssued: 'yes' | 'no'
  readonly recoverySessionProbeStatus: string
  readonly recoverySessionAuthenticated: 'yes' | 'no' | '?'
  readonly payoutRetryStarted: 'yes' | 'no'
  readonly payoutRetryStatus: string
  readonly reservedClaimFound: 'yes' | 'no' | '?'
  readonly payoutFound: 'yes' | 'no' | '?'
  readonly payoutStatus: string
  readonly payoutStateSet: 'yes' | 'no'
  readonly payoutCardRender: 'yes' | 'no'
}

const INITIAL_SNAPSHOT: PlayRecoveryDiagnosticSnapshot = {
  playWalletConnected: 'no',
  playWallet: '',
  payoutInitialGetStarted: 'no',
  payoutInitialGetStatus: '',
  walletRecoverySessionPresent: '?',
  recoveryChallengeRequested: 'no',
  recoveryChallengeStatus: '',
  recoverySignatureRequested: 'no',
  recoverySignatureResult: 'not-requested',
  recoveryVerifyRequested: 'no',
  recoveryVerifyStatus: '',
  walletSessionIssued: 'no',
  recoverySessionProbeStatus: '',
  recoverySessionAuthenticated: '?',
  payoutRetryStarted: 'no',
  payoutRetryStatus: '',
  reservedClaimFound: '?',
  payoutFound: '?',
  payoutStatus: '',
  payoutStateSet: 'no',
  payoutCardRender: 'no',
}

let snapshot: PlayRecoveryDiagnosticSnapshot = { ...INITIAL_SNAPSHOT }
const listeners = new Set<() => void>()

const RECOVERY_DIAG_QUERY = 'recoveryDiag'

export function isPlayRecoveryDevDiagnosticsEnabled(): boolean {
  const env = (import.meta as ImportMeta & { env?: { DEV?: boolean; MODE?: string; PROD?: boolean } }).env
  if (env?.PROD === true || env?.MODE === 'production') return false
  return Boolean(env?.DEV) && env?.MODE !== 'test'
}

export function hasPlayRecoveryDevBannerQuery(search?: string | URLSearchParams | null): boolean {
  const params = search instanceof URLSearchParams
    ? search
    : new URLSearchParams(typeof search === 'string' ? search.replace(/^\?/, '') : '')
  return params.get(RECOVERY_DIAG_QUERY) === '1'
}

export function isPlayRecoveryDevBannerEnabled(search?: string | URLSearchParams | null): boolean {
  return isPlayRecoveryDevDiagnosticsEnabled() && hasPlayRecoveryDevBannerQuery(search)
}

export function getPlayRecoveryDiagnostics(): PlayRecoveryDiagnosticSnapshot {
  return snapshot
}

export function subscribePlayRecoveryDiagnostics(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetPlayRecoveryDiagnosticsForTests(): void {
  snapshot = { ...INITIAL_SNAPSHOT }
  listeners.clear()
}

export function formatPlayRecoveryDevLine(value: PlayRecoveryDiagnosticSnapshot): string {
  const mark = (flag: 'yes' | 'no' | '?'): string => (flag === 'yes' ? '✓' : flag === 'no' ? '—' : '?')
  const wallet = value.playWalletConnected === 'yes'
    ? `wallet ✓${value.playWallet ? ` ${value.playWallet}` : ''}`
    : 'wallet —'
  const get = value.payoutInitialGetStatus
    ? `get ${value.payoutInitialGetStatus}`
    : value.payoutInitialGetStarted === 'yes' ? 'get …' : 'get ?'
  const challenge = value.recoveryChallengeStatus
    ? `challenge ${value.recoveryChallengeStatus}`
    : `challenge ${mark(value.recoveryChallengeRequested === 'yes' ? 'yes' : value.recoveryChallengeRequested)}`
  const signature = value.recoverySignatureResult === 'not-requested'
    ? 'signature —'
    : `signature ${value.recoverySignatureResult}`
  const verify = value.recoveryVerifyStatus
    ? `verify ${value.recoveryVerifyStatus}`
    : value.recoveryVerifyRequested === 'yes' ? 'verify …' : 'verify —'
  const session = value.walletSessionIssued === 'yes' || value.walletRecoverySessionPresent === 'yes'
    ? 'session ✓'
    : value.walletRecoverySessionPresent === 'no' ? 'session —' : 'session ?'
  const claim = `claim ${mark(value.reservedClaimFound)}`
  const payout = value.payoutStatus
    ? `payout ${value.payoutStatus}`
    : `payout ${mark(value.payoutFound)}`
  const render = `render ${mark(value.payoutCardRender)}`
  return `Recovery: ${wallet}  ${get}  ${challenge}  ${signature}  ${verify}  ${session}  ${claim}  ${payout}  ${render}`
}

export function traceWalletRecovery(event: string, details: Readonly<Record<string, DiagnosticValue>> = {}): void {
  applyEvent(event, details)
  if (!isPlayRecoveryDevDiagnosticsEnabled()) return
  const parts = Object.entries(details).map(([key, value]) => `${key}=${value}`)
  console.info(`[wallet-recovery] ${event}${parts.length > 0 ? ` ${parts.join(' ')}` : ''}`)
}

function applyEvent(event: string, details: Readonly<Record<string, DiagnosticValue>>): void {
  switch (event) {
    case 'PLAY_WALLET_CONNECTED':
    case 'WALLET_BOOTSTRAP_OK':
      patch({
        playWalletConnected: details.connected === 'no' ? 'no' : 'yes',
        playWallet: typeof details.wallet === 'string' ? details.wallet : snapshot.playWallet,
      })
      return
    case 'PAYOUT_INITIAL_GET_STARTED':
      patch({ payoutInitialGetStarted: 'yes' })
      return
    case 'PAYOUT_INITIAL_GET_STATUS':
      patch({
        payoutInitialGetStarted: 'yes',
        payoutInitialGetStatus: statusLabel(details),
      })
      return
    case 'PAYOUT_GET_HTTP': {
      const label = statusLabel(details)
      if (!snapshot.payoutInitialGetStatus) {
        patch({ payoutInitialGetStarted: 'yes', payoutInitialGetStatus: label })
      } else {
        patch({ payoutRetryStarted: 'yes', payoutRetryStatus: label })
      }
      return
    }
    case 'WALLET_RECOVERY_SESSION_PRESENT':
    case 'RECOVERY_SESSION_PRESENT':
      patch({
        walletRecoverySessionPresent: details.present === 'yes' ? 'yes' : details.present === 'no' ? 'no' : snapshot.walletRecoverySessionPresent,
      })
      return
    case 'RECOVERY_CHALLENGE_REQUESTED':
      patch({ recoveryChallengeRequested: details.requested === 'no' ? 'no' : 'yes' })
      return
    case 'RECOVERY_CHALLENGE_STATUS':
      patch({
        recoveryChallengeRequested: 'yes',
        recoveryChallengeStatus: statusLabel(details),
      })
      return
    case 'RECOVERY_SIGNATURE_REQUESTED':
      patch({ recoverySignatureRequested: details.requested === 'no' ? 'no' : 'yes' })
      return
    case 'RECOVERY_SIGNATURE_RESULT':
    case 'RECOVERY_SIGNATURE_OK':
      patch({
        recoverySignatureRequested: snapshot.recoverySignatureRequested === 'yes' || details.result === 'approved' || details.ok === 'yes' ? 'yes' : snapshot.recoverySignatureRequested,
        recoverySignatureResult: details.result === 'cancelled' || details.result === 'approved' || details.result === 'not-requested'
          ? details.result
          : details.ok === 'yes' ? 'approved' : details.ok === 'no' ? 'cancelled' : snapshot.recoverySignatureResult,
      })
      return
    case 'RECOVERY_VERIFY_REQUESTED':
      patch({ recoveryVerifyRequested: details.requested === 'no' ? 'no' : 'yes' })
      return
    case 'RECOVERY_VERIFY_STATUS':
      patch({ recoveryVerifyStatus: statusLabel(details) })
      return
    case 'RECOVERY_SESSION_PROBE_STATUS':
      patch({ recoverySessionProbeStatus: statusLabel(details) })
      return
    case 'RECOVERY_SESSION_AUTHENTICATED':
      patch({
        recoverySessionAuthenticated: details.authenticated === 'yes' ? 'yes' : details.authenticated === 'no' ? 'no' : snapshot.recoverySessionAuthenticated,
      })
      return
    case 'WALLET_SESSION_ISSUED':
      patch({
        walletSessionIssued: details.issued === 'no' ? 'no' : 'yes',
        walletRecoverySessionPresent: details.issued === 'no' ? snapshot.walletRecoverySessionPresent : 'yes',
      })
      return
    case 'PAYOUT_RETRY_STARTED':
      patch({ payoutRetryStarted: 'yes' })
      return
    case 'PAYOUT_RETRY_STATUS':
      patch({
        payoutRetryStarted: 'yes',
        payoutRetryStatus: statusLabel(details),
      })
      return
    case 'RESERVED_CLAIM_FOUND':
      patch({ reservedClaimFound: details.found === 'yes' ? 'yes' : details.found === 'no' ? 'no' : snapshot.reservedClaimFound })
      return
    case 'PAYOUT_FOUND':
      patch({ payoutFound: details.found === 'yes' ? 'yes' : details.found === 'no' ? 'no' : snapshot.payoutFound })
      return
    case 'PAYOUT_STATUS':
      patch({ payoutStatus: typeof details.status === 'string' ? details.status : snapshot.payoutStatus })
      return
    case 'PAYOUT_STATE_SET':
      patch({ payoutStateSet: details.set === 'no' ? 'no' : 'yes' })
      return
    case 'PAYOUT_CARD_RENDER':
      patch({ payoutCardRender: details.render === 'yes' ? 'yes' : 'no' })
      return
    default:
      return
  }
}

function statusLabel(details: Readonly<Record<string, DiagnosticValue>>): string {
  const status = details.status
  const code = details.code
  if (typeof status === 'number' && typeof code === 'string' && code) return `${status}/${code}`
  if (typeof status === 'string' && typeof code === 'string' && code) return `${status}/${code}`
  if (typeof status === 'number' || typeof status === 'string') return String(status)
  if (typeof code === 'string' && code) return code
  return ''
}

function patch(next: Partial<PlayRecoveryDiagnosticSnapshot>): void {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) listener()
}
