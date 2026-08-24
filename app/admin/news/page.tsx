"use client";

import { BackButton } from "@/components/ui/back-button";
import { useEffect, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { getTelegramInitData } from "@/lib/telegram";
import type { ClubActivityEvent, ClubActivityEventType } from "@/types/club-activity";
import type { Player } from "@/types/domain";

type FormState = {
  eventType: ClubActivityEventType;
  title: string;
  body: string;
  imageUrl: string;
  ctaLabel: string;
  ctaUrl: string;
  status: "draft" | "published";
};

const EMPTY_FORM: FormState = {
  eventType: "news",
  title: "",
  body: "",
  imageUrl: "",
  ctaLabel: "",
  ctaUrl: "",
  status: "draft",
};

export default function AdminNewsPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [checked, setChecked] = useState(false);
  const [events, setEvents] = useState<ClubActivityEvent[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAutomatic, setEditingAutomatic] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function adminHeaders() {
    const initData = await getTelegramInitData();
    return { "Content-Type": "application/json", "x-telegram-init-data": initData };
  }

  async function loadEvents() {
    const response = await fetch("/api/admin/club-activity", { headers: await adminHeaders() });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Не удалось загрузить публикации");
    setEvents(payload.events ?? []);
  }

  useEffect(() => {
    resolveCurrentPlayer()
      .then(async (current) => {
        setPlayer(current);
        if (current.role === "admin") {
          const initData = await getTelegramInitData();
          const response = await fetch("/api/admin/club-activity", {
            headers: {
              "Content-Type": "application/json",
              "x-telegram-init-data": initData,
            },
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error ?? "Не удалось загрузить публикации");
          }
          setEvents(payload.events ?? []);
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Ошибка доступа"))
      .finally(() => setChecked(true));
  }, []);

  function editEvent(event: ClubActivityEvent) {
    setEditingId(event.id);
    setEditingAutomatic(event.source === "automatic");
    setForm({
      eventType: event.event_type as FormState["eventType"],
      title: event.title,
      body: event.body,
      imageUrl: event.image_url ?? "",
      ctaLabel: event.cta_label ?? "",
      ctaUrl: event.cta_url ?? "",
      status: event.status === "published" ? "published" : "draft",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        editingId ? `/api/admin/club-activity/${editingId}` : "/api/admin/club-activity",
        {
          method: editingId ? "PATCH" : "POST",
          headers: await adminHeaders(),
          body: JSON.stringify(form),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Не удалось сохранить публикацию");
      setForm(EMPTY_FORM);
      setEditingId(null);
      setEditingAutomatic(false);
      await loadEvents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ошибка сохранения");
    } finally {
      setLoading(false);
    }
  }

  async function archive(eventId: string) {
    if (!window.confirm("Архивировать публикацию? Она исчезнет из ленты.")) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/club-activity/${eventId}`, {
        method: "DELETE",
        headers: await adminHeaders(),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Не удалось архивировать публикацию");
      await loadEvents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ошибка архивации");
    } finally {
      setLoading(false);
    }
  }

  if (!checked) return <main className="min-h-screen bg-black p-6 text-white/60">Проверяем доступ...</main>;
  if (player?.role !== "admin") return <main className="min-h-screen bg-black p-6 text-white">Доступ запрещён</main>;

  const inputClass = "mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-3 text-sm text-white outline-none focus:border-[#d7b55a]/40";

  return (
    <main className="min-h-screen bg-[#080808] px-4 py-6 text-white">
      <div className="mx-auto max-w-3xl">
        <BackButton href="/admin" />
        <h1 className="mt-5 text-2xl font-bold">Лента / Новости</h1>
        <p className="mt-1 text-sm text-white/50">Публикации для главной страницы и ленты клуба.</p>

        <form onSubmit={save} className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">{editingId ? "Редактирование" : "Новая публикация"}</h2>
            {editingId ? (
              <button type="button" onClick={() => { setEditingId(null); setEditingAutomatic(false); setForm(EMPTY_FORM); }} className="text-xs text-white/45">Отмена</button>
            ) : null}
          </div>

          <label className="mt-4 block text-xs text-white/50">Тип
            <select disabled={editingAutomatic} value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value as FormState["eventType"] })} className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-55`}>
              <option value="news">Новость</option>
              <option value="update">Обновление</option>
              <option value="tournament_announcement">Турнир</option>
              {editingAutomatic ? (
                <>
                  <option value="tournament_winner">Победитель турнира</option>
                  <option value="achievement">Достижение</option>
                </>
              ) : null}
            </select>
          </label>
          <label className="mt-3 block text-xs text-white/50">Заголовок
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} required className={inputClass} />
          </label>
          <label className="mt-3 block text-xs text-white/50">Текст
            <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} maxLength={5000} required rows={5} className={inputClass} />
          </label>
          <label className="mt-3 block text-xs text-white/50">Изображение URL
            <input type="url" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://..." className={inputClass} />
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-white/50">CTA label
              <input value={form.ctaLabel} onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })} placeholder="Открыть Академию" className={inputClass} />
            </label>
            <label className="block text-xs text-white/50">CTA URL
              <input value={form.ctaUrl} onChange={(e) => setForm({ ...form, ctaUrl: e.target.value })} placeholder="/academy" className={inputClass} />
            </label>
          </div>
          <label className="mt-3 block text-xs text-white/50">Статус
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FormState["status"] })} className={inputClass}>
              <option value="draft">Черновик</option>
              <option value="published">Опубликовано</option>
            </select>
          </label>
          {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
          <button disabled={loading} className="mt-4 w-full rounded-xl bg-[#d7b55a] py-3 text-sm font-bold text-black disabled:opacity-50">
            {loading ? "Сохраняем..." : editingId ? "Сохранить изменения" : "Создать публикацию"}
          </button>
        </form>

        <section className="mt-7">
          <h2 className="text-lg font-semibold">Публикации</h2>
          <div className="mt-3 space-y-2">
            {events.filter((event) => event.status !== "archived").map((event) => (
              <div key={event.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-white/35">{event.source === "automatic" ? "Системное" : event.status === "published" ? "Опубликовано" : "Черновик"}</p>
                    <p className="mt-1 truncate font-semibold">{event.title}</p>
                  </div>
                  <div className="flex shrink-0 gap-3 text-xs">
                    <button type="button" onClick={() => editEvent(event)} className="text-[#d7b55a]">Изменить</button>
                    <button type="button" onClick={() => archive(event.id)} className="text-red-300/75">Удалить</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
