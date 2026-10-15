export interface Rect { top: number; left: number; width: number; height: number }

/** The padded, viewport-clamped hole for the tour spotlight; null when there is nothing visible to highlight. */
export function spotlightRect(target: Rect | null, padding: number, viewport: { width: number; height: number }): Rect | null {
  if (!target || target.width <= 0 || target.height <= 0) return null
  const top = Math.max(0, target.top - padding)
  const left = Math.max(0, target.left - padding)
  const bottom = Math.min(viewport.height, target.top + target.height + padding)
  const right = Math.min(viewport.width, target.left + target.width + padding)
  if (bottom <= top || right <= left) return null
  return { top, left, width: right - left, height: bottom - top }
}
