"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-client";

/** Magic link rather than passwords: nobody in a six-person office wants to
 *  manage a password policy, and a link opens straight into the app on a
 *  phone. Swap signInWithOtp({ phone }) for SMS codes if you prefer. */
export default function Login() {
  const [email, setEmail] = useState("");
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

  return (
    <main className="auth">
      <div className="auth-card">
        <p className="brand">Larabee Homes</p>
        <h1>Shared inbox</h1>
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
              placeholder="you@larabeehomes.com"
            />
            <button type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Email me a link"}
            </button>
            {state === "error" && <p className="error">{message}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
