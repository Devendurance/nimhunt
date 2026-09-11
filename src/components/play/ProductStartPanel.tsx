import type { Mission } from '../../types/play'
import { shortenNimiqAddress } from '../../integrations/nimiq/treasureSeal'
import {
  PRODUCT_START_COPY,
  type ProductStartFailureStatus,
  type ProductStartState,
} from './productStart.ts'
import styles from './PlayShell.module.css'

type ProductStartPanelProps = {
  readonly mission: Mission
  readonly state: ProductStartState
  readonly onSelectAccount: (account: string) => void
  readonly onAuthorize: () => void
  readonly onRetryStart: () => void
  readonly onCancel: () => void
  readonly onBack: () => void
  readonly onPractice: () => void
  readonly onFreshStart: () => void
}

export function ProductStartPanel({
  mission,
  state,
  onSelectAccount,
  onAuthorize,
  onRetryStart,
  onCancel,
  onBack,
  onPractice,
  onFreshStart,
}: ProductStartPanelProps) {
  if (state.status === 'IDLE' || state.status === 'STARTED') return null

  const failure = isFailureStatus(state.status)
  const busy = state.status === 'REQUESTING_ACCOUNT'
    || state.status === 'REQUESTING_CHALLENGE'
    || state.status === 'SUBMITTING_START'
  const canPractice = state.status === 'LIMIT_REACHED'
    || state.status === 'BLUEPRINT_UNAVAILABLE'
    || state.status === 'PROOF_UNAVAILABLE'

  return <section className={styles.productPanel} aria-labelledby="product-start-heading" aria-busy={busy}>
    <div className={styles.sheetTopline}>
      <span className={styles.kicker}>REWARD EXPEDITION</span>
      <span className={styles.fixtureBadge}>NIMIQ PAY</span>
    </div>
    <h2 id="product-start-heading">{mission.title}</h2>

    {state.status === 'REQUESTING_ACCOUNT' && <StatusMessage text={PRODUCT_START_COPY.REQUESTING_ACCOUNT} />}

    {state.status === 'SELECTING_ACCOUNT' && <>
      <p className={styles.productIntro}>{PRODUCT_START_COPY.SELECTING_ACCOUNT}</p>
      <div className={styles.accountList} role="group" aria-label="Nimiq accounts">
        {state.accounts.map(account => <button
          key={account}
          className={styles.accountButton}
          type="button"
          onClick={() => onSelectAccount(account)}
          aria-label={`Use ${account} for this expedition`}
        >
          <span>{shortenNimiqAddress(account)}</span>
          <small>{account}</small>
        </button>)}
      </div>
    </>}

    {state.status === 'REQUESTING_CHALLENGE' && <StatusMessage text={PRODUCT_START_COPY.REQUESTING_CHALLENGE} />}

    {state.status === 'AWAITING_START_SIGNATURE' && <>
      <p className={styles.productIntro}>Review the exact message before your Nimiq account signs it.</p>
      <pre className={styles.canonicalPayload} aria-label="Exact expedition authorization message">{state.canonicalPayload}</pre>
      <div className={styles.productActions}>
        <button className={styles.sheetPrimary} type="button" onClick={onAuthorize}>Authorize this expedition</button>
        <button className={styles.sheetSecondary} type="button" onClick={onCancel}>Cancel</button>
      </div>
    </>}

    {state.status === 'SUBMITTING_START' && <StatusMessage text={PRODUCT_START_COPY.SUBMITTING_START} />}

    {state.status === 'RECOVERING_START' && <>
      <div className={styles.productNotice} role="status">
        <strong>{PRODUCT_START_COPY.RECOVERING_START}</strong>
        <p>The same signed message will be submitted. No new challenge or account request will be made.</p>
      </div>
      <div className={styles.productActions}>
        <button className={styles.sheetPrimary} type="button" onClick={onRetryStart}>Retry authorization</button>
      </div>
    </>}

    {state.status === 'CANCELLED' && <>
      <div className={styles.productNotice} role="status">
        <strong>{PRODUCT_START_COPY.CANCELLED}</strong>
        <p>{PRODUCT_START_COPY.NO_ATTEMPT_USED}</p>
      </div>
      <div className={styles.productActions}>
        <button className={styles.sheetSecondary} type="button" onClick={onBack}>Back to mission brief</button>
      </div>
    </>}

    {failure && <>
      <div className={styles.productError} role="alert">
        <strong>{failureCopy(state.status)}</strong>
        {state.errorCode && <p>Reference: {state.errorCode}</p>}
      </div>
      <div className={styles.productActions}>
        <button className={styles.sheetPrimary} type="button" onClick={onFreshStart}>Start again</button>
        {canPractice && <button className={styles.sheetSecondary} type="button" onClick={onPractice}>Start Practice Run</button>}
      </div>
    </>}

    {busy && state.status !== 'SUBMITTING_START' && <div className={styles.productActions}>
      <button className={styles.sheetSecondary} type="button" onClick={onCancel}>Cancel</button>
    </div>}
  </section>
}

function StatusMessage({ text }: { readonly text: string }) {
  return <p className={styles.productStatus} role="status">{text}</p>
}

function isFailureStatus(status: ProductStartState['status']): status is ProductStartFailureStatus {
  return status === 'LIMIT_REACHED'
    || status === 'BLUEPRINT_UNAVAILABLE'
    || status === 'PROOF_UNAVAILABLE'
    || status === 'REJECTED'
}

function failureCopy(status: ProductStartFailureStatus): string {
  if (status === 'LIMIT_REACHED') return PRODUCT_START_COPY.LIMIT_REACHED
  if (status === 'BLUEPRINT_UNAVAILABLE') return PRODUCT_START_COPY.BLUEPRINT_UNAVAILABLE
  if (status === 'PROOF_UNAVAILABLE') return PRODUCT_START_COPY.PROOF_UNAVAILABLE
  return PRODUCT_START_COPY.REJECTED
}
