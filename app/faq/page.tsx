"use client";
import { useEffect, useState } from "react";
import { BackButton } from "@/components/ui/back-button";
import { FAQ_CONTENT } from "@/config/faq-content";
const tabs = [
  ["general", "Общая информация"],
  ["common-rules", "Общий регламент клуба"],
  ["tournament-rules", "Регламент турниров"],
  ["rating-rules", "Регламент рейтинга"],
];
import { Blocks } from "@/components/faq/blocks";
export default function FaqPage() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const update = () => {
      const t = new URLSearchParams(window.location.search).get("tab");
      setActive(
        Math.max(
          0,
          tabs.findIndex((x) => x[0] === t),
        ),
      );
    };
    update();
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return (
    <main className="min-h-screen bg-[#080f0c] px-4 py-6 pb-32 text-white">
      <div className="mx-auto max-w-4xl">
        <BackButton href="/" />
        <header className="my-6 rounded-3xl border border-[#d7b55a]/25 bg-[#10251b] p-6 sm:p-9">
          <p className="text-xs tracking-[.2em] text-[#d7b55a]">
            РЕРЕЙЗ · СПРАВОЧНИК · 18+
          </p>
          <h1 className="mt-4 text-3xl font-bold sm:text-5xl">Гид по РЕРЕЙЗ</h1>
          <p className="mt-4 leading-7 text-white/70">
            От первой записи до рейтинга сезона. Правила клуба, игровые форматы
            и подробный расчёт очков.
          </p>
        </header>
        <nav
          aria-label="Разделы гида"
          className="grid grid-cols-2 gap-3 md:grid-cols-4"
        >
          {tabs.map(([key, title], i) => (
            <button
              key={key}
              aria-pressed={active === i}
              onClick={() => {
                setActive(i);
                window.history.pushState(null, "", `?tab=${key}`);
              }}
              className={`min-h-24 rounded-2xl border p-4 text-left text-sm font-semibold ${active === i ? "border-[#d7b55a] bg-[#20372a] text-[#f0d38a]" : "border-white/15 bg-white/5 text-white/80"}`}
            >
              <span className="mb-2 block text-xs text-[#d7b55a]">
                0{i + 1}
              </span>
              {title}
            </button>
          ))}
        </nav>
        <section aria-label={tabs[active][1]} className="mt-8 space-y-3">
          <h2 className="mb-5 text-2xl font-semibold">{tabs[active][1]}</h2>
          {FAQ_CONTENT[active]
            .split(/^## /m)
            .filter((s) => s.trim() && s.trim() !== "---")
            .map((s, i) => {
              const n = s.indexOf("\n");
              return (
                <details
                  key={`${active}-${i}`}
                  className="rounded-2xl border border-white/15 bg-white/[.035] p-4 sm:p-6"
                >
                  <summary className="cursor-pointer text-base font-semibold leading-7 marker:text-[#d7b55a]">
                    {s.slice(0, n)}
                  </summary>
                  <div className="mt-5 border-t border-white/10 pt-5">
                    <Blocks text={s.slice(n + 1)} />
                  </div>
                </details>
              );
            })}
        </section>
      </div>
    </main>
  );
}
