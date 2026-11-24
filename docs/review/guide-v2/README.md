# Guide 2.0 browser review

Real Chromium captures of the local production build (no dev badge). A browser-only fake player response enables the real BottomNav; this is not a real authenticated production session. Public production artwork configurations are read over HTTP and supplied to the local browser; no production data was modified.

- [Home, 390px](home-390.png)
- [Search, 390px](search-390.png)
- [Tournament catalogue, 390px](catalog-390.png)
- [Phoenix article, 390px](phoenix-390.png)
- [Progressive Knockout article, 390px](pko-390.png)
- [Rating, 390px](rating-390.png)
- [Home, desktop](home-1440.png)
- [Catalogue, desktop](catalog-1440.png)

Additional captures cover 360px and 768px. [Browser checks](browser-checks.json) record overflow checks, legacy deep links, article content and Back navigation. All tested widths had no horizontal overflow.

These are desktop Chromium viewport checks. Actual Telegram device acceptance and virtual keyboard behavior remain manual checks; they are not represented as verified by these screenshots. The application shell and safe-area handling are unchanged.

All 14 guide formats resolve canonical artwork: six built-in card derivatives, seven production originals, and monthly final reuses Classic according to the existing is_final preset. Public read-only HEAD checks returned 200 for these 13 unique artworks. Missing derivatives fall through to originals, then built-in defaults, then a typographic fallback. The separate qualification_final default returned 404 and is not used by the guide.

Second pass: stable canonical format links (with old numeric aliases), title-first search, three-line catalogue summaries, prominent general/dispute rule links and article-specific breadcrumbs. Browser checks include actual BottomNav visibility, Back/Forward, scroll restoration and clearance of the final article action above fixed navigation. Actual Telegram and virtual keyboard: MANUAL_TELEGRAM_PENDING.
