"use client";

import { openSupportChat } from "@/lib/support";

function SupportIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.75 6.25h12.5A2.75 2.75 0 0 1 21 9v6a2.75 2.75 0 0 1-2.75 2.75H11l-4.25 3v-3H5.75A2.75 2.75 0 0 1 3 15V9a2.75 2.75 0 0 1 2.75-2.75Z" />
    </svg>
  );
}

// The one and only screen a blocked player is allowed to see -- no normal
// app UI, no Telegram/email login controls (the exact mistake made in
// poker-app: showing a "blocked" message while still leaving working
// re-login buttons on screen). Only a way to reach support.
export function BlockedScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-4 py-6 text-white">
      <div className="mx-auto w-full max-w-sm rounded-[24px] border border-white/10 bg-white/[0.04] p-6 text-center">
        <h1 className="text-xl font-bold">Доступ заблокирован</h1>
        <p className="mt-3 text-sm leading-6 text-white/65">
          Обратитесь в поддержку.
        </p>

        <button
          type="button"
          onClick={() => openSupportChat()}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#c9a84c] px-5 py-3.5 text-sm font-semibold text-black transition active:scale-[0.99]"
        >
          <SupportIcon />
          Написать в поддержку
        </button>
      </div>
    </main>
  );
}
