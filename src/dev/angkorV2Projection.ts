import { ROOM, ROOM_SIZE, TILE, WALL_HEIGHT, TEST_ASSETS, cell, walls, poses, groundPoint, compareDepth, wallCoversFoot, type Pose, type WallCell } from './angkorV2ProjectionModel'

// Dedicated Vite development HTML entry. App and /play never import this.
if (import.meta.env.DEV) void mountProjection().catch(error => {
  const status = document.getElementById('status')!
  status.dataset.error = 'true'
  status.textContent = `Projection could not load: ${String(error)}`
})

async function mountProjection() {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const room = element<HTMLCanvasElement>('room'), phone = element<HTMLCanvasElement>('phone')
  const annotated = element<HTMLCanvasElement>('annotated'), status = element<HTMLParagraphElement>('status')
  const pose = element<HTMLSelectElement>('pose'), grid = element<HTMLInputElement>('grid')
  const doorPass = element<HTMLInputElement>('door-pass')
  const paths = {
    ...TEST_ASSETS,
    root: '/assets/game/angkor-v2/nature/roots/root-wall-v2.png',
    fern: '/assets/game/angkor-v2/nature/foliage/fern-a-v2.png',
    moss: '/assets/game/angkor-v2/nature/foliage/moss-cluster-v2.png',
    rubble: '/assets/game/angkor-v2/environment/rubble/rubble-small-a-v2.png',
    guardian: '/assets/game/angkor-v2/environment/architecture/guardian-statue-v2.png',
  }
  const images = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, path]) => {
    const image = new Image(); image.src = path; await image.decode(); return [key, image]
  }))) as Record<keyof typeof paths, HTMLImageElement>
  const context = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; return ctx
  }
  const ctx = context(room)
  const pattern = (key: 'top' | 'face' | 'floor', width: number, height: number) => {
    const p = ctx.createPattern(images[key], 'repeat')!
    p.setTransform(new DOMMatrix().scale(width / images[key].width, height / images[key].height))
    return p
  }
  const top = pattern('top', 96, 96), face = pattern('face', 96, 64), floor = pattern('floor', 128, 128)
  const fill = (x: number, y: number, width: number, height: number, style: string | CanvasPattern | CanvasGradient) => {
    ctx.fillStyle = style; ctx.fillRect(x, y, width, height)
  }
  const shade = (x: number, y: number, width: number, height: number, upper: string, lower: string) => {
    const g = ctx.createLinearGradient(x, y, x, y + height); g.addColorStop(0, upper); g.addColorStop(1, lower)
    fill(x, y, width, height, g)
  }
  const sprite = (key: 'root' | 'fern' | 'moss' | 'rubble' | 'guardian' | 'explorer', x: number, foot: number, width: number, height: number) => {
    ctx.drawImage(images[key], x - width / 2, foot - height, width, height)
  }
  const wall = (w: WallCell) => {
    const x = w.x * TILE, y = w.topY, base = w.depth
    fill(x, y, TILE, TILE, top)
    // Only exposed boundaries receive faces/bevels: internal joins remain solid.
    if (w.north) { fill(x, y, TILE, 2, '#4c4227'); fill(x + 1, y + 2, TILE - 2, 1, '#e6c886') }
    if (w.south) {
      const start = base - WALL_HEIGHT
      shade(x - 2, base, TILE + 4, 7, '#201e16b8', '#201e1600')
      fill(x, start, TILE, WALL_HEIGHT, face)
      shade(x, start, TILE, WALL_HEIGHT, '#50402544', '#25251aca')
      fill(x, start, TILE, 2, '#d4ae6b')
      fill(x, base - 2, TILE, 2, '#312e1c')
    }
    // Camera looks along Y: E/W faces are narrow vertical return bevels,
    // not full isometric side planes. They bridge top to ground at corners.
    if (w.east) { fill(x + TILE - 3, y + 2, 3, base - y - 2, face); fill(x + TILE - 2, y + 2, 2, base - y - 2, '#342e2088') }
    if (w.west) { fill(x, y + 2, 3, base - y - 2, face); fill(x, y + 2, 1, base - y - 2, '#e5c78699') }
  }
  const doorway = () => {
    const x = 7 * TILE, y = 7 * TILE, base = 8 * TILE
    // Two returns and a raised lintel leave an actual see-through floor gap.
    for (const jamb of [x, x + 28]) {
      fill(jamb, y - WALL_HEIGHT, 4, TILE, top)
      fill(jamb, y + TILE - WALL_HEIGHT, 4, WALL_HEIGHT, face)
      shade(jamb, y - WALL_HEIGHT, 4, TILE + WALL_HEIGHT, '#b3945655', '#25251ac0')
    }
    fill(x + 4, y - WALL_HEIGHT, 24, 14, top)
    fill(x + 4, y - WALL_HEIGHT + 14, 24, 8, face)
    fill(x + 4, y - WALL_HEIGHT + 21, 24, 2, '#25251b')
    shade(x + 4, base - 7, 24, 7, '#28261955', '#28261900')
  }
  const breach = () => {
    const x = 9 * TILE, y = 7 * TILE
    const fragments = [[0, 9, 5, 20], [4, 17, 3, 13], [26, 6, 6, 25], [23, 20, 4, 12]]
    for (const [dx, dy, width, height] of fragments) {
      fill(x + dx, y - WALL_HEIGHT + dy, width, height, top)
      fill(x + dx, y - WALL_HEIGHT + dy + height, width, 10, face)
      shade(x + dx, y - WALL_HEIGHT + dy + height, width, 10, '#4a392b44', '#25251ac0')
    }
    sprite('rubble', x + 5, y + 32, 18, 12)
    sprite('rubble', x + 28, y + 31, 16, 10)
  }
  const drawGrid = (target: CanvasRenderingContext2D) => {
    target.save(); target.strokeStyle = '#63dbe077'; target.lineWidth = 1
    for (let i = 0; i <= ROOM_SIZE; i++) {
      target.beginPath(); target.moveTo(i * TILE + .5, 0); target.lineTo(i * TILE + .5, 384); target.stroke()
      target.beginPath(); target.moveTo(0, i * TILE + .5); target.lineTo(384, i * TILE + .5); target.stroke()
    }
    target.restore()
  }
  let doorProgress: number | undefined
  const footPoint = () => doorProgress === undefined ? groundPoint(poses[pose.value as Pose].x, poses[pose.value as Pose].y) : groundPoint(7.5, 6.65 + doorProgress * 2)
  const paintRoom = (foot: { x: number; y: number }) => {
    ctx.clearRect(0, 0, 384, 384); fill(0, 0, 384, 384, floor)
    // Ambient floor contact at lateral wall boundaries, underneath raised solids.
    for (const w of walls) {
      if (w.east) fill((w.x + 1) * TILE, w.y * TILE, 5, TILE, '#29291c3d')
      if (w.west) fill(w.x * TILE - 4, w.y * TILE, 4, TILE, '#29291c30')
    }
    const commands: { depth: number; order: number; paint: () => void }[] = walls.map(w => ({ depth: w.depth, order: 2, paint: () => wall(w) }))
    commands.push({ depth: 256, order: 2, paint: doorway }, { depth: 256, order: 2, paint: breach })
    // Vegetation attaches to masonry seams and breaches, never random floor spots.
    commands.push(
      { depth: 96, order: 3, paint: () => { sprite('root', 342, 91, 38, 61); sprite('fern', 335, 77, 32, 24) } },
      { depth: 64, order: 3, paint: () => { sprite('moss', 196, 46, 29, 20); sprite('fern', 177, 64, 25, 23) } },
      { depth: 123, order: 1, paint: () => sprite('guardian', 194, 123, 38, 49) },
      { depth: 256, order: 3, paint: () => { sprite('root', 320, 257, 35, 55); sprite('fern', 287, 240, 21, 19) } },
      { depth: 320, order: 3, paint: () => sprite('fern', 133, 293, 28, 24) },
      { depth: foot.y, order: 1, paint: () => {
        ctx.fillStyle = '#24271bb0'; ctx.beginPath(); ctx.ellipse(foot.x, foot.y - 1, 7, 3, 0, 0, Math.PI * 2); ctx.fill()
        sprite('explorer', foot.x, foot.y + 1, 25, 28)
      } },
    )
    commands.sort(compareDepth).forEach(c => c.paint())
    if (grid.checked) drawGrid(ctx)
  }
  const render = () => {
    const foot = footPoint()
    paintRoom(foot)
    const pctx = context(phone); pctx.clearRect(0, 0, 320, 384); pctx.drawImage(room, 32, 0, 320, 384, 0, 0, 320, 384)
    const a = context(annotated); a.clearRect(0, 0, 880, 560); a.fillStyle = '#1b3833'; a.fillRect(0, 0, 880, 560)
    // Same renderer and depth commands, with a fixed foreground test position.
    paintRoom(groundPoint(poses.behind.x, poses.behind.y))
    a.drawImage(room, 168, 88)
    paintRoom(foot)
    a.strokeStyle = '#63dbe0'; a.lineWidth = 2
    a.strokeRect(168 + 4 * TILE + 1, 88 + 4 * TILE + 1, 30, 30)
    a.strokeStyle = '#ead88c'; a.strokeRect(168 + 4 * TILE + 1, 88 + 4 * TILE - WALL_HEIGHT + 1, 30, 30)
    const callout = (label: string, sx: number, sy: number, tx: number, ty: number, color = '#f3ead7') => {
      a.strokeStyle = color; a.fillStyle = color; a.lineWidth = 1
      a.beginPath(); a.moveTo(sx, sy); a.lineTo(tx + 168, ty + 88); a.stroke()
      a.beginPath(); a.arc(tx + 168, ty + 88, 3, 0, Math.PI * 2); a.fill()
      a.font = '14px system-ui'; a.fillText(label, sx < 360 ? 12 : sx + 8, sy - 8)
    }
    callout('WALL TOP · z = 24', 150, 63, 144, 112, '#ead88c')
    callout('VERTICAL FACE', 563, 84, 222, 53)
    callout('FLOOR · z = 0', 563, 185, 269, 168)
    callout('FOREGROUND OCCLUSION', 563, 315, 272, 214)
    callout('COLLISION · 32×32', 150, 278, 144, 144, '#63dbe0')
    callout('INNER CORNER', 150, 390, 157, 252)
    callout('OUTER CORNER / CAP', 563, 427, 266, 215)
    callout('DOORWAY', 150, 491, 240, 237)
    callout('BROKEN OPENING', 563, 491, 304, 245)
    a.fillStyle = '#f3ead7'; a.font = '13px system-ui'; a.fillText('Same 32px grid · yellow: raised visual top · cyan: ground collision cell', 168, 535)
    const occluded = walls.some(w => wallCoversFoot(w, foot))
    const occupied = ROOM.reduce((n, row) => n + [...row].filter(c => c === '#').length, 0)
    status.textContent = `9 PNGs loaded · ${occupied}/144 masonry cells · Explorer foot (${foot.x.toFixed(1)}, ${foot.y.toFixed(1)}) · ${occluded ? 'foreground wall covers lower body' : cell(Math.floor(foot.x / TILE), Math.floor(foot.y / TILE)) === 'D' ? 'passing beneath lintel' : 'feet on recessed floor'} · visual-only`
    room.dataset.pose = doorProgress === undefined ? pose.value : 'door-pass'
    room.dataset.occluded = String(occluded)
    room.dataset.foot = `${foot.x},${foot.y}`
  }
  pose.addEventListener('change', () => { doorProgress = undefined; render() })
  grid.addEventListener('change', render)
  doorPass.addEventListener('input', () => { pose.value = 'doorway'; doorProgress = Number(doorPass.value) / 100; render() })
  render()
}
