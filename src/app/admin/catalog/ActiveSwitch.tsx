"use client";

import { useState, useTransition } from "react";
import { setSongActive } from "./actions";

/**
 * On/off switch for one song. Off songs are left out of new games entirely
 * (never drawn, never a wrong answer). Flips immediately and rolls back if
 * the save fails.
 */
export function ActiveSwitch({
  id,
  active,
  title,
  withLabel = false,
  onSaved,
}: {
  id: string;
  active: boolean;
  title: string;
  withLabel?: boolean;
  /** Called after a change is saved (e.g. so the upload list can keep its counts). */
  onSaved?: (active: boolean) => void;
}) {
  const [on, setOn] = useState(active);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    setError(false);
    startTransition(async () => {
      const result = await setSongActive(id, next).catch(() => null);
      if (!result?.ok) {
        setOn(!next);
        setError(true);
      } else {
        onSaved?.(next);
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Use “${title}” in new games`}
        title={on ? "On: new games can use this song" : "Off: new games leave this song out"}
        onClick={toggle}
        disabled={pending}
        className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition ${
          on ? "bg-accent" : "bg-line"
        } disabled:opacity-70`}
      >
        <span
          className={`inline-block size-5 rounded-full shadow transition ${
            on ? "translate-x-[18px] bg-accent-ink" : "translate-x-0.5 bg-muted"
          }`}
        />
      </button>
      {withLabel && <span className="text-sm text-muted">{on ? "In games" : "Left out of games"}</span>}
      {error && <span className="text-xs text-danger">Didn&apos;t save</span>}
    </span>
  );
}
