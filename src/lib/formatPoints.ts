/**
 * Shared points labels: `0 pt` / `1 pt` / `N pts`, optional leading `+`.
 */

export function formatPoints(
  value: number,
  options?: { signed?: boolean },
): string {
  const magnitude = Math.abs(value)
  const unit = magnitude <= 1 ? 'pt' : 'pts'
  if (options?.signed && value > 0) {
    return `+${value} ${unit}`
  }
  return `${value} ${unit}`
}
