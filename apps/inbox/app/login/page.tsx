"use client";
import { useState } from "react";
import Image from "next/image";
import { supabaseBrowser } from "@/lib/supabase-client";
import PinSignIn from "@/components/PinSignIn";

type Mode = "password" | "link" | "pin" | "reset";

/** Who is at the door. Three different people arrive at this page and only one
 *  of them has a password, so asking first is kinder than a single form that
 *  two thirds of its visitors cannot use. */
type Who = "tenant" | "office" | "vendor" | "investor";

const WHO: [Who, string][] = [
  ["office", "Staff"],
  ["tenant", "Tenant"],
  ["vendor", "Vendor"],
  ["investor", "Investor"],
];

/**
 * Signing in.
 *
 * A password first, because this is used every morning and going to find an
 * email is a worse thirty seconds every single day. The emailed link stays,
 * one tap away, for the phone in a driveway and for anyone who has not set a
 * password yet. A four-digit PIN is for field staff, who are wearing gloves.
 *
 * All three identify one person. Nobody shares an account: the name on a reply,
 * the read receipt and the typing indicator would all become lies at once.
 */
export default function Login() {
  const [who, setWho] = useState<Who>("office");
  const [mode, setMode] = useState<Mode>("password");
  const [vendorPhone, setVendorPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "working" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  const supabase = () => supabaseBrowser();

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setState("working");
    const { error } = await supabase().auth.signInWithPassword({ email, password });
    if (error) {
      setState("error");
      // Never "no account with that email". A sign-in page that tells the
      // difference between a wrong password and an unknown address is a staff
      // directory for anyone willing to try a few.
      setMessage("That email and password don't match.");
      return;
    }
    location.assign("/");
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setState("working");
    const { error } = await supabase().auth.signInWithOtp({
      email, options: { emailRedirectTo: `${location.origin}/` },
    });
    if (error) { setState("error"); setMessage(error.message); return; }
    setState("sent");
  }

  /** The answer is the same whatever the number is -- see the route. */
  async function sendJobsLink(e: React.FormEvent) {
    e.preventDefault();
    setState("working");
    await fetch("/api/vendor/link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: vendorPhone }),
    }).catch(() => {});
    setState("sent");
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setState("working");
    const { error } = await supabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/reset`,
    });
    // Answered the same way whether or not the address is one of ours, for the
    // same reason as above.
    if (error && !/rate|limit/i.test(error.message)) {
      setState("error"); setMessage(error.message); return;
    }
    setState("sent");
  }

  if (mode === "pin") {
    return (
      <main className="auth">
        <div className="auth-card">
          <div className="authhead">
            <Image src="/icon-192.png" alt="" width={46} height={46} className="authlogo" priority />
            <h1>Sign in</h1>
            <p className="authwho">Larabee Homes</p>
          </div>
          <PinSignIn onBack={() => setMode("password")} />
        </div>
      </main>
    );
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="authhead">
          <Image src="/icon-192.png" alt="" width={46} height={46} className="authlogo" priority />
          <h1>Sign in</h1>
          <p className="authwho">Larabee Homes</p>
        </div>

        <div className="authtabs" role="tablist" aria-label="Who is signing in">
          {WHO.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={who === k}
                    className={who === k ? "on" : ""}
                    onClick={() => { setWho(k); setMode("password"); setState("idle"); }}>
              {label}
            </button>
          ))}
        </div>

        {who === "tenant" ? (
          /* Tenants have no account, and saying so plainly is the useful
             answer. The alternative is a form that cannot work for them and a
             phone call to the office asking why. */
          <div className="authtell">
            <p>
              You don&rsquo;t need one. Text us on the number you already have for
              us and it reaches the whole office — repairs, rent questions,
              anything. Somebody picks it up and you keep the same thread.
            </p>
            <p>
              Looking for a home?{" "}
              <a className="dashgo" href="/apply">Check if you prequalify</a>.
            </p>
          </div>
        ) : who === "investor" ? (
          /* No owner portal exists yet. Said plainly, with the way to get an
             answer today, rather than a form that goes nowhere. */
          <div className="authtell">
            <p>
              There&rsquo;s no investor login yet. Statements, rent rolls and
              distributions still come from the office directly.
            </p>
            <p>
              Ask Cade or the office and we&rsquo;ll send what you need — and
              tell us what you&rsquo;d want to see here, because this is the
              page it will go on.
            </p>
          </div>
        ) : who === "vendor" ? (
          state === "sent" ? (
            <div className="authtell">
              <p>
                If that number is one we send work to, your jobs link is on its
                way. It opens straight to your open jobs — no password.
              </p>
              <button className="pinlink" onClick={() => setState("idle")}>
                Try another number
              </button>
            </div>
          ) : (
            <form onSubmit={sendJobsLink}>
              <p className="authtell">
                No password. We text you the same link your jobs already come
                on, so you can send photos back from it.
              </p>
              <label htmlFor="vp">Your mobile</label>
              <input id="vp" type="tel" required autoComplete="tel" autoFocus
                     value={vendorPhone} onChange={(ev) => setVendorPhone(ev.target.value)}
                     placeholder="(252) 555-0142" />
              <button type="submit" disabled={state === "working"}>
                {state === "working" ? "Sending…" : "Text me my jobs link"}
              </button>
            </form>
          )
        ) : state === "sent" ? (
          <>
            <p className="muted">
              {mode === "reset"
                ? <>If <strong>{email}</strong> is one of ours, a link to set a
                   password is on its way. It opens straight into the app.</>
                : <>Check <strong>{email}</strong> for a sign-in link. It opens
                   straight into the inbox.</>}
            </p>
            <button className="pinlink" onClick={() => { setState("idle"); setMode("password"); }}>
              Back to sign in
            </button>
          </>
        ) : mode === "password" ? (
          <form onSubmit={signIn}>
            <label htmlFor="e">Work email</label>
            <input id="e" type="email" required autoComplete="email" autoFocus
                   value={email} onChange={(ev) => setEmail(ev.target.value)}
                   placeholder="you@larabeehomesllc.com" />
            <label htmlFor="p">Password</label>
            <input id="p" type="password" required autoComplete="current-password"
                   value={password} onChange={(ev) => setPassword(ev.target.value)} />
            <button type="submit" disabled={state === "working"}>
              {state === "working" ? "Signing in…" : "Sign in"}
            </button>
            {state === "error" && <p className="error">{message}</p>}
            <div className="authalt">
              <button type="button" className="pinlink"
                      onClick={() => { setMode("reset"); setState("idle"); }}>
                Forgot password?
              </button>
              <button type="button" className="pinlink"
                      onClick={() => { setMode("link"); setState("idle"); }}>
                Email me a link
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={mode === "reset" ? sendReset : sendLink}>
            <label htmlFor="e2">Work email</label>
            <input id="e2" type="email" required autoComplete="email" autoFocus
                   value={email} onChange={(ev) => setEmail(ev.target.value)}
                   placeholder="you@larabeehomesllc.com" />
            <button type="submit" disabled={state === "working"}>
              {state === "working" ? "Sending…"
                : mode === "reset" ? "Email me a link to set it" : "Email me a sign-in link"}
            </button>
            {state === "error" && <p className="error">{message}</p>}
            <div className="authalt">
              <button type="button" className="pinlink"
                      onClick={() => { setMode("password"); setState("idle"); }}>
                Use a password
              </button>
            </div>
          </form>
        )}

        {who === "office" && (
          <p className="authfoot">
            Out on a job?{" "}
            <button className="pinlink" onClick={() => setMode("pin")}>
              Sign in with your PIN
            </button>
          </p>
        )}
      </div>
    </main>
  );
}
