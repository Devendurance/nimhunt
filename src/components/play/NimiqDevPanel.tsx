import { useState } from 'react'
import { useNimiq } from '../../hooks/useNimiq'
import { shortenNimiqAddress } from '../../integrations/nimiq/treasureSeal'
import { HuntHeader } from './HuntHeader'
import play from './PlayShell.module.css'
import styles from './NimiqDevPanel.module.css'

const PROVIDER_LABELS = {
  uninitialized: 'uninitialized',
  initializing: 'initializing',
  ready: 'ready',
  unavailable: 'unavailable',
  error: 'error',
} as const

export function NimiqDevPanel() {
  const nimiq = useNimiq()
  const [copied, setCopied] = useState(false)
  const providerReady = nimiq.providerStatus === 'ready'
  const canRequestAccount = providerReady && nimiq.accountStatus !== 'loading'
  const canSign = providerReady && Boolean(nimiq.account) && nimiq.signStatus !== 'loading' && Boolean(nimiq.testMessage)
  const showUnavailableCopy = nimiq.providerStatus === 'unavailable'
  const showUserError = nimiq.error && nimiq.error.code !== 'PROVIDER_UNAVAILABLE'

  const copyAddress = async () => {
    if (!nimiq.account) return
    const copiedText = await copyText(nimiq.account)
    if (!copiedText) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return <div className={play.shell}>
    <div className={play.viewport}>
      <HuntHeader />
      <main className={play.main}>
        <section className={play.pageIntro} aria-labelledby="nimiq-dev-heading">
          <span className={play.kicker}>DEVELOPMENT SURFACE · NOT A CLAIM</span>
          <h1 id="nimiq-dev-heading">Nimiq integration</h1>
          <p>Account access and a test treasure-seal signature only. No NIM is sent from this screen.</p>
        </section>

        <div className={styles.banner}>
          <strong>Development signature test</strong>
          <p>This is not a real treasure claim or reward. Approve only if you intend to test Nimiq Pay account access and message signing.</p>
        </div>

        <section className={styles.section} aria-labelledby="environment-heading">
          <span className={styles.label} id="environment-heading">Environment</span>
          <p className={styles.value}>{nimiq.environment === 'nimiq-pay' ? 'Nimiq Pay detected' : 'Browser development mode'}</p>
          {showUnavailableCopy && <p className={styles.note}>Nimiq Pay provider is unavailable in this browser. Real wallet operations must be tested inside Nimiq Pay. This panel will not fake an account or signature.</p>}
        </section>

        <section className={styles.section} aria-labelledby="provider-heading">
          <span className={styles.label} id="provider-heading">Provider status</span>
          <div className={styles.statusRow}>
            <span className={`${styles.dot} ${dotClass(nimiq.providerStatus)}`} aria-hidden="true" />
            <p className={styles.value}>{PROVIDER_LABELS[nimiq.providerStatus]}</p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="account-heading">
          <span className={styles.label} id="account-heading">Account</span>
          {nimiq.account ? <>
            <p className={styles.address}>{shortenNimiqAddress(nimiq.account)}</p>
            <p className={styles.fullAddress}>{nimiq.account}</p>
            <div className={styles.actions}>
              <button className={styles.copy} type="button" onClick={() => void copyAddress()}>{copied ? 'Copied' : 'Copy full address'}</button>
            </div>
            <p className={styles.note}>This address was returned by Nimiq Pay. It is not an app login beyond what the SDK proves.</p>
          </> : <p className={styles.value}>No account requested yet.</p>}
          <div className={styles.actions}>
            <button className={styles.primary} type="button" onClick={() => void nimiq.requestAccount()} disabled={!canRequestAccount}>
              {nimiq.accountStatus === 'loading' ? 'Requesting account…' : 'Request Nimiq account'}
            </button>
          </div>
        </section>

        {nimiq.account && nimiq.testMessage && <section className={styles.section} aria-labelledby="seal-heading">
          <span className={styles.label} id="seal-heading">Sign test treasure seal</span>
          <h2>Exact message</h2>
          <pre className={styles.payload}>{nimiq.testMessage}</pre>
          <div className={styles.actions}>
            <button className={styles.secondary} type="button" onClick={() => void nimiq.signTestSeal()} disabled={!canSign}>
              {nimiq.signStatus === 'loading' ? 'Waiting for signature…' : 'Sign test treasure seal'}
            </button>
          </div>
        </section>}

        {nimiq.signature && <section className={styles.section} aria-labelledby="result-heading">
          <span className={styles.label} id="result-heading">Development signature test</span>
          <h2>Signed locally</h2>
          <p className={styles.note}>Not a treasure claim. NIM has not been awarded.</p>
          <div className={styles.proofRow}><span>PUBLIC KEY</span><p>{nimiq.signature.publicKey}</p></div>
          <div className={styles.proofRow}><span>SIGNATURE</span><p>{nimiq.signature.signature}</p></div>
          <div className={styles.proofRow}><span>SIGNED PAYLOAD</span></div>
          <pre className={styles.proof}>{nimiq.signature.message}</pre>
          <div className={styles.proofRow}><span>LOCAL TIMESTAMP</span><p>{formatLocalTimestamp(nimiq.signature.completedAt)}</p></div>
        </section>}

        {nimiq.signature && <section className={styles.section} aria-labelledby="verify-heading">
          <span className={styles.label} id="verify-heading">Server-side verification</span>
          <h2>Development verifier</h2>
          <div className={styles.statusRow}>
            <span className={`${styles.dot} ${verifyDotClass(nimiq.verifyStatus)}`} aria-hidden="true" />
            <p className={styles.value}>{verifyLabel(nimiq.verifyStatus)}</p>
          </div>
          <p className={styles.note}>Trusted Node code checks the signature and address binding. The client `verified` flag is never trusted.</p>
          <div className={styles.actions}>
            <button className={styles.primary} type="button" onClick={() => void nimiq.verifyTestSeal()} disabled={nimiq.verifyStatus === 'loading'}>
              {nimiq.verifyStatus === 'loading' ? 'Verifying…' : 'Verify test signature'}
            </button>
            <button className={styles.secondary} type="button" onClick={() => void nimiq.verifyTamperedSeal()} disabled={nimiq.verifyStatus === 'loading'}>
              Test tampered payload
            </button>
          </div>
          {nimiq.verifyStatus === 'success' && nimiq.verification?.valid && <>
            <p className={styles.devOnly}>DEVELOPMENT-ONLY</p>
            <div className={styles.proofRow}><span>SIGNATURE VALID</span><p>Yes</p></div>
            <div className={styles.proofRow}><span>ADDRESS MATCHED</span><p>Yes</p></div>
            <div className={styles.proofRow}><span>PAYLOAD HASH</span><p>{nimiq.verification.payloadHash}</p></div>
            <p className={styles.note}>Development verification passed. No NIM has been awarded.</p>
          </>}
          {nimiq.verifyStatus === 'error' && nimiq.verification && !nimiq.verification.valid && <>
            <div className={styles.error} role="alert">
              <strong>Rejected</strong>
              <p>{rejectCopy(nimiq.verification.reason)}</p>
            </div>
            <div className={styles.proofRow}><span>REASON</span><p>{nimiq.verification.reason ?? 'UNKNOWN'}</p></div>
            <div className={styles.proofRow}><span>SIGNATURE VALID</span><p>{nimiq.verification.signatureValid ? 'Yes' : 'No'}</p></div>
            <div className={styles.proofRow}><span>ADDRESS MATCHED</span><p>{nimiq.verification.addressMatches ? 'Yes' : 'No'}</p></div>
            {nimiq.verification.payloadHash && <div className={styles.proofRow}><span>PAYLOAD HASH</span><p>{nimiq.verification.payloadHash}</p></div>}
          </>}
        </section>}

        {showUserError && nimiq.error && <div className={styles.error} role="alert">
          <strong>{errorTitle(nimiq.error.code)}</strong>
          <p>{nimiq.error.message}</p>
          <details className={styles.details}>
            <summary>Developer details</summary>
            <pre className={styles.payload}>{formatErrorDetails(nimiq.error.details)}</pre>
          </details>
        </div>}
      </main>
    </div>
  </div>
}

function dotClass(status: keyof typeof PROVIDER_LABELS): string {
  if (status === 'ready') return styles.ready
  if (status === 'initializing') return styles.initializing
  if (status === 'error') return styles.errorDot
  if (status === 'unavailable') return styles.unavailable
  return ''
}

function verifyLabel(status: 'idle' | 'loading' | 'success' | 'error'): string {
  if (status === 'loading') return 'VERIFYING'
  if (status === 'success') return 'VERIFIED'
  if (status === 'error') return 'REJECTED'
  return 'NOT VERIFIED'
}

function verifyDotClass(status: 'idle' | 'loading' | 'success' | 'error'): string {
  if (status === 'success') return styles.ready
  if (status === 'loading') return styles.initializing
  if (status === 'error') return styles.errorDot
  return ''
}

function rejectCopy(reason: string | undefined): string {
  if (reason === 'INVALID_SIGNATURE') return 'The signature does not match this payload.'
  if (reason === 'ADDRESS_MISMATCH') return 'The public key does not match the expected wallet.'
  if (reason === 'INVALID_PUBLIC_KEY') return 'The public key could not be parsed.'
  if (reason === 'INVALID_WALLET') return 'The wallet address could not be parsed.'
  if (reason === 'PAYLOAD_TAMPERED') return 'The payload is not the canonical signed string.'
  if (reason === 'UNSUPPORTED_MESSAGE_TYPE') return 'This message type is not a development treasure seal.'
  if (reason === 'REQUEST_FAILED') return 'The verifier could not be reached.'
  return 'The verifier rejected this payload.'
}

function errorTitle(code: string): string {
  if (code === 'ACCOUNT_CANCELLED' || code === 'SIGN_CANCELLED') return 'Cancelled'
  if (code === 'PROVIDER_INIT_FAILED') return 'Provider error'
  if (code === 'ACCOUNT_EMPTY') return 'No account'
  return 'Nimiq error'
}

function formatLocalTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

function formatErrorDetails(details: unknown): string {
  if (details instanceof Error) return `${details.name}: ${details.message}`
  try {
    return JSON.stringify(details, null, 2)
  } catch {
    return String(details)
  }
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall through to the execCommand path for HTTP LAN testing.
  }

  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  const ok = document.execCommand('copy')
  input.remove()
  return ok
}
