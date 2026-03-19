"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import {
  getTournamentById,
  getTournamentParticipants,
  getTournamentResults,
  getPlayerRegistrations,
  getTournamentRegistrationCounts,
  registerPlayerForTournament,
  cancelPlayerRegistration,
} from "@/features/tournaments";
import { getTelegramUser } from "@/lib/telegram";
import type {
  RegistrationStatus,
  Tournament,
  TournamentParticipant,
  TournamentResult,
} from "@/types/domain";

type TabKey = "about" | "participants" | "results";

export default function TournamentDetailsPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = params?.id;

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [participants, setParticipants] = useState<TournamentParticipant[]>([]);
  const [results, setResults] = useState<TournamentResult[]>([]);
  const [registrationStatus, setRegistrationStatus] =
    useState<RegistrationStatus | null>(null);
  const [registeredCount, setRegisteredCount] = useState(0);

  const [activeTab, setActiveTab] = useState<TabKey>("about");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const registeredParticipants = participants.filter(
  (participant) =>
    participant.status === "registered" || participant.status === "attended"
);

const waitlistParticipants = participants.filter(
  (participant) => participant.status === "waitlist"
);

  async function refreshPageData(currentPlayerId: string, currentTournamentId: string) {
    const [tournamentData, participantsData, registrations, counts] = await Promise.all([
      getTournamentById(currentTournamentId),
      getTournamentParticipants(currentTournamentId),
      getPlayerRegistrations(currentPlayerId),
      getTournamentRegistrationCounts(),
    ]);

    const myRegistration =
      registrations.find((item) => item.tournament_id === currentTournamentId) ?? null;

    setTournament(tournamentData);
    setParticipants(participantsData);
    setRegistrationStatus(myRegistration?.status ?? null);
    setRegisteredCount(counts[currentTournamentId] ?? 0);

    if (tournamentData.status === "completed") {
      const resultsData = await getTournamentResults(currentTournamentId);
      setResults(resultsData);
    } else {
      setResults([]);
    }
  }

  useEffect(() => {
    async function init() {
      try {
        if (!tournamentId) {
          throw new Error("Tournament id not found");
        }

        const telegramUser = getTelegramUser();

        if (!telegramUser) {
          throw new Error("Telegram user not found");
        }

        const player = await ensurePlayerFromTelegramUser(telegramUser);
        setPlayerId(player.id);

        await refreshPageData(player.id, tournamentId);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown tournament details error";
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [tournamentId]);

  async function handleRegister() {
    if (!playerId || !tournamentId) return;

    try {
      setActionLoading(true);
      setMessage(null);

      const result = await registerPlayerForTournament(playerId, tournamentId);

      if (result.status === "registered") {
        setMessage("Р’С‹ Р·Р°РїРёСЃР°РЅС‹ РЅР° С‚СѓСЂРЅРёСЂ");
      } else if (result.status === "waitlist") {
        setMessage("Р’С‹ РґРѕР±Р°РІР»РµРЅС‹ РІ СЃРїРёСЃРѕРє РѕР¶РёРґР°РЅРёСЏ");
      }

      await refreshPageData(playerId, tournamentId);
    } catch (err) {
      setMessage("РћС€РёР±РєР° Р·Р°РїРёСЃРё");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancel() {
    if (!playerId || !tournamentId) return;

    try {
      setActionLoading(true);
      setMessage(null);

      await cancelPlayerRegistration(playerId, tournamentId);

      if (registrationStatus === "registered") {
        setMessage("Р—Р°РїРёСЃСЊ РЅР° С‚СѓСЂРЅРёСЂ РѕС‚РјРµРЅРµРЅР°");
      } else if (registrationStatus === "waitlist") {
        setMessage("Р’С‹ РІС‹С€Р»Рё РёР· СЃРїРёСЃРєР° РѕР¶РёРґР°РЅРёСЏ");
      }

      await refreshPageData(playerId, tournamentId);
    } catch (err) {
      setMessage("РћС€РёР±РєР° РѕС‚РјРµРЅС‹ Р·Р°РїРёСЃРё");
    } finally {
      setActionLoading(false);
    }
  }

  function renderActionButton() {
    if (!tournament || tournament.status === "completed") return null;

    if (!registrationStatus) {
  return (
    <button
      type="button"
      onClick={handleRegister}
      disabled={actionLoading}
      className="mt-5 w-full rounded-xl bg-yellow-500 py-3 font-semibold text-black disabled:opacity-60"
    >
      {actionLoading
        ? "РЎРѕС…СЂР°РЅСЏРµРј..."
        : registeredCount >= tournament.max_players
        ? "Р’СЃС‚Р°С‚СЊ РІ СЃРїРёСЃРѕРє РѕР¶РёРґР°РЅРёСЏ"
        : "Р—Р°РїРёСЃР°С‚СЊСЃСЏ РЅР° С‚СѓСЂРЅРёСЂ"}
    </button>
  );
}

    if (registrationStatus === "registered") {
      return (
        <button
          type="button"
          onClick={handleCancel}
          disabled={actionLoading}
          className="mt-5 w-full rounded-xl bg-green-600 py-3 font-semibold text-white disabled:opacity-60"
        >
          {actionLoading ? "РЎРѕС…СЂР°РЅСЏРµРј..." : "РћС‚РјРµРЅРёС‚СЊ Р·Р°РїРёСЃСЊ"}
        </button>
      );
    }

    if (registrationStatus === "waitlist") {
      return (
        <button
          type="button"
          onClick={handleCancel}
          disabled={actionLoading}
          className="mt-5 w-full rounded-xl bg-orange-500 py-3 font-semibold text-white disabled:opacity-60"
        >
          {actionLoading ? "РЎРѕС…СЂР°РЅСЏРµРј..." : "Р’С‹Р№С‚Рё РёР· СЃРїРёСЃРєР° РѕР¶РёРґР°РЅРёСЏ"}
        </button>
      );
    }

    return null;
  }

  function getStatusText() {
    if (!tournament) return "";

    if (tournament.status === "completed") {
      return "РЎС‚Р°С‚СѓСЃ: С‚СѓСЂРЅРёСЂ Р·Р°РІРµСЂС€РµРЅ";
    }

    if (registrationStatus === "registered") {
      return "РЎС‚Р°С‚СѓСЃ: РІС‹ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅС‹";
    }

    if (registrationStatus === "waitlist") {
      return "РЎС‚Р°С‚СѓСЃ: РІС‹ РІ СЃРїРёСЃРєРµ РѕР¶РёРґР°РЅРёСЏ";
    }

    if (registeredCount >= tournament.max_players) {
      return "РЎС‚Р°С‚СѓСЃ: СЃРІРѕР±РѕРґРЅС‹С… РјРµСЃС‚ РЅРµС‚";
    }

    return "РЎС‚Р°С‚СѓСЃ: РµСЃС‚СЊ СЃРІРѕР±РѕРґРЅС‹Рµ РјРµСЃС‚Р°";
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-md">
          <p className="text-sm text-white/70">Р—Р°РіСЂСѓР¶Р°РµРј С‚СѓСЂРЅРёСЂ...</p>
        </div>
      </main>
    );
  }

  if (error || !tournament) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-md">
          <Link
            href="/tournaments"
            className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
          >
            в†ђ РќР°Р·Р°Рґ
          </Link>

          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error ?? "РўСѓСЂРЅРёСЂ РЅРµ РЅР°Р№РґРµРЅ"}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-md">
        <Link
          href="/tournaments"
          className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          в†ђ РќР°Р·Р°Рґ
        </Link>

        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-red-900/60 to-black p-5">
          <p className="text-sm text-white/60">РўСѓСЂРЅРёСЂ</p>
          <h1 className="mt-2 text-3xl font-black uppercase tracking-wide">
            {tournament.title}
          </h1>

          <div className="mt-4 flex gap-2 text-sm text-white/80">
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2">
              {new Date(tournament.start_at).toLocaleString("ru-RU")}
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2">
              {registeredCount} / {tournament.max_players}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setActiveTab("about")}
            className={`rounded-full border px-4 py-3 text-sm font-medium ${
              activeTab === "about"
                ? "border-white/20 bg-white/10 text-white"
                : "border-white/10 bg-transparent text-white/70"
            }`}
          >
            Рћ С‚СѓСЂРЅРёСЂРµ
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveTab(tournament.status === "completed" ? "results" : "participants")
            }
            className={`rounded-full border px-4 py-3 text-sm font-medium ${
              activeTab === "participants" || activeTab === "results"
                ? "border-white/20 bg-white/10 text-white"
                : "border-white/10 bg-transparent text-white/70"
            }`}
          >
            {tournament.status === "completed"
              ? `Р РµР·СѓР»СЊС‚Р°С‚С‹ (${results.length})`
              : `РЈС‡Р°СЃС‚РЅРёРєРё (${registeredParticipants.length})`}
          </button>
        </div>

        {activeTab === "about" ? (
          <div className="mt-6 space-y-6">
            <section>
              <h2 className="text-2xl font-bold">РљРѕРіРґР°</h2>
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-base">{new Date(tournament.start_at).toLocaleString("ru-RU")}</p>
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-bold">Р“РґРµ</h2>
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-base">
                {tournament.location || "РњРµСЃС‚Рѕ РЅРµ СѓРєР°Р·Р°РЅРѕ"}
                </p>
              </div>
            </section>

<section>
  <h2 className="text-2xl font-bold">РћРїРёСЃР°РЅРёРµ</h2>
  <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
    <p className="text-base text-white/80">
      {tournament.description || "РћРїРёСЃР°РЅРёРµ РЅРµ РґРѕР±Р°РІР»РµРЅРѕ"}
    </p>
  </div>
</section>

            <section>
              <h2 className="text-2xl font-bold">РЎС‚Р°С‚СѓСЃ</h2>
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-base">{getStatusText()}</p>
              </div>
            </section>

            {tournament.status !== "completed" ? (
              <section>
                <h2 className="text-2xl font-bold">Р РµРіРёСЃС‚СЂР°С†РёСЏ</h2>
                <div className="mt-3 rounded-xl border border-white/10 bg-red-900/30 p-4">
                  <p className="text-sm text-white/80">
                    Р•СЃР»Рё РїР»Р°РЅС‹ РёР·РјРµРЅРёР»РёСЃСЊ, РїРѕР¶Р°Р»СѓР№СЃС‚Р°, РѕС‚РјРµРЅСЏР№С‚Рµ СЂРµРіРёСЃС‚СЂР°С†РёСЋ Р·Р°СЂР°РЅРµРµ,
                    чтобы освободить место для игроков из списка ожидания.
                  </p>

                  {renderActionButton()}

                  {message ? (
                    <p className="mt-3 text-sm text-white/80">{message}</p>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
        ) : tournament.status === "completed" ? (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5">
            <div className="grid grid-cols-[48px_1fr_80px_80px] gap-3 border-b border-white/10 px-4 py-3 text-xs uppercase tracking-wide text-white/50">
              <div>РњРµСЃС‚Рѕ</div>
              <div>РРіСЂРѕРє</div>
              <div className="text-right">KO</div>
              <div className="text-right">РћС‡РєРё</div>
            </div>

            {results.length === 0 ? (
              <div className="px-4 py-6 text-sm text-white/60">Р РµР·СѓР»СЊС‚Р°С‚С‹ РїРѕРєР° РЅРµ Р·Р°РїРѕР»РЅРµРЅС‹</div>
            ) : (
              results.map((result) => (
                <div
                  key={`${result.player_id}-${result.place}`}
                  className="grid grid-cols-[48px_1fr_80px_80px] gap-3 border-b border-white/10 px-4 py-4 last:border-b-0"
                >
                  <div className="text-sm font-semibold text-white/80">{result.place}</div>

                  <div>
                    <Link
                      href={`/players/${result.player_id}`}
                      className="text-sm font-medium text-white"
                    >
                      {result.username ? `@${result.username}` : result.display_name}
                    </Link>
                    {!result.username ? (
                      <p className="mt-1 text-xs text-white/50">{result.display_name}</p>
                    ) : null}
                  </div>

                  <div className="text-right text-sm font-semibold text-white/80">
                    {result.knockouts}
                  </div>

                  <div className="text-right text-sm font-semibold text-white/80">
                    {result.rating_points}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5">
            <div className="border-b border-white/10 px-4 py-3">
              <p className="text-sm font-semibold text-white/80">
                Р—Р°РїРёСЃР°РЅС‹ ({registeredParticipants.length})
              </p>
            </div>

            <div className="grid grid-cols-[48px_1fr_90px] gap-3 border-b border-white/10 px-4 py-3 text-xs uppercase tracking-wide text-white/50">
              <div>#</div>
              <div>РќРёРє</div>
              <div className="text-right">Р РµР№С‚РёРЅРі</div>
            </div>

            {registeredParticipants.length === 0 ? (
              <div className="px-4 py-6 text-sm text-white/60">РџРѕРєР° Р·Р°РїРёСЃР°РЅРЅС‹С… СѓС‡Р°СЃС‚РЅРёРєРѕРІ РЅРµС‚</div>
            ) : (
              registeredParticipants.map((participant, index) => (
                <div
                  key={participant.registration_id}
                  className="grid grid-cols-[48px_1fr_90px] gap-3 border-b border-white/10 px-4 py-4 last:border-b-0"
                >
                  <div className="text-sm font-semibold text-white/80">{index + 1}</div>

                  <div>
                    <Link
                      href={`/players/${participant.player_id}`}
                      className="text-sm font-medium text-white"
                    >
                      {participant.username
                        ? `@${participant.username}`
                        : participant.display_name}
                    </Link>
                    {!participant.username ? (
                      <p className="mt-1 text-xs text-white/50">{participant.display_name}</p>
                    ) : null}
                  </div>

                  <div className="text-right text-sm font-semibold text-white/80">
                    {participant.rating}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5">
            <div className="border-b border-white/10 px-4 py-3">
              <p className="text-sm font-semibold text-white/80">
                РЎРїРёСЃРѕРє РѕР¶РёРґР°РЅРёСЏ ({waitlistParticipants.length})
              </p>
            </div>

            <div className="grid grid-cols-[48px_1fr_90px] gap-3 border-b border-white/10 px-4 py-3 text-xs uppercase tracking-wide text-white/50">
              <div>#</div>
              <div>РќРёРє</div>
              <div className="text-right">Р РµР№С‚РёРЅРі</div>
            </div>

            {waitlistParticipants.length === 0 ? (
              <div className="px-4 py-6 text-sm text-white/60">РЎРїРёСЃРѕРє РѕР¶РёРґР°РЅРёСЏ РїСѓСЃС‚</div>
            ) : (
              waitlistParticipants.map((participant, index) => (
                <div
                  key={participant.registration_id}
                  className="grid grid-cols-[48px_1fr_90px] gap-3 border-b border-white/10 px-4 py-4 last:border-b-0"
                >
                  <div className="text-sm font-semibold text-white/80">{index + 1}</div>

                  <div>
                    <Link
                      href={`/players/${participant.player_id}`}
                      className="text-sm font-medium text-white"
                    >
                      {participant.username
                        ? `@${participant.username}`
                        : participant.display_name}
                    </Link>
                    {!participant.username ? (
                      <p className="mt-1 text-xs text-white/50">{participant.display_name}</p>
                    ) : null}
                  </div>

                  <div className="text-right text-sm font-semibold text-white/80">
                    {participant.rating}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        )}
      </div>
    </main>
  );
}
