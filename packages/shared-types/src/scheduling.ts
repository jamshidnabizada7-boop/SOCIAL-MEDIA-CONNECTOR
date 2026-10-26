/** Format a wall-clock value without depending on the browser's own time zone. */
export function formatDateTimeInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

/** Reject DST gaps and repeated hours instead of silently choosing the wrong instant. */
export function localDateTimeToUtc(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error("Pick a valid date and time.");
  const [, year, month, day, hour, minute, second = "00"] = match;
  const wallClock = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const target = Date.parse(`${wallClock}Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 19) !== wallClock) {
    throw new Error("Pick a valid date and time.");
  }
  // Offsets on both sides of a transition include all candidates for this local date.
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = target + hours * 3_600_000;
    offsets.add(Date.parse(`${formatDateTimeInZone(new Date(probe), timeZone)}Z`) - probe);
  }
  const candidates = [...offsets].map((offset) => new Date(target - offset))
    .filter((candidate) => formatDateTimeInZone(candidate, timeZone) === wallClock);
  if (candidates.length === 0) throw new Error("That local time does not exist because the clocks change. Choose another time.");
  if (candidates.length > 1) throw new Error("That local time occurs twice because the clocks change. Choose a time outside the repeated hour.");
  return candidates[0].toISOString();
}
