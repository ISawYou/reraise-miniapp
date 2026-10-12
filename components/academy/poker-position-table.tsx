"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { KeyboardEvent, ReactNode } from "react";
import {
  ACADEMY_TABLE_SEATS,
  getAcademyTableSeat,
  type AcademyTableSeat,
} from "@/config/academy/position-table";
import { formatSizingBb } from "@/lib/academy/preflop-sizing";
import type {
  AcademyPreflopTableMoney,
  AcademyPreflopTableMoneySeat,
  AcademyPreflopTablePot,
  AcademyPreflopTableScene,
  AcademyPreflopTableSeatRole,
  PreflopPosition,
} from "@/types/academy";

/**
 * One 9-max table, four modes:
 * - `STATIC` (default): the original non-interactive lesson rendering.
 * - `LESSON_NAVIGATION`: same picture; each seat that has a База MTT lesson
 *   (UTG … BTN) is a link to that lesson. SB / BB have no lesson and stay
 *   non-interactive.
 * - `POSITION_SELECTION`: tap a seat to pick the hero or the villain; only
 *   `selectableSeats` are enabled, every other seat is a disabled button.
 * - `TRAINING_SCENE`: a portrait "seat view" sized for the phone screen —
 *   hero at the bottom centre (optionally with the hole cards on the felt),
 *   villain highlighted with its key action ("Рейз", "3-бет", "Олл-ин", …) as
 *   a chip in front of the seat. Seats that folded are drawn as small, dim,
 *   dashed capsules with NO action text (no "Фолд" around the table).
 * Seats are addressed by trainer seat codes ("UTG1", "BB") in the two
 * trainer modes and by lesson position in the two lesson modes.
 */
type StaticProps = {
  mode?: "STATIC";
  activePosition: PreflopPosition;
};

type LessonNavigationProps = {
  mode: "LESSON_NAVIGATION";
  activePosition: PreflopPosition;
};

type PositionSelectionProps = {
  mode: "POSITION_SELECTION";
  /** Which role a tap assigns. */
  selecting: "HERO" | "VILLAIN";
  heroSeat: string | null;
  villainSeat: string | null;
  /** Trainer seat codes that may be tapped right now (real nodes only). */
  selectableSeats: readonly string[];
  onSelectSeat: (seat: string) => void;
};

type TrainingSceneProps = {
  mode: "TRAINING_SCENE";
  scene: AcademyPreflopTableScene;
  stackBb?: number;
  /** Optional hero hole cards, placed on the felt just above the hero's seat. */
  heroCards?: ReactNode;
  /**
   * Cap the scene's height to the VISIBLE viewport (Telegram top chrome,
   * safe areas, bottom nav and the decision UI below the table), so the whole
   * table — top seats included — and the action buttons fit on arrival. See
   * `TRAINING_SCENE_FIT_MAX_HEIGHT`.
   */
  fitViewport?: boolean;
  /**
   * Explicit presentation mode. `BASIC` (default) renders exactly the plain
   * scene. `ADVANCED` additionally draws the trusted `table` money model —
   * hero/villain remaining stacks, committed-chip markers, blinds, pot and
   * all-in marks. Without `table` ADVANCED looks like BASIC.
   */
  presentation?: AcademyTablePresentation;
  table?: AcademyPreflopTableMoney;
};

/** Beginner-style plain table vs the advanced table with stacks / chips / pot. */
export type AcademyTablePresentation = "BASIC" | "ADVANCED";

export type PokerPositionTableProps =
  | StaticProps
  | LessonNavigationProps
  | PositionSelectionProps
  | TrainingSceneProps;

const VIEW_WIDTH = 360;
const VIEW_HEIGHT = 230;
const SEAT_WIDTH = 62;
const SEAT_HEIGHT = 30;
/** Extra vertical hit area (viewBox units) of interactive seats. */
const HIT_PADDING_Y = 5;

type SeatLook = {
  fill: string;
  stroke: string;
  strokeWidth: string;
  text: string;
  weight: string;
  opacity?: number;
};

const LOOK = {
  idle: { fill: "#111713", stroke: "rgba(255,255,255,0.14)", strokeWidth: "1", text: "rgba(255,255,255,0.66)", weight: "600" },
  active: { fill: "#d7b55a", stroke: "#f0d98a", strokeWidth: "2", text: "#11120f", weight: "800" },
  villain: { fill: "#6b2d31", stroke: "#e58a8e", strokeWidth: "2", text: "#ffffff", weight: "800" },
  folded: { fill: "#0c100e", stroke: "rgba(255,255,255,0.08)", strokeWidth: "1", text: "rgba(255,255,255,0.34)", weight: "600" },
  selectable: { fill: "#15271e", stroke: "#72b28e", strokeWidth: "1.5", text: "#ffffff", weight: "700" },
  disabled: { fill: "#0c100e", stroke: "rgba(255,255,255,0.06)", strokeWidth: "1", text: "rgba(255,255,255,0.25)", weight: "600" },
  lessonLink: { fill: "#111713", stroke: "rgba(215,181,90,0.42)", strokeWidth: "1", text: "rgba(255,255,255,0.78)", weight: "600" },
  noLesson: { fill: "#111713", stroke: "rgba(255,255,255,0.14)", strokeWidth: "1", text: "rgba(255,255,255,0.66)", weight: "600", opacity: 0.45 },
} satisfies Record<string, SeatLook>;

function TableFelt({ centerLine }: { centerLine: string }) {
  return (
    <>
      <defs>
        <linearGradient id="academy-table-felt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#234d38" />
          <stop offset="1" stopColor="#11291e" />
        </linearGradient>
      </defs>

      <ellipse
        cx="180"
        cy="115"
        rx="111"
        ry="70"
        fill="#080b09"
        stroke="#26372e"
        strokeWidth="10"
      />
      <ellipse
        cx="180"
        cy="115"
        rx="103"
        ry="62"
        fill="url(#academy-table-felt)"
        stroke="#496d59"
        strokeWidth="1.5"
      />
      <ellipse
        cx="180"
        cy="115"
        rx="79"
        ry="42"
        fill="none"
        stroke="rgba(255,255,255,0.08)"
      />
      <text
        x="180"
        y="111"
        textAnchor="middle"
        fill="rgba(255,255,255,0.28)"
        fontSize="10"
        fontWeight="700"
        letterSpacing="2.2"
      >
        RERAISE
      </text>
      <text
        x="180"
        y="128"
        textAnchor="middle"
        fill="rgba(255,255,255,0.18)"
        fontSize="9"
      >
        {centerLine}
      </text>
    </>
  );
}

