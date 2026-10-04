import type { AngkorV2AssetKey } from '../../assets/angkorV2Manifest.js'
import type { EnvironmentDepthClass } from './geometry.js'

export interface EnvironmentSprite {
  readonly key: AngkorV2AssetKey; readonly x: number; readonly y: number;
  readonly depthClass?: EnvironmentDepthClass; readonly depthY?: number;
  readonly occludesPlayer?: boolean; readonly alpha?: number; readonly flipX?: boolean; readonly shadow?: boolean;
}
