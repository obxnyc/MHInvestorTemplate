"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-client";
import PinSignIn from "@/components/PinSignIn";

/** Three doors, because there are three situations.
 *
 *  A link to your email needs no password and no memory, and opens straight
 *  into the app on a phone -- the right default for an office of six. A
 *  password is faster once you are signing in every morning and your inbox is
 *  in another tab. A four-digit PIN is for someone standing in a yard with
 *  gloves on, and is field staff only: it is the wrong lock for a door that
 *  opens court filings.
 *
 *  All three identify one person. Nobody shares an account -- the name on a
 *  reply, the read receipt and the typing indicator would all become lies at
 *  once. */
export default function Login() {
  // Two doors, because two jobs. Office staff are at a desk with their email
  // open; field staff are not. The email link stays the only way in for anyone
  // who can reach court filings or the audit trail.
  const [mode, setMode] = useState<"email" | "password" | "pin">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/` },
    });
    if (error) { setState("error"); setMessage(error.message); }
    else setState("sent");
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await supabaseBrowser().auth
      .signInWithPassword({ email, password });
    if (error) {
      setState("error");
      // Never "no account with that email": a sign-in page that distinguishes
      // a wrong password from an unknown address is a staff directory for
      // anyone who cares to try.
      setMessage("That email and password don't match.");
    } else {
      location.assign("/");
    }
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <p className="brand">Larabee Homes</p>
        <h1>Shared inbox</h1>

        {mode === "pin" ? (
          <PinSignIn onBack={() => setMode("email")} />
        ) : mode === "password" ? (
          <form onSubmit={signIn}>
            <label htmlFor="pe">Work email</label>
            <input id="pe" type="email" required autoComplete="email"
                   value={email} onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" required autoComplete="current-password"
                   value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Signing in…" : "Sign in"}
            </button>
            {state === "error" && <p className="error">{message}</p>}
            <button type="button" className="pinlink"
                    onClick={() => { setMode("email"); setState("idle"); }}>
              Email me a link instead
            </button>
          </form>
        ) : (<>
        {state === "sent" ? (
          <p className="muted">
            Check <strong>{email}</strong> for a sign-in link. It opens straight
            into the inbox.
          </p>
        ) : (
          <form onSubmit={send}>
            <label htmlFor="email">Work email</label>
            <input
              id="email" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@larabeehomesllc.com"
            />
            <button type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Email me a link"}
            </button>
            {state === "error" && <p className="error">{message}</p>}
          </form>
        )}
        <button className="pinlink" onClick={() => { setMode("password"); setState("idle"); }}>
          Use a password instead
        </button>
        <button className="pinlink" onClick={() => setMode("pin")}>
          Out on a job? Sign in with your PIN
        </button>
        </>)}
      </div>
    </main>
  );
}
