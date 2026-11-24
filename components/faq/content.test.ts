import { expect, it } from "vitest";
import { FAQ_CONTENT } from "@/config/faq-content";
import { articles, searchGuide, topics, legacyFormatIds } from "./content";
it("ranks title matches first and limits topic-only matches", () => {
  expect(searchGuide("Phoenix")[0].id).toBe("format-phoenix");
  expect(searchGuide("Форматы турниров")).toHaveLength(1);
  expect(searchGuide("наибольших остатков")[0].snippet).toContain(
    "наибольших остатков",
  );
});
it("uses unique canonical links and preserves previously issued format links", () => {
  expect(new Set(articles.map((a) => a.id)).size).toBe(articles.length);
  expect(articles.find((a) => a.title === "Progressive Knockout")?.id).toBe(
    "format-progressive-knockout",
  );
  expect(legacyFormatIds["format-7"]).toBe("format-phoenix");
});
it("preserves every approved content word in the normalized articles", () => {
  const words = (s: string) =>
    s
      .replace(/^#+.*$/gm, "")
      .replace(/---/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .sort();
  for (const topic of topics)
    expect(
      words(
        articles
          .filter((a) => a.topic === topic.id)
          .map((a) => a.text)
          .join("\n"),
      ),
    ).toEqual(words(FAQ_CONTENT[topic.source]));
});
it("indexes full rules and produces relevant snippets without HTML", () => {
  expect(searchGuide("Phoenix").some((a) => a.title === "Phoenix")).toBe(true);
  expect(searchGuide("50 000").some((a) => a.title === "Phoenix")).toBe(true);
  expect(searchGuide("Progressive Knockout").some((a) => a.format)).toBe(true);
  expect(searchGuide("несуществующееслово")).toEqual([]);
  expect(searchGuide(" ")).toEqual([]);
});
it("keeps all fourteen formats including monthly final, excluding archived final", () => {
  const formats = articles.filter((a) => a.format);
  expect(formats).toHaveLength(14);
  expect(formats.some((a) => a.title === "Финал месяца")).toBe(true);
  expect(formats.some((a) => a.title.includes("Калининград"))).toBe(false);
});
