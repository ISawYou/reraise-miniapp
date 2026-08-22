"use client";

import Link from "next/link";
import type { ClubActivityEvent } from "@/types/club-activity";

const EVENT_PRESENTATION = {
  news: { label: "Новость", accent: "border-white/10", icon: "N" },
  update: { label: "Обновление", accent: "border-sky-400/20", icon: "U" },
  tournament_announcement: { label: "Турнир", accent: "border-emerald-400/20", icon: "T" },
  tournament_winner: { label: "Победитель", accent: "border-[#d7b55a]/30", icon: "W" },
  achievement: { label: "Достижение", accent: "border-[#d7b55a]/35", icon: "A" },
} as const;

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

export function ClubActivityCard({
  event,
  compact = false,
}: {
  event: ClubActivityEvent;
  compact?: boolean;
}) {
  const presentation = EVENT_PRESENTATION[event.event_type];
  const content = (
    <>
      <div className="flex items-start gap-3">
        {event.player?.avatar_url ? (
          <span
            role="img"
            aria-label={event.player.display_name}
            className="h-10 w-10 shrink-0 rounded-xl border border-white/10 bg-cover bg-center"
            style={{ backgroundImage: `url("${event.player.avatar_url}")` }}
          />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-xs font-bold text-white/70">
            {presentation.icon}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/38">
              {presentation.label}
            </span>
            <time className="shrink-0 text-[11px] text-white/30">
              {formatDate(event.published_at)}
            </time>
          </div>
          <h3 className="mt-1 text-sm font-bold leading-snug text-white">{event.title}</h3>
          <p className={`mt-1 text-sm leading-relaxed text-white/58 ${compact ? "line-clamp-2" : "whitespace-pre-line"}`}>
            {event.achievement?.name ?? event.body}
          </p>
          {!compact && event.achievement ? (
            <p className="mt-1 text-xs text-[#d7b55a]/75">{event.achievement.description}</p>
          ) : null}
        </div>
      </div>

      {event.image_url && !compact ? (
        <div
          role="img"
          aria-label={event.title}
          className="mt-3 aspect-[16/9] w-full rounded-2xl border border-white/10 bg-cover bg-center"
          style={{ backgroundImage: `url("${event.image_url}")` }}
        />
      ) : null}
    </>
  );

  return (
    <article className={`rounded-2xl border ${presentation.accent} bg-white/[0.035] p-3.5`}>
      {content}
      {event.cta_label && event.cta_url ? (
        event.cta_url.startsWith("/") ? (
          <Link href={event.cta_url} className="mt-3 inline-flex text-sm font-semibold text-[#d7b55a]">
            {event.cta_label} →
          </Link>
        ) : (
          <a
            href={event.cta_url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex text-sm font-semibold text-[#d7b55a]"
          >
            {event.cta_label} →
          </a>
        )
      ) : null}
    </article>
  );
}
