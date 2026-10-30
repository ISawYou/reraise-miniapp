import Link from "next/link";
import { CompactListRow, StatusPill, TournamentArtworkIcon } from "./profile-primitives";
import type { TournamentVisualConfig } from "@/config/tournament-visuals";
import type { RegistrationStatus, Tournament } from "@/types/domain";

export function ProfileUpcomingRow({ tournament, status, count, configs }: {
  tournament: Tournament;
  status: RegistrationStatus;
  count: number;
  configs: Record<string, TournamentVisualConfig>;
}) {
  const label = status === "registered" ? "Вы записаны" : status === "waitlist" ? "Лист ожидания" : status === "attended" ? "Вы участвовали" : status;
  return (
    <Link href={`/tournaments/${tournament.id}`} className="block transition active:scale-[0.99]">
      <CompactListRow>
        <TournamentArtworkIcon tournamentType={tournament.tournament_type} configs={configs} />
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-sm font-semibold leading-snug text-white [overflow-wrap:anywhere]">{tournament.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-white/65">
            <span className="block">{new Date(tournament.start_at).toLocaleString("ru-RU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
            <span data-registration-status="" className="block">{label}</span>
            {tournament.status === "closed" ? <span className="block">Регистрация закрыта</span> : null}
          </p>
        </div>
        <StatusPill>{count}/{tournament.max_players}</StatusPill>
      </CompactListRow>
    </Link>
  );
}
