"use client";
import { useEffect, useState } from "react";
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
/** What a sign-in email failure actually means, in words somebody can act on.
 *
 *  Supabase's BUILT-IN email sender is rate-limited to a handful of messages
 *  an hour and is not meant for production. When it refuses, it says "email
 *  rate limit exceeded" -- which names the symptom, says nothing about the
 *  cause, and gives no way forward. Somebody then waits, tries again, gets
 *  the same thing, and concludes the address is wrong.
 *
 *  The project already pays for Postmark. Pointing Supabase's SMTP settings
 *  at it lifts the limit permanently, and that is the sentence that belongs
 *  on screen rather than the provider's own.
 */
function sayWhy(message: string): string {
  if (/rate limit|too many/i.test(message)) {
    return "No email was sent. The database's built-in mail service only"
      + " allows a few messages an hour and has hit that limit — this is not"
      + " about the address you typed. An admin can lift it for good by"
      + " pointing Supabase's SMTP settings at Postmark, under"
      + " Authentication → Emails. Until then, a password set directly on the"
      + " account signs in without any email at all.";
  }
  if (/signup|not allowed|disabled/i.test(message)) {
    return "That address has no account here yet. Ask an admin to add you on"
      + " the people page.";
  }
  return message;
}

export default function Login() {
  const [who, setWho] = useState<Who>("office");
  const [mode, setMode] = useState<Mode>("password");

  /* A LINK THAT GOES STRAIGHT TO THE PIN BOX.
   *
   * The crew's way in was three taps down a page that opens asking for an
   * email and a password -- neither of which a man on a roof has. The one-use
   * link he WAS sent dies the moment it is used, and the screen it leaves
   * behind said "ask the office to send another" with nothing to tap.
   *
   * So `/login?pin=1` is a URL the office sends once and he keeps: it opens
   * on the PIN box, it can be added to the home screen, and it works again
   * tomorrow. Nothing about it expires, because the PIN is the secret and the
   * URL is not.
   *
   * Set after mount rather than in the initial state so the server and the
   * browser render the same thing on the first pass -- a mode read from the
   * query string during render is a hydration mismatch, which React resolves
   * by throwing the client's version away.
   */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("pin") === "1" || q.get("m") === "pin") {
      setMode("pin");
      // Staff, which is what the crew are as far as this page is concerned.
      setWho("office");
    }
  }, []);
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
    if (error) { setState("error"); setMessage(sayWhy(error.message)); return; }
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
    /* Answered the same way whether or not the address is one of ours -- an
       error that distinguishes them tells a stranger who has an account.
       A RATE LIMIT IS NOT THAT. It is about this project, not the address,
       and swallowing it said "check your email" when nothing had been sent:
       the exact shape this codebase keeps writing down -- a send that failed
       must not look like a send that worked. */
    if (error && /rate limit|too many/i.test(error.message)) {
      setState("error"); setMessage(sayWhy(error.message)); return;
    }
    /* Every OTHER error still reads as sent, which was a deliberate choice
       and stays one: an error here that distinguishes a real address from an
       unknown one hands a stranger a way to find out who has an account.
       Only the rate limit breaks out, because it is a fact about this
       project rather than about the address. */
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
