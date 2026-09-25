import { initials, swatch } from "@/lib/format";

/** A name gives initials. A number gives a handset.
 *
 *  It used to give the last two digits, which was a deliberate choice -- "(2"
 *  reads as a rendering fault -- but two digits still look like initials, so a
 *  list of unsaved numbers looked like a list of people whose names had failed
 *  to load. The handset says the thing that is actually true: we do not know
 *  who this is yet. It goes away the moment somebody saves a name. */
export function isJustANumber(name: string) {
  return /^[\d\s()+\-.]+$/.test(String(name).trim());
}

export default function Avatar(
  { name, className = "", style }:
  { name: string; className?: string; style?: React.CSSProperties },
) {
  if (isJustANumber(name)) {
    return (
      <span className={`av unknown ${className}`.trim()} style={style} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
             stroke="currentColor" strokeWidth="1.9"
             strokeLinecap="round" strokeLinejoin="round">
          <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
          <line x1="10.75" y1="18.25" x2="13.25" y2="18.25" />
        </svg>
      </span>
    );
  }
  const [bg, fg] = swatch(name);
  return (
    <span className={`av ${className}`.trim()} style={{ background: bg, color: fg, ...style }}>
      {initials(name)}
    </span>
  );
}
