"use client";
import { useRouter } from "next/navigation";

/**
 * The way out of a screen you opened from somewhere else.
 *
 * Settings and everything under it were one-way: you could get in from the
 * header and then the only way back was the browser's own button, which is not
 * there at all once the app is installed to a home screen.
 *
 * It goes back in history where there is history to go back to, because
 * "back" should return you to the thread you were reading, not to a fixed
 * page. `fallback` is for a cold open -- a pasted link, a push notification,
 * a fresh tab -- where there is nothing behind this page and router.back()
 * would leave the person exactly where they are.
 */
export default function BackLink({ fallback = "/home", label = "Back" }:
  { fallback?: string; label?: string }) {
  const router = useRouter();
  return (
    <button type="button" className="backlink" onClick={() => {
      // length <= 1 is a tab whose whole history is this page.
      if (typeof window !== "undefined" && window.history.length > 1) router.back();
      else router.push(fallback);
    }}>
      <span aria-hidden="true">&larr;</span> {label}
    </button>
  );
}