function SeatShape({ seat, label, look, ariaLabel }: { seat: AcademyTableSeat; label: string; look: SeatLook; ariaLabel: string }) {
  return (
    <g
      transform={`translate(${seat.x} ${seat.y})`}
      aria-label={ariaLabel}
      opacity={look.opacity}
      data-table-seat={seat.trainerSeat}
    >
      <rect
        width={SEAT_WIDTH}
        height={SEAT_HEIGHT}
        rx="12"
        fill={look.fill}
        stroke={look.stroke}
        strokeWidth={look.strokeWidth}
      />
      <text
        x="31"
        y="19"
        textAnchor="middle"
        fill={look.text}
        fontSize="10.5"
        fontWeight={look.weight}
      >
        {label}
      </text>
    </g>
  );
}

/** Interactive hit area over one seat, positioned in % of the viewBox. */
function seatHitStyle(seat: AcademyTableSeat) {
  return {
    left: `${(seat.x / VIEW_WIDTH) * 100}%`,
    top: `${((seat.y - HIT_PADDING_Y) / VIEW_HEIGHT) * 100}%`,
    width: `${(SEAT_WIDTH / VIEW_WIDTH) * 100}%`,
    height: `${((SEAT_HEIGHT + HIT_PADDING_Y * 2) / VIEW_HEIGHT) * 100}%`,
  };
}

const HIT_CLASS =
  "absolute rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#f0d98a] focus-visible:ring-offset-0";

function Frame({ caption, aside, children }: { caption: string; aside?: string; children: ReactNode }) {
  return (
    <figure className="m-0 min-w-0 overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.035] px-3 py-4">
      <figcaption className="flex items-center justify-between gap-3 px-1">
        <span className="text-sm font-medium text-white/65">{caption}</span>
        {aside ? <span className="text-xs font-semibold text-[#e0c477]">{aside}</span> : null}
      </figcaption>
      {children}
    </figure>
  );
}

