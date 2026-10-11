/**
 * Pure normalization helpers for imported feed data. No React Native or
 * database imports here, so these can be unit tested under Node.
 */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Offsets in minutes for the named zones RFC 822 allows, plus common extras.
const ZONES: Record<string, number> = {
  z: 0, ut: 0, utc: 0, gmt: 0,
  est: -300, edt: -240, cst: -360, cdt: -300,
  mst: -420, mdt: -360, pst: -480, pdt: -420,
  bst: 60, cet: 60, cest: 120,
};

// e.g. "Fri, 13 Feb 2026 08:00:00 GMT", "13 Feb 26 08:00 +0000", "Mon, 3 Mar 2025 9:05:00 -05:00"
const RFC822 =
  /^(?:[a-z]{3,}\.?,?\s+)?(\d{1,2})\s+([a-z]{3,})\.?,?\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*([a-z]{1,5}|[+-]\d{2}:?\d{2})?\s*$/i;

function zoneOffsetMinutes(zone: string | undefined): number {
  if (!zone) return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (m) {
    const sign = m[1] === "-" ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
  }
  return ZONES[zone.toLowerCase()] ?? 0;
}

function parseRfc822(raw: string): number | null {
  const m = RFC822.exec(raw);
  if (!m) return null;
  const [, day, monthName, yearStr, hh, mm, ss, zone] = m;
  const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  let year = parseInt(yearStr, 10);
  if (yearStr.length === 2) year += year < 50 ? 2000 : 1900;
  const utc = Date.UTC(
    year,
    month,
    parseInt(day, 10),
    hh ? parseInt(hh, 10) : 0,
    mm ? parseInt(mm, 10) : 0,
    ss ? parseInt(ss, 10) : 0
  );
  return utc - zoneOffsetMinutes(zone) * 60_000;
}

/**
 * Convert a feed date (RFC 822 from RSS, ISO 8601 from Atom / JSON) to an
 * ISO 8601 UTC string so it sorts correctly as text in SQLite.
 *
 * Returns the trimmed input unchanged when it cannot be parsed, and null for
 * empty input.
 */
export function normalizePubdate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return null;

  // Already canonical: leave it alone (keeps migrations idempotent).
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(trimmed)) return trimmed;

  let ms: number | null = null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const parsed = Date.parse(trimmed);
    ms = Number.isNaN(parsed) ? null : parsed;
  }
  if (ms === null) ms = parseRfc822(trimmed);
  if (ms === null) {
    const parsed = Date.parse(trimmed);
    ms = Number.isNaN(parsed) ? null : parsed;
  }
  if (ms === null || Number.isNaN(ms)) return trimmed;
  return new Date(ms).toISOString();
}

/**
 * Key used to recognize the same feed across imports: lowercase, no
 * protocol, no leading "www.", no trailing slashes.
 */
export function feedKey(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

/**
 * Turn free text from the search box into a safe FTS5 MATCH expression.
 * Each word becomes a quoted prefix term, so punctuation such as quotes,
 * hyphens or apostrophes can never cause a syntax error. Returns null when
 * nothing searchable remains.
 */
export function buildFtsQuery(input: string): string | null {
  const terms = input
    .split(/\s+/)
    .map((t) => t.replace(/"/g, "").trim())
    .filter((t) => /[0-9A-Za-z\u00C0-\uFFFF]/.test(t));
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"*`).join(" ");
}
