import { type NextRequest, NextResponse } from "next/server";
import {
  isValidEmail,
  normalizeEmail,
  verifyEmailOtpCode,
  type EmailOtpPurpose,
} from "@/lib/email-otp";
import {
  ensurePlayerFromEmailServer,
  linkEmailToPlayerServer,
} from "@/features/auth-server";
import { COOKIE_NAME, signSession, verifySession } from "@/lib/telegram-web-session";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      email?: string;
      code?: string;
      purpose?: EmailOtpPurpose;
    };

    const purpose: EmailOtpPurpose =
      body.purpose === "link_email" ? "link_email" : "login";
    const email = normalizeEmail(body.email ?? "");
    const code = (body.code ?? "").trim();

    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { error: "Введите корректный email" },
        { status: 400 }
      );
    }

    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: "Введите 6-значный код" },
        { status: 400 }
      );
    }

    const verification = await verifyEmailOtpCode({
      email,
      purpose,
      code,
    });

    if (!verification.ok) {
      if (verification.reason === "attempts_exceeded") {
        return NextResponse.json(
          { error: "Превышен лимит попыток. Запросите новый код." },
          { status: 429 }
        );
      }

      if (verification.reason === "expired" || verification.reason === "missing") {
        return NextResponse.json(
          { error: "Код истёк. Запросите новый код." },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          error:
            verification.reason === "invalid"
              ? `Неверный код. Осталось попыток: ${verification.remainingAttempts ?? 0}`
              : "Неверный код.",
        },
        { status: 400 }
      );
    }

    let player;

    if (purpose === "link_email") {
      const sessionValue = request.cookies.get(COOKIE_NAME)?.value;
      const sessionPlayerId = sessionValue ? verifySession(sessionValue) : null;

      if (!sessionPlayerId) {
        return NextResponse.json(
          { error: "Необходимо войти в систему" },
          { status: 401 }
        );
      }

      player = await linkEmailToPlayerServer(sessionPlayerId, email);
    } else {
      player = await ensurePlayerFromEmailServer(email);
    }

    const response = NextResponse.json({
      ok: true,
      player,
    });

    response.cookies.set(COOKIE_NAME, signSession(player.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[email-otp] verify-code route error:", error);
    return NextResponse.json(
      { error: "Не удалось проверить код" },
      { status: 500 }
    );
  }
}
