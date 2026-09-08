import type Phaser from 'phaser'

/** Runtime-only framing: source artwork is never modified. */
export function frameArtwork(scene: Phaser.Scene, source: string, key: string, isolate = false): void {
  if (scene.textures.exists(key) || !scene.textures.exists(source)) return
  const image = scene.textures.get(source).getSourceImage() as HTMLImageElement
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { width, height } = canvas
  const count = width * height
  const opaque = (i: number) => pixels.data[i * 4 + 3] > 24
  let selected: Uint8Array | undefined
  if (isolate) {
    const visited = new Uint8Array(count)
    const queue = new Int32Array(count)
    let largest: number[] = []
    for (let i = 0; i < count; i++) {
      if (visited[i] || !opaque(i)) continue
      let head = 0, tail = 1
      queue[0] = i
      visited[i] = 1
      while (head < tail) {
        const p = queue[head++]
        const x = p % width
        for (const next of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
          if (next < 0 || next >= count || visited[next] || !opaque(next)) continue
          visited[next] = 1
          queue[tail++] = next
        }
      }
      if (tail > largest.length) largest = Array.from(queue.subarray(0, tail))
    }
    selected = new Uint8Array(count)
    for (const p of largest) selected[p] = 1
  }
  let left = width, top = height, right = -1, bottom = -1
  for (let i = 0; i < count; i++) {
    if (selected && !selected[i]) pixels.data[i * 4 + 3] = 0
    if (!opaque(i)) continue
    left = Math.min(left, i % width)
    right = Math.max(right, i % width)
    top = Math.min(top, Math.floor(i / width))
    bottom = Math.max(bottom, Math.floor(i / width))
  }
  if (right < left) return
  ctx.putImageData(pixels, 0, 0)
  const output = document.createElement('canvas')
  output.height = 96
  output.width = Math.max(1, Math.round(96 * (right - left + 1) / (bottom - top + 1)))
  output.getContext('2d')!.drawImage(canvas, left, top, right - left + 1, bottom - top + 1, 0, 0, output.width, output.height)
  scene.textures.addCanvas(key, output)
}
