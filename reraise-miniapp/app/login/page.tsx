"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Step = "email" | "code";
type OtpPurpose = "login";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/me", {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((payload) => {
        if (payload?.player?.id) {
          router.replace("/");
        }
      })
      .catch(() => null);
  }, [router]);

  useEffect(() => {
    if (step !== "code") return;

    const timer = setTimeout(() => codeInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [step]);

  function startResendCooldown(seconds: number) {
    setResendCooldown(seconds);
    const interval = setInterval(() => {
      setResendCooldown((value) => {
        if (value <= 1) {
          clearInterval(interval);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
  }

  async function requestCode(purpose: OtpPurpose) {
    const trimmedEmail = email.trim().toLowerCase();

    const response = await fetch("/api/auth/email/request-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: trimmedEmail,
        purpose,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; retryAfterSeconds?: number }
      | null;

    if (!response.ok) {
      if (payload?.retryAfterSeconds) {
        startResendCooldown(payload.retryAfterSeconds);
      }

      throw new Error(payload?.error ?? "Не удалось отправить код.");
    }

    startResendCooldown(payload?.retryAfterSeconds ?? 60);
  }

  async function handleRequestCode(event: React.FormEvent) {
    event.preventDefault();

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) return;

    setLoading(true);
    setError(null);

    try {
      await requestCode("login");
      setStep("code");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось отправить код."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(event: React.FormEvent) {
    event.preventDefault();

    const trimmedCode = code.trim();
    if (!trimmedCode) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/email/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: trimmedCode,
          purpose: "login",
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Не удалось проверить код.");
      }

      router.replace("/");
      router.refresh();
    } catch (verifyError) {
      setError(
        verifyError instanceof Error
          ? verifyError.message
          : "Не удалось проверить код."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return;

    setLoading(true);
    setError(null);

    try {
      await requestCode("login");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось отправить код повторно."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="fixed inset-0 bg-black px-5 text-white"
      style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom, 24px))" }}
    >
      <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-white/35">
            Игровое пространство РЕРЕЙЗ
          </p>
          <h1 className="mt-3 text-[2.5rem] font-bold leading-none tracking-tight">
            РЕРЕЙЗ
          </h1>
          <p className="mt-2 text-sm text-white/50">Вход</p>
        </div>

        <div className="rounded-[20px] border border-white/8 bg-white/4 p-6">
          {step === "email" ? (
            <form onSubmit={handleRequestCode} className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-white/60">
                Введите email, и мы отправим 6-значный код для входа.
              </p>

              <input
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError(null);
                }}
                placeholder="your@email.com"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                disabled={loading}
                className="w-full rounded-[14px] border border-white/10 bg-black/40 px-4 py-3.5 text-base text-white placeholder-white/25 outline-none transition-colors focus:border-white/25 disabled:opacity-50"
              />

              {error ? <p className="text-sm text-red-400">{error}</p> : null}

              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="w-full rounded-[14px] bg-yellow-500 py-3.5 text-base font-semibold text-black shadow-[0_6px_20px_rgba(234,179,8,0.18)] transition-opacity disabled:opacity-40"
              >
                {loading ? "Отправляем..." : "Получить код"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
              <div>
                <p className="text-sm text-white/60">
                  Письмо отправлено на{" "}
                  <span className="font-medium text-white/90">{email}</span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setCode("");
                    setError(null);
                  }}
                  className="mt-1 text-xs text-yellow-500/60 transition-colors hover:text-yellow-400/80"
                >
                  Изменить email
                </button>
              </div>

              <input
                ref={codeInputRef}
                type="text"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                  setError(null);
                }}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoCapitalize="none"
                disabled={loading}
                className="w-full rounded-[14px] border border-white/10 bg-black/40 px-4 py-3.5 text-center text-[1.75rem] font-light tracking-[0.5em] text-white placeholder:tracking-[0.15em] placeholder:text-white/20 outline-none transition-colors focus:border-yellow-500/30 disabled:opacity-50"
              />

              {error ? <p className="text-sm text-red-400">{error}</p> : null}

              <button
                type="submit"
                disabled={loading || code.length < 6}
                className="w-full rounded-[14px] bg-yellow-500 py-3.5 text-base font-semibold text-black shadow-[0_6px_20px_rgba(234,179,8,0.18)] transition-opacity disabled:opacity-40"
              >
                {loading ? "Проверяем..." : "Войти"}
              </button>

              <button
                type="button"
                onClick={handleResend}
                disabled={loading || resendCooldown > 0}
                className="text-sm text-white/30 transition-colors disabled:opacity-60"
              >
                {resendCooldown > 0
                  ? `Отправить повторно (${resendCooldown}с)`
                  : "Отправить код повторно"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
