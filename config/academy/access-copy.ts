/**
 * Academy access tiers — client-safe types and player-facing copy (tiny,
 * dependency-free, no policy). The POLICY lives in
 * `config/academy/access-policy.ts` and is enforced server-side by
 * `features/academy-access.ts`; nothing in this file grants or denies access.
 *
 * - `BEGINNER_ONLY`: no actual participation in a game of the current season;
 *   the complete "Новичкам" experience stays open.
 * - `FULL`: participated in at least one game of the current season (or staff).
 */
export const ACADEMY_ACCESS_TIERS = ["BEGINNER_ONLY", "FULL"] as const;

export type AcademyAccessTier = (typeof ACADEMY_ACCESS_TIERS)[number];

/** Minimal product payload of `GET /api/academy/access` — never attendance / result details. */
export type AcademyAccessView = {
  readonly access: AcademyAccessTier;
  readonly season: { readonly id: string; readonly title: string } | null;
};

export function isAcademyAccessTier(value: unknown): value is AcademyAccessTier {
  return typeof value === "string" && (ACADEMY_ACCESS_TIERS as readonly string[]).includes(value);
}

export const ACADEMY_ACCESS_ENDPOINT = "/api/academy/access";

/** Where a restricted player is sent to unlock the rest of the Academy. */
export const ACADEMY_MEMBERSHIP_CTA_ROUTE = "/tournaments";

/** Stable machine code of the 403 body (`{ error, code }`) of a denied Academy API call. */
export const ACADEMY_ACCESS_DENIED_CODE = "ACADEMY_ACCESS_DENIED";

export const ACADEMY_ACCESS_COPY = Object.freeze({
  /** 403 message of a denied Academy API call (authenticated, not entitled — never 401). */
  apiDenied: "Расширенная Академия доступна после первой игры в текущем сезоне",
  panelTitle: "Продолжение — для участников сезона",
  panelBody: [
    "Более глубокие материалы и тренажёры доступны игрокам, которые уже были у нас на игре в этом сезоне.",
    "Запишитесь на свою первую игру — после участия доступ откроется автоматически.",
  ],
  cta: "Выбрать турнир",
  lockedCardReason: "Откроется после первой игры в сезоне",
  lockedScreenTitle: "Доступно участникам сезона",
  lockedScreenBody: "Более глубокие материалы и тренажёры открываются после вашей первой игры в текущем сезоне.",
  lockedScreenBack: "Вернуться к урокам для новичков",
  checking: "Проверяем доступ...",
});
