"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-client";

/**
 * Where a "set a password" email lands.
 *
 * The link carries a one-time session in the URL, which supabase-js picks up on
 * load. That session is good for exactly one thing -- setting a password -- so
 * the page does that and nothing else, and sends you into the app afterwards
 * rather than leaving you on a screen with no obvious exit.
 */
export default function ResetPassword() {
  const [ready, setReady] = useState<"waiting" | "ok" | "expired">("waiting");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const supabase = supabaseBrowser();
    // The session may land a moment after the page does, so both the current
    // state and the next change are checked. A link that has already been used
    // or has expired gives neither, and says so rather than showing a form that
    // cannot work.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady("ok");
      else setTimeout(() => {
        supabase.auth.getSession().then(({ data: d2 }) =>
          setReady(d2.session ? "ok" : "expired"));
      }, 1200);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) setReady("ok");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) { setState("error"); setMessage("The two don't match."); return; }
    if (password.length < 8) { setState("error"); setMessage("At least 8 characters."); return; }
    setState("saving");
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    if (error) { setState("error"); setMessage(error.message); return; }
    location.assign("/");
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <p className="brand">Larabee Homes</p>
        <h1>Set your password</h1>

        {ready === "waiting" && <p className="muted">One moment…</p>}

        {ready === "expired" && (
          <>
            <p className="muted">
              That link has been used already, or it has expired. Ask for another
              and use the newest email.
            </p>
            <a className="pinlink" href="/login">Back to sign in</a>
          </>
        )}

        {ready === "ok" && (
          <form onSubmit={save}>
            <label htmlFor="np">New password</label>
            <input id="np" type="password" autoComplete="new-password" autoFocus
                   value={password} onChange={(e) => setPassword(e.target.value)} />
            <label htmlFor="na">Type it again</label>
            <input id="na" type="password" autoComplete="new-password"
                   value={again} onChange={(e) => setAgain(e.target.value)} />
            <button type="submit" disabled={state === "saving"}>
              {state === "saving" ? "Saving…" : "Save and sign in"}
            </button>
            {state === "error" && <p className="error">{message}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
