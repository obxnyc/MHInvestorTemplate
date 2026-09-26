"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
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
  const nav_ = useRef<HTMLElement>(null);
  const nav: [string, string][] = [
    ["/home", "Home"],
    ["/", "Messages"],
    ["/properties", "Properties"],
    ["/settings", "Settings"],
  ];

  // If the nav is scrolled sideways, the page you are on can be off the end
  // of it -- and a nav that does not show where you are is worse than one you
  // have to swipe.
  useEffect(() => {
    const here = nav_.current?.querySelector<HTMLElement>("a.on");
    here?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [path]);

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

      {/* The destinations scroll sideways when they do not fit; the account
          menu does not, because it is outside this element. On a narrow
          window the four links used to push the avatar off the right-hand
          edge, where the shell's overflow:hidden clipped it -- and the way to
          sign out was behind it. A nav that overflows should be swipeable;
          the way out of the app should never move. */}
      <nav className="topnav" aria-label="Main" ref={nav_}>
        {nav.map(([href, label]) => (
          <Link key={href} href={href} className={on(href) ? "on" : ""}
                aria-current={on(href) ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      <AccountMenu name={name} role={role} />
    </header>
  );
}
