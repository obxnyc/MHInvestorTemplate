import { createClient } from "@supabase/supabase-js";

/** Service-role client. Bypasses RLS entirely, so it is only ever used by the
 *  Twilio webhooks, which have no signed-in user to act as. Never import this
 *  into anything that renders. */
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
