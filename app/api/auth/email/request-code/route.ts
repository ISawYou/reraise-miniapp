import { type NextRequest, NextResponse } from "next/server";
import {
  createEmailOtpCode,
  isValidEmail,
  normalizeEmail,
  type EmailOtpPurpose,
} from "@/lib/email-otp";
import { sendOtpEmail } from "@/lib/resend";
import { verifySession, COOKIE_NAME } from "@/lib/telegram-web-session";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      email?: string;
      purpose?: EmailOtpPurpose;
    };

    const purpose: EmailOtpPurpose =
      body.purpose === "link_email" ? "link_email" : "login";
    const email = normalizeEmail(body.email ?? "");

    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { error: "Введите корректный email" },
        { status: 400 }
      );
    }

    let playerId: string | null = null;

    if (purpose === "link_email") {
      const sessionValue = request.cookies.get(COOKIE_NAME)?.value;
      const sessionPlayerId = sessionValue ? verifySession(sessionValue) : null;

      if (!sessionPlayerId) {
        return NextResponse.json(
          { error: "Необходимо войти в систему" },
          { status: 401 }
        );
      }

      playerId = sessionPlayerId;
    }

    const otpResult = await createEmailOtpCode({
      email,
      purpose,
      playerId,
    });

    if (!otpResult.ok) {
      return NextResponse.json(
        {
          error: `Повторная отправка будет доступна через ${otpResult.retryAfterSeconds} сек.`,
          retryAfterSeconds: otpResult.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    try {
      await sendOtpEmail(email, otpResult.code);
    } catch (error) {
      console.error("[email-otp] failed to send email:", {
        email,
        purpose,
        error,
      });

      return NextResponse.json(
        { error: "Не удалось отправить письмо. Попробуйте позже." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      retryAfterSeconds: otpResult.retryAfterSeconds,
    });
  } catch (error) {
    console.error("[email-otp] request-code route error:", error);
    return NextResponse.json(
      { error: "Не удалось обработать запрос" },
      { status: 500 }
    );
  }
}
