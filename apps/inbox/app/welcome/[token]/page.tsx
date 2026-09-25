"use client";
import { use, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-client";

/**
 * Taking up an invite, on the phone the text arrived on.
 *
 * Three fields and a password, in one sitting. Setting up access should not
 * involve going to find an email, because that is where it gets abandoned --
 * the person puts the phone down meaning to finish later and never does, and a
 * week later somebody in the office is still forwarding them screenshots.
 */
export default function Welcome({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, setState] = useState<"loading" | "form" | "password" | "bad">("loading");
  const [known, setKnown] = useState<{ name: string | null; phone: string } | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/people/invite/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => { setKnown(d); setFullName(d.name ?? ""); setState("form"); })
      .catch(() => setState("bad"));
  }, [token]);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch(`/api/people/invite/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, email }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(out.error ?? "That didn't work."); return; }

    if (out.signIn) {
      const { error: signInError } = await supabaseBrowser().auth.verifyOtp({
        token_hash: out.signIn, type: "email",
      });
      if (!signInError) { setState("password"); return; }
    }
    // The account exists either way; they can set a password the ordinary way.
    location.assign("/login");
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) { setError("The two don't match."); return; }
    if (password.length < 8) { setError("At least 8 characters."); return; }
    setBusy(true); setError(null);
    const { error: saveError } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (saveError) { setError(saveError.message); return; }
    location.assign("/");
  }

  if (state === "loading") {
    return <main className="auth"><div className="auth-card"><p className="muted">One moment…</p></div></main>;
  }

  if (state === "bad") {
    return (
      <main className="auth">
        <div className="auth-card">
          <p className="brand">Larabee Homes</p>
          <h1>That link is done</h1>
          <p className="muted">
            It has already been used, or it has expired. Ask the office to send
            another.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <p className="brand">Larabee Homes</p>

        {state === "form" ? (
          <>
            <h1>Set up your access</h1>
            <p className="muted" style={{ marginBottom: "1rem" }}>
              You&rsquo;ll be signed in on this phone when you&rsquo;re done.
            </p>
            <form onSubmit={accept}>
              <label htmlFor="n">Your name</label>
              <input id="n" value={fullName} onChange={(e) => setFullName(e.target.value)}
                     required autoFocus />

              <label htmlFor="e">Work email</label>
              <input id="e" type="email" value={email} autoComplete="email"
                     onChange={(e) => setEmail(e.target.value)} required />

              {known?.phone && (
                <p className="muted" style={{ fontSize: ".82rem", marginTop: ".5rem" }}>
                  Calls to the shared line will ring {known.phone}. The office can
                  change that later.
                </p>
              )}

              {error && <p className="error">{error}</p>}
              <button type="submit" disabled={busy}>
                {busy ? "Setting up…" : "Continue"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1>Pick a password</h1>
            <p className="muted" style={{ marginBottom: "1rem" }}>
              This is what you&rsquo;ll sign in with from now on.
            </p>
            <form onSubmit={savePassword}>
              <label htmlFor="p1">Password</label>
              <input id="p1" type="password" autoComplete="new-password" autoFocus
                     value={password} onChange={(e) => setPassword(e.target.value)} />
              <label htmlFor="p2">Type it again</label>
              <input id="p2" type="password" autoComplete="new-password"
                     value={again} onChange={(e) => setAgain(e.target.value)} />
              {error && <p className="error">{error}</p>}
              <button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save and go in"}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
