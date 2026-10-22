"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { BackButton } from "@/components/ui/back-button";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import { ROLE_LABELS, isKnownRole, isSuperAdmin } from "@/lib/roles";
import type { Player } from "@/types/domain";
import type {
  AdminMergeExecuteResult,
  AdminMergePlayerSummary,
  AdminMergePreview,
  AdminMergeResultCard,
  AdminMergeResultConflict,
  AdminMergeTournamentConflict,
} from "@/lib/player-merge";

// Must match lib/player-merge.ts's ADMIN_MERGE_CONFIRMATION -- the server
// re-verifies it; this copy only gates the button.
const CONFIRMATION_WORD = "ОБЪЕДИНИТЬ";

type ResultSide = "target" | "source";

const MOSCOW_DATE = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function tournamentLabel(tournament: AdminMergeTournamentConflict): string {
  return tournament.start_at
    ? `${tournament.title} — ${MOSCOW_DATE.format(new Date(tournament.start_at))}`
    : tournament.title;
}

function pluralTournaments(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} турнир`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} турнира`;
  return `${count} турниров`;
}

function keptResultLine(conflict: AdminMergeResultConflict, side: ResultSide): string {
  const kept = side === "target" ? conflict.target : conflict.source;
  const dropped = side === "target" ? conflict.source : conflict.target;
  return `${tournamentLabel(conflict.tournament)}: будет сохранён результат ${kept.nickname} (${kept.place} место, ${kept.rating_points} очк.), результат ${dropped.nickname} будет удалён`;
}

type ConflictPlayerSummary = {
  id: string;
  telegram_id: number | null;
  email: string | null;
  display_name: string;
  username: string | null;
  role: string;
  can_access_free: boolean;
  can_access_paid: boolean;
  can_access_cash: boolean;
  referral_count: number;
  free_reentries_balance: number;
  yandex_review_bonus_claimed: boolean;
  accepted_terms_at: string | null;
  profile_completed_at: string | null;
  nickname_status: string | null;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  merged_into_player_id: string | null;
  created_at: string;
};

type MergeConflict = {
  intent: {
    id: string;
    email: string;
    status: string;
    conflict_reason: string | null;
    created_at: string;
  };
  target: ConflictPlayerSummary | null;
  source: ConflictPlayerSummary | null;
  overlappingTournamentIds: string[];
  sourceTournamentCount: number;
  targetTournamentCount: number;
};

// What a selector card needs to show -- satisfied by a search result and by
// a conflict-queue summary alike.
type SelectedAccount = {
  id: string;
  display_name: string;
  username: string | null;
  email: string | null;
  telegram_linked: boolean;
  role: string;
};

type MergeSuccess = Extract<AdminMergeExecuteResult, { merged: true }>;

function roleLabel(role: string): string {
  return isKnownRole(role) ? ROLE_LABELS[role] : role;
}

function fromConflictSummary(player: ConflictPlayerSummary): SelectedAccount {
  return {
    id: player.id,
    display_name: player.display_name,
    username: player.username,
    email: player.email,
    telegram_linked: player.telegram_id !== null,
    role: player.role,
  };
}

function AccountLine({ account }: { account: SelectedAccount | AdminMergePlayerSummary }) {
  return (
    <dl className="mt-2 space-y-1 text-xs text-white/60">
      <div className="flex justify-between gap-2">
        <dt className="text-white/40">Telegram</dt>
        <dd className="truncate">
          {account.telegram_linked ? (account.username ? `@${account.username}` : "привязан") : "не привязан"}
        </dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-white/40">Email</dt>
        <dd className="truncate">{account.email ?? "—"}</dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-white/40">Роль</dt>
        <dd>{roleLabel(account.role)}</dd>
      </div>
    </dl>
  );
}

