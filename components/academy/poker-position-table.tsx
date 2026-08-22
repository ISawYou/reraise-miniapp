import {
  ACADEMY_TABLE_SEATS,
  getAcademyTableSeat,
} from "@/config/academy/position-table";
import type { PreflopPosition } from "@/types/academy";

type PokerPositionTableProps = {
  activePosition: PreflopPosition;
};

export function PokerPositionTable({
  activePosition,
}: PokerPositionTableProps) {
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
          9-MAX
        </text>

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
