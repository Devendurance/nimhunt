import { ANGKOR_V2_BY_KEY, ANGKOR_V2_EXPLORER_WALK, ANGKOR_V2_LEGACY_MANIFEST as ANGKOR_V2_MANIFEST, ANGKOR_V2_TILE_SIZE, type AngkorV2AssetKey } from '../game/assets/angkorV2Manifest'

// Separate Vite dev HTML entry; never imported by App, /play, or the production entry.
if (import.meta.env.DEV) void mountShowcase()

async function mountShowcase() {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const status = element<HTMLParagraphElement>('status')
  const scene = element<HTMLCanvasElement>('scene')
  const joins = element<HTMLCanvasElement>('joins')
  const walk = element<HTMLCanvasElement>('walk')
  const scale = element<HTMLSelectElement>('scale')
  const grid = element<HTMLInputElement>('grid')
  const passage = element<HTMLInputElement>('passage')
  const animate = element<HTMLInputElement>('animate')
  const frame = element<HTMLSelectElement>('frame')
  const pose = element<HTMLSelectElement>('pose')
  const direction = element<HTMLSelectElement>('direction')
  const images = new Map<string, HTMLImageElement>()
  const failures: string[] = []
  await Promise.all(ANGKOR_V2_MANIFEST.map(async asset => {
    const img = new Image()
    img.src = asset.path
    try { await img.decode(); images.set(asset.key, img) }
    catch { failures.push(asset.path) }
  }))
  if (failures.length) {
    status.dataset.error = 'true'
    status.textContent = `Missing or invalid images: ${failures.join(', ')}`
    return
  }
  status.textContent = `${images.size} files loaded · 32px logical tiles · no gameplay integration`
  const floors = ANGKOR_V2_MANIFEST.filter(asset => asset.category === 'environment/floors')
  const ctxFor = (canvas: HTMLCanvasElement, width: number, height: number, zoom: number) => {
    canvas.width = width * zoom; canvas.height = height * zoom
    const ctx = canvas.getContext('2d')!
    ctx.scale(zoom, zoom)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    return ctx
  }
  const sprite = (ctx: CanvasRenderingContext2D, key: AngkorV2AssetKey, x: number, y: number, walkFrame = 0, direction = 0) => {
    const asset = ANGKOR_V2_BY_KEY[key]
    const { width, height } = asset.displayDimensions
    const dx = x - width * asset.anchor.x, dy = y - height * asset.anchor.y
    const img = images.get(key)!
    if (key === 'explorer-walk-v2') {
      const sheet = ANGKOR_V2_EXPLORER_WALK
      ctx.drawImage(img, walkFrame * sheet.frameWidth, direction * sheet.frameHeight, sheet.frameWidth, sheet.frameHeight, dx, dy, width, height)
    } else ctx.drawImage(img, dx, dy, width, height)
  }
  const sceneObjects: readonly [AngkorV2AssetKey, number, number][] = [
    ['wall-end-left-v2', 1, 3], ['wall-straight-v2', 3, 3], ['wall-broken-opening-v2', 5.5, 3.3],
    ['wall-straight-mossy-v2', 8, 3], ['monkey-perched-v2', 3, 1.8],
    ['pillar-intact-v2', 1, 5.8], ['guardian-statue-v2', 8.3, 7.1],
    ['root-heavy-v2', 1.2, 8.8], ['root-floor-a-v2', 4.3, 8.8], ['fern-a-v2', 2.2, 5.1],
    ['fern-b-v2', 8.8, 8.8], ['broadleaf-a-v2', 1.2, 4.2], ['grass-edge-v2', 8.3, 9.3],
    ['blue-gem-v2', 5, 5.4], ['pushable-boulder-v2', 3.2, 7.1],
    ['spike-trap-active-v2', 6.6, 6.1], ['snake-coiled-v2', 6.5, 8.3],
    ['rubble-small-a-v2', 2.4, 9.4], ['moss-cluster-v2', 8.9, 4.7],
  ]
  const floorAccents: Record<string, number> = { '2,2': 1, '4,3': 2, '1,8': 4, '2,8': 3, '8,7': 3, '8,8': 5, '3,9': 5, '6,5': 1, '5,8': 2, '9,3': 3 }
  const idleDirections: readonly AngkorV2AssetKey[] = ['explorer-idle-down', 'explorer-idle-left', 'explorer-idle-right', 'explorer-idle-up']
  const drawScene = (walkFrame: number) => {
    const ctx = ctxFor(scene, 320, 320, Number(scale.value))
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      // Sparse deliberate accents avoid a repeating diagonal pattern of cracks.
      const floor = floors[floorAccents[`${x},${y}`] ?? 0]
      ctx.drawImage(images.get(floor.key)!, x * 32, y * 32, 32, 32)
    }
    const explorerKey = animate.checked || pose.value === 'walk' ? 'explorer-walk-v2' : idleDirections[Number(direction.value)]
    const objects = [...sceneObjects, [passage.checked ? 'temple-passage-open-v2' : 'temple-passage-closed-v2', 7.8, 4.1] as const, [explorerKey, 5, 7.2] as const]
    objects.sort((a, b) => a[2] - b[2])
    for (const [key, x, y] of objects) sprite(ctx, key, x * ANGKOR_V2_TILE_SIZE, y * ANGKOR_V2_TILE_SIZE, walkFrame, Number(direction.value))
    if (grid.checked) {
      ctx.strokeStyle = '#132a2655'; ctx.lineWidth = 0.5
      for (let i = 0; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, 320); ctx.moveTo(0, i * 32); ctx.lineTo(320, i * 32); ctx.stroke() }
    }
  }
  const drawChecks = () => {
    const ctx = ctxFor(joins, 320, 192, 2)
    for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) ctx.drawImage(images.get(floors[(x + y) % floors.length].key)!, x * 32, y * 32, 32, 32)
    const walls: readonly AngkorV2AssetKey[] = ['wall-end-left-v2', 'wall-straight-v2', 'wall-straight-damaged-v2', 'wall-straight-mossy-v2', 'wall-end-right-v2']
    walls.forEach((key, i) => sprite(ctx, key, 32 + i * 64, 72))
    const corners: readonly AngkorV2AssetKey[] = ['wall-corner-inner-v2', 'wall-straight-v2', 'wall-straight-damaged-v2', 'wall-straight-v2', 'wall-corner-outer-v2']
    corners.forEach((key, i) => sprite(ctx, key, 32 + i * 64, 160))
    const wc = ctxFor(walk, 128, 160, 3)
    wc.fillStyle = '#1b3833'; wc.fillRect(0, 0, 128, 160)
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      sprite(wc, 'explorer-walk-v2', col * 32 + 16, row * 40 + 36, col, row)
      wc.strokeStyle = '#3e88f7'; wc.lineWidth = 0.4
      wc.beginPath(); wc.moveTo(col * 32 + 3, row * 40 + 36); wc.lineTo(col * 32 + 29, row * 40 + 36); wc.stroke()
    }
  }
  const catalogue = element<HTMLDivElement>('catalogue')
  for (const asset of ANGKOR_V2_MANIFEST) {
    const figure = document.createElement('figure'), swatch = document.createElement('div'), caption = document.createElement('figcaption')
    swatch.className = 'swatch'
    const img = images.get(asset.key)!.cloneNode() as HTMLImageElement
    img.alt = asset.key; img.loading = 'lazy'
    swatch.append(img)
    caption.textContent = `${asset.key} · ${asset.sourceDimensions.width}×${asset.sourceDimensions.height} · display ${asset.displayDimensions.width}×${asset.displayDimensions.height}`
    figure.append(swatch, caption); catalogue.append(figure)
  }
  let animationId = 0, visible = true
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const tick = (time: number) => {
    animationId = 0
    if (!animate.checked || !visible || document.hidden || reducedMotion.matches) return
    drawScene(Math.floor(time / (1000 / ANGKOR_V2_EXPLORER_WALK.framesPerSecond)) % 4)
    animationId = requestAnimationFrame(tick)
  }
  const refresh = () => {
    cancelAnimationFrame(animationId); animationId = 0
    drawScene(Number(frame.value))
    if (animate.checked && visible && !document.hidden && !reducedMotion.matches) animationId = requestAnimationFrame(tick)
  }
  for (const control of [scale, grid, passage, animate, pose, direction]) control.addEventListener('change', refresh)
  frame.addEventListener('change', () => { pose.value = 'walk'; refresh() })
  document.addEventListener('visibilitychange', refresh)
  reducedMotion.addEventListener('change', refresh)
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; refresh() }).observe(scene)
  drawChecks(); refresh()
}
