"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import AccountMenu from "./AccountMenu";

type Role = "admin" | "office" | "tech";

/**
 * The bar across the top of everything.
 *
 * Brand on the left, where every application on the internet puts the way home.
 * Destinations on the right. Nothing else: the actions that belong to a screen
 * live on that screen, because a header that carries "New Message" is a header
 * that has to explain itself on the page about vendor invoices.
 *
 * Built to take more destinations than it has. This is the shared line today;
 * the same bar is where Boats, Slips or Properties go when there are any.
 */
export default function AppHeader(
  { name, role }: { name: string; role: Role },
) {
  const path = usePathname();
  const nav: [string, string][] = [
    ["/home", "Home"],
    ["/", "Messages"],
    ["/properties", "Properties"],
    ["/settings", "Settings"],
  ];

  const on = (href: string) =>
    href === "/" ? path === "/" || path.startsWith("/c/") || path.startsWith("/team")
                 : path.startsWith(href);

  return (
    <header className="apphead">
      {/* The logo goes to YOUR screen, not the shared inbox. Those are
          different questions -- "what am I supposed to be doing" and "what has
          come in" -- and the way home should answer the first. */}
      <Link href="/home" className="brandmark" aria-label="Larabee Homes — your dashboard">
        {/* The actual mark, not two letters in a box. The company has a logo;
            a lettered square in its place reads as a placeholder nobody got
            round to replacing, which is what it was. */}
        <Image src="/icon-192.png" alt="" width={32} height={32}
               className="brandlogo" priority />
        <span className="brandname">Larabee Homes</span>
      </Link>

      <nav className="topnav" aria-label="Main">
        {nav.map(([href, label]) => (
          <Link key={href} href={href} className={on(href) ? "on" : ""}
                aria-current={on(href) ? "page" : undefined}>
            {label}
          </Link>
        ))}
        <AccountMenu name={name} role={role} />
      </nav>
    </header>
  );
}
