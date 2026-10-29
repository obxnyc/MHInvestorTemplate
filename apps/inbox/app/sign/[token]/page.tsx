import SignHere from "@/components/SignHere";

export const dynamic = "force-dynamic";

/**
 * The page the investor opens.
 *
 * No account, no app, no third-party signing service -- a link, the
 * documents, and somewhere to sign. Public on purpose: the token is what
 * stands between a stranger and somebody's purchase agreement, and asking
 * a buyer to make an account before they can read what they are buying is
 * how a deal spends a week in somebody's inbox.
 */
export default async function SignPage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return <SignHere token={token} />;
}
