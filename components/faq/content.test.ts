import { expect, it } from "vitest";
import { FAQ_CONTENT } from "@/config/faq-content";
import { articles, searchGuide, topics } from "./content";
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
