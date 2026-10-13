"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  FOLLOW_LIST_PAGE_SIZE,
  fetchFollowers,
  fetchFollowing,
  type FollowListItem,
  type FollowListPage,
} from "@/lib/follows-client";
import { useBodyScrollLock } from "@/lib/hooks/use-body-scroll-lock";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";

// Followers / following list as a bottom sheet (centered card from `sm:`),
// opened from the profile's two counters. The modal OWNS its data: it is
// mounted only while open, fetches on mount (so every open is fresh), and
// nothing it loads is lifted into page state. Same visual language as the
// profile's other bottom sheet (rounded top, handle bar, safe-area padding)
// and the dialog conventions of app/admin/admin-shifts/page.tsx
// (role="dialog", Escape, ×).

type Props = {
  playerId: string;
  mode: "followers" | "following";
  title: string;
  onClose: () => void;
};

// Everything the modal knows about ONE (player, mode) list. Tagged with its
// key so state that belongs to a previous list can never be shown for the
// current one.
type LoadedList = {
  key: string;
  items: FollowListItem[];
  total: number;
  // Rows received from the server so far -- the next page's offset. Equal to
  // items.length unless a duplicate id was dropped (see mergeItems).
  fetched: number;
  // The server answered a non-empty page last time? false => nothing more to
  // fetch even if `total` still says otherwise (data shrank under us).
  exhausted: boolean;
};

type KeyedMessage = { key: string; message: string };

const FALLBACK_ERROR = "Не удалось загрузить список. Попробуйте ещё раз.";

function safeMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : FALLBACK_ERROR;
}

// Player id is the dedupe key. Appends only ids not seen yet and never
// reorders what the server sent (newest first).
function mergeItems(existing: FollowListItem[], incoming: FollowListItem[]): FollowListItem[] {
  const seen = new Set(existing.map((item) => item.id));
  const merged = [...existing];
  for (const item of incoming) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}

export function FollowListModal({ playerId, mode, title, onClose }: Props) {
  const key = `${playerId}:${mode}`;
  const titleId = useId();
  const sheetRef = useRef<HTMLElement | null>(null);

  const [list, setList] = useState<LoadedList | null>(null);
  const [initialError, setInitialError] = useState<KeyedMessage | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<KeyedMessage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Which list a response is allowed to update. Cleared on unmount / when the
  // list changes, so a response that lands after the modal was closed (or
  // re-pointed at another player/mode) is dropped.
  const activeKeyRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);

  useBodyScrollLock(true);

  // Keep the latest onClose without re-subscribing the Escape listener on
  // every parent render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    sheetRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    activeKeyRef.current = key;
    let cancelled = false;

    const fetchPage = mode === "followers" ? fetchFollowers : fetchFollowing;
    fetchPage(playerId, FOLLOW_LIST_PAGE_SIZE, 0)
      .then((page) => {
        if (cancelled) return;
        const items = mergeItems([], page.items);
        setList({
          key,
          items,
          total: page.total,
          fetched: page.items.length,
          exhausted: page.items.length === 0,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setInitialError({ key, message: safeMessage(error) });
      });

    return () => {
      cancelled = true;
      activeKeyRef.current = null;
    };
  }, [key, mode, playerId]);

  const current = list && list.key === key ? list : null;
  const initialErrorMessage = initialError && initialError.key === key ? initialError.message : null;
  const loadMoreErrorMessage = loadMoreError && loadMoreError.key === key ? loadMoreError.message : null;
  const hasMore = current !== null && !current.exhausted && current.fetched < current.total;

  async function handleLoadMore() {
    if (!current || loadingMoreRef.current || !hasMore) return;

    const requestKey = key;
    const offset = current.fetched;
    const fetchPage = mode === "followers" ? fetchFollowers : fetchFollowing;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);

    let page: FollowListPage | null = null;
    try {
      page = await fetchPage(playerId, FOLLOW_LIST_PAGE_SIZE, offset);
    } catch (error) {
      if (activeKeyRef.current === requestKey) {
        // Already-loaded rows stay; only a message is added, and the button
        // remains so the user can retry.
        setLoadMoreError({ key: requestKey, message: safeMessage(error) });
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }

    if (page && activeKeyRef.current === requestKey) {
      const received = page;
      setList((previous) =>
        previous && previous.key === requestKey
          ? {
              ...previous,
              items: mergeItems(previous.items, received.items),
              total: received.total,
              fetched: previous.fetched + received.items.length,
              exhausted: received.items.length === 0,
            }
          : previous
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <section
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[75vh] w-full max-w-md flex-col rounded-t-[30px] border border-white/10 bg-[#101612]/95 p-5 pb-[calc(env(safe-area-inset-bottom)+24px)] outline-none backdrop-blur-2xl sm:rounded-[30px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-white/20" aria-hidden="true" />
        <div className="flex shrink-0 items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg leading-none text-white/70"
          >
            ×
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {initialErrorMessage ? (
            <p className="text-sm text-red-300">{initialErrorMessage}</p>
          ) : !current ? (
            <p className="text-sm text-white/60">Загрузка...</p>
          ) : current.items.length === 0 ? (
            <p className="text-sm text-white/60">Пока никого нет</p>
          ) : (
            <>
              <ul className="space-y-2">
                {current.items.map((item) => {
                  const avatarUrl = getPlayerAvatarUrl(item);
                  return (
                    <li key={item.id}>
                      <Link
                        href={`/players/${item.id}`}
                        onClick={onClose}
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5"
                      >
                        {avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={avatarUrl}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-full border border-white/10 object-cover"
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-sm font-bold text-white/80"
                          >
                            {getPlayerAvatarFallback(item)}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                          {item.display_name}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {loadMoreErrorMessage ? (
                <p className="mt-3 text-sm text-red-300">{loadMoreErrorMessage}</p>
              ) : null}

              {hasMore ? (
                <button
                  type="button"
                  onClick={() => void handleLoadMore()}
                  disabled={loadingMore}
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-white/[0.05] py-2.5 text-sm text-white/75 disabled:opacity-50"
                >
                  {loadingMore ? "Загрузка..." : "Показать ещё"}
                </button>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
