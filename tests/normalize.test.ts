import { describe, expect, it } from "vitest";
import { buildFtsQuery, feedKey, normalizePubdate } from "../services/import/normalize";

describe("normalizePubdate", () => {
  it.each([
    ["Fri, 13 Feb 2026 08:00:00 GMT", "2026-02-13T08:00:00.000Z"],
    ["Fri, 13 Feb 2026 08:00:00 +0000", "2026-02-13T08:00:00.000Z"],
    ["Mon, 3 Mar 2025 09:05:00 -0500", "2025-03-03T14:05:00.000Z"],
    ["Mon, 3 Mar 2025 09:05:00 -05:00", "2025-03-03T14:05:00.000Z"],
    ["Tue, 01 Jul 2014 12:00:00 PDT", "2014-07-01T19:00:00.000Z"],
    ["1 Jan 99 00:00 GMT", "1999-01-01T00:00:00.000Z"],
    ["Wed, 05 June 2019 10:00:00 GMT", "2019-06-05T10:00:00.000Z"],
    ["13 Feb 2026", "2026-02-13T00:00:00.000Z"],
    ["2026-02-13T08:00:00Z", "2026-02-13T08:00:00.000Z"],
    ["2026-02-13T08:00:00+02:00", "2026-02-13T06:00:00.000Z"],
    ["2026-02-13T08:00:00.000Z", "2026-02-13T08:00:00.000Z"],
  ])("parses %s", (raw, expected) => {
    expect(normalizePubdate(raw)).toBe(expected);
  });

  it("returns null for empty input", () => {
    expect(normalizePubdate(null)).toBeNull();
    expect(normalizePubdate(undefined)).toBeNull();
    expect(normalizePubdate("   ")).toBeNull();
  });

  it("keeps unparseable text as-is", () => {
    expect(normalizePubdate("sometime last spring")).toBe("sometime last spring");
  });

  it("produces dates that sort chronologically as text", () => {
    const raw = [
      "Fri, 13 Feb 2026 08:00:00 GMT",
      "Mon, 01 Jan 2024 08:00:00 GMT",
      "Wed, 15 Mar 2023 08:00:00 GMT",
    ];
    const sorted = raw.map((r) => normalizePubdate(r)!).sort();
    expect(sorted).toEqual([
      "2023-03-15T08:00:00.000Z",
      "2024-01-01T08:00:00.000Z",
      "2026-02-13T08:00:00.000Z",
    ]);
  });
});

describe("feedKey", () => {
  it("treats protocol, www and trailing slashes as the same feed", () => {
    expect(feedKey("https://www.astralcodexten.com/feed/")).toBe(feedKey("http://astralcodexten.com/feed"));
  });

  it("keeps different paths distinct", () => {
    expect(feedKey("https://example.com/feed")).not.toBe(feedKey("https://example.com/comments/feed"));
  });
});

describe("buildFtsQuery", () => {
  it("quotes each word as a prefix term", () => {
    expect(buildFtsQuery("moloch meditations")).toBe('"moloch"* "meditations"*');
  });

  it("neutralizes FTS syntax characters", () => {
    expect(buildFtsQuery(`don't "AI-risk" OR`)).toBe(`"don't"* "AI-risk"* "OR"*`);
  });

  it("returns null when nothing searchable remains", () => {
    expect(buildFtsQuery(` " - * `)).toBeNull();
  });
});
