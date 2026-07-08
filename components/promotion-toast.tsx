"use client";

import { useEffect, useState } from "react";

type PromotionToastProps = {
  message: string;
};

export function PromotionToast({ message }: PromotionToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const enterTimer = window.setTimeout(() => {
      setVisible(true);
    }, 10);

    const exitTimer = window.setTimeout(() => {
      setVisible(false);
    }, 4000);

    return () => {
      window.clearTimeout(enterTimer);
      window.clearTimeout(exitTimer);
    };
  }, [message]);

  return (
    <div className="fixed left-4 right-4 top-24 z-50 flex justify-center pointer-events-none">
      <div
        className={`w-full max-w-md rounded-2xl border border-green-500/50 bg-green-950 px-4 py-3 text-sm font-medium text-green-100 shadow-2xl transition-all duration-300 ${
          visible
            ? "translate-y-0 opacity-100"
            : "-translate-y-2 opacity-0"
        }`}
      >
        {message}
      </div>
    </div>
  );
}