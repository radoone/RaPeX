import { afterEach, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { LocalDateTime } from "../app/components/LocalDateTime";

const originalTZ = process.env.TZ;
afterEach(() => {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});

describe("date hydration across server and browser time zones", () => {
  it("renders identical initial markup in different zones and locales", () => {
    const render = (tz: string, locale: string) => {
      process.env.TZ = tz;
      return renderToString(<LocalDateTime value="2026-10-21T01:18:49Z" locale={locale} />);
    };
    expect(render("UTC", "en")).toBe(render("Europe/Bratislava", "sk"));
    expect(render("UTC", "en")).toBe(render("America/Los_Angeles", "en-US"));
    expect(render("UTC", "en")).toContain("2026-10-21 01:18:49 UTC");
  });

  it("does not evaluate clock-dependent relative dates during SSR", () => {
    const result = renderToString(<LocalDateTime value="2026-10-21T01:18:49Z" format={() => { throw new Error("Browser formatter called during SSR"); }} />);
    expect(result).toContain("2026-10-21 01:18:49 UTC");
  });
});
