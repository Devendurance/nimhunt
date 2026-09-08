import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  ArrowUpRight,
  Compass,
  Flame,
  Gem,
  KeyRound,
  ListChecks,
  LockKeyhole,
  PackageOpen,
  Play,
  Sparkles,
  Star,
  Trophy,
} from 'lucide-react'

const icons = {
  arrowLeft: ArrowLeft,
  arrowUpRight: ArrowUpRight,
  compass: Compass,
  flame: Flame,
  gem: Gem,
  key: KeyRound,
  listChecks: ListChecks,
  lock: LockKeyhole,
  package: PackageOpen,
  play: Play,
  sparkles: Sparkles,
  star: Star,
  trophy: Trophy,
} satisfies Record<string, LucideIcon>

export type PlayIconName = keyof typeof icons

export function PlayIcon({ name, size = 18, strokeWidth = 1.8, className }: { name: PlayIconName; size?: number; strokeWidth?: number; className?: string }) {
  const Icon = icons[name]
  return <Icon className={className} size={size} strokeWidth={strokeWidth} aria-hidden="true" focusable="false" />
}
