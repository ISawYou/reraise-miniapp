"use server";
import { registerPlayerForTournament } from '@/features/tournaments';
import { registrationDeadlineRejection } from '@/lib/registration-deadline-response';
// Keep canonical authorization/transaction unchanged; serialize only the
// confirmed expected rejection, not arbitrary database messages.
export async function registerPlayerForTournamentAction(playerId: string, tournamentId: string) {
    try {
        return { ok: true as const, registration: await registerPlayerForTournament(playerId, tournamentId) };
    }
    catch (error) {
        const rejection = registrationDeadlineRejection(error);
        if (rejection)
            return rejection;
        throw error;
    }
}
