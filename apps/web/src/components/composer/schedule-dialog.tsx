"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/primitives";
import { formatDateTimeInZone, localDateTimeToUtc } from "@aria/shared-types";

function defaultWhen(timeZone: string): string {
  return `${formatDateTimeInZone(new Date(Date.now() + 24 * 3600_000), timeZone).slice(0, 10)}T10:00`;
}

const TIMEZONES = ["Europe/Berlin", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "UTC"];

export function ScheduleDialog({
  open,
  onClose,
  onConfirm,
  workspaceTimezone,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (iso: string) => void;
  workspaceTimezone: string;
}) {
  const [when, setWhen] = useState(() => defaultWhen(workspaceTimezone));
  const [tz, setTz] = useState(workspaceTimezone);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) {
      setWhen(defaultWhen(workspaceTimezone));
      setTz(workspaceTimezone);
      setError(undefined);
    }
  }, [open, workspaceTimezone]);

  const confirm = () => {
    try {
      const iso = localDateTimeToUtc(when, tz);
      if (Date.parse(iso) < Date.now() + 60_000) {
        setError("Choose a time at least a minute in the future.");
        return;
      }
      onConfirm(iso);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pick a valid date and time.");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Schedule post"
      description="Times are stored in UTC and displayed in your workspace time zone — daylight-saving changes are handled for you."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm}>
            <CalendarClock className="size-4" />
            Schedule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Publish at" htmlFor="when" error={error}>
          <Input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label="Time zone" htmlFor="schtz" hint="The date and time above use this time zone.">
          <Select id="schtz" value={tz} onChange={(e) => setTz(e.target.value)}>
            {[...new Set([workspaceTimezone, ...TIMEZONES])].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <p className="rounded-lg bg-surface-2 border p-3 text-[13px] leading-relaxed text-ink-2">
          <span className="font-semibold text-ink">Tip:</span> to publish into your recurring queue
          slots instead, use “Add to queue” on the post after saving it as a draft.
        </p>
      </div>
    </Dialog>
  );
}
