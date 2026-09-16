import { MnemonicUtils, TransactionBuilder, KeyPair } from '@nimiq/core'
import {
  formatNimFromLuna,
  readPayoutExecutionConfig,
  type TreasurySecret,
} from './config.ts'
import { PayoutError } from './errors.ts'
import { normalizeNimiqAddress } from './intent.ts'
import { keyPairFromSecret, type NimiqTreasury, type SignedBasicTransfer } from './nimiqTreasury.ts'
import {
  LUNA_PER_NIM,
  NIMIQ_MAINNET_NETWORK_ID,
  type TreasuryTransaction,
} from './types.ts'

export const SWEEP_LEAVE_NIM = 100n
export const SWEEP_LEAVE_LUNA = SWEEP_LEAVE_NIM * LUNA_PER_NIM

export type SweepCommand = {
  readonly recipient: string
  readonly leaveNim: bigint
  readonly confirm: boolean
}

export type SweepConfig = {
  readonly network: 'mainnet'
  readonly secret: Extract<TreasurySecret, { kind: 'mnemonic' }>
}

export type SweepTransport = Pick<
  NimiqTreasury,
  'network' | 'address' | 'getBalance' | 'signBasicTransfer' | 'submitBasic' | 'getTransaction'
>

export type SweepPlan = {
  readonly treasury: string
  readonly recipient: string
  readonly currentBalanceLuna: bigint
  readonly sendLuna: bigint
  readonly leaveLuna: bigint
  readonly feeLuna: bigint
  readonly expectedFinalLuna: bigint
}

type SweepPlanFields = SweepPlan & {
  readonly currentBalanceNim: string
  readonly sendNim: string
  readonly leaveNim: string
  readonly feeNim: string
  readonly expectedFinalNim: string
}

export type SweepReport =
  | (SweepPlanFields & {
      readonly mode: 'preview'
      readonly signed: false
      readonly broadcast: false
    })
  | (SweepPlanFields & {
      readonly mode: 'confirmed'
      readonly signed: true
      readonly broadcast: true
      readonly txHash: string
      readonly chainStatus: string
      readonly confirmedSender: string | null
      readonly confirmedRecipient: string | null
      readonly confirmedAmountLuna: bigint | null
      readonly finalBalanceLuna: bigint | null
      readonly finalBalanceNim: string | null
      readonly senderMatch: boolean
      readonly recipientMatch: boolean
      readonly amountMatch: boolean
      readonly leaveMatch: boolean
    })
  | (SweepPlanFields & {
      readonly mode: 'submitted'
      readonly signed: true
      readonly broadcast: true
      readonly txHash: string
      readonly chainStatus: string
      readonly confirmedSender: string | null
      readonly confirmedRecipient: string | null
      readonly confirmedAmountLuna: bigint | null
      readonly finalBalanceLuna: bigint | null
      readonly finalBalanceNim: string | null
      readonly senderMatch: boolean
      readonly recipientMatch: boolean
      readonly amountMatch: boolean
      readonly leaveMatch: boolean
    })
  | (SweepPlanFields & {
      readonly mode: 'ambiguous'
      readonly signed: true
      readonly broadcast: 'unknown'
      readonly txHash: string
      readonly submittedTxHash: string | null
    })

export function nimToLuna(nim: bigint): bigint {
  if (nim <= 0n) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
  return nim * LUNA_PER_NIM
}

export function readBasicTransferFeeLuna(): bigint {
  const sender = KeyPair.generate()
  const tx = TransactionBuilder.newBasic(
    sender.toAddress(),
    KeyPair.generate().toAddress(),
    1n,
    0n,
    1,
    NIMIQ_MAINNET_NETWORK_ID,
  )
  return tx.fee
}

export function calculateSweepSendLuna(input: {
  readonly currentBalanceLuna: bigint
  readonly leaveLuna: bigint
  readonly feeLuna: bigint
}): bigint {
  if (input.leaveLuna <= 0n || input.feeLuna < 0n) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
  const sendLuna = input.currentBalanceLuna - input.leaveLuna - input.feeLuna
  if (sendLuna <= 0n) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
  return sendLuna
}