function AccountPicker({
  title,
  testId,
  selected,
  excludeId,
  onSelect,
  onClear,
}: {
  title: string;
  testId: string;
  selected: SelectedAccount | null;
  excludeId: string | null;
  onSelect: (account: SelectedAccount) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminMergePlayerSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchError("Введите минимум 2 символа");
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const data = await fetchAdminJson<{ players: AdminMergePlayerSummary[] }>(
        `/api/admin/account-merges/search?q=${encodeURIComponent(trimmed)}`
      );
      setResults(data.players);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Не удалось выполнить поиск");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div data-testid={testId} className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-xs font-semibold tracking-widest text-white/40">{title}</p>

      {selected ? (
        <div data-testid={`${testId}-selected`}>
          <p className="mt-1 truncate text-sm font-semibold text-white">{selected.display_name}</p>
          <AccountLine account={selected} />
          <button
            type="button"
            onClick={() => {
              onClear();
              setResults(null);
            }}
            className="mt-3 text-xs text-white/50 underline"
          >
            Выбрать другой
          </button>
        </div>
      ) : (
        <>
          <form onSubmit={runSearch} className="mt-2 flex gap-2">
            <input
              data-testid={`${testId}-search-input`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Имя, @username, email или Telegram ID"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30"
            />
            <button
              type="submit"
              data-testid={`${testId}-search-submit`}
              disabled={searching}
              className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {searching ? "..." : "Найти"}
            </button>
          </form>

          {searchError ? <p className="mt-2 text-xs text-red-300">{searchError}</p> : null}

          {results ? (
            results.length === 0 ? (
              <p className="mt-2 text-xs text-white/50">Никого не нашли</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {results.map((candidate) => {
                  const unavailable = candidate.merged || candidate.id === excludeId;
                  return (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        data-testid={`${testId}-result`}
                        disabled={unavailable}
                        onClick={() =>
                          onSelect({
                            id: candidate.id,
                            display_name: candidate.display_name,
                            username: candidate.username,
                            email: candidate.email,
                            telegram_linked: candidate.telegram_linked,
                            role: candidate.role,
                          })
                        }
                        className="w-full rounded-lg border border-white/10 bg-black/30 p-2 text-left disabled:opacity-40"
                      >
                        <p className="truncate text-sm text-white">
                          {candidate.display_name}
                          {candidate.admin_display_name ? (
                            <span className="text-white/40"> · {candidate.admin_display_name}</span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-white/50">
                          {candidate.telegram_linked
                            ? candidate.username
                              ? `@${candidate.username}`
                              : "Telegram привязан"
                            : "Без Telegram"}
                          {" · "}
                          {candidate.email ?? "без email"}
                          {" · "}
                          {roleLabel(candidate.role)}
                          {candidate.is_blocked ? " · заблокирован" : ""}
                          {candidate.id === excludeId ? " · уже выбран" : ""}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : null}
        </>
      )}
    </div>
  );
}

function PreviewCard({ title, player }: { title: string; player: AdminMergePlayerSummary | null }) {
  if (!player) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/40">
        {title}: игрок не найден
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-xs font-semibold tracking-widest text-white/40">{title}</p>
      <p className="mt-1 truncate text-sm font-semibold text-white">{player.display_name}</p>
      <AccountLine account={player} />
      <dl className="mt-1 space-y-1 text-xs text-white/60">
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Скидка</dt>
          <dd>{player.club_discount_percent}%</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Ограничение онлайн-записи</dt>
          <dd>{player.online_registration_restricted ? "есть" : "нет"}</dd>
        </div>
        {player.is_blocked ? (
          <div className="flex justify-between gap-2">
            <dt className="text-white/40">Статус</dt>
            <dd className="text-red-300">заблокирован</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function ResultCardView({
  title,
  card,
  side,
  tournamentId,
  selected,
  onSelect,
}: {
  title: string;
  card: AdminMergeResultCard;
  side: ResultSide;
  tournamentId: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const rows: Array<[string, string | number]> = [
    ["Место", card.place],
    ["Очки рейтинга", card.rating_points],
    ["Входы", card.entries],
    ["Аддоны", card.addons],
  ];
  if (card.knockouts > 0) rows.push(["KO", card.knockouts]);
  if (card.boss_knockouts > 0) rows.push(["Boss KO", card.boss_knockouts]);
  if (card.mystery_bounty_points > 0) rows.push(["Mystery", card.mystery_bounty_points]);

  return (
    <label
      data-testid={`merge-result-card-${side}`}
      className={`block cursor-pointer rounded-xl border p-3 ${
        selected ? "border-emerald-400/60 bg-emerald-500/10" : "border-white/10 bg-black/30"
      }`}
    >
      <p className="text-xs font-semibold tracking-widest text-white/40">{title}</p>
      <p className="mt-1 truncate text-sm font-semibold text-white">{card.nickname}</p>
      <dl className="mt-2 space-y-1 text-xs text-white/70">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-white/40">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <span className="mt-3 flex items-center gap-2 text-sm text-white">
        <input
          type="radio"
          data-testid={`merge-result-choice-${side}`}
          name={`result-choice-${tournamentId}`}
          checked={selected}
          onChange={onSelect}
        />
        Оставить результат {card.nickname}
      </span>
    </label>
  );
}

function MergeCenter({
  prefill,
  onMerged,
}: {
  prefill: { target: SelectedAccount; source: SelectedAccount; nonce: number } | null;
  onMerged: () => void;
}) {
  const [target, setTarget] = useState<SelectedAccount | null>(null);
  const [source, setSource] = useState<SelectedAccount | null>(null);
  const [preview, setPreview] = useState<AdminMergePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [success, setSuccess] = useState<MergeSuccess | null>(null);
  const [refreshWarning, setRefreshWarning] = useState(false);
  // Super-Admin's explicit choice per double-result tournament. Always reset
  // when a (new) preview is loaded -- a choice never carries over to a
  // different pair, direction or data state.
  const [resultChoices, setResultChoices] = useState<Record<string, ResultSide>>({});
  const previewSeq = useRef(0);

  useEffect(() => {
    if (!prefill) return;
    setTarget(prefill.target);
    setSource(prefill.source);
    setSuccess(null);
  }, [prefill]);

  const loadPreview = useCallback(async (targetId: string, sourceId: string) => {
    const seq = ++previewSeq.current;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const data = await fetchAdminJson<{ preview: AdminMergePreview }>("/api/admin/account-merges/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlayerId: targetId, sourcePlayerId: sourceId }),
      });
      if (seq === previewSeq.current) {
        setPreview(data.preview);
        setResultChoices({});
      }
    } catch (err) {
      if (seq === previewSeq.current) {
        setPreview(null);
        setPreviewError(err instanceof Error ? err.message : "Не удалось построить предпросмотр");
      }
    } finally {
      if (seq === previewSeq.current) setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    // Any change of either account invalidates the preview and any
    // half-typed confirmation.
    setPreview(null);
    setResultChoices({});
    setConfirmOpen(false);
    setConfirmText("");
    setExecuteError(null);
    if (target && source && target.id !== source.id) {
      void loadPreview(target.id, source.id);
    } else {
      previewSeq.current += 1;
      setPreviewLoading(false);
      setPreviewError(null);
    }
  }, [target, source, loadPreview]);

  function swap() {
    setTarget(source);
    setSource(target);
  }

  const resultConflicts = preview?.result_conflicts ?? [];
  const unresolvedConflicts = resultConflicts.filter((conflict) => !resultChoices[conflict.tournament.id]);

  function chooseResult(tournamentId: string, side: ResultSide) {
    setResultChoices((current) => ({ ...current, [tournamentId]: side }));
    // A changed choice must be re-confirmed with the updated summary.
    setConfirmOpen(false);
    setConfirmText("");
  }

  async function execute() {
    if (!target || !source || confirmText !== CONFIRMATION_WORD || unresolvedConflicts.length > 0) return;
    // Only choices for the conflicts of THIS preview are sent; the server
    // re-derives the conflicts and rejects anything else.
    const resultResolutions: Record<string, ResultSide> = {};
    for (const conflict of resultConflicts) {
      resultResolutions[conflict.tournament.id] = resultChoices[conflict.tournament.id];
    }
    setExecuting(true);
    setExecuteError(null);
    try {
      const data = await fetchAdminJson<{
        ok: true;
        result: MergeSuccess;
        achievementRefreshFailed?: boolean;
      }>("/api/admin/account-merges/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetPlayerId: target.id,
          sourcePlayerId: source.id,
          confirmation: confirmText,
          resultResolutions,
        }),
      });
      setSuccess(data.result);
      setRefreshWarning(Boolean(data.achievementRefreshFailed));
      setTarget(null);
      setSource(null);
      onMerged();
    } catch (err) {
      setExecuteError(err instanceof Error ? err.message : "Не удалось объединить аккаунты");
      // State may have changed under us -- show the CURRENT blockers.
      void loadPreview(target.id, source.id);
    } finally {
      setExecuting(false);
      setConfirmText("");
    }
  }

  const needsResultChoice = Boolean(preview?.eligible) && unresolvedConflicts.length > 0;
  const blocked = !preview || !preview.eligible || previewLoading || needsResultChoice;
  // The CTA sits right under the selectors (above the potentially
  // multi-screen preview), so its label has to carry the preview state.
  const ctaLabel = previewLoading
    ? "Проверяем возможность объединения..."
    : preview
      ? !preview.eligible
        ? "Объединение невозможно"
        : needsResultChoice
          ? "Выберите правильный результат турнира"
          : "Объединить аккаунты"
      : "Не удалось проверить объединение";

  return (
    <section data-testid="merge-center" className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <h2 className="text-lg font-semibold">Объединить два аккаунта</h2>
      <p className="mt-1 text-xs text-white/50">
        Основной аккаунт остаётся, присоединяемый поглощается: его история переходит в основной, а
        сам он становится объединённым.
      </p>

      {success ? (
        <div data-testid="merge-success" className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
          <p className="font-semibold text-emerald-200">Аккаунты объединены</p>
          <dl className="mt-2 space-y-1 text-xs text-emerald-100/80">
            <div className="flex justify-between gap-2">
              <dt>Основной аккаунт</dt>
              <dd className="truncate">{success.final_identity.display_name}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Telegram</dt>
              <dd>
                {success.final_identity.telegram_linked
                  ? success.final_identity.telegram_username
                    ? `@${success.final_identity.telegram_username}`
                    : "привязан"
                  : "не привязан"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Email</dt>
              <dd className="truncate">{success.final_identity.email ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Перенесено турниров</dt>
              <dd>{success.transferred_tournament_count}</dd>
            </div>
            {success.reconciled_tournament_count ? (
              <div className="flex justify-between gap-2">
                <dt>Объединено совпадающих турниров</dt>
                <dd>{success.reconciled_tournament_count}</dd>
              </div>
            ) : null}
          </dl>
          {refreshWarning ? (
            <p className="mt-2 text-xs text-yellow-200">
              Объединение выполнено, но достижения не удалось пересчитать — запустите пересчёт вручную.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <AccountPicker
          title="ОСНОВНОЙ АККАУНТ"
          testId="merge-target"
          selected={target}
          excludeId={source?.id ?? null}
          onSelect={(account) => {
            setSuccess(null);
            setTarget(account);
          }}
          onClear={() => setTarget(null)}
        />
        <AccountPicker
          title="ПРИСОЕДИНЯЕМЫЙ АККАУНТ"
          testId="merge-source"
          selected={source}
          excludeId={target?.id ?? null}
          onSelect={(account) => {
            setSuccess(null);
            setSource(account);
          }}
          onClear={() => setSource(null)}
        />
      </div>

      <button
        type="button"
        data-testid="merge-swap"
        onClick={swap}
        disabled={!target && !source}
        className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white disabled:opacity-40"
      >
        Поменять местами
      </button>

      {target && source ? (
        <button
          type="button"
          data-testid="merge-open-confirm"
          disabled={blocked || confirmOpen}
          onClick={() => {
            setConfirmOpen(true);
            setConfirmText("");
          }}
          className="mt-4 w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:bg-white/10 disabled:text-white/40"
        >
          {ctaLabel}
        </button>
      ) : null}

      {target && source && preview && !preview.eligible && !previewLoading ? (
        <p data-testid="merge-cta-blocked-hint" className="mt-2 text-xs text-red-200/80">
          Причины указаны ниже, в предпросмотре.
        </p>
      ) : null}

      {target && source && needsResultChoice && !previewLoading ? (
        <p data-testid="merge-cta-result-hint" className="mt-2 text-xs text-amber-200/90">
          В одном турнире у аккаунтов два результата. Ниже, в разделе «Нужно выбрать правильный
          результат», отметьте, какой результат сохранить (без выбора:{" "}
          {pluralTournaments(unresolvedConflicts.length)}).
        </p>
      ) : null}

      {confirmOpen && target && source && preview?.eligible && !needsResultChoice ? (
        <div data-testid="merge-confirm" className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">
          <p className="whitespace-pre-line text-white">
            {`Основным останется: ${target.display_name}\n\nВ него будет объединён: ${source.display_name}`}
          </p>
          {resultConflicts.length > 0 ? (
            <ul data-testid="merge-confirm-results" className="mt-2 space-y-1 text-xs text-amber-100">
              {resultConflicts.map((conflict) => (
                <li key={conflict.tournament.id}>
                  {keptResultLine(conflict, resultChoices[conflict.tournament.id])}
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-white/70">
            <li>Вся история присоединяемого аккаунта перейдёт в основной.</li>
            <li>Присоединяемый аккаунт станет объединённым и больше не будет самостоятельным.</li>
            <li>Вход через перенесённый email/Telegram будет вести в основной аккаунт.</li>
            <li>Отменить объединение из приложения нельзя.</li>
          </ul>
          <label className="mt-3 block text-xs text-white/60">
            Введите {CONFIRMATION_WORD}, чтобы подтвердить
            <input
              data-testid="merge-confirm-input"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              autoComplete="off"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              data-testid="merge-confirm-submit"
              disabled={confirmText !== CONFIRMATION_WORD || executing}
              onClick={execute}
              className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-white/10 disabled:text-white/40"
            >
              {executing ? "Объединяем..." : "Подтвердить объединение"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmOpen(false);
                setConfirmText("");
              }}
              className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/70"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      {executeError ? (
        <p data-testid="merge-execute-error" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">
          {executeError}
        </p>
      ) : null}

      {previewLoading ?<p className="mt-4 text-sm text-white/60">Строим предпросмотр...</p> : null}
      {previewError ? (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">{previewError}</p>
      ) : null}

      {preview && !previewLoading ? (
        <div data-testid="merge-preview" className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PreviewCard title="ОСНОВНОЙ (останется)" player={preview.target} />
            <PreviewCard title="ПРИСОЕДИНЯЕМЫЙ" player={preview.source} />
          </div>

          {resultConflicts.length > 0 ? (
            <div
              data-testid="merge-result-conflicts"
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3"
            >
              <p className="text-sm font-semibold text-amber-100">Нужно выбрать правильный результат</p>
              <p className="mt-1 text-xs text-amber-100/70">
                Один человек не может иметь два результата одного турнира. Выбранный результат
                сохранится без изменений (место и очки рейтинга не пересчитываются), второй будет удалён.
              </p>
              <div className="mt-3 space-y-4">
                {resultConflicts.map((conflict) => (
                  <div key={conflict.tournament.id} data-testid="merge-result-conflict">
                    <p className="text-xs font-semibold text-white">В этом турнире найдены два результата</p>
                    <p className="text-xs text-white/70">{tournamentLabel(conflict.tournament)}</p>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <ResultCardView
                        title="АККАУНТ A · ОСНОВНОЙ"
                        card={conflict.target}
                        side="target"
                        tournamentId={conflict.tournament.id}
                        selected={resultChoices[conflict.tournament.id] === "target"}
                        onSelect={() => chooseResult(conflict.tournament.id, "target")}
                      />
                      <ResultCardView
                        title="АККАУНТ B · ПРИСОЕДИНЯЕМЫЙ"
                        card={conflict.source}
                        side="source"
                        tournamentId={conflict.tournament.id}
                        selected={resultChoices[conflict.tournament.id] === "source"}
                        onSelect={() => chooseResult(conflict.tournament.id, "source")}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {preview.final_identity ? (
            <div data-testid="merge-final-identity" className="rounded-xl border border-sky-500/20 bg-sky-500/10 p-3">
              <p className="text-xs font-semibold tracking-widest text-sky-200/70">ПОСЛЕ ОБЪЕДИНЕНИЯ</p>
              <dl className="mt-2 space-y-1 text-xs text-sky-100/80">
                <div className="flex justify-between gap-2">
                  <dt>Профиль</dt>
                  <dd className="truncate">{preview.final_identity.display_name} (основной)</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Telegram</dt>
                  <dd>
                    {preview.final_identity.telegram_linked
                      ? preview.final_identity.telegram_username
                        ? `@${preview.final_identity.telegram_username}`
                        : "привязан"
                      : "не привязан"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Email</dt>
                  <dd className="truncate">{preview.final_identity.email ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Роль</dt>
                  <dd>{roleLabel(preview.final_identity.role)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Ограничение онлайн-записи</dt>
                  <dd>{preview.final_identity.online_registration_restricted ? "сохранится" : "нет"}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          {preview.counts ? (
            <div data-testid="merge-counts" className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/60">
              <p className="font-semibold text-white/70">Будет перенесено из присоединяемого аккаунта</p>
              <ul className="mt-2 grid grid-cols-2 gap-1">
                <li>Турниров: {preview.counts.source.tournaments}</li>
                <li>Регистраций: {preview.counts.source.registrations}</li>
                <li>Результатов: {preview.counts.source.results}</li>
                <li>Неявок: {preview.counts.source.no_shows}</li>
                <li>Командная история: {preview.counts.source.team_memberships}</li>
                <li>Смен дилера: {preview.counts.source.dealer_shifts}</li>
              </ul>
            </div>
          ) : null}

          {(preview.tournament_reconciliation ?? []).length > 0 ? (
            <div
              data-testid="merge-tournament-reconciliation"
              className="rounded-xl border border-sky-500/20 bg-sky-500/10 p-3 text-xs text-sky-100/80"
            >
              <p className="font-semibold text-sky-100">
                Совпадающая история турниров будет объединена: {preview.tournament_reconciliation.length}
              </p>
              <ul className="mt-2 space-y-1">
                {preview.tournament_reconciliation.map((item) => (
                  <li key={item.tournament.id}>
                    {tournamentLabel(item.tournament)}
                    {item.collapsed.length > 0 ? ` — объединяется: ${item.collapsed.join(", ")}` : ""}
                    {item.result_conflict ? " — нужен выбор результата" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.warnings.length > 0 ? (
            <div data-testid="merge-warnings" className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3">
              <p className="text-xs font-semibold text-yellow-200">Останутся значения основного аккаунта</p>
              <ul className="mt-2 space-y-1 text-xs text-yellow-100/80">
                {preview.warnings.map((warning) => (
                  <li key={warning.code}>{warning.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.blockers.length > 0 ? (
            <div data-testid="merge-blockers" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
              <p className="text-xs font-semibold text-red-200">Объединение невозможно</p>
              <ul className="mt-2 space-y-2 text-xs text-red-100/90">
                {preview.blockers.map((blocker) => (
                  <li key={blocker.code} className="whitespace-pre-line">
                    {blocker.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ConflictPlayerCard({ title, player }: { title: string; player: ConflictPlayerSummary | null }) {
  if (!player) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/40">
        {title}: игрок не найден
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-xs font-semibold tracking-widest text-white/40">{title}</p>
      <p className="mt-1 truncate text-sm font-semibold text-white">{player.display_name}</p>
      <dl className="mt-2 space-y-1 text-xs text-white/60">
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Telegram ID</dt>
          <dd>{player.telegram_id ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Email</dt>
          <dd className="truncate">{player.email ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Роль</dt>
          <dd>{player.role}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Рефералы</dt>
          <dd>{player.referral_count}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Бесплатные ре-энтри</dt>
          <dd>{player.free_reentries_balance}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Ник</dt>
          <dd>{player.nickname_status ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-white/40">Уже объединён с</dt>
          <dd className="truncate">{player.merged_into_player_id ?? "—"}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function AdminAccountMergesPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<MergeConflict[]>([]);
  const [prefill, setPrefill] = useState<{ target: SelectedAccount; source: SelectedAccount; nonce: number } | null>(
    null
  );

  const loadConflicts = useCallback(async () => {
    try {
      const data = await fetchAdminJson<{ conflicts: MergeConflict[] }>("/api/admin/account-merges");
      setConflicts(data.conflicts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить очередь конфликтов");
    }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const currentPlayer = await resolveCurrentPlayer();
        setPlayer(currentPlayer);
        if (isSuperAdmin(currentPlayer?.role)) {
          await loadConflicts();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить очередь конфликтов");
      } finally {
        setAccessChecked(true);
        setLoading(false);
      }
    }
    init();
  }, [loadConflicts]);

  if (!accessChecked) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Проверяем доступ...</p>
        </div>
      </main>
    );
  }

  if (!isSuperAdmin(player?.role)) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <BackButton href="/admin" className="mb-4" />
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h1 className="text-xl font-semibold">Доступ запрещён</h1>
            <p className="mt-2 text-sm text-white/70">
              Эта страница доступна только Супер-администратору.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 pb-16 text-white">
      <div className="mx-auto max-w-3xl">
        <BackButton href="/admin" className="mb-4" />

        <h1 className="text-2xl font-bold">Объединение аккаунтов</h1>

        <MergeCenter prefill={prefill} onMerged={() => void loadConflicts()} />

        <h2 className="mt-8 text-lg font-semibold">Очередь конфликтов</h2>
        <p className="mt-1 text-sm text-white/50">
          Запросы на самостоятельное объединение, которые нельзя провести автоматически
          (два результата одного турнира, вторая Telegram-идентификация и т.п.). Откройте пару в
          объединении — те же проверки покажут, можно ли её объединить, а два результата одного
          турнира можно разрешить прямо там.
        </p>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="mt-6 text-sm text-white/70">Загружаем...</p>
        ) : conflicts.length === 0 ? (
          <div data-testid="conflict-queue-empty" className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
            Конфликтов нет
          </div>
        ) : (
          <div data-testid="conflict-queue" className="mt-6 space-y-4">
            {conflicts.map((conflict) => (
              <div
                key={conflict.intent.id}
                data-testid="conflict-card"
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{conflict.intent.email}</p>
                  <p className="text-xs text-white/40">
                    {new Date(conflict.intent.created_at).toLocaleString("ru-RU")}
                  </p>
                </div>

                {conflict.intent.conflict_reason ? (
                  <p className="mt-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-2 text-xs text-yellow-200">
                    {conflict.intent.conflict_reason}
                  </p>
                ) : null}

                {conflict.overlappingTournamentIds.length > 0 ? (
                  <p className="mt-2 text-xs text-white/50">
                    Пересекающихся турниров: {conflict.overlappingTournamentIds.length}{" "}
                    (у цели: {conflict.targetTournamentCount}, у источника: {conflict.sourceTournamentCount})
                  </p>
                ) : null}

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ConflictPlayerCard title="Цель (сохраняется)" player={conflict.target} />
                  <ConflictPlayerCard title="Источник (email)" player={conflict.source} />
                </div>

                {conflict.target && conflict.source ? (
                  <button
                    type="button"
                    data-testid="conflict-open-in-merge"
                    onClick={() => {
                      setPrefill({
                        target: fromConflictSummary(conflict.target!),
                        source: fromConflictSummary(conflict.source!),
                        nonce: Date.now(),
                      });
                      if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
                        try {
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        } catch {
                          // jsdom / old webviews -- scrolling is cosmetic only.
                        }
                      }
                    }}
                    className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                  >
                    Открыть в объединении
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
