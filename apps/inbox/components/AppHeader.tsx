"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AccountMenu from "./AccountMenu";
import { isClockOnly, isDesk, type Role } from "@/lib/roles";
import OmniSearch from "@/components/OmniSearch";


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
  // Crew get one destination, because they have one job here. The shared
  // inbox carries tenants' messages and somebody who is here to say they have
  // started work has no business reading them -- a nav that offers it is an
  // invitation, whatever the row policies say underneath.
  /* Seven places across the top, not eleven. Things that belong to one job
     sit under it: Distributions under Investors, and the crew's three screens
     -- the clock, the timesheets and Friday pay -- under Crew. The heading
     itself still goes somewhere, to the first page under it. */
  const nav: Item[] = isClockOnly(role)
    ? [{ href: "/clock", label: "On the clock" }]
    : [
        { href: "/home", label: "Home" },
        { href: "/", label: "Messages" },
        { href: "/properties", label: "Properties" },
        { href: "/leasing", label: "Leasing" },
        // Who owes and what was promised: the desk's daily screen at the
        // start of every month, so it is a place of its own, not a page
        // under something.
        { href: "/collections", label: "Collections" },
        { href: "/owners", label: "Investors", under: [
          { href: "/owners", label: "Investors" },
          // Everybody's money: only the two roles the page itself lets in.
          ...(isDesk(role) ? [{ href: "/distributions", label: "Owner distributions" }] : []),
        ] },
        { href: "/clock", label: "Crew", under: [
          { href: "/clock", label: "On the clock" },
          { href: "/timesheets", label: "Timesheets" },
          ...(isDesk(role) ? [{ href: "/pay", label: "Friday pay" }] : []),
          ...(isDesk(role) ? [{ href: "/crew", label: "Crews & texts" }] : []),
        ] },
        { href: "/settings", label: "Settings" },
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
  const onItem = (i: Item) => (i.under?.length ? i.under.some((u) => on(u.href)) : on(i.href));

  return (
    <header className="apphead">
      {/* The logo goes to YOUR screen, not the shared inbox. Those are
          different questions -- "what am I supposed to be doing" and "what has
          come in" -- and the way home should answer the first. */}
      <Link href={isClockOnly(role) ? "/clock" : "/home"} className="brandmark"
            aria-label="Larabee Homes — your dashboard">
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
      {/* Crew get one screen and no search: there is nothing for them to
          find, and a box that returns other people's lots to somebody here
          to clock in is a box that should not be on their phone. */}
      {!isClockOnly(role) ? <OmniSearch /> : null}

      <nav className="topnav" aria-label="Main" ref={nav_}>
        {nav.map((i) => i.under && i.under.length > 1
          ? <NavGroup key={i.label} item={i} here={onItem(i)} on={on} />
          : (
            <Link key={i.href} href={i.href} className={onItem(i) ? "on" : ""}
                  aria-current={onItem(i) ? "page" : undefined}>
              {i.label}
            </Link>
          ))}
      </nav>
      <AccountMenu name={name} role={role} />
    </header>
  );
}

type Item = { href: string; label: string; under?: { href: string; label: string }[] };

/* A heading with its pages under it. Hover opens it with a mouse; on a phone,
   where there is no hover, the arrow beside the heading opens it.

   The list is position:fixed and placed from the heading's own box, because
   the nav scrolls sideways on a phone (overflow-x:auto) and anything
   absolutely positioned inside a scrolling box is clipped by it -- the menu
   would open and be cut off at the bottom of the header. It is kept inside
   the window on both sides; the account menu once opened off the left edge. */
function NavGroup({ item, here, on }: { item: Item; here: boolean; on: (href: string) => boolean }) {
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const shut = useRef<ReturnType<typeof setTimeout> | null>(null);
  const path = usePathname();
  useEffect(() => { setOpen(null); }, [path]);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    const gone = () => setOpen(null);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", gone);
    box.current?.closest(".topnav")?.addEventListener("scroll", gone);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", gone);
      box.current?.closest(".topnav")?.removeEventListener("scroll", gone);
    };
  }, [open]);
  const show = () => {
    if (shut.current) clearTimeout(shut.current);
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const width = 200;
    setOpen({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: r.bottom + 4 });
  };
  const hide = () => { shut.current = setTimeout(() => setOpen(null), 150); };
  const mouse = (e: React.PointerEvent) => e.pointerType === "mouse";
  return (
    <span className={`navgroup${here ? " on" : ""}${open ? " open" : ""}`} ref={box}
          onPointerEnter={(e) => mouse(e) && show()} onPointerLeave={(e) => mouse(e) && hide()}>
      <Link href={item.href} className={here ? "on" : ""} aria-current={here ? "page" : undefined}>{item.label}</Link>
      <button type="button" className="navcaret" aria-label={`More under ${item.label}`} aria-expanded={!!open}
              onClick={() => (open ? setOpen(null) : show())}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.75 5 6.75 8 3.75" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <span className="navmenu" role="menu" style={{ left: open.left, top: open.top }}>
          {item.under!.map((u) => (
            <Link key={u.href + u.label} href={u.href} role="menuitem" className={on(u.href) ? "on" : ""}>{u.label}</Link>
          ))}
        </span>
      ) : null}
    </span>
  );
}