export function parseSweepArgs(argv: readonly string[]): SweepCommand {
  let recipient: string | undefined
  let leaveNim: bigint | undefined
  let confirm = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--confirm') {
      confirm = true
      continue
    }
    const recipientValue = readOption(argv, index, '--recipient')
    if (recipientValue) {
      recipient = recipientValue.value
      index = recipientValue.index
      continue
    }
    const leaveValue = readOption(argv, index, '--leave-nim')
    if (leaveValue) {
      if (!/^[1-9][0-9]*$/.test(leaveValue.value)) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
      leaveNim = BigInt(leaveValue.value)
      index = leaveValue.index
      continue
    }
    throw new PayoutError('MALFORMED_REQUEST')
  }

  if (!recipient?.trim() || leaveNim == null) throw new PayoutError('MALFORMED_REQUEST')
  if (leaveNim <= 0n) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
  return { recipient, leaveNim, confirm }
}

export function readSweepConfig(
  env: Record<string, string | undefined> = process.env,
): SweepConfig {
  const config = readPayoutExecutionConfig(env)
  if (config.network !== 'mainnet') throw new PayoutError('PAYOUT_NETWORK_INVALID')
  if (env.NIMHUNT_TREASURY_PRIVATE_KEY?.trim()) throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
  const mnemonic = env.NIMHUNT_TREASURY_MNEMONIC?.trim()
  if (!mnemonic || mnemonic.split(/\s+/).length < 24) throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
  const secret = { kind: 'mnemonic' as const, value: mnemonic }
  try {
    MnemonicUtils.getMnemonicType(mnemonic)
    keyPairFromSecret(secret)
  } catch (error) {
    if (error instanceof PayoutError) throw error
    throw new PayoutError('PAYOUT_TREASURY_UNAVAILABLE')
  }
  return { network: 'mainnet', secret }
}

export function assertSweepRecipient(recipient: string, treasuryAddress: string): string {
  const normalizedRecipient = normalizeNimiqAddress(recipient)
  const normalizedTreasury = normalizeNimiqAddress(treasuryAddress)
  if (normalizedRecipient === normalizedTreasury) throw new PayoutError('WALLET_MISMATCH')
  return normalizedRecipient
}

export function buildSweepPlan(input: {
  readonly treasury: string
  readonly recipient: string
  readonly currentBalanceLuna: bigint
  readonly leaveLuna: bigint
  readonly feeLuna: bigint
}): SweepPlan {
  const treasury = normalizeNimiqAddress(input.treasury)
  const recipient = assertSweepRecipient(input.recipient, treasury)
  const sendLuna = calculateSweepSendLuna({
    currentBalanceLuna: input.currentBalanceLuna,
    leaveLuna: input.leaveLuna,
    feeLuna: input.feeLuna,
  })
  const expectedFinalLuna = input.currentBalanceLuna - sendLuna - input.feeLuna
  if (expectedFinalLuna !== input.leaveLuna) throw new PayoutError('PAYOUT_AMOUNT_INVALID')
  return {
    treasury,
    recipient,
    currentBalanceLuna: input.currentBalanceLuna,
    sendLuna,
    leaveLuna: input.leaveLuna,
    feeLuna: input.feeLuna,
    expectedFinalLuna,
  }
}

