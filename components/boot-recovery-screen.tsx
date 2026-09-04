type BootRecoveryScreenProps = {
  title: string;
  description: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  helperText: string;
};

// Shared dark-theme recovery UI for the route error boundary
// (app/error.tsx), the global error boundary (app/global-error.tsx), and
// the Home boot watchdog (app/page.tsx) -- one visual language for "the app
// got stuck or crashed, here's how to get unstuck" across all three
// triggers. Deliberately has no imports beyond the props it's given (no
// data fetching, no repositories, no auth) so it stays cheap and safe to
// render from app/global-error.tsx, which must not depend on large
// app/business modules -- it can render even when most of the app failed.
export function BootRecoveryScreen({
  title,
  description,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  helperText,
}: BootRecoveryScreenProps) {
  return (
    <main className="fixed inset-0 z-50 flex items-center justify-center bg-black px-4 text-white">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.05] p-6 text-center">
        <h1 className="text-lg font-semibold text-white">{title}</h1>
        <p className="mt-2 text-sm text-white/70">{description}</p>

        <button
          type="button"
          onClick={onPrimary}
          className="mt-5 w-full rounded-xl bg-yellow-500 py-3 font-semibold text-black"
        >
          {primaryLabel}
        </button>

        {secondaryLabel && onSecondary ? (
          <button
            type="button"
            onClick={onSecondary}
            className="mt-2.5 w-full rounded-xl border border-white/15 bg-white/[0.04] py-3 text-sm font-semibold text-white"
          >
            {secondaryLabel}
          </button>
        ) : null}

        <p className="mt-4 text-xs text-white/45">{helperText}</p>
      </div>
    </main>
  );
}
