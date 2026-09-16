import type { HuntLaunchConfig } from '../../data/marketing.types'

export const HUNT_IN_NIMIQ_PAY_LABEL = 'Hunt in Nimiq Pay'
export const ENTER_TODAYS_HUNT_LABEL = "Enter today's hunt"
export const IN_APP_HUNT_HREF = '/play'

export type LandingHuntCta =
  | { readonly kind: 'in-app'; readonly label: string; readonly href: '/play' }
  | { readonly kind: 'deep-link'; readonly label: string; readonly href: string }
  | { readonly kind: 'unavailable'; readonly label: string }

export function resolveLandingHuntCta(options: {
  readonly inNimiqPay: boolean
  readonly launchConfig: HuntLaunchConfig
  readonly label?: string
}): LandingHuntCta {
  if (options.inNimiqPay) {
    return {
      kind: 'in-app',
      label: ENTER_TODAYS_HUNT_LABEL,
      href: IN_APP_HUNT_HREF,
    }
  }

  const label = options.label ?? HUNT_IN_NIMIQ_PAY_LABEL
  if (options.launchConfig.kind === 'configured') {
    return { kind: 'deep-link', label, href: options.launchConfig.deepLink }
  }
  return { kind: 'unavailable', label }
}
