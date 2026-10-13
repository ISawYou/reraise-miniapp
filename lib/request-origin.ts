// Minimal same-origin evidence for state-changing browser requests (CSRF).
//
// WHY: the production session cookie (`reraise_session`, SameSite=None so the
// Telegram WebView can use it) is sent by the browser on cross-site requests
// too. Without this check a third-party page could make a victim's browser
// POST /api/players/:id/follow and the cookie alone would authenticate it.
// A Telegram initData credential does not have that problem: it travels in a
// custom header, which a cross-site page cannot attach without a CORS
// preflight this app never grants.
//
// This is NOT authentication and never identifies anybody. It only classifies
// where a request came from so the caller can decide whether ambient browser
// credentials (the cookie) may be trusted for a mutation.
//
// Verdicts:
// - "same-origin": Origin header (or, when absent, Sec-Fetch-Site) proves the
//   request was issued by this application's own pages.
// - "cross-origin": Origin is present but is not ours / malformed / "null", or
//   the browser reports a cross-site / same-site initiator. Always refused.
// - "unproven": no browser evidence either way (non-browser client, very old
//   WebView). Ambient cookies must NOT be honoured; a verified initData header
//   still can be.
//
// The expected host is derived from the request itself (X-Forwarded-Host /
// Host / request.url) plus the app's own configured public URL -- never from a
// hardcoded hostname and never from a list of foreign origins. A cross-site
// attacker cannot influence those values for a request that carries the
// victim's cookies (cookies are scoped to the real host).

export type OriginVerdict = "same-origin" | "cross-origin" | "unproven";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function firstListValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim().toLowerCase();
  return first ? first : null;
}

function hostOf(rawUrl: string | undefined | null): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).host.toLowerCase() || null;
  } catch {
    return null;
  }
}

function expectedHosts(request: Request): Set<string> {
  const hosts = new Set<string>();
  const candidates = [
    firstListValue(request.headers.get("x-forwarded-host")),
    firstListValue(request.headers.get("host")),
    hostOf(request.url),
    hostOf(process.env.NEXT_PUBLIC_APP_URL),
  ];
  for (const candidate of candidates) {
    if (candidate) hosts.add(candidate);
  }
  return hosts;
}

function isOwnOrigin(request: Request, rawOrigin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    return false; // malformed, or the literal "null" of an opaque origin
  }

  // A real Origin header is exactly scheme://host[:port]; anything with a
  // path/query/credentials is not one and is never trusted.
  if (parsed.origin === "null" || parsed.origin !== rawOrigin.trim().toLowerCase()) {
    return false;
  }

  if (!expectedHosts(request).has(parsed.host.toLowerCase())) {
    return false;
  }

  if (parsed.protocol === "https:") return true;

  // Plain http is only ever legitimate for local development.
  return (
    parsed.protocol === "http:" &&
    (LOOPBACK_HOSTNAMES.has(parsed.hostname) || process.env.NODE_ENV !== "production")
  );
}

export function classifyRequestOrigin(request: Request): OriginVerdict {
  const secFetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase() ?? null;

  // Browsers set Sec-Fetch-Site themselves (it is a forbidden header name for
  // scripts). cross-site and same-site (a sibling subdomain) are both foreign.
  if (secFetchSite === "cross-site" || secFetchSite === "same-site") {
    return "cross-origin";
  }

  const origin = request.headers.get("origin");
  if (origin !== null) {
    return isOwnOrigin(request, origin) ? "same-origin" : "cross-origin";
  }

  if (secFetchSite === "same-origin") {
    return "same-origin";
  }

  return "unproven";
}
