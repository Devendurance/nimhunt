import Phaser from 'phaser'
import { BootScene } from '../scenes/BootScene'
import { AngkorDevScene } from '../scenes/AngkorDevScene'
import { ANGKOR_ROOM_01 } from '../world/room01'
import { TILE_SIZE } from '../world/grid'
import type { NimHuntGameBridge } from '../events/gameEvents'
import type { CreateGameOptions } from '../createNimHuntGame'

export function createGameConfig(
  parent: HTMLElement,
  bridge: NimHuntGameBridge,
  options: CreateGameOptions,
): Phaser.Types.Core.GameConfig {
  const gameWidth = ANGKOR_ROOM_01.width * TILE_SIZE // 384px
  const gameHeight = ANGKOR_ROOM_01.height * TILE_SIZE // 320px

  return {
    type: Phaser.AUTO,
    parent,
    width: gameWidth,
    height: gameHeight,
    backgroundColor: '#132A26', // Temple Night
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: gameWidth,
      height: gameHeight,
    },
    audio: {
      noAudio: true,
    },
    input: {
      keyboard: false,
    },
    render: {
      roundPixels: true,
      antialias: true,
    },
    scene: [BootScene, new AngkorDevScene(bridge, options)],
  }
}
