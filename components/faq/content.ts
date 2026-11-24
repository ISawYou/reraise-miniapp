import { FAQ_CONTENT } from "@/config/faq-content";
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
  format?: string;
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
          return {
            id: `format-${n + 1}`,
            topic: topic.id,
            title: format.slice(0, end),
            text: format.slice(end + 1),
            format: format.slice(0, end),
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
  return articles.flatMap((article) => {
    const topic = topics.find((t) => t.id === article.topic)!;
    const body = plainText(article.text);
    const haystack =
      `${article.title} ${topic.title} ${topic.note} ${body}`.toLocaleLowerCase(
        "ru",
      );
    const position = Math.max(
      0,
      body.toLocaleLowerCase("ru").indexOf(words[0]) - 45,
    );
    return words.every((w) => haystack.includes(w))
      ? [
          {
            ...article,
            snippet: `${position ? "…" : ""}${body.slice(position, position + 170)}${body.length > position + 170 ? "…" : ""}`,
          },
        ]
      : [];
  });
}
export const guideHref = (topic?: string, article?: string) =>
  `/faq${topic ? `?tab=${topic}${article ? `&article=${article}` : ""}` : ""}`;
