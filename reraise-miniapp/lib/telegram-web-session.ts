import { createHmac, timingSafeEqual } from "crypto";

export const COOKIE_NAME = "dwc_tg_session";

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is not set");
  }
  return secret ?? "dev-insecure-secret";
}

export function signSession(playerId: string): string {
  const mac = createHmac("sha256", getSecret()).update(playerId).digest("hex");
  return `${playerId}.${mac}`;
}

export function verifySession(value: string): string | null {
  const dot = value.lastIndexOf(".");
  if (dot === -1) return null;

  const playerId = value.slice(0, dot);
  const mac = value.slice(dot + 1);

  let expected: Buffer;
  try {
    expected = createHmac("sha256", getSecret()).update(playerId).digest();
  } catch {
    return null;
  }

  try {
    const macBuf = Buffer.from(mac, "hex");
    if (macBuf.length !== expected.length) return null;
    if (!timingSafeEqual(macBuf, expected)) return null;
  } catch {
    return null;
  }

  return playerId;
}
