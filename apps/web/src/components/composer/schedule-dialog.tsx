"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/primitives";

function defaultWhen(): string {
  const d = new Date(Date.now() + 24 * 3600_000);
  d.setMinutes(0, 0, 0);
  d.setHours(10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const [when, setWhen] = useState(defaultWhen());
  const [tz, setTz] = useState(workspaceTimezone);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) {
      setWhen(defaultWhen());
      setTz(workspaceTimezone);
      setError(undefined);
    }
  }, [open, workspaceTimezone]);

  const confirm = () => {
    const t = new Date(when).getTime();
    if (!when || Number.isNaN(t)) {
      setError("Pick a valid date and time.");
      return;
    }
    if (t < Date.now() - 60_000) {
      setError("Choose a time in the future.");
      return;
    }
    onConfirm(new Date(t).toISOString());
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
        <Field label="Display time zone" htmlFor="schtz" hint="Recipients see the post at this local moment.">
          <Select id="schtz" value={tz} onChange={(e) => setTz(e.target.value)}>
            {TIMEZONES.map((t) => (
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
