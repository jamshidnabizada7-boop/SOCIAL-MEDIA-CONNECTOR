import { describe, expect, it } from "vitest";
import { localDateTimeToUtc } from "@aria/shared-types";

describe("wall-clock scheduling", () => {
  it("converts the selected time zone independently of the machine's zone", () => {
    expect(localDateTimeToUtc("2026-10-26T10:00", "Asia/Karachi")).toBe("2026-10-26T05:00:00.000Z");
    expect(localDateTimeToUtc("2026-10-26T10:00", "America/New_York")).toBe("2026-10-26T14:00:00.000Z");
    expect(localDateTimeToUtc("2026-10-26T10:00:30", "UTC")).toBe("2026-10-26T10:00:30.000Z");
  });
  it("rejects invalid dates, DST gaps and ambiguous repeated hours", () => {
    expect(() => localDateTimeToUtc("2026-02-30T10:00", "UTC")).toThrow("valid date");
    expect(() => localDateTimeToUtc("2026-03-29T02:30", "Europe/Berlin")).toThrow("does not exist");
    expect(() => localDateTimeToUtc("2026-10-25T02:30", "Europe/Berlin")).toThrow("occurs twice");
  });
});
