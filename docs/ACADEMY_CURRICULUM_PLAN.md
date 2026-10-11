# Academy — beginner curriculum plan (backlog)

> **Developer-facing planning document only.** Nothing here is shipped or
> shown to players: no lesson cards, no placeholders, no "coming soon"
> entries. Each module needs real, reviewed content and data before it
> becomes player-facing. New modules get NEW stable lesson codes; existing
> codes are never renamed.

## Principles

- Teach in the order a hand is played: positions first, then first-in
  decisions, then reacting to action.
- Only realistic spots. In the 9-max action order used across the platform
  (UTG → … → BTN → SB → BB), the **BB never acts first preflop**. So there is
  **no "BB open / unopened pot from BB" lesson, ever**. BB content is always
  **defence against an open**.
- Practice uses the normal three-state scoring: any action the strategy plays
  (frequency > 0) counts as correct, and only 0% actions are mistakes. The
  100bb HRC Solver Lab keeps its exact-randomizer philosophy.
- Plain Russian and short screens, using the trainer UX already shipped
  (table scene, compact feedback with "Подробнее", sticky next step).

## Preflop beginner track (next modules, in order)

| # | Module | Notes / data |
|---|---|---|
| 1 | **Позиции и порядок действий** | Seat names, who acts first preflop and postflop, why position matters. Concept lesson plus a seat-recognition drill on the existing table (no strategy data needed). |
| 2 | **Открытия UTG–BTN** | Exists today as База MTT · Open Raise (100 BB, binary). Extend with stack-depth variants from the validated reference datasets already used by the configurable trainer. |
| 3 | **SB first-in** | SB when everyone folded: raise / limp / fold depending on stack. Needs a node set where the SB first-in strategy is available. |
| 4 | **Защита BB против открытия** | BB facing an open from each seat: 3-bet / call / fold. Defence framing only, never "BB opens". |
| 5 | **SB против открытия** | SB facing an open (out of position, BB still to act): mostly 3-bet-or-fold. |
| 6 | **Базовый 3-бет** | Value vs bluff 3-bets in position and from the blinds, at 40 / 100 BB. |
| 7 | **Игра против 3-бета** | Opener facing a 3-bet: 4-bet / call / fold. |
| 8 | **Короткий стек / Push-Fold** | **Only after validated ranges exist.** The HoldemMath 9-max charts use a single-caller approximation and are too wide for early seats (docs/ACADEMY_PUSH_FOLD_AUDIT.md), so scored Push/Fold is paused and the charts are reference-only. Build this module once an MTT-appropriate source has been validated. |

## Postflop beginner track (future, planning only)

There is no postflop solver data in the repository and none should be added
before these topics are designed:

1. Позиция на постфлопе (who acts first, information advantage)
2. Текстуры борда (dry / wet, paired, monotone)
3. Основы контбета (c-bet)
4. Вэлью против блефа
5. Сайзинг ставок
6. Игра на тёрне
7. Основы игры на ривере
8. Шансы банка и простое понимание эквити

## Dependencies before any of this ships

- A content source per module (validated data, or concept-only content).
- Catalog entries with new stable codes (`config/academy/catalog.ts`). Never
  add empty or placeholder cards.
- Progress uses the existing `academy_lesson_progress` /
  `academy_training_attempts` tables (text lesson codes), so no migration is
  needed.