export async function runTreasurySweep(options: {
  readonly command: SweepCommand
  readonly transport: SweepTransport
  readonly feeLuna?: bigint
  readonly sleep?: (ms: number) => Promise<void>
  readonly confirmTimeoutMs?: number
  readonly pollMs?: number
}): Promise<SweepReport> {
  if (options.transport.network !== 'mainnet') throw new PayoutError('PAYOUT_NETWORK_INVALID')
  const treasury = normalizeNimiqAddress(options.transport.address())
  const recipient = assertSweepRecipient(options.command.recipient, treasury)
  const leaveLuna = nimToLuna(options.command.leaveNim)
  const feeLuna = options.feeLuna ?? readBasicTransferFeeLuna()
  if (feeLuna < 0n) throw new PayoutError('PAYOUT_AMOUNT_INVALID')

  if (!options.command.confirm) {
    const currentBalanceLuna = await options.transport.getBalance()
    return {
      mode: 'preview',
      ...decoratePlan(buildSweepPlan({
        treasury,
        recipient,
        currentBalanceLuna,
        leaveLuna,
        feeLuna,
      })),
      signed: false,
      broadcast: false,
    }
  }

  const currentBalanceLuna = await options.transport.getBalance()
  const plan = buildSweepPlan({
    treasury,
    recipient,
    currentBalanceLuna,
    leaveLuna,
    feeLuna,
  })
  const intent = await options.transport.signBasicTransfer({
    recipient: plan.recipient,
    amountLuna: plan.sendLuna,
  })
  assertExactIntent(plan, intent)

  let submitted: { readonly txHash: string }
  try {
    submitted = await options.transport.submitBasic(intent)
  } catch {
    return {
      mode: 'ambiguous',
      ...decoratePlan(plan),
      signed: true,
      broadcast: 'unknown',
      txHash: intent.txHash,
      submittedTxHash: null,
    }
  }
  if (submitted.txHash !== intent.txHash) {
    return {
      mode: 'ambiguous',
      ...decoratePlan(plan),
      signed: true,
      broadcast: 'unknown',
      txHash: intent.txHash,
      submittedTxHash: submitted.txHash,
    }
  }

  const chain = await waitForChain(options.transport, submitted.txHash, {
    sleep: options.sleep ?? defaultSleep,
    timeoutMs: options.confirmTimeoutMs ?? 120_000,
    pollMs: options.pollMs ?? 4_000,
  })
  const finalBalanceLuna = await readFinalBalance(options.transport, plan.leaveLuna, {
    sleep: options.sleep ?? defaultSleep,
    timeoutMs: chain?.status === 'confirmed' ? Math.min(options.confirmTimeoutMs ?? 120_000, 30_000) : 0,
    pollMs: options.pollMs ?? 4_000,
  })
  const senderMatch = chain != null && normalizeNimiqAddress(chain.sender) === plan.treasury
  const recipientMatch = chain != null && normalizeNimiqAddress(chain.recipient) === plan.recipient
  const amountMatch = chain != null && chain.amountLuna === plan.sendLuna
  const leaveMatch = finalBalanceLuna === plan.leaveLuna
  const confirmed = chain?.status === 'confirmed'

  return {
    mode: confirmed ? 'confirmed' : 'submitted',
    ...decoratePlan(plan),
    signed: true,
    broadcast: true,
    txHash: submitted.txHash,
    chainStatus: chain?.status ?? 'UNAVAILABLE',
    confirmedSender: chain?.sender ?? null,
    confirmedRecipient: chain?.recipient ?? null,
    confirmedAmountLuna: chain?.amountLuna ?? null,
    finalBalanceLuna,
    finalBalanceNim: finalBalanceLuna == null ? null : formatNimFromLuna(finalBalanceLuna),
    senderMatch,
    recipientMatch,
    amountMatch,
    leaveMatch,
  }
}

export function formatSweepReport(report: SweepReport): string {
  const lines = [
    report.mode === 'preview'
      ? 'TREASURY SWEEP CHECKPOINT'
      : report.mode === 'ambiguous'
        ? 'TREASURY SWEEP AMBIGUOUS SUBMISSION'
        : report.mode === 'confirmed'
          ? 'TREASURY SWEEP EXECUTED'
          : 'TREASURY SWEEP SUBMITTED',
    `treasury=${report.treasury}`,
    `currentBalanceNim=${report.currentBalanceNim}`,
    `currentBalanceLuna=${report.currentBalanceLuna.toString()}`,
    `recipient=${report.recipient}`,
    `sendNim=${report.sendNim}`,
    `sendLuna=${report.sendLuna.toString()}`,
    `leave=${report.leaveNim} NIM / ${report.leaveLuna.toString()} Luna`,
    `leaveNim=${report.leaveNim}`,
    `leaveLuna=${report.leaveLuna.toString()}`,
    `fee=${report.feeLuna.toString()} Luna`,
    `feeLuna=${report.feeLuna.toString()}`,
    `feeNim=${report.feeNim}`,
    `expectedFinalBalanceNim=${report.expectedFinalNim}`,
    `expectedFinalBalanceLuna=${report.expectedFinalLuna.toString()}`,
    `signed=${report.signed ? 'yes' : 'no'}`,
    `broadcast=${report.broadcast === true ? 'yes' : report.broadcast === false ? 'no' : 'unknown'}`,
  ]
  if (report.mode !== 'preview') {
    lines.push(`tx_hash=${report.txHash}`)
  }
  if (report.mode === 'ambiguous') {
    lines.push(`submitted_tx_hash=${report.submittedTxHash ?? 'none'}`)
    lines.push('Do not retry. Reconcile this transaction.')
  }
  if (report.mode === 'confirmed' || report.mode === 'submitted') {
    lines.push(`chain_status=${report.chainStatus}`)
    lines.push(`confirmed_sender=${report.confirmedSender ?? 'UNAVAILABLE'}`)
    lines.push(`confirmed_recipient=${report.confirmedRecipient ?? 'UNAVAILABLE'}`)
    lines.push(`confirmed_amount_luna=${report.confirmedAmountLuna?.toString() ?? 'UNAVAILABLE'}`)
    lines.push(`sender_match=${report.senderMatch ? 'yes' : 'no'}`)
    lines.push(`recipient_match=${report.recipientMatch ? 'yes' : 'no'}`)
    lines.push(`amount_match=${report.amountMatch ? 'yes' : 'no'}`)
    lines.push(`finalTreasuryBalanceNim=${report.finalBalanceNim ?? 'UNAVAILABLE'}`)
    lines.push(`finalTreasuryBalanceLuna=${report.finalBalanceLuna?.toString() ?? 'UNAVAILABLE'}`)
    lines.push(`leave_match=${report.leaveMatch ? 'yes' : 'no'}`)
  }
  return lines.join('\n')
}

