"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

export default function PlayerAchievementsPage() {
  const params = useParams<{ id: string }>();
  const playerId = params?.id;

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-md">
        <Link
          href={playerId ? `/players/${playerId}` : "/"}
          className="inline-flex items-center rounded-full border border-white/[0.08] bg-transparent px-3.5 py-2 text-sm text-white/65"
        >
          ← Назад
        </Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight">Достижения</h1>
        <p className="mt-2 text-sm text-white/45">
          Этот раздел скоро появится.
        </p>

        <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.05] p-5 text-white/70">
          Здесь появятся достижения игрока и прогресс по ним.
        </div>
      </div>
    </main>
  );
}
