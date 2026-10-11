"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { KeyboardEvent, ReactNode } from "react";
import {
  ACADEMY_TABLE_SEATS,
  getAcademyTableSeat,
  type AcademyTableSeat,
} from "@/config/academy/position-table";
import type { AcademyPreflopTableScene, PreflopPosition } from "@/types/academy";

/**
 * One 9-max table, four modes:
 * - `STATIC` (default): the original non-interactive lesson rendering.
 * - `LESSON_NAVIGATION`: same picture; each seat that has a База MTT lesson
 *   (UTG … BTN) is a link to that lesson. SB / BB have no lesson and stay
 *   non-interactive.
 * - `POSITION_SELECTION`: tap a seat to pick the hero or the villain; only
 *   `selectableSeats` are enabled, every other seat is a disabled button.
 * - `TRAINING_SCENE`: hero / villain highlighted and the earlier actions the
 *   node implies ("Фолд", "Рейз", "3-бет", …) shown in front of the seats.
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
};

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

/** Centre of the action bubble in front of each seat (viewBox units, on the felt). */
const ACTION_ANCHORS: Readonly<Record<AcademyTableSeat["trainerSeat"], { x: number; y: number }>> = {
  UTG: { x: 118, y: 70 },
  UTG1: { x: 180, y: 62 },
  UTG2: { x: 242, y: 70 },
  LJ: { x: 258, y: 98 },
  HJ: { x: 258, y: 138 },
  CO: { x: 226, y: 166 },
  BTN: { x: 160, y: 168 },
  SB: { x: 110, y: 152 },
  BB: { x: 102, y: 112 },
};

const BUBBLE_WIDTH = 44;
const BUBBLE_HEIGHT = 16;

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

const BUBBLE_LOOK = {
  hero: { fill: "rgba(215,181,90,0.22)", stroke: "#d7b55a", text: "#f3dc93" },
  villain: { fill: "rgba(229,138,142,0.2)", stroke: "#e58a8e", text: "#ffd0d2" },
  folded: { fill: "rgba(0,0,0,0.28)", stroke: "rgba(255,255,255,0.1)", text: "rgba(255,255,255,0.45)" },
} as const;

function TrainingSceneTable({ scene, stackBb }: Omit<TrainingSceneProps, "mode">) {
  const bySeat = new Map(scene.seats.map((entry) => [entry.seat, entry]));
  const folded = scene.seats.filter((entry) => entry.role === "folded").map((entry) => entry.seat);
  const villain = scene.villainSeat ? bySeat.get(scene.villainSeat) : undefined;
  const hero = bySeat.get(scene.heroSeat);
  const description = [
    `Стол 9-max. Ты на ${scene.heroSeat}${hero?.actionLabel ? ` (${hero.actionLabel})` : ""}`,
    villain ? `соперник ${villain.seat}${villain.actionLabel ? `: ${villain.actionLabel}` : ""}` : null,
    folded.length > 0 ? `сбросили: ${folded.join(", ")}` : null,
  ].filter(Boolean).join("; ");

  return (
    <figure className="m-0 min-w-0 overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.035] px-2.5 py-2">
      <div className="relative" data-table-mode="TRAINING_SCENE">
        <svg
          role="img"
          aria-label={description}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="block h-auto w-full max-w-full"
        >
          <TableFelt centerLine={stackBb ? `${stackBb} BB` : "9-MAX"} />
          <DealerButton />
          {ACADEMY_TABLE_SEATS.map((seat) => {
            const entry = bySeat.get(seat.trainerSeat);
            const role = entry?.role ?? "waiting";
            const look = role === "hero" ? LOOK.active : role === "villain" ? LOOK.villain : role === "folded" ? LOOK.folded : LOOK.idle;
            return (
              <SeatShape
                key={seat.trainerSeat}
                seat={seat}
                label={seat.trainerSeat}
                look={look}
                ariaLabel={`${seat.trainerSeat}${role === "hero" ? ", ты" : role === "villain" ? ", соперник" : ""}`}
              />
            );
          })}
          {ACADEMY_TABLE_SEATS.map((seat) => {
            const entry = bySeat.get(seat.trainerSeat);
            if (!entry?.actionLabel || entry.role === "waiting") return null;
            const anchor = ACTION_ANCHORS[seat.trainerSeat];
            const look = BUBBLE_LOOK[entry.role];
            return (
              <g
                key={`action-${seat.trainerSeat}`}
                transform={`translate(${anchor.x - BUBBLE_WIDTH / 2} ${anchor.y - BUBBLE_HEIGHT / 2})`}
                data-seat-action={seat.trainerSeat}
                data-seat-role={entry.role}
              >
                <rect width={BUBBLE_WIDTH} height={BUBBLE_HEIGHT} rx="8" fill={look.fill} stroke={look.stroke} strokeWidth="1" />
                <text
                  x={BUBBLE_WIDTH / 2}
                  y="11.2"
                  textAnchor="middle"
                  fill={look.text}
                  fontSize="8.5"
                  fontWeight={entry.role === "folded" ? "500" : "700"}
                >
                  {entry.actionLabel}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <Legend items={[
        { color: "#d7b55a", label: "Ты" },
        ...(scene.villainSeat ? [{ color: "#e58a8e", label: "Соперник" }] : []),
      ]} />
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
      return <TrainingSceneTable scene={props.scene} stackBb={props.stackBb} />;
    default:
      return <StaticTable activePosition={props.activePosition} />;
  }
}
