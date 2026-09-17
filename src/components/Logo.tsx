/**
 * The Ascent mark: a three-quarter progress ring around a centre dot, echoing
 * the XP ring on the dashboard. Drawn in currentColor so the tile behind it can
 * follow the accent and theme. scripts/make-icons.mjs rasterizes the same
 * geometry (64-unit box, r 15, stroke 5.5, 270° arc from 12 o'clock) for the
 * favicon and app icons — change both together.
 */
export function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <circle
        cx="32" cy="32" r="15" fill="none"
        stroke="currentColor" strokeWidth="5.5" strokeLinecap="round"
        strokeDasharray="70.7 30" transform="rotate(-90 32 32)" />
      <circle cx="32" cy="32" r="4.5" fill="currentColor" />
    </svg>
  )
}
