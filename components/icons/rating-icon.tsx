// Original inline SVG, not an icon package -- matches the thin-stroke,
// rounded-join line style already used across the app's other inline icons
// (see e.g. app/admin/page.tsx's nav icons). Adapted from the reference
// screenshot's trophy motif (used there for the "ТОП-1" tournament badge)
// into a standalone, reusable rating symbol: cup, two handles, stem, base.
// Used consistently everywhere rating is visually represented (leaderboard
// header, optionally the Home rating preview) -- never an emoji.
export function RatingIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M7 4h10v4.5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5.5H4.75a1.75 1.75 0 0 0 0 3.5H7" />
      <path d="M17 5.5h2.25a1.75 1.75 0 0 1 0 3.5H17" />
      <path d="M12 13.5v3" />
      <path d="M9 20h6" />
      <path d="M10.3 16.8 9 20" />
      <path d="M13.7 16.8 15 20" />
    </svg>
  );
}
