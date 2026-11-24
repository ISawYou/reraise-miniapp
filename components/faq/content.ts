import { FAQ_CONTENT } from "@/config/faq-content";
import type { TournamentType } from "@/types/domain";
export const formatTypes: Record<string, TournamentType | "monthly-final"> = {
  Classic: "classic",
  "Bounty Hunters": "bounty",
  "Boss Bounty": "boss_bounty",
  "Win The Button": "win_the_button",
  "Deep Stack": "deep_stack",
  "Mystery Bounty": "mystery_bounty",
  Phoenix: "phoenix",
  "Crazy Pineapple": "crazy_pineapple",
  "Bomb Pot": "bomb_pot",
  "Free-Roll": "free_roll",
  "Progressive Knockout": "progressive_knockout",
  "Omaha / Hold'em Mix": "omaha_holdem_mix",
  "RERAISE Main Event": "boost_rating",
  "Финал месяца": "monthly-final",
};
export const formatId = (type: string) => `format-${type.replaceAll("_", "-")}`;
export const legacyFormatIds: Record<string, string> = {};
export const topics = [
  {
    id: "general",
    title: "Начало и участие",
    note: "Запись, входы и первые шаги",
    source: 0,
  },
  {
    id: "tournament-rules",
    title: "Форматы турниров",
    note: "Найдите свою игру",
    source: 2,
  },
  {
    id: "rating-rules",
    title: "Рейтинг и очки",
    note: "От участия до места в сезоне",
    source: 3,
  },
  {
    id: "common-rules",
    title: "Правила клуба",
    note: "Условия, порядок и безопасность",
    source: 1,
  },
];
export type GuideArticle = {
  id: string;
  topic: string;
  title: string;
  text: string;
  format?: TournamentType | "monthly-final";
};
export const articles: GuideArticle[] = topics.flatMap((topic) =>
  FAQ_CONTENT[topic.source]
    .split(/^## /m)
    .filter((s) => s.trim() && s.trim() !== "---")
    .flatMap((section, index) => {
      const line = section.indexOf("\n");
      const [text, ...formats] = section.slice(line + 1).split(/^### /m);
      return [
        {
          id: `${topic.id}-${index + 1}`,
          topic: topic.id,
          title: section.slice(0, line).replace(/^\d+\.\s*/, ""),
          text,
        },
        ...formats.map((format, n) => {
          const end = format.indexOf("\n");
          const type = formatTypes[format.slice(0, end)];
          legacyFormatIds[`format-${n + 1}`] = formatId(type);
          return {
            id: formatId(type),
            topic: topic.id,
            title: format.slice(0, end),
            text: format.slice(end + 1),
            format: type,
          };
        }),
      ];
    }),
);
export const plainText = (text: string) =>
  text
    .replace(/[*`#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
export function searchGuide(query: string) {
  const words = query
    .toLocaleLowerCase("ru")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  return articles
    .flatMap((article) => {
      const topic = topics.find((t) => t.id === article.topic)!;
      const body = plainText(article.text);
      const title = article.title.toLocaleLowerCase("ru");
      const bodyLower = body.toLocaleLowerCase("ru");
      const contentMatch = words.every((w) =>
        `${title} ${bodyLower}`.includes(w),
      );
      // A topic-only query returns one representative result rather than every article.
      const topicMatch =
        words.every((w) => topic.title.toLocaleLowerCase("ru").includes(w)) &&
        article.id === `${topic.id}-1`;
      const score = words.every((w) => title.includes(w))
        ? 100
        : contentMatch
          ? 20 + words.filter((w) => title.includes(w)).length
          : topicMatch
            ? 1
            : 0;
      const matches = words.map(w => bodyLower.indexOf(w)).filter(n => n >= 0);
      const position = Math.max(0, (matches.length ? Math.min(...matches) : 0) - 45);
      return score
        ? [
            {
              ...article,
              score,
              snippet: `${position ? "…" : ""}${body.slice(position, position + 170)}${body.length > position + 170 ? "…" : ""}`,
            },
          ]
        : [];
    })
    .sort((a, b) => b.score - a.score);
}
export const guideHref = (topic?: string, article?: string) =>
  `/faq${topic ? `?tab=${topic}${article ? `&article=${article}` : ""}` : ""}`;
