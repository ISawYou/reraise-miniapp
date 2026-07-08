import { SupabaseSeasonRepository } from "./SupabaseSeasonRepository";
import type { SeasonRepository } from "./SeasonRepository";

export type { SeasonRepository, SeasonRow } from "./SeasonRepository";

export const seasonRepository: SeasonRepository = new SupabaseSeasonRepository();
