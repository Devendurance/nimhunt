import { describe, expect, it } from 'vitest'
import {
  formatPlayRecoveryDevLine,
  getPlayRecoveryDiagnostics,
  hasPlayRecoveryDevBannerQuery,
  isPlayRecoveryDevBannerEnabled,
  isPlayRecoveryDevDiagnosticsEnabled,
  resetPlayRecoveryDiagnosticsForTests,
  traceWalletRecovery,
} from './walletRecoveryDiagnostics.ts'

describe('play recovery diagnostics', () => {
  it('formats a compact local-dev line without secrets', () => {
    resetPlayRecoveryDiagnosticsForTests()
    traceWalletRecovery('PLAY_WALLET_CONNECTED', { connected: 'yes', wallet: 'NQ218B…6GEB' })
    traceWalletRecovery('PAYOUT_GET_HTTP', { status: 400, code: 'MALFORMED_REQUEST' })
    const line = formatPlayRecoveryDevLine(getPlayRecoveryDiagnostics())
    expect(line).toContain('wallet ✓ NQ218B…6GEB')
    expect(line).toContain('get 400/MALFORMED_REQUEST')
    expect(line).toContain('challenge —')
    expect(line).toContain('signature —')
    expect(line).toContain('verify —')
    expect(line).toContain('session')
    expect(line).not.toMatch(/nimhunt_wallet_session=/)
    expect(line).not.toMatch(/signature=/)
    expect(line).not.toMatch(/challenge=[A-Za-z0-9_-]{16,}/)
  })

  it('records a successful recovery HTTP sequence', () => {
    resetPlayRecoveryDiagnosticsForTests()
    traceWalletRecovery('PAYOUT_GET_HTTP', { status: 401, code: 'RUN_SESSION_INVALID' })
    traceWalletRecovery('RECOVERY_CHALLENGE_REQUESTED', { requested: 'yes' })
    traceWalletRecovery('RECOVERY_CHALLENGE_STATUS', { status: 200, code: 'ok' })
    traceWalletRecovery('RECOVERY_SIGNATURE_REQUESTED', { requested: 'yes' })
    traceWalletRecovery('RECOVERY_SIGNATURE_RESULT', { result: 'approved' })
    traceWalletRecovery('RECOVERY_VERIFY_REQUESTED', { requested: 'yes' })
    traceWalletRecovery('RECOVERY_VERIFY_STATUS', { status: 200, code: 'ok' })
    traceWalletRecovery('RECOVERY_SESSION_PROBE_STATUS', { status: 200, code: 'ok' })
    traceWalletRecovery('RECOVERY_SESSION_AUTHENTICATED', { authenticated: 'yes' })
    traceWalletRecovery('WALLET_SESSION_ISSUED', { issued: 'yes' })
    traceWalletRecovery('PAYOUT_GET_HTTP', { status: 200, code: 'ok' })
    traceWalletRecovery('RESERVED_CLAIM_FOUND', { found: 'yes' })
    traceWalletRecovery('PAYOUT_STATUS', { status: 'CONFIRMED' })
    traceWalletRecovery('PAYOUT_STATE_SET', { set: 'yes' })
    traceWalletRecovery('PAYOUT_CARD_RENDER', { render: 'yes' })
    const snapshot = getPlayRecoveryDiagnostics()
    expect(snapshot.payoutInitialGetStatus).toBe('401/RUN_SESSION_INVALID')
    expect(snapshot.payoutRetryStatus).toBe('200/ok')
    expect(snapshot.recoverySignatureResult).toBe('approved')
    expect(snapshot.recoveryVerifyStatus).toBe('200/ok')
    expect(snapshot.recoverySessionAuthenticated).toBe('yes')
    expect(snapshot.walletSessionIssued).toBe('yes')
    expect(formatPlayRecoveryDevLine(snapshot)).toContain('verify 200/ok')
    expect(snapshot.payoutCardRender).toBe('yes')
    expect(formatPlayRecoveryDevLine(snapshot)).toContain('payout CONFIRMED')
  })

  it('never enables the production UI banner without an explicit local-dev query', () => {
    expect(isPlayRecoveryDevDiagnosticsEnabled()).toBe(false)
    expect(hasPlayRecoveryDevBannerQuery(null)).toBe(false)
    expect(hasPlayRecoveryDevBannerQuery('')).toBe(false)
    expect(hasPlayRecoveryDevBannerQuery('recoveryDiag=0')).toBe(false)
    expect(hasPlayRecoveryDevBannerQuery('recoveryDiag=1')).toBe(true)
    expect(hasPlayRecoveryDevBannerQuery(new URLSearchParams('recoveryDiag=1'))).toBe(true)
    expect(isPlayRecoveryDevBannerEnabled('recoveryDiag=1')).toBe(false)
    expect(isPlayRecoveryDevBannerEnabled('?recoveryDiag=1')).toBe(false)
  })
})
