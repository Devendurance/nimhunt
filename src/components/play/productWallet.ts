let rememberedProductWallet: string | null = null

export function rememberProductWallet(wallet: string): void {
  rememberedProductWallet = wallet
}

export function getRememberedProductWallet(): string | null {
  return rememberedProductWallet
}

export function clearRememberedProductWallet(): void {
  rememberedProductWallet = null
}
