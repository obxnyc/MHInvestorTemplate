import { supabaseBrowser } from "@/lib/supabase-client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/** "Dana is typing…", for your own team only.
 *
 *  Nothing is stored. This is the one kind of state where writing it down would
 *  be worse than losing it: a typing flag that outlives the browser tab that
 *  set it is a lie that sits there until someone clears it. It rides on the
 *  realtime connection the inbox already holds open and expires on its own.
 *
 *  Worth being straight about the exposure: the channel is keyed by the
 *  conversation's id, and anyone holding both that id and the public anon key
 *  could listen. What they would learn is a staff first name. The id is a
 *  random uuid that only appears to people who can already read the thread, so
 *  the trade is a first name against machinery nobody would maintain. If that
 *  stops being acceptable, this moves to an authorized channel -- the shape
 *  here does not change. */

export type TypingPeer = { name: string; at: number };

const CHANNEL = (conversationId: string) => `typing:${conversationId}`;

/** How long a keystroke keeps someone marked as typing. Long enough to cover
 *  thinking mid-sentence, short enough that a closed laptop clears in seconds. */
export const TYPING_TTL = 6000;

export function joinTyping(
  conversationId: string,
  onPeer: (name: string) => void,
): RealtimeChannel {
  const channel = supabaseBrowser().channel(CHANNEL(conversationId), {
    // Our own keystrokes are not news to us.
    config: { broadcast: { self: false } },
  });
  channel
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      const name = (payload as { name?: string })?.name;
      if (name) onPeer(name);
    })
    .subscribe();
  return channel;
}

export function sendTyping(channel: RealtimeChannel, name: string) {
  channel.send({ type: "broadcast", event: "typing", payload: { name } });
}
