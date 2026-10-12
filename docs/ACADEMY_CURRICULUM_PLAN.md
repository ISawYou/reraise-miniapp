# Academy — beginner curriculum plan (backlog)

> **Developer-facing planning document only.** Rows marked **Shipped** are
> live; everything else is a plan and is not shown to players: no lesson
> cards, no placeholders, no "coming soon" entries. Each module needs real, reviewed content and data before it
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
| 3 | **SB first-in** | **Shipped** as Новичкам · Шаг 2, lesson 1 (40 BB `RFI_SB`: raise / fold — that node has no LIMP, so limp is not taught; 20 / 100 BB `RFI_SB` do have LIMP). |
| 4 | **Защита BB против открытия** | **Shipped** as Шаг 2, lesson 2 (40 BB `FACING_OPEN_BB_VS_BTN`, compared with `…_VS_UTG`). Defence framing only, never "BB opens". |
| 5 | **SB против открытия** | **Shipped** as Шаг 2, lesson 3 (40 BB `FACING_OPEN_SB_VS_BTN`, compared with BB defence). |
| 6 | **Базовый 3-бет** | **Shipped** as Шаг 2, lesson 4 (40 BB `FACING_OPEN_BTN_VS_CO` in position vs `FACING_OPEN_BB_VS_BTN` out of position; sizes from the typed sizing profile). |
| 7 | **Игра против 3-бета** | **Shipped** as Шаг 2, lesson 5 (40 BB `FACING_3BET_CO_VS_BTN`: all-in / call / fold — at 40 BB the next raise is all-in). |

Шаг 2 ("Что делать после открытия", `config/academy/beginner-after-open.ts`)
is deliberately **outside** `ACADEMY_CATALOG`: adding it to the База MTT
course/module would change the "X из 7" total of every player who already
completed the opening lessons. Its practice deep-links into the existing
configurable-trainer route of each node and records under that trainer's
code. Per-lesson completion, if ever wanted, must be a new catalog unit with
the same never-renamed lesson codes — never an append to the 7 openings.
| 8 | **Короткий стек / Push-Fold** | **Only after validated ranges exist.** The HoldemMath 9-max charts use a single-caller approximation and are too wide for early seats (docs/ACADEMY_PUSH_FOLD_AUDIT.md), so scored Push/Fold is paused and the charts are reference-only. Build this module once an MTT-appropriate source has been validated. |

## Postflop beginner track (future, planning only)

There is no postflop solver data in the repository and none should be added
before these topics are designed:

1. **Позиция после флопа** — who acts first, the information advantage
2. **Типы досок** — dry / wet, paired, monotone
3. **Продолженная ставка** — the c-bet by the preflop raiser
4. **Добор и блеф** — betting for value vs as a bluff
5. **Размер ставки** — choosing a bet size
6. **Игра на тёрне**
7. **Игра на ривере**
8. **Шансы банка / базовая эквити** — pot odds and a simple feel for equity

Planning only: no postflop strategy data, content, lesson cards or
"скоро" placeholders exist for any of these.

## Dependencies before any of this ships

- A content source per module (validated data, or concept-only content).
- Catalog entries with new stable codes (`config/academy/catalog.ts`). Never
  add empty or placeholder cards.
- Progress uses the existing `academy_lesson_progress` /
  `academy_training_attempts` tables (text lesson codes), so no migration is
  needed.
