"use client";
import { use, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-client";
import PinChoose from "@/components/PinChoose";
import { useLang } from "@/components/useLang";

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
  const [lang] = useLang();
  const [state, setState] = useState<"loading" | "form" | "password" | "bad">("loading");
  const [known, setKnown] = useState<{ name: string | null; phone: string; field?: boolean } | null>(null);
  /* A link that is SPENT rather than unheard-of: we still know whose it was,
     which is the whole reason a button can exist here at all. */
  const [spent, setSpent] = useState<{ name: string | null; asked: boolean } | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* READ THE BODY EVEN WHEN IT IS A 404.
     A spent link and a link nobody ever issued are both 404s and are not the
     same thing: the first still knows whose it was. Rejecting on `!r.ok`
     threw that away, which is why the screen could only ever say "ask the
     office". */
  useEffect(() => {
    fetch(`/api/people/invite/${token}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (ok) { setKnown(body); setFullName(body.name ?? ""); setState("form"); return; }
        if (body?.known) setSpent({ name: body.name ?? null, asked: Boolean(body.asked) });
        setState("bad");
      })
      .catch(() => setState("bad"));
  }, [token]);

  /** Ask the office for a new one, from the dead screen itself. */
  async function askAgain() {
    setBusy(true); setError(null);
    const res = await fetch(`/api/people/invite/${token}/again`, { method: "POST" })
      .catch(() => null);
    setBusy(false);
    if (!res) { setError("That didn't send. Check your signal and try again."); return; }
    const out = await res.json().catch(() => ({}));
    /* Nothing is called done until the server says so -- the same rule as the
       team composer, which cleared the box whatever came back. */
    if (!res.ok) { setError(out.error ?? "That didn't send."); return; }
    setSpent((was) => ({ name: was?.name ?? null, asked: true }));
  }

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
          {/* A DEAD END IS NOT AN ANSWER.
              This said "ask the office to send another" and gave nothing to
              tap. A one-use link dies the moment it is used -- which is
              correct, it is a setup link -- but the man holding it is now
              locked out of the thing he clocks in on, and the way back in is
              a PIN he may already have.
              So the way back in is a button, and the other half is said too:
              if he has no PIN, what to ask for. A sentence telling somebody
              to ask the office is only useful if it says what to ask FOR. */}
          <p className="muted">
            It has already been used, or it has expired. That is normal — a
            setup link only works once.
          </p>
          <a className="authgo" href="/login?pin=1">Sign in with your PIN</a>

          {spent ? (
            spent.asked ? (
              <p className="authnote">
                The office has been told{spent.name ? ` that ${spent.name} is` : " you are"}
                {" "}waiting for a new link. They will send one.
              </p>
            ) : (
              <>
                <button className="authalt2" onClick={askAgain} disabled={busy}>
                  {busy ? "Asking…" : "Ask the office for a new link"}
                </button>
                {error ? <p className="authbad">{error}</p> : null}
              </>
            )
          ) : (
            /* No row behind this token, so there is nobody to ask on behalf
               of. Saying that is more use than a button that quietly does
               nothing. */
            <p className="authnote">
              We do not recognise this link. Ask the office to text you a new
              one.
            </p>
          )}

          <p className="authnote">
            No PIN yet? Ask the office for a new setup link — you choose the
            PIN yourself on it, and nobody else ever sees it.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <p className="brand">Larabee Homes</p>

        {state === "form" && known?.field ? (
          /* FIELD STAFF SET UP WITH A PIN AND NOTHING ELSE.
             No email and no password: "a lot of these guys pay for basic
             phone plans", and sending a man in a driveway off to find an
             email is where setup is abandoned. The phone the link arrived on
             is the identity. */
          <>
            <h1>Set up your access</h1>
            <form onSubmit={(e) => e.preventDefault()}>
              <label htmlFor="n">Your name</label>
              <input id="n" value={fullName} onChange={(e) => setFullName(e.target.value)}
                     required autoFocus />
            </form>
            <PinChoose
              lang={lang}
              submit={async (pin) => {
                const res = await fetch(`/api/people/invite/${token}/pin`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ pin, fullName }),
                }).catch(() => null);
                if (!res) return "That didn't send. Check your signal and try again.";
                const out = await res.json().catch(() => ({}));
                if (!res.ok) return out.error ?? "That didn't work.";
                /* Signed in on the spot, so the first thing they see is the
                   clock rather than a sign-in page asking for the PIN they
                   typed four seconds ago. */
                if (out.signIn) {
                  await supabaseBrowser().auth.verifyOtp({
                    token_hash: out.signIn, type: "email",
                  }).catch(() => null);
                }
                location.assign("/clock");
                return null;
              }} />
            {known?.phone && (
              <p className="authnote">
                Calls to the shared line will ring {known.phone}. The office can
                change that later.
              </p>
            )}
          </>
        ) : state === "form" ? (
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
