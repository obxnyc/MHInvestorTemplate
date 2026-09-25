import { redirect } from "next/navigation";

/** /signin is the address people are given and the one that reads properly on
 *  a card. /login stays alive because it is in old emails and bookmarks, and
 *  breaking a sign-in link to tidy a URL is a bad trade. */
export default function SignIn() {
  redirect("/login");
}
