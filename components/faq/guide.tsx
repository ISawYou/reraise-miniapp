"use client";
import { useEffect, useState, type ReactNode } from "react";
import { BackButton } from "@/components/ui/back-button";
import { Blocks } from "./blocks";
import {
  articles,
  guideHref,
  plainText,
  searchGuide,
  topics,
  legacyFormatIds,
} from "./content";
import {
  isTournamentVisualType,
  type TournamentVisualConfig,
} from "@/config/tournament-visuals";
import { Artwork } from "./artwork";
import "./guide.css";

export function Guide() {
  const [location, setLocation] = useState({ topic: "", article: "" });
  const [query, setQuery] = useState("");
  const [visuals, setVisuals] = useState<TournamentVisualConfig[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/tournament-visuals", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.visuals))
          setVisuals(
            data.visuals.filter(
              (v: TournamentVisualConfig) =>
                v &&
                isTournamentVisualType(v.tournamentType) &&
                typeof v.assetUrl === "string",
            ),
          );
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const update = () => {
      const p = new URLSearchParams(window.location.search);
      setLocation({
        topic: p.get("tab") || "",
        article:
          legacyFormatIds[p.get("article") || ""] || p.get("article") || "",
      });
      setQuery("");
      const top = window.history.state?.guideScroll || 0;
      requestAnimationFrame(() => window.scrollTo({ top }));
    };
    update();
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.history.scrollRestoration = previous;
    };
  }, []);
  const topic = topics.find((t) => t.id === location.topic);
  const article = articles.find(
    (a) => a.id === location.article && a.topic === topic?.id,
  );
  const items = articles.filter((a) => a.topic === topic?.id);
  function link(href: string, label: ReactNode, className?: string) {
    return (
      <a
        key={href}
        className={className}
        href={href}
        onClick={(e) => {
          if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
            e.preventDefault();
            window.history.replaceState(
              { ...window.history.state, guideScroll: window.scrollY },
              "",
            );
            window.history.pushState({ guideScroll: 0 }, "", href);
            window.dispatchEvent(new PopStateEvent("popstate"));
            window.scrollTo({ top: 0 });
          }
        }}
      >
        {label}
      </a>
    );
  }
  const results = searchGuide(query);
  return (
    <main className="guide">
      <div className="guide-wrap">
        <nav aria-label="Путь по гиду" className="guide-back">
          <BackButton href="/" />
          {topic && link("/faq", "Гид по РЕРЕЙЗ /")}
          {article && link(guideHref(topic?.id), topic?.title)}
        </nav>
        <header className="guide-header">
          <p className="guide-eyebrow">РЕРЕЙЗ / ЗНАНИЕ ИГРЫ</p>
          <h1>{article?.title || topic?.title || "Гид по РЕРЕЙЗ"}</h1>
          {!article && (
            <p>{topic ? topic.note : "Всё об игре, турнирах и рейтинге"}</p>
          )}
        </header>
        <div className="guide-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            aria-label="Поиск по гиду"
            placeholder="Найти правило, формат или ответ"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="Очистить поиск" onClick={() => setQuery("")}>
              ×
            </button>
          )}
        </div>
        {query.trim() ? (
          <section aria-label="Результаты поиска" aria-live="polite">
            <h2 className="guide-section-title">Найдено: {results.length}</h2>
            {results.map((a) =>
              link(
                guideHref(a.topic, a.id),
                <>
                  <small>{topics.find((t) => t.id === a.topic)?.title}</small>
                  <h3>{a.title}</h3>
                  <p>{a.snippet}</p>
                </>,
                "guide-result",
              ),
            )}
            {!results.length && (
              <p className="guide-empty">
                Ничего не найдено. Попробуйте «вход», «Phoenix» или «очки».
              </p>
            )}
          </section>
        ) : (
          <>
            {!topic ? (
              <>
                <nav aria-label="Разделы гида" className="guide-topics">
                  {topics.map((t, i) =>
                    link(
                      guideHref(t.id),
                      <>
                        <span className="guide-topic-mark">
                          {["↗", "♠", "+", "§"][i]}
                        </span>
                        <span>
                          <small>0{i + 1}</small>
                          <h2>{t.title}</h2>
                          <p>{t.note}</p>
                        </span>
                        <span aria-hidden="true">↗</span>
                      </>,
                      "guide-topic",
                    ),
                  )}
                </nav>
                <section className="guide-quick">
                  <p className="guide-eyebrow">С ЧЕГО НАЧАТЬ</p>
                  <h2>Быстрые ответы</h2>
                  {[
                    ["Как записаться на турнир?", "general-5"],
                    ["Что такое повторный вход?", "general-6"],
                    ["Что такое дополнительный вход?", "general-7"],
                    ["Как начисляются рейтинговые очки?", "rating-rules-5"],
                    [
                      "За что дают очки в Bounty?",
                      articles.find((a) => a.title === "Bounty Hunters")!.id,
                    ],
                  ].map(([label, id]) => {
                    const a = articles.find((x) => x.id === id)!;
                    return link(
                      guideHref(a.topic, id),
                      <>
                        {label}
                        <span aria-hidden="true">→</span>
                      </>,
                    );
                  })}
                </section>
              </>
            ) : article ? (
              <div className="guide-reading">
                <aside className="guide-related">
                  <p className="guide-eyebrow">В ЭТОМ РАЗДЕЛЕ</p>
                  {items.map((a) =>
                    link(
                      guideHref(a.topic, a.id),
                      a.title,
                      a.id === article.id ? "selected" : "",
                    ),
                  )}
                </aside>
                <article className="guide-article">
                  {article.format && (
                    <Artwork
                      key={article.id}
                      article={article}
                      visuals={visuals}
                    />
                  )}
                  <Blocks text={article.text} />
                  <footer>
                    {link(guideHref(topic.id), `← ${topic.title}`)}
                    {link(guideHref("rating-rules"), "Как устроен рейтинг →")}
                  </footer>
                </article>
              </div>
            ) : (
              <>
                <nav className="guide-toc" aria-label="Содержание">
                  <details>
                    <summary>Содержание раздела ↓</summary>
                    {items.map((a) => (
                      <a
                        key={a.id}
                        href={a.format ? guideHref(a.topic, a.id) : `#${a.id}`}
                      >
                        {a.title}
                      </a>
                    ))}
                  </details>
                </nav>
                {topic.id === "tournament-rules" ? (
                  <>
                    <nav
                      className="guide-rules-links"
                      aria-label="Общие материалы турниров"
                    >
                      {items
                        .filter((a) => !a.format && a.text.trim())
                        .map((a) =>
                          link(guideHref(a.topic, a.id), <>{a.title} ↗</>),
                        )}
                    </nav>
                    <div className="guide-catalog">
                      {items
                        .filter((a) => a.format)
                        .map((a) =>
                          link(
                            guideHref(a.topic, a.id),
                            <>
                              <Artwork article={a} visuals={visuals} />
                              <div>
                                <h2>{a.title}</h2>
                                <p>{plainText(a.text).slice(0, 155)}…</p>
                                <span className="guide-read">
                                  Правила формата ↗
                                </span>
                              </div>
                            </>,
                            "guide-format",
                          ),
                        )}
                    </div>
                    {items
                      .filter((a) => !a.format && a.text.trim())
                      .map((a) => (
                        <section id={a.id} key={a.id} className="guide-chapter">
                          <h2>{a.title}</h2>
                          <Blocks text={a.text} />
                        </section>
                      ))}
                  </>
                ) : (
                  <div className="guide-reading">
                    <aside className="guide-related">
                      <p className="guide-eyebrow">СОДЕРЖАНИЕ</p>
                      {items.map((a) => (
                        <a key={a.id} href={`#${a.id}`}>
                          {a.title}
                        </a>
                      ))}
                    </aside>
                    <div>
                      {items.map((a, i) => (
                        <section id={a.id} key={a.id} className="guide-chapter">
                          <p className="guide-eyebrow">
                            {String(i + 1).padStart(2, "0")} / {topic.title}
                          </p>
                          <h2>{link(guideHref(a.topic, a.id), a.title)}</h2>
                          <Blocks text={a.text} />
                        </section>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
        <footer className="guide-footer">
          РЕРЕЙЗ · Тверь · 18+
          <span>Условия конкретного мероприятия — в его карточке.</span>
        </footer>
      </div>
    </main>
  );
}
