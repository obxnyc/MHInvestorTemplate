/**
 * Parts of the application a particular person is not shown.
 *
 * On the PERSON, not the role (`staff.hidden_areas`, 072): Alex and Natashia
 * are both Office, and Alex runs the owner distributions while Natashia does
 * not see them. A role would have had to be invented for every such
 * difference, and each new one is a role the rest of the code has to learn.
 *
 * Refused in three places, and each answers a different way in:
 *   - the proxy refuses the pages and their APIs (`areaOf`),
 *   - the header does not offer them (`hiddenHref`),
 *   - the database refuses the rows (072's `hidden_area` policies), so the
 *     data is not one direct database call away either.
 */
export const AREAS = {
  distributions: {
    label: "Owner distributions",
    paths: ["/distributions", "/api/distributions"],
  },
  pay: {
    label: "Pay, timesheets & crew wages",
    paths: ["/pay", "/timesheets", "/crew", "/api/pay", "/api/timesheets", "/api/crew"],
  },
  trail: {
    label: "Crew trail & locations",
    paths: ["/trail", "/api/trail"],
  },
  investors: {
    label: "Investors & owners",
    paths: ["/owners", "/api/owners"],
  },
} as const;

export type Area = keyof typeof AREAS;
export const AREA_KEYS = Object.keys(AREAS) as Area[];

const under = (path: string, p: string) => path === p || path.startsWith(`${p}/`);

/** Which area a path belongs to, if any. "/pay" is not "/payments". */
export function areaOf(path: string): Area | null {
  for (const k of AREA_KEYS) {
    if (AREAS[k].paths.some((p) => under(path, p))) return k;
  }
  return null;
}

/** Whether a link in the header leads somewhere this person is not shown. */
export function hiddenHref(href: string, hidden: readonly string[]): boolean {
  const a = areaOf(href);
  return a !== null && hidden.includes(a);
}

export function isArea(v: unknown): v is Area {
  return typeof v === "string" && (AREA_KEYS as string[]).includes(v);
}
