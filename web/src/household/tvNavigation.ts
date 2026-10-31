export type Direction = 'up' | 'down' | 'left' | 'right'
export type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number }

/** Spatial fallback for controls/grids. Shelf-to-shelf movement uses explicit rows. */
export function directionalIndex(origin: Box, candidates: Box[], direction: Direction): number {
  const vertical = direction === 'up' || direction === 'down'
  const negative = direction === 'up' || direction === 'left'
  const cx = (origin.left + origin.right) / 2
  const cy = (origin.top + origin.bottom) / 2
  let result = -1
  let score = Infinity
  candidates.forEach((r, i) => {
    const x = (r.left + r.right) / 2
    const y = (r.top + r.bottom) / 2
    const main = vertical ? y - cy : x - cx
    if (negative ? main >= -2 : main <= 2) return
    const cross = vertical ? Math.abs(x - cx) : Math.abs(y - cy)
    const overlap = vertical
      ? Math.min(origin.right, r.right) - Math.max(origin.left, r.left)
      : Math.min(origin.bottom, r.bottom) - Math.max(origin.top, r.top)
    const next = Math.abs(main) + cross * 2 + (overlap <= 0 ? 10000 : 0)
    if (next < score) { result = i; score = next }
  })
  return result
}

/** Keep the same on-screen column when moving between differently scrolled shelves. */
export function closestColumn(center: number, candidates: Box[], viewportWidth: number): number {
  let result = -1
  let score = Infinity
  candidates.forEach((r, i) => {
    if (r.right < 64 || r.left > viewportWidth) return
    const next = Math.abs((r.left + r.right) / 2 - center)
    if (next < score) { result = i; score = next }
  })
  return result < 0 && candidates.length ? 0 : result
}