function Legend({ items }: { items: ReadonlyArray<{ color: string; label: string; outline?: boolean }> }) {
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-xs text-white/55" aria-hidden="true">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={item.outline ? { border: `1.5px solid ${item.color}` } : { backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// STATIC — unchanged original rendering
// ---------------------------------------------------------------------------

function StaticTable({ activePosition }: { activePosition: PreflopPosition }) {
  const activeSeat = getAcademyTableSeat(activePosition);

  return (
    <figure className="m-0 min-w-0 overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.035] px-3 py-4">
      <figcaption className="flex items-center justify-between gap-3 px-1">
        <span className="text-sm font-medium text-white/65">
          Позиция за столом
        </span>
        <span className="text-xs font-semibold text-[#e0c477]">
          {activeSeat.label}
        </span>
      </figcaption>

      <svg
        role="img"
        aria-label={`Стол 9-max, выделена позиция ${activeSeat.label}`}
        viewBox="0 0 360 230"
        className="mt-2 block h-auto w-full max-w-full"
      >
        <TableFelt centerLine="9-MAX" />

        {ACADEMY_TABLE_SEATS.map((seat) => {
          const active = seat.lessonPosition === activePosition;

          return (
            <g
              key={seat.label}
              transform={`translate(${seat.x} ${seat.y})`}
              aria-label={`${seat.label}${active ? ", текущая позиция" : ""}`}
            >
              <rect
                width="62"
                height="30"
                rx="12"
                fill={active ? "#d7b55a" : "#111713"}
                stroke={active ? "#f0d98a" : "rgba(255,255,255,0.14)"}
                strokeWidth={active ? "2" : "1"}
              />
              <text
                x="31"
                y="19"
                textAnchor="middle"
                fill={active ? "#11120f" : "rgba(255,255,255,0.66)"}
                fontSize="10.5"
                fontWeight={active ? "800" : "600"}
              >
                {seat.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// LESSON_NAVIGATION
// ---------------------------------------------------------------------------

/** Route of a База MTT lesson page (same lower-case param the page generates). */
export function academyPreflopLessonRoute(position: PreflopPosition): string {
  return `/academy/preflop/${position.toLowerCase()}`;
}

function LessonSeatLink({ seat, position, active }: { seat: AcademyTableSeat; position: PreflopPosition; active: boolean }) {
  const router = useRouter();
  const href = academyPreflopLessonRoute(position);
  function onKeyDown(event: KeyboardEvent<HTMLAnchorElement>) {
    // Links activate on Enter natively; Space is added so the seat behaves
    // like the button it looks like. Both go through the router.
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      router.push(href);
    }
  }
  return (
    <Link
      href={href}
      aria-label={active ? `${seat.label} — текущий урок` : `Перейти к уроку ${seat.label}`}
      aria-current={active ? "page" : undefined}
      data-lesson-seat={position}
      onKeyDown={onKeyDown}
      className={HIT_CLASS}
      style={seatHitStyle(seat)}
    />
  );
}

function LessonNavigationTable({ activePosition }: { activePosition: PreflopPosition }) {
  const activeSeat = getAcademyTableSeat(activePosition);
  return (
    <Frame caption="Позиция за столом" aside={activeSeat.label}>
      <div className="relative mt-2" data-table-mode="LESSON_NAVIGATION">
        <svg
          role="img"
          aria-label={`Стол 9-max, выделена позиция ${activeSeat.label}`}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="block h-auto w-full max-w-full"
        >
          <TableFelt centerLine="9-MAX" />
          {ACADEMY_TABLE_SEATS.map((seat) => {
            const active = seat.lessonPosition === activePosition;
            const look = active ? LOOK.active : seat.lessonPosition ? LOOK.lessonLink : LOOK.noLesson;
            return (
              <SeatShape
                key={seat.label}
                seat={seat}
                label={seat.label}
                look={look}
                ariaLabel={`${seat.label}${active ? ", текущая позиция" : ""}`}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0">
          {ACADEMY_TABLE_SEATS.map((seat) => (seat.lessonPosition ? (
            <LessonSeatLink
              key={seat.label}
              seat={seat}
              position={seat.lessonPosition}
              active={seat.lessonPosition === activePosition}
            />
          ) : null))}
        </div>
      </div>
      <p className="mt-2 px-1 text-xs text-white/40">
        Нажми на позицию, чтобы открыть её урок. Для SB и BB уроков нет.
      </p>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// POSITION_SELECTION
// ---------------------------------------------------------------------------

function PositionSelectionTable({
  selecting,
  heroSeat,
  villainSeat,
  selectableSeats,
  onSelectSeat,
}: Omit<PositionSelectionProps, "mode">) {
  const selectable = new Set(selectableSeats);
  return (
    <figure className="m-0 min-w-0 overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.035] px-3 py-3">
      <div className="relative" data-table-mode="POSITION_SELECTION" data-selecting={selecting}>
        <svg
          role="img"
          aria-label={`Стол 9-max${heroSeat ? `, ты на ${heroSeat}` : ""}${villainSeat ? `, соперник ${villainSeat}` : ""}`}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="block h-auto w-full max-w-full"
        >
          <TableFelt centerLine="9-MAX" />
          <DealerButton />
          {ACADEMY_TABLE_SEATS.map((seat) => {
            const code = seat.trainerSeat;
            const look = code === heroSeat
              ? LOOK.active
              : code === villainSeat
                ? LOOK.villain
                : selectable.has(code) ? LOOK.selectable : LOOK.disabled;
            return <SeatShape key={code} seat={seat} label={code} look={look} ariaLabel={code} />;
          })}
        </svg>
        <div className="absolute inset-0">
          {ACADEMY_TABLE_SEATS.map((seat) => {
            const code = seat.trainerSeat;
            const enabled = selectable.has(code);
            const state = code === heroSeat ? "hero" : code === villainSeat ? "villain" : enabled ? "selectable" : "disabled";
            const label = enabled
              ? selecting === "HERO" ? `Ты на ${code}` : `Соперник на ${code}`
              : code === heroSeat ? `${code} — твоя позиция` : `${code} — недоступно`;
            return (
              <button
                key={code}
                type="button"
                data-seat={code}
                data-seat-state={state}
                disabled={!enabled}
                aria-disabled={!enabled}
                aria-pressed={enabled ? (selecting === "HERO" ? code === heroSeat : code === villainSeat) : undefined}
                aria-label={label}
                onClick={enabled ? () => onSelectSeat(code) : undefined}
                className={`${HIT_CLASS} ${enabled ? "cursor-pointer" : "cursor-default"}`}
                style={seatHitStyle(seat)}
              />
            );
          })}
        </div>
      </div>
      <Legend items={[
        { color: "#d7b55a", label: "Ты" },
        { color: "#e58a8e", label: "Соперник" },
        { color: "#72b28e", label: "Можно выбрать", outline: true },
      ]} />
    </figure>
  );
}

// ---------------------------------------------------------------------------
// TRAINING_SCENE
// ---------------------------------------------------------------------------

function DealerButton() {
  return (
    <g aria-hidden="true">
      <circle cx="200" cy="184" r="7" fill="#f4f1e6" stroke="#9c9682" strokeWidth="1" />
      <text x="200" y="187.5" textAnchor="middle" fill="#1b1b18" fontSize="8.5" fontWeight="800">D</text>
    </g>
  );
}

// Seat view: a portrait table sized for a phone screen. The hero always sits
// at the bottom centre; the other eight seats follow clockwise in action order
// (the seat that acts right after the hero sits on the hero's left, bottom-
// left), the way a mobile poker client draws the table. Only the PRESENTATION
// of the scene lives here — which seats folded / raised and with which label
// comes unchanged from the scene builders (lib/academy/*-table-scene.ts).
const SCENE_WIDTH = 360;
const SCENE_HEIGHT = 384;
const SCENE_CENTER_X = 180;
const SCENE_CENTER_Y = 184;
// Compact capsule seats (v2 polish). Every plate is centred on the SAME slot
// centre as before and fits inside the previous 76×40 / 124×46 boxes, so all
// earlier no-overlap guarantees (chips, bets, stacks, pot, cards) still hold.
/** A seat still to act (or without a role). */
const PLATE = { width: 66, height: 30 } as const;
/** The active opponent: a little larger, with a "Соперник" caption. */
const VILLAIN_PLATE = { width: 74, height: 36 } as const;
/** A seat that already folded: smaller and quiet — no "Фолд" text anywhere. */
const FOLDED_PLATE = { width: 58, height: 26 } as const;
const HERO_PLATE = { width: 116, height: 42 } as const;
const CHIP_HEIGHT = 20;

/** Plate size of a seat role (hero, villain, folded, waiting). */
export function trainingScenePlateSize(role: AcademyPreflopTableSeatRole): { readonly width: number; readonly height: number } {
  switch (role) {
    case "hero": return HERO_PLATE;
    case "villain": return VILLAIN_PLATE;
    case "folded": return FOLDED_PLATE;
    default: return PLATE;
  }
}
/** Top edge (viewBox units) of the hero-cards area on the felt, above the hero plate. */
const HERO_CARDS_TOP = 242;

// ---------------------------------------------------------------------------
// Viewport fit (safe area). Pure numbers shared by the CSS below and the
// layout model `trainingSceneFitLayout`, so tests and rendering cannot drift.
// ---------------------------------------------------------------------------

/** Session chrome ABOVE the table (page top padding, top bar, spot context), px. */
export const TRAINING_SCENE_CHROME_ABOVE_PX = 140;
/** Decision UI BELOW the table ("Твой ход" + action buttons, incl. two-line labels), px. */
export const TRAINING_SCENE_CHROME_BELOW_PX = 120;
/** The app's fixed bottom nav (incl. its 10px offset) + 8px breathing room, px — excluding the bottom safe-area inset. */
export const TRAINING_SCENE_BOTTOM_NAV_CLEARANCE_PX = 86;
/**
 * Floor of the fitted height: below this, the 78px hole cards would no longer
 * fit between `HERO_CARDS_TOP` and the hero plate (85 viewBox units ≥ 78px ⇒
 * scale ≥ 0.92 ⇒ ≥ 352px). On extreme screens the page scrolls instead of
 * crushing the table.
 */
export const TRAINING_SCENE_MIN_HEIGHT_PX = 352;
/** Smallest distance (viewBox units) between any seat plate and the scene's top edge. */
export const TRAINING_SCENE_TOP_SEAT_MARGIN_UNITS = 6;

/** Everything around the table that must fit in the visible viewport, px (above + below + bottom nav). */
export const TRAINING_SCENE_RESERVED_PX = 346;

/**
 * CSS max-height of a fitted scene. `--app-top-offset` is the Telegram
 * fullscreen top chrome (status bar + Mini App close bar), maintained by
 * TelegramAppShell; `--tg-viewport-stable-height` is Telegram's visible
 * viewport (falls back to 100dvh outside Telegram).
 *
 * Deliberately ONE plain string literal: the production minifier mangled the
 * equivalent template-literal concatenation (dropping the `var(...)` terms and
 * producing an invalid value the browser silently ignored). A test pins the
 * numbers to the constants above (352 = MIN, 346 = RESERVED).
 */
export const TRAINING_SCENE_FIT_MAX_HEIGHT =
  "max(352px, calc(var(--tg-viewport-stable-height, 100dvh) - var(--app-top-offset, 0px) - env(safe-area-inset-bottom, 0px) - 346px))";

/** Top edge (viewBox units) of the highest seat plate of the scene. */
export function trainingSceneTopSeatEdgeUnits(): number {
  // Worst case: the tallest non-hero plate (the villain's) in a top slot.
  return Math.min(...SCENE_SLOTS.map((slot, index) => slot.y - (index === 0 ? HERO_PLATE.height : VILLAIN_PLATE.height) / 2));
}

/**
 * Layout model of a fitted scene (mirrors `TRAINING_SCENE_FIT_MAX_HEIGHT`):
 * where the table and its highest seat land on screen for a viewport, the
 * Telegram top chrome and the bottom safe area. `contentWidth` is the scene's
 * rendered width (content column minus gutters).
 */
export function trainingSceneFitLayout({
  viewportHeight,
  topInset,
  bottomInset = 0,
  contentWidth,
}: {
  readonly viewportHeight: number;
  readonly topInset: number;
  readonly bottomInset?: number;
  readonly contentWidth: number;
}) {
  const naturalHeight = (contentWidth * SCENE_HEIGHT) / SCENE_WIDTH;
  const available = viewportHeight - topInset - bottomInset
    - TRAINING_SCENE_CHROME_ABOVE_PX - TRAINING_SCENE_CHROME_BELOW_PX - TRAINING_SCENE_BOTTOM_NAV_CLEARANCE_PX;
  const maxHeight = Math.max(TRAINING_SCENE_MIN_HEIGHT_PX, available);
  const height = Math.min(naturalHeight, maxHeight);
  const scale = Math.min(height / SCENE_HEIGHT, contentWidth / SCENE_WIDTH);
  const tableTop = topInset + TRAINING_SCENE_CHROME_ABOVE_PX;
  // preserveAspectRatio="xMidYMid meet": a height-capped scene is centred vertically in its box.
  const contentTop = tableTop + (height - SCENE_HEIGHT * scale) / 2;
  return {
    height,
    scale,
    tableTop,
    topSeatTop: contentTop + trainingSceneTopSeatEdgeUnits() * scale,
    buttonsBottom: tableTop + height + TRAINING_SCENE_CHROME_BELOW_PX,
    bottomNavTop: viewportHeight - bottomInset - TRAINING_SCENE_BOTTOM_NAV_CLEARANCE_PX,
  };
}

type SceneSlot = {
  /** Seat plate centre. */
  readonly x: number;
  readonly y: number;
  /** Action chip centre — clear of every plate, chip, the centre text and the hero-cards area. */
  readonly chip: { readonly x: number; readonly y: number };
  /** Dealer button centre when this slot holds the BTN. */
  readonly dealer: { readonly x: number; readonly y: number };
};

/** Slot 0 = hero; slot k = the seat acting k places after the hero. */
const SCENE_SLOTS: readonly SceneSlot[] = [
  { x: 180, y: 350, chip: { x: 278, y: 350 }, dealer: { x: 103, y: 350 } },
  { x: 67, y: 276, chip: { x: 67, y: 243 }, dealer: { x: 106, y: 243 } },
  { x: 42, y: 184, chip: { x: 113, y: 184 }, dealer: { x: 58, y: 218 } },
  { x: 67, y: 89, chip: { x: 78, y: 126 }, dealer: { x: 116, y: 98 } },
  { x: 137, y: 28, chip: { x: 140, y: 66 }, dealer: { x: 140, y: 92 } },
  { x: 223, y: 28, chip: { x: 220, y: 66 }, dealer: { x: 220, y: 92 } },
  { x: 293, y: 89, chip: { x: 282, y: 126 }, dealer: { x: 244, y: 98 } },
  { x: 318, y: 184, chip: { x: 247, y: 184 }, dealer: { x: 302, y: 218 } },
  { x: 293, y: 276, chip: { x: 293, y: 243 }, dealer: { x: 254, y: 243 } },
];

/** Visual slot of every seat: hero at slot 0, then clockwise in action order. */
export function trainingSceneSlotOf(seat: string, heroSeat: string): number {
  const order = ACADEMY_TABLE_SEATS.map((entry) => entry.trainerSeat as string);
  const seatIndex = order.indexOf(seat);
  const heroIndex = order.indexOf(heroSeat);
  if (seatIndex === -1 || heroIndex === -1) throw new Error(`Unknown table seat: ${seat} / ${heroSeat}`);
  return (seatIndex - heroIndex + order.length) % order.length;
}

/**
 * Action chips are drawn ONLY for the hero and the active villain (the key
 * action: open / 3-bet / all-in). Folded seats get no chip at all — they are
 * shown by their quiet plate alone (v2: no "Фолд" smeared around the table).
 */
const CHIP_LOOK = {
  hero: { fill: "#3a3218", stroke: "#d7b55a", text: "#f3dc93", weight: "800" },
  villain: { fill: "#4a1f22", stroke: "#e58a8e", text: "#ffd0d2", weight: "800" },
} as const;

/** Folded seat: dark, dashed outline, dim label — present but out of the hand. */
const SCENE_FOLDED_LOOK: SeatLook = {
  fill: "#0d1210", stroke: "rgba(255,255,255,0.09)", strokeWidth: "1", text: "rgba(255,255,255,0.3)", weight: "600",
};

/** Seats whose action chip is drawn (see `CHIP_LOOK`). */
export function trainingSceneShowsActionChip(role: AcademyPreflopTableSeatRole): role is "hero" | "villain" {
  return role === "hero" || role === "villain";
}

function chipWidth(label: string): number {
  return Math.max(46, Math.round(label.length * 7 + 18));
}

/** Felt (inner ellipse) radii: larger than before, so the seats sit on the rail. */
export const TRAINING_SCENE_FELT = { rx: 131, ry: 159 } as const;

function SceneFelt({ stackBb, center = true }: { stackBb?: number; center?: boolean }) {
  return (
    <>
      <defs>
        <radialGradient id="academy-scene-felt" cx="50%" cy="44%" r="64%">
          <stop offset="0" stopColor="#2d6046" />
          <stop offset="0.72" stopColor="#1b412f" />
          <stop offset="1" stopColor="#11291e" />
        </radialGradient>
      </defs>
      <ellipse cx={SCENE_CENTER_X} cy={SCENE_CENTER_Y} rx={TRAINING_SCENE_FELT.rx + 9} ry={TRAINING_SCENE_FELT.ry + 9} fill="#070a08" stroke="#26362d" strokeWidth="10" />
      <ellipse cx={SCENE_CENTER_X} cy={SCENE_CENTER_Y} rx={TRAINING_SCENE_FELT.rx} ry={TRAINING_SCENE_FELT.ry} fill="url(#academy-scene-felt)" stroke="#4f7561" strokeWidth="1.5" />
      <ellipse cx={SCENE_CENTER_X} cy={SCENE_CENTER_Y} rx={TRAINING_SCENE_FELT.rx - 31} ry={TRAINING_SCENE_FELT.ry - 37} fill="none" stroke="rgba(255,255,255,0.05)" />
      {center ? (
        <text x={SCENE_CENTER_X} y="150" textAnchor="middle" fill="rgba(255,255,255,0.16)" fontSize="9" fontWeight="700" letterSpacing="2.4">
          RERAISE
        </text>
      ) : null}
      {center ? (
        <text x={SCENE_CENTER_X} y="191" textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize="22" fontWeight="800">
          {stackBb ? `${stackBb} BB` : "9-MAX"}
        </text>
      ) : null}
      {center && stackBb ? (
        <text x={SCENE_CENTER_X} y="208" textAnchor="middle" fill="rgba(255,255,255,0.42)" fontSize="10" fontWeight="600">
          стек у всех
        </text>
      ) : null}
    </>
  );
}

function ScenePlate({ seat, slot, role }: { seat: string; slot: SceneSlot; role: AcademyPreflopTableSeatRole }) {
  const hero = role === "hero";
  const villain = role === "villain";
  const folded = role === "folded";
  const size = trainingScenePlateSize(role);
  // Folded seats are dimmed with an OPAQUE plate (no group opacity), so the rail never shows through.
  const look = hero ? LOOK.active : villain ? LOOK.villain : folded ? SCENE_FOLDED_LOOK : LOOK.idle;
  const caption = hero ? "Ты" : villain ? "Соперник" : null;
  return (
    <g
      transform={`translate(${slot.x - size.width / 2} ${slot.y - size.height / 2})`}
      aria-label={`${seat}${hero ? ", ты" : villain ? ", соперник" : folded ? ", сбросил" : ""}`}
      data-table-seat={seat}
      data-scene-role={role}
      data-seat-folded={folded ? "true" : undefined}
    >
      <rect
        width={size.width}
        height={size.height}
        rx={size.height / 2}
        fill={look.fill}
        stroke={look.stroke}
        strokeWidth={hero ? "2.5" : look.strokeWidth}
        strokeDasharray={folded ? "3 2.5" : undefined}
      />
      <text
        x={size.width / 2}
        y={caption ? (hero ? 19 : 16) : size.height / 2 + (folded ? 4 : 4.5)}
        textAnchor="middle"
        fill={look.text}
        fontSize={hero ? 16 : villain ? 13.5 : folded ? 11.5 : 13}
        fontWeight={folded || role === "waiting" ? "600" : "800"}
      >
        {seat}
      </text>
      {caption ? (
        <text
          x={size.width / 2}
          y={hero ? 34 : 29.5}
          textAnchor="middle"
          fill={hero ? "rgba(17,18,15,0.72)" : "#ffd0d2"}
          fontSize={hero ? 10.5 : 9}
          fontWeight="800"
          letterSpacing={hero ? "1.4" : "0.3"}
        >
          {caption}
        </text>
      ) : null}
    </g>
  );
}

function SceneChip({ seat, slot, role, label }: { seat: string; slot: SceneSlot; role: "hero" | "villain"; label: string }) {
  const look = CHIP_LOOK[role];
  const width = chipWidth(label);
  return (
    <g
      transform={`translate(${slot.chip.x - width / 2} ${slot.chip.y - CHIP_HEIGHT / 2})`}
      data-seat-action={seat}
      data-seat-role={role}
    >
      <rect width={width} height={CHIP_HEIGHT} rx={CHIP_HEIGHT / 2} fill={look.fill} stroke={look.stroke} strokeWidth="1.2" />
      <text x={width / 2} y="14" textAnchor="middle" fill={look.text} fontSize="12" fontWeight={look.weight}>
        {label}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// ADVANCED presentation: stacks, committed chips, pot (trusted money model only)
// ---------------------------------------------------------------------------

type Point = { readonly x: number; readonly y: number };

/**
 * Committed-chip marker candidates per slot (centres), best first: between
 * the seat and the pot, each pre-checked against every plate, action chip,
 * stack badge, dealer button, the pot block, the ante note and the hero-cards
 * area that can occur. At render time a marker takes its first candidate that
 * does not collide with markers already placed (`placeBetMarkers`); a
 * geometry test pins "no overlap" for every real spot.
 */
const BET_CANDIDATES: readonly (readonly Point[])[] = [
  [{ x: 180, y: 232 }],
  [{ x: 112, y: 218 }, { x: 84, y: 150 }],
  [{ x: 112, y: 208 }, { x: 84, y: 150 }, { x: 146, y: 126 }],
  [{ x: 140, y: 126 }, { x: 78, y: 150 }, { x: 112, y: 208 }, { x: 202, y: 126 }],
  [{ x: 160, y: 116 }, { x: 84, y: 150 }],
  [{ x: 200, y: 116 }, { x: 276, y: 150 }],
  [{ x: 220, y: 126 }, { x: 282, y: 150 }, { x: 248, y: 208 }, { x: 158, y: 126 }],
  [{ x: 248, y: 208 }, { x: 276, y: 150 }, { x: 214, y: 126 }],
  [{ x: 248, y: 218 }, { x: 276, y: 150 }],
];
/** Side slots whose dealer button is nudged down in ADVANCED (clear of the BTN's stack badge). */
const SIDE_DEALER_SLOTS: ReadonlySet<number> = new Set([2, 7]);
/** Slot order in which markers claim their spots (hero first). */
const BET_PLACEMENT_PRIORITY = [0, 1, 2, 4, 3, 5, 6, 8, 7] as const;
/** The hero's taller all-in marker sits a little higher, clear of the hole cards. */
const HERO_ALL_IN_BET_SPOT: Point = { x: 180, y: 228 };
const BET_HEIGHT = 16;
const BET_ALL_IN_HEIGHT = 26;
const STACK_BADGE_HEIGHT = 12;
/** How far a stack badge overlaps its plate's edge (keeps the plate's caption readable). */
const STACK_BADGE_OVERLAP = 4;
/** Upper side seats whose action chip sits right below the plate: their badge goes on the plate's top edge. */
const STACK_BADGE_ON_TOP_SLOTS: ReadonlySet<number> = new Set([3, 6]);
/** Pot block in the felt centre (viewBox units). */
export const TRAINING_SCENE_POT_BOX = { x: 144, y: 163, width: 72, height: 50 } as const;
/** Separate ante note above the pot (only when the ante is not folded into the pot). */
export const TRAINING_SCENE_ANTE_NOTE_BOX = { x: 116, y: 141, width: 128, height: 14 } as const;

function textWidth(text: string, perChar: number, padding: number): number {
  return Math.round(text.length * perChar + padding);
}

/** "18 BB" or, for an all-in seat, "Олл-ин · 0" (nothing behind). */
export function trainingSceneStackLabel(seat: AcademyPreflopTableMoneySeat): string {
  return seat.allIn ? "Олл-ин · 0" : `${formatSizingBb(seat.remainingBb ?? 0)} BB`;
}

/** Drops a trailing size from an action chip ("Олл-ин 20 BB" → "Олл-ин"): the amount sits in the chip marker. */
export function trainingSceneShortActionLabel(label: string): string {
  return label.replace(/\s+[\d.]+\s*BB$/, "");
}

function StackBadge({ seat, x, top }: { seat: AcademyPreflopTableMoneySeat; x: number; top: number }) {
  const label = trainingSceneStackLabel(seat);
  const width = textWidth(label, 5.6, 14);
  // Hangs off the plate's edge (`top` from the caller); clamped into the viewBox for edge seats.
  const left = Math.min(Math.max(x - width / 2, 2), SCENE_WIDTH - 2 - width);
  return (
    <g
      transform={`translate(${left} ${top})`}
      data-seat-stack={seat.seat}
      data-remaining-bb={seat.remainingBb}
      data-all-in={seat.allIn ? "true" : undefined}
    >
      <rect
        width={width}
        height={STACK_BADGE_HEIGHT}
        rx={STACK_BADGE_HEIGHT / 2}
        fill={seat.allIn ? "#b9373d" : "#0b0f0d"}
        stroke={seat.allIn ? "#ffb3b6" : "rgba(255,255,255,0.28)"}
        strokeWidth="1"
      />
      <text x={width / 2} y="9.1" textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="800">
        {label}
      </text>
    </g>
  );
}

function betMarkerSize(seat: AcademyPreflopTableMoneySeat): { width: number; height: number } {
  return {
    width: Math.max(textWidth(`${formatSizingBb(seat.committedBb)} BB`, 5.6, 22), seat.allIn ? 56 : 0),
    height: seat.allIn ? BET_ALL_IN_HEIGHT : BET_HEIGHT,
  };
}

/** Deterministic, collision-free marker centres (see `BET_CANDIDATES`). */
function placeBetMarkers(markers: readonly { seat: AcademyPreflopTableMoneySeat; slotIndex: number }[]): Map<string, Point> {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const result = new Map<string, Point>();
  const ordered = [...markers].sort((a, b) =>
    BET_PLACEMENT_PRIORITY.indexOf(a.slotIndex as never) - BET_PLACEMENT_PRIORITY.indexOf(b.slotIndex as never));
  for (const { seat, slotIndex } of ordered) {
    const { width, height } = betMarkerSize(seat);
    const candidates = slotIndex === 0 && seat.allIn ? [HERO_ALL_IN_BET_SPOT] : BET_CANDIDATES[slotIndex];
    const box = (point: Point) => ({ x: point.x - width / 2 - 1, y: point.y - height / 2 - 1, w: width + 2, h: height + 2 });
    const free = candidates.find((point) => {
      const candidate = box(point);
      return placed.every((other) => !(candidate.x < other.x + other.w && other.x < candidate.x + candidate.w
        && candidate.y < other.y + other.h && other.y < candidate.y + candidate.h));
    }) ?? candidates[0];
    placed.push(box(free));
    result.set(seat.seat, free);
  }
  return result;
}

function BetMarker({ seat, spot, role }: { seat: AcademyPreflopTableMoneySeat; spot: Point; role: AcademyPreflopTableSeatRole }) {
  const amount = `${formatSizingBb(seat.committedBb)} BB`;
  const { width, height } = betMarkerSize(seat);
  const fill = seat.allIn ? "#5a1d21" : "rgba(5,8,6,0.82)";
  const stroke = seat.allIn ? "#ff8f94" : role === "hero" ? "#d7b55a" : role === "villain" ? "#e58a8e" : "rgba(255,255,255,0.22)";
  const chipColor = seat.allIn ? "#ff5a62" : role === "hero" ? "#d7b55a" : role === "villain" ? "#e58a8e" : "#9fb3a8";
  return (
    <g
      transform={`translate(${spot.x - width / 2} ${spot.y - height / 2})`}
      data-seat-bet={seat.seat}
      data-committed-bb={seat.committedBb}
      data-blind={seat.blind}
      data-all-in={seat.allIn ? "true" : undefined}
      aria-label={`${seat.seat}: ${amount}${seat.allIn ? " / ALL-IN" : ""}`}
    >
      <rect width={width} height={height} rx={height / 2} fill={fill} stroke={stroke} strokeWidth="1.2" />
      {seat.allIn ? (
        <text x={width / 2} y="10" textAnchor="middle" fill="#ffb3b6" fontSize="7.5" fontWeight="900" letterSpacing="0.8">ALL-IN</text>
      ) : null}
      <circle cx="9" cy={height - 8.5} r="4.6" fill={chipColor} stroke="rgba(0,0,0,0.45)" strokeWidth="1" strokeDasharray="2 1.6" />
      <text x={(width + 12) / 2} y={height - 5} textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="800">
        {amount}
      </text>
    </g>
  );
}

/**
 * Compact, honest pot + ante presentation (pure; rendering only). The pot
 * POLICY is untouched (lib/academy/preflop-sizing.ts): an ambiguous ante is
 * never added to a total. Only the wording changes — instead of a warning-style
 * "Банк без анте" + "формат не указан" line, the felt reads like a real table:
 * - EXACT, no ante:      pot "3.8 BB", no ante label;
 * - EXACT, trusted ante: pot "4.7 BB" + "с анте", pill "Анте 0.1 BB с игрока";
 * - WITHOUT_ANTE:        pot "3.8 BB" + "+ анте" (the ante is ON TOP, not in
 *   the number), pill "Анте 1 BB" restating only what the source declares.
 *   The source's caveat ("формат не указан") stays in the pill's tooltip and
 *   in the screen-reader description — never dropped, just not shouted.
 */
export type TrainingSceneAntePresentation = {
  /** Under the pot amount: "+ анте" / "с анте" / null. */
  readonly potCaption: string | null;
  /** Small pill above the pot, or null when there is no ante to label. */
  readonly pill: string | null;
  /** Full honest wording (tooltip + screen readers). */
  readonly note: string | null;
};

export function trainingSceneAntePresentation(table: AcademyPreflopTableMoney): TrainingSceneAntePresentation {
  const { pot, ante } = table;
  if (pot.kind === "EXACT") {
    if (pot.anteTotalBb <= 0) return { potCaption: null, pill: null, note: null };
    const pill = ante?.kind === "PER_PLAYER"
      ? `Анте ${formatSizingBb(ante.perPlayerBb)} BB с игрока`
      : `Анте ${formatSizingBb(pot.anteTotalBb)} BB`;
    return { potCaption: "с анте", pill, note: `Банк включает анте ${formatSizingBb(pot.anteTotalBb)} BB` };
  }
  const pill = ante?.kind === "AMBIGUOUS" && ante.declaredBb !== undefined
    ? `Анте ${formatSizingBb(ante.declaredBb)} BB`
    : ante?.kind === "AMBIGUOUS" ? "Анте: размер не указан" : "Анте";
  return { potCaption: "+ анте", pill, note: `Анте не входит в сумму банка: ${pot.anteNote}` };
}

function PotBlock({ table }: { table: AcademyPreflopTableMoney }) {
  const box = TRAINING_SCENE_POT_BOX;
  const cx = box.x + box.width / 2;
  const exact = table.pot.kind === "EXACT";
  const amount = exact ? table.pot.totalBb : table.pot.knownBb;
  const { potCaption } = trainingSceneAntePresentation(table);
  return (
    <g data-table-pot={table.pot.kind} data-pot-bb={amount}>
      <rect x={box.x} y={box.y} width={box.width} height={box.height} rx="14" fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.08)" />
      <text x={cx} y={box.y + 13} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="9" fontWeight="700" letterSpacing="0.6">
        Банк
      </text>
      <text x={cx} y={box.y + (potCaption ? 32 : 35)} textAnchor="middle" fill="#ffffff" fontSize="19" fontWeight="800">
        {`${formatSizingBb(amount)} BB`}
      </text>
      {potCaption ? (
        <text x={cx} y={box.y + 45} textAnchor="middle" fill="#e4c97a" fontSize="9" fontWeight="700" data-pot-caption>
          {potCaption}
        </text>
      ) : null}
    </g>
  );
}

function AntePill({ label, note, kind }: { label: string; note: string | null; kind: AcademyPreflopTablePot["kind"] }) {
  const box = TRAINING_SCENE_ANTE_NOTE_BOX;
  const width = Math.min(box.width, textWidth(label, 5.2, 22));
  const x = box.x + (box.width - width) / 2;
  return (
    <g data-ante-note data-ante-kind={kind} transform={`translate(${x} ${box.y})`}>
      {note ? <title>{note}</title> : null}
      <rect width={width} height={box.height} rx={box.height / 2} fill="rgba(215,181,90,0.12)" stroke="rgba(215,181,90,0.35)" strokeWidth="0.8" />
      <circle cx="8" cy={box.height / 2} r="2.6" fill="#d7b55a" />
      <text x={(width + 8) / 2} y={box.height / 2 + 3.1} textAnchor="middle" fill="#e9d394" fontSize="8.5" fontWeight="700">
        {label}
      </text>
    </g>
  );
}

/** Screen-reader summary of the money model (stacks, bets, pot). */
function moneyDescription(money: AcademyPreflopTableMoney, scene: AcademyPreflopTableScene): string[] {
  const seatText = money.seats
    .filter((seat) => seat.committedBb > 0 || seat.remainingBb !== undefined)
    .map((seat) => {
      const who = seat.seat === scene.heroSeat ? "ты" : seat.seat === scene.villainSeat ? "соперник" : "блайнд";
      const parts = [`${seat.seat} (${who}): поставил ${formatSizingBb(seat.committedBb)} BB`];
      if (seat.allIn) parts.push("олл-ин");
      else if (seat.remainingBb !== undefined) parts.push(`осталось ${formatSizingBb(seat.remainingBb)} BB`);
      return parts.join(", ");
    });
  const pot = money.pot.kind === "EXACT"
    ? `банк ${formatSizingBb(money.pot.totalBb)} BB${money.pot.anteTotalBb > 0 ? ", включая анте" : ""}`
    : `банк ${formatSizingBb(money.pot.knownBb)} BB плюс анте (${money.pot.anteNote})`;
  return [...seatText, pot];
}

function TrainingSceneTable({
  scene,
  stackBb,
  heroCards,
  fitViewport = false,
  presentation = "BASIC",
  table,
}: Omit<TrainingSceneProps, "mode">) {
  const money = presentation === "ADVANCED" ? table : undefined;
  const anteLabel = money ? trainingSceneAntePresentation(money) : null;
  const bySeat = new Map(scene.seats.map((entry) => [entry.seat, entry]));
  const folded = scene.seats.filter((entry) => entry.role === "folded").map((entry) => entry.seat);
  const villain = scene.villainSeat ? bySeat.get(scene.villainSeat) : undefined;
  const hero = bySeat.get(scene.heroSeat);
  const description = [
    `Стол 9-max. Ты на ${scene.heroSeat}${hero?.actionLabel ? ` (${hero.actionLabel})` : ""}`,
    villain ? `соперник ${villain.seat}${villain.actionLabel ? `: ${villain.actionLabel}` : ""}` : null,
    folded.length > 0 ? `сбросили: ${folded.join(", ")}` : null,
    ...(money ? moneyDescription(money, scene) : []),
  ].filter(Boolean).join("; ");
  const moneyBySeat = new Map((money?.seats ?? []).map((entry) => [entry.seat, entry]));
  const seats = ACADEMY_TABLE_SEATS.map((seat) => {
    const entry = bySeat.get(seat.trainerSeat);
    const slotIndex = trainingSceneSlotOf(seat.trainerSeat, scene.heroSeat);
    return {
      seat: seat.trainerSeat as string,
      role: entry?.role ?? ("waiting" as const),
      actionLabel: entry?.actionLabel,
      slotIndex,
      slot: SCENE_SLOTS[slotIndex],
    };
  });
  const button = seats.find((entry) => entry.seat === "BTN");
  // ADVANCED only: on the side seats the BTN's stack badge hangs where the
  // dealer button sits, so the button moves a few units down.
  const dealer = button && money && SIDE_DEALER_SLOTS.has(button.slotIndex)
    ? { x: button.slot.dealer.x, y: button.slot.dealer.y + 6 }
    : button?.slot.dealer;
  const betSpots = placeBetMarkers(seats.flatMap((entry) => {
    const seatMoney = moneyBySeat.get(entry.seat);
    return seatMoney && seatMoney.committedBb > 0 ? [{ seat: seatMoney, slotIndex: entry.slotIndex }] : [];
  }));

  return (
    <figure className="m-0 min-w-0" data-scene-layout="SEAT_VIEW" data-scene-fit={fitViewport ? "viewport" : undefined}>
      <div className="relative" data-table-mode="TRAINING_SCENE">
        <svg
          role="img"
          aria-label={description}
          viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`}
          className="block h-auto w-full max-w-full"
          style={fitViewport ? { maxHeight: TRAINING_SCENE_FIT_MAX_HEIGHT } : undefined}
        >
          <SceneFelt stackBb={stackBb} center={!money} />
          {money ? <PotBlock table={money} /> : null}
          {anteLabel?.pill ? <AntePill label={anteLabel.pill} note={anteLabel.note} kind={money!.pot.kind} /> : null}
          {dealer ? (
            <g aria-hidden="true" data-dealer-button>
              <circle cx={dealer.x} cy={dealer.y} r="9" fill="#f4f1e6" stroke="#9c9682" strokeWidth="1" />
              <text x={dealer.x} y={dealer.y + 3.6} textAnchor="middle" fill="#1b1b18" fontSize="10" fontWeight="800">D</text>
            </g>
          ) : null}
          {seats.map((entry) => <ScenePlate key={entry.seat} seat={entry.seat} slot={entry.slot} role={entry.role} />)}
          {seats.map((entry) => (entry.actionLabel && trainingSceneShowsActionChip(entry.role) ? (
            <SceneChip
              key={`action-${entry.seat}`}
              seat={entry.seat}
              slot={entry.slot}
              role={entry.role}
              label={money ? trainingSceneShortActionLabel(entry.actionLabel) : entry.actionLabel}
            />
          ) : null))}
          {money ? seats.map((entry) => {
            const seatMoney = moneyBySeat.get(entry.seat);
            if (!seatMoney) return null;
            const plateHeight = trainingScenePlateSize(entry.role).height;
            return (
              <g key={`money-${entry.seat}`}>
                {seatMoney.committedBb > 0 ? (
                  <BetMarker seat={seatMoney} spot={betSpots.get(entry.seat)!} role={entry.role} />
                ) : null}
                {seatMoney.remainingBb !== undefined ? (
                  <StackBadge
                    seat={seatMoney}
                    x={entry.slot.x}
                    top={STACK_BADGE_ON_TOP_SLOTS.has(entry.slotIndex)
                      ? entry.slot.y - plateHeight / 2 - STACK_BADGE_HEIGHT + STACK_BADGE_OVERLAP
                      : entry.slot.y + plateHeight / 2 - STACK_BADGE_OVERLAP}
                  />
                ) : null}
              </g>
            );
          }) : null}
        </svg>
        {heroCards ? (
          <div
            className="absolute left-1/2 -translate-x-1/2"
            style={{ top: `${(HERO_CARDS_TOP / SCENE_HEIGHT) * 100}%` }}
            data-testid="scene-hero-cards"
          >
            {heroCards}
          </div>
        ) : null}
      </div>
    </figure>
  );
}

export function PokerPositionTable(props: PokerPositionTableProps) {
  switch (props.mode) {
    case "LESSON_NAVIGATION":
      return <LessonNavigationTable activePosition={props.activePosition} />;
    case "POSITION_SELECTION":
      return (
        <PositionSelectionTable
          selecting={props.selecting}
          heroSeat={props.heroSeat}
          villainSeat={props.villainSeat}
          selectableSeats={props.selectableSeats}
          onSelectSeat={props.onSelectSeat}
        />
      );
    case "TRAINING_SCENE":
      return (
        <TrainingSceneTable
          scene={props.scene}
          stackBb={props.stackBb}
          heroCards={props.heroCards}
          fitViewport={props.fitViewport}
          presentation={props.presentation}
          table={props.table}
        />
      );
    default:
      return <StaticTable activePosition={props.activePosition} />;
  }
}
