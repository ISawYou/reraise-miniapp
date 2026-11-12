import type { ReactNode } from "react";

export function TournamentDescription({ text, children }: { text: string; children: ReactNode }) {
  if (text.length <= 320) return <>{children}</>;
  return (
    <details className="group">
      <summary className="cursor-pointer text-sm text-[#e9b654]">
        <span className="mb-2 block text-white/75 group-open:hidden">{text.slice(0, 280)}…</span>
        <span className="group-open:hidden">Подробнее</span>
        <span className="hidden group-open:inline">Свернуть</span>
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}
