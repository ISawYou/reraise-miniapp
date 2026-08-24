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

function formatCompactDate(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function getCompactCtaLabel(event: ClubActivityEvent) {
  const url = event.cta_url ?? "";
  if (url.startsWith("/tournaments/")) return "Турнир";
  if (url.startsWith("/academy")) return "Академия";
  if (url.includes("achievements")) return "Достижения";
  if (url.startsWith("/leaderboard")) return "Рейтинг";
  return (event.cta_label ?? "Перейти").replace(/^Открыть\s+/i, "").replace(/→/g, "").trim();
}

export function ClubActivityCard({
  event,
  compact = false,
  contentHref,
  social,
}: {
  event: ClubActivityEvent;
  compact?: boolean;
  contentHref?: string;
  social?: {
    likeCount: number;
    likedByMe: boolean;
    commentCount: number;
    onToggleLike: () => void;
    likeDisabled?: boolean;
    commentHref: string;
  };
}) {
  const presentation = EVENT_PRESENTATION[event.event_type];

  if (compact) {
    return (
      <Link
        href={`/activity/${event.id}`}
        className="flex min-h-12 items-center gap-3 px-3 py-2 transition-colors hover:bg-white/[0.035]"
      >
        {event.player?.avatar_url ? (
          <span
            role="img"
            aria-label={event.player.display_name}
            className="h-8 w-8 shrink-0 rounded-lg border border-white/10 bg-cover bg-center"
            style={{ backgroundImage: `url("${event.player.avatar_url}")` }}
          />
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[10px] font-bold text-white/70">
            {presentation.icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight text-white">{event.title}</p>
          <p className="mt-0.5 truncate text-[11px] text-white/38">
            {presentation.label}{event.published_at ? ` · ${formatCompactDate(event.published_at)}` : ""}
          </p>
        </div>
      </Link>
    );
  }

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
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-white/58">
            {event.achievement?.name ?? event.body}
          </p>
          {event.achievement ? (
            <p className="mt-1 text-xs text-[#d7b55a]/75">{event.achievement.description}</p>
          ) : null}
        </div>
      </div>

      {event.image_url ? (
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
      {contentHref ? <Link href={contentHref} className="block">{content}</Link> : content}
      {social ? (
        <div className="mt-3 flex items-center gap-2 border-t border-white/[0.06] pt-3">
          <button
            type="button"
            disabled={social.likeDisabled}
            onClick={social.onToggleLike}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur transition disabled:opacity-50 ${
              social.likedByMe
                ? "border-rose-400/25 bg-rose-500/12 text-rose-200"
                : "border-white/10 bg-white/[0.04] text-white/60"
            }`}
          >
            {social.likedByMe ? "❤️" : "♡"} {social.likeCount}
          </button>
          <Link
            href={social.commentHref}
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/60 backdrop-blur"
          >
            💬 {social.commentCount}
          </Link>
          {event.cta_label && event.cta_url ? (
            event.cta_url.startsWith("/") ? (
              <Link
                href={event.cta_url}
                className="ml-auto rounded-full border border-[#d7b55a]/20 bg-[#d7b55a]/10 px-3 py-1.5 text-xs font-semibold text-[#e2c979] backdrop-blur"
              >
                {getCompactCtaLabel(event)}
              </Link>
            ) : (
              <a
                href={event.cta_url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto rounded-full border border-[#d7b55a]/20 bg-[#d7b55a]/10 px-3 py-1.5 text-xs font-semibold text-[#e2c979] backdrop-blur"
              >
                {getCompactCtaLabel(event)}
              </a>
            )
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
