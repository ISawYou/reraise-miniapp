import type { AcademyLessonCode, PreflopPosition } from "@/types/academy";

export type AcademyPreflopLesson = {
  readonly code: AcademyLessonCode;
  readonly position: PreflopPosition;
  readonly displayLabel: string;
  readonly fullName: string;
  readonly positionGroup: string;
  readonly theory: readonly [string, string];
};

export const ACADEMY_PREFLOP_LESSONS = {
  UTG: {
    code: "preflop_rfi_9max_100bb_utg",
    position: "UTG",
    displayLabel: "UTG",
    fullName: "Under the Gun",
    positionGroup: "Ранняя позиция",
    theory: [
      "UTG — первая позиция после большого блайнда. На префлопе игрок на UTG принимает решение первым.",
      "После тебя остаётся больше всего игроков, поэтому диапазон открытия здесь уже, чем на более поздних позициях.",
    ],
  },
  EP: {
    code: "preflop_rfi_9max_100bb_ep",
    position: "EP",
    displayLabel: "UTG+1",
    fullName: "Early Position",
    positionGroup: "Ранняя позиция",
    theory: [
      "UTG+1 действует сразу после UTG и всё ещё относится к ранним позициям 9-max стола.",
      "Игроков позади немного меньше, поэтому открываться можно чуть шире, но диапазон всё ещё требует дисциплины.",
    ],
  },
  MP1: {
    code: "preflop_rfi_9max_100bb_mp1",
    position: "MP1",
    displayLabel: "MP",
    fullName: "Middle Position",
    positionGroup: "Средняя позиция",
    theory: [
      "MP находится в средней части стола: ранние позиции уже сделали ход, но впереди остаётся несколько соперников.",
      "Риск получить сопротивление снижается, поэтому диапазон открытия постепенно расширяется.",
    ],
  },
  MP2: {
    code: "preflop_rfi_9max_100bb_mp2",
    position: "MP2",
    displayLabel: "LJ",
    fullName: "Lojack",
    positionGroup: "Средняя позиция",
    theory: [
      "LJ — последняя средняя позиция перед HJ, CO и BTN.",
      "Чем ближе мы к баттону, тем меньше игроков остаётся позади и тем больше рук можно прибыльно открывать.",
    ],
  },
  HJ: {
    code: "preflop_rfi_9max_100bb_hj",
    position: "HJ",
    displayLabel: "HJ",
    fullName: "Hijack",
    positionGroup: "Поздняя позиция",
    theory: [
      "HJ находится справа от CO и открывает позднюю часть стола.",
      "Позади остаётся меньше игроков, поэтому диапазон заметно шире ранних и средних позиций.",
    ],
  },
  CO: {
    code: "preflop_rfi_9max_100bb_co",
    position: "CO",
    displayLabel: "CO",
    fullName: "Cutoff",
    positionGroup: "Поздняя позиция",
    theory: [
      "CO находится непосредственно справа от баттона. После тебя решение принимают BTN и блайнды.",
      "Благодаря небольшому числу игроков позади здесь можно открывать широкий диапазон рук.",
    ],
  },
  BTN: {
    code: "preflop_rfi_9max_100bb_btn",
    position: "BTN",
    displayLabel: "BTN",
    fullName: "Button",
    positionGroup: "Баттон",
    theory: [
      "BTN — самая поздняя позиция: на префлопе позади остаются только малый и большой блайнды.",
      "Позиционное преимущество после флопа и минимум игроков позади позволяют открывать самый широкий диапазон курса.",
    ],
  },
} as const satisfies Record<PreflopPosition, AcademyPreflopLesson>;

export function getAcademyPreflopLesson(position: PreflopPosition): AcademyPreflopLesson {
  return ACADEMY_PREFLOP_LESSONS[position];
}

export const ACADEMY_PREFLOP_LESSON_CODES = Object.freeze(
  Object.values(ACADEMY_PREFLOP_LESSONS).map((lesson) => lesson.code),
) as readonly AcademyLessonCode[];

export function getAcademyPreflopLessonByCode(
  lessonCode: string,
): AcademyPreflopLesson | null {
  return Object.values(ACADEMY_PREFLOP_LESSONS).find(
    (lesson) => lesson.code === lessonCode,
  ) ?? null;
}
