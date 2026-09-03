import { type NextRequest, NextResponse } from "next/server";
import {
  isValidEmail,
  normalizeEmail,
  verifyEmailOtpCode,
  type EmailOtpPurpose,
} from "@/lib/email-otp";
import {
  EmailAlreadyLinkedToAnotherPlayerError,
  ensurePlayerFromEmailServer,
  getPlayerFromSessionServer,
  linkEmailToPlayerServer,
} from "@/features/auth-server";
import { AccountMergeUnavailableError, createMergeIntent } from "@/lib/player-merge";
import { COOKIE_NAME, signSession } from "@/lib/telegram-web-session";

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
      // Canonical-resolving identity -- not a raw cookie read. Using the
      // caller's raw session cookie id directly here would let a still-
      // validly-signed cookie for a player already soft-merged into another
      // one (players.merged_into_player_id -- see lib/player-merge.ts) link
      // a new email straight onto that dead row, resurrecting it as an
      // independently loggable-into identity. getPlayerFromSessionServer()
      // already follows merged_into_player_id to the canonical player
      // (lib/canonical-player.ts), so this can only ever act as the
      // current, real owner of the session.
      const sessionValue = request.cookies.get(COOKIE_NAME)?.value;
      const sessionPlayer = await getPlayerFromSessionServer(sessionValue);

      if (!sessionPlayer) {
        return NextResponse.json(
          { error: "Необходимо войти в систему" },
          { status: 401 }
        );
      }

      const sessionPlayerId = sessionPlayer.id;

      try {
        player = await linkEmailToPlayerServer(sessionPlayerId, email);
      } catch (linkError) {
        if (linkError instanceof EmailAlreadyLinkedToAnotherPlayerError) {
          // The OTP itself was genuinely valid (verifyEmailOtpCode already
          // marked it consumed above, and its id -- proof of ownership --
          // travels into the merge intent below) -- this is a separate,
          // later failure, so the message must not read like the code was
          // wrong. No role/access-flag/other-player mutation happens on
          // this path. createMergeIntent() re-runs the full eligibility
          // check (tournament overlap, source's own telegram_id) and
          // decides pending vs conflict -- this route never does.
          //
          // createMergeIntent() throws AccountMergeUnavailableError if
          // DATABASE_PROVIDER isn't "postgres" -- production always runs
          // postgres (CI's own preflight enforces this), so this is
          // defense-in-depth, not an expected path. Caught here and folded
          // into the exact same "canMerge: false, contact admin" shape a
          // genuine eligibility conflict already returns, so the client
          // (app/page.tsx) never offers an "Объединить аккаунты" button
          // that is guaranteed to fail -- neither side needs to know
          // DATABASE_PROVIDER itself for that to hold.
          let intent;
          try {
            intent = await createMergeIntent({
              targetPlayerId: sessionPlayerId,
              sourcePlayerId: linkError.sourcePlayerId,
              email,
              otpVerificationId: verification.otpId,
            });
          } catch (mergeError) {
            if (mergeError instanceof AccountMergeUnavailableError) {
              return NextResponse.json(
                {
                  error: "Аккаунт с этой почтой уже существует",
                  detail:
                    "Автоматическое объединение недоступно из-за конфликта данных. Обратитесь к администратору для объединения аккаунтов.",
                  canMerge: false,
                },
                { status: 409 }
              );
            }
            throw mergeError;
          }

          if (intent.status === "pending") {
            return NextResponse.json(
              {
                error: "Аккаунт с этой почтой уже существует",
                detail:
                  "Мы нашли аккаунт, зарегистрированный с этим email. Его можно объединить с текущим аккаунтом — вся игровая история сохранится.",
                canMerge: true,
                mergeIntentId: intent.id,
              },
              { status: 409 }
            );
          }

          return NextResponse.json(
            {
              error: "Аккаунт с этой почтой уже существует",
              detail:
                "Автоматическое объединение недоступно из-за конфликта данных. Обратитесь к администратору для объединения аккаунтов.",
              canMerge: false,
            },
            { status: 409 }
          );
        }
        throw linkError;
      }
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