function decoratePlan(plan: SweepPlan): SweepPlanFields {
  return {
    ...plan,
    currentBalanceNim: formatNimFromLuna(plan.currentBalanceLuna),
    sendNim: formatNimFromLuna(plan.sendLuna),
    leaveNim: formatNimFromLuna(plan.leaveLuna),
    feeNim: formatNimFromLuna(plan.feeLuna),
    expectedFinalNim: formatNimFromLuna(plan.expectedFinalLuna),
  }
}

function assertExactIntent(plan: SweepPlan, intent: SignedBasicTransfer): void {
  if (intent.network !== 'mainnet') throw new PayoutError('PAYOUT_NETWORK_INVALID')
  if (intent.networkId !== NIMIQ_MAINNET_NETWORK_ID) throw new PayoutError('PAYOUT_NETWORK_INVALID')
  if (normalizeNimiqAddress(intent.sender) !== plan.treasury) throw new PayoutError('WALLET_MISMATCH')
  if (normalizeNimiqAddress(intent.recipient) !== plan.recipient) throw new PayoutError('WALLET_MISMATCH')
  if (intent.amountLuna !== plan.sendLuna) throw new PayoutError('PAYOUT_TX_MISMATCH')
  if (intent.feeLuna !== plan.feeLuna) throw new PayoutError('PAYOUT_TX_MISMATCH')
  if (plan.currentBalanceLuna - intent.amountLuna - intent.feeLuna !== plan.leaveLuna) {
    throw new PayoutError('PAYOUT_AMOUNT_INVALID')
  }
}

async function waitForChain(
  transport: SweepTransport,
  txHash: string,
  options: {
    readonly sleep: (ms: number) => Promise<void>
    readonly timeoutMs: number
    readonly pollMs: number
  },
): Promise<TreasuryTransaction | null> {
  const deadline = Date.now() + options.timeoutMs
  let chain = await transport.getTransaction(txHash)
  while (chain?.status !== 'confirmed' && Date.now() < deadline) {
    await options.sleep(options.pollMs)
    chain = await transport.getTransaction(txHash)
  }
  return chain
}

async function readFinalBalance(
  transport: SweepTransport,
  leaveLuna: bigint,
  options: {
    readonly sleep: (ms: number) => Promise<void>
    readonly timeoutMs: number
    readonly pollMs: number
  },
): Promise<bigint | null> {
  try {
    let balance = await transport.getBalance()
    const deadline = Date.now() + options.timeoutMs
    while (balance !== leaveLuna && Date.now() < deadline) {
      await options.sleep(options.pollMs)
      balance = await transport.getBalance()
    }
    return balance
  } catch {
    return null
  }
}

function readOption(
  argv: readonly string[],
  index: number,
  name: string,
): { readonly value: string; readonly index: number } | null {
  const arg = argv[index]
  if (arg === name) {
    const value = argv[index + 1]
    if (value == null || value.startsWith('--')) throw new PayoutError('MALFORMED_REQUEST')
    return { value, index: index + 1 }
  }
  if (arg.startsWith(`${name}=`)) {
    return { value: arg.slice(name.length + 1), index }
  }
  return null
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
