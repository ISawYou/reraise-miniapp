export function normalizeInternalReturnTo(
  value: string | null | undefined,
  fallback = "/",
): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return fallback;

  try {
    const url = new URL(value, "https://reraise.local");
    if (url.origin !== "https://reraise.local" || url.pathname === "/login") {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
