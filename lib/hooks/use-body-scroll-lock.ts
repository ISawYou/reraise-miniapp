import { useEffect } from "react";

// Freezes the page behind an open modal/overlay -- background can't scroll
// or swipe, and closing restores the exact scroll offset it had before.
// `overflow: hidden` alone doesn't reliably stop touch panning in iOS/Android
// WebViews (a long-standing iOS Safari bug that Telegram's in-app browser
// inherits), so this uses the standard fixed-body technique instead: pin the
// body in place with a negative `top` offset equal to the current scroll
// position, then undo it and jump back to that offset on unlock. Call with
// `locked = true` while the overlay is open; the effect's own cleanup
// handles unmount/navigation, so callers never need a separate teardown.
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;

    const { body } = document;
    const scrollY = window.scrollY;
    const previousStyle = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";

    return () => {
      body.style.position = previousStyle.position;
      body.style.top = previousStyle.top;
      body.style.left = previousStyle.left;
      body.style.right = previousStyle.right;
      body.style.width = previousStyle.width;
      window.scrollTo(0, scrollY);
    };
  }, [locked]);
}
