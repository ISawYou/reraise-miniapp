"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ClubActivityCard } from "@/components/club-activity-card";
import type { ClubActivityComment, ClubActivityDetail } from "@/types/club-activity";

function formatCommentDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ClubActivityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/club-activity/${id}`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Не удалось загрузить публикацию");
        setDetail(payload);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, [id]);

  async function toggleLike() {
    if (!detail || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/club-activity/${id}/like`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Не удалось изменить отметку");
      setDetail((current) => current ? {
        ...current,
        likedByMe: payload.liked,
        likeCount: payload.likeCount,
      } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ошибка отправки");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = commentBody.trim();
    if (!body || !detail || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/club-activity/${id}/comments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Не удалось добавить комментарий");
      setDetail((current) => current ? {
        ...current,
        comments: [...current.comments, payload.comment as ClubActivityComment],
      } : current);
      setCommentBody("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ошибка отправки");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#080808] px-4 py-6 pb-32 text-white">
      <div className="relative mx-auto max-w-md">
        <Link href="/activity" className="telegram-top-action inline-flex text-sm text-white/55">
          ← Все события
        </Link>
        {loading ? <p className="mt-6 text-sm text-white/40">Загружаем публикацию...</p> : null}
        {error ? (
          <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        {detail ? (
          <>
            <div className="mt-5">
              <ClubActivityCard event={detail.event} />
            </div>
            <button
              type="button"
              disabled={submitting}
              onClick={toggleLike}
              className={`mt-3 rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                detail.likedByMe
                  ? "border-rose-400/35 bg-rose-500/15 text-rose-200"
                  : "border-white/10 bg-white/[0.04] text-white/70"
              }`}
            >
              {detail.likedByMe ? "❤️" : "♡"} {detail.likeCount}
            </button>

            <section className="mt-6">
              <h2 className="text-lg font-bold">Комментарии · {detail.comments.length}</h2>
              <form onSubmit={submitComment} className="mt-3">
                <textarea
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="Написать комментарий"
                  className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white outline-none placeholder:text-white/30"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-white/30">{commentBody.length} / 1000</span>
                  <button
                    type="submit"
                    disabled={submitting || !commentBody.trim()}
                    className="rounded-xl bg-[#d7b55a] px-4 py-2 text-sm font-bold text-black disabled:opacity-40"
                  >
                    Отправить
                  </button>
                </div>
              </form>

              <div className="mt-4 space-y-3">
                {detail.comments.map((comment) => (
                  <article key={comment.id} className="flex gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
                    {comment.player.avatar_url ? (
                      <span
                        role="img"
                        aria-label={comment.player.display_name}
                        className="h-9 w-9 shrink-0 rounded-full bg-cover bg-center"
                        style={{ backgroundImage: `url("${comment.player.avatar_url}")` }}
                      />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-xs font-bold">
                        {comment.player.display_name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold">{comment.player.display_name}</p>
                        <time className="shrink-0 text-[10px] text-white/30">{formatCommentDate(comment.created_at)}</time>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white/65">{comment.body}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
