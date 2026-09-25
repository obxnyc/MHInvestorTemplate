"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-client";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin", office: "Office", tech: "Maintenance", shower: "Showings",
};

/** Your own sign-in.
 *
 *  Setting a password is optional and always will be: the email link works
 *  forever and needs nothing remembered. This is for the person signing in
 *  every morning who would rather type eight characters than go and find an
 *  email. */
export default function AccountForm({ name, role }: { name: string; role: string }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) { setState("error"); setMessage("The two don't match."); return; }
    // Eight is Supabase's floor and there is no point pretending otherwise
    // here; a rule the server will not enforce is decoration.
    if (password.length < 8) {
      setState("error"); setMessage("At least 8 characters."); return;
    }
    setState("saving");
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    if (error) { setState("error"); setMessage(error.message); return; }
    setState("saved"); setPassword(""); setAgain("");
  }

  return (
    <main className="people">
      <h1 className="pagetitle">Your sign-in</h1>
      <p className="muted">{name} · {ROLE_LABEL[role] ?? role}</p>

      <form className="addbox" onSubmit={save}>
        <h2>Set a password</h2>
        <p className="muted">
          Optional. The emailed link keeps working either way — this is just
          faster if you sign in every morning.
        </p>
        <label htmlFor="p1">New password</label>
        <input id="p1" type="password" autoComplete="new-password"
               value={password} onChange={(e) => setPassword(e.target.value)} />
        <label htmlFor="p2">Type it again</label>
        <input id="p2" type="password" autoComplete="new-password"
               value={again} onChange={(e) => setAgain(e.target.value)} />
        <button className="btn pri" disabled={state === "saving"}>
          {state === "saving" ? "Saving…" : "Save password"}
        </button>
        {state === "error" && <p className="err">{message}</p>}
        {state === "saved" && <p className="okmsg">Saved. You can sign in with it next time.</p>}
      </form>
    </main>
  );
}
