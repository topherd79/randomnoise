"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ClipMode } from "@/db/schema";
import { CLIP_LENGTHS, clampStart, formatTime, surpriseStart } from "@/lib/clips";
import { saveClipSettings, type FormResult } from "../actions";

type Props = {
  songId: string;
  durationSec: number;
  waveform: number[];
  initial: { mode: ClipMode; spots: number[]; lengthSec: number | null };
};

const MODES: { mode: ClipMode; label: string; help: string }[] = [
  {
    mode: "surprise",
    label: "Surprise me",
    help: "The game picks a random spot when it creates the game, avoiding the very start, the end and quiet parts.",
  },
  { mode: "start", label: "Start of song", help: "Plays from 0:00." },
  {
    mode: "spots",
    label: "Pick spots",
    help: "Click the sound wave to mark a spot, drag it to move it. Mark several and the game picks one each time.",
  },
];

/** Previews use the override, or 10 seconds (the middle game setting). */
const DEFAULT_PREVIEW_SEC = 10;

export function ClipEditor({ songId, durationSec, waveform, initial }: Props) {
  const [mode, setMode] = useState<ClipMode>(initial.mode);
  const [spots, setSpots] = useState<number[]>(initial.spots);
  const [lengthSec, setLengthSec] = useState<number | null>(initial.lengthSec);
  const [surprise, setSurprise] = useState<number | null>(null);
  const [playing, setPlaying] = useState<{ start: number; end: number } | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [note, setNote] = useState<FormResult>(null);
  const [saving, startSaving] = useTransition();

  const audio = useRef<HTMLAudioElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; startX: number; startSpot: number; moved: boolean } | null>(null);
  const frame = useRef<number | null>(null);

  const previewLen = Math.min(lengthSec ?? DEFAULT_PREVIEW_SEC, durationSec);
  const dirty =
    mode !== initial.mode ||
    lengthSec !== initial.lengthSec ||
    JSON.stringify([...spots].sort((a, b) => a - b)) !== JSON.stringify(initial.spots);

  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );

  function stop() {
    audio.current?.pause();
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    setPlaying(null);
    setPlayhead(null);
  }

  /** Play [start, start + previewLen). Waits for the audio's metadata so seeking works in Safari. */
  async function play(start: number) {
    const el = audio.current;
    if (!el) return;
    stop();
    const s = clampStart(start, previewLen, durationSec);
    const end = s + previewLen;
    if (el.readyState < 1) {
      el.load();
      await new Promise<void>((res) => el.addEventListener("loadedmetadata", () => res(), { once: true }));
    }
    el.currentTime = s;
    try {
      await el.play();
    } catch {
      return;
    }
    setPlaying({ start: s, end });
    const tick = () => {
      if (!audio.current) return;
      const t = audio.current.currentTime;
      if (t >= end || audio.current.paused) {
        stop();
        return;
      }
      setPlayhead(t);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }

  function timeAt(clientX: number): number {
    const rect = area.current!.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    return (x / rect.width) * durationSec;
  }

  function onAreaPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const t = timeAt(e.clientX);
    if (mode === "spots") {
      if (spots.length >= 20) return;
      const s = Math.round(clampStart(t, previewLen, durationSec) * 10) / 10;
      setSpots((all) => [...all, s].sort((a, b) => a - b));
      play(s);
    } else {
      play(t);
    }
  }

  function onBoxPointerDown(e: React.PointerEvent, index: number) {
    if (mode !== "spots" || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { index, startX: e.clientX, startSpot: spots[index], moved: false };
  }

  function onBoxPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const width = area.current!.getBoundingClientRect().width;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 3) d.moved = true;
    const s = Math.round(clampStart(d.startSpot + (dx / width) * durationSec, previewLen, durationSec) * 10) / 10;
    setSpots((all) => all.map((v, i) => (i === d.index ? s : v)));
  }

  function onBoxPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const s = spots[d.index];
    setSpots((all) => [...all].sort((a, b) => a - b));
    play(s);
  }

  function save() {
    startSaving(async () => {
      const r = await saveClipSettings(songId, { mode, spots, lengthSec });
      setNote(r);
    });
  }

  const pct = (t: number) => `${(t / durationSec) * 100}%`;
  const boxes =
    mode === "spots"
      ? spots.map((s) => ({ start: s, kind: "spot" as const }))
      : mode === "start"
        ? [{ start: 0, kind: "fixed" as const }]
        : surprise !== null
          ? [{ start: surprise, kind: "surprise" as const }]
          : [];
  const tickEvery = durationSec > 420 ? 60 : 30;
  const ticks = Array.from({ length: Math.floor(durationSec / tickEvery) + 1 }, (_, i) => i * tickEvery);

  return (
    <div className="flex flex-col gap-5">
      <audio ref={audio} src={`/api/admin/songs/${songId}/audio`} preload="metadata" onEnded={stop} />

      <div className="grid gap-3 sm:grid-cols-3">
        {MODES.map((m) => (
          <label
            key={m.mode}
            className={`cursor-pointer rounded-xl border p-3 transition ${
              mode === m.mode ? "border-accent bg-accent/5" : "border-line hover:border-muted"
            }`}
          >
            <span className="flex items-center gap-2 font-semibold">
              <input
                type="radio"
                name="clipMode"
                checked={mode === m.mode}
                onChange={() => {
                  setMode(m.mode);
                  setSurprise(null);
                  setNote(null);
                }}
                className="accent-[#d6ff3f]"
              />
              {m.label}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted">{m.help}</span>
          </label>
        ))}
      </div>

      <div>
        <div
          ref={area}
          onPointerDown={onAreaPointerDown}
          className="relative h-28 cursor-crosshair touch-none select-none overflow-hidden rounded-xl bg-surface"
          role="presentation"
        >
          <svg viewBox={`0 0 ${waveform.length} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            {waveform.map((v, i) => {
              const h = Math.max(1.5, v * 0.92);
              return <rect key={i} x={i + 0.15} width={0.7} y={(100 - h) / 2} height={h} className="fill-muted/50" />;
            })}
          </svg>
          {boxes.map((b, i) => (
            <div
              key={`${b.kind}-${i}`}
              onPointerDown={(e) => onBoxPointerDown(e, i)}
              onPointerMove={onBoxPointerMove}
              onPointerUp={onBoxPointerUp}
              className={`absolute inset-y-0 rounded-md border-2 ${
                b.kind === "surprise" ? "border-dashed border-accent/80 bg-accent/10" : "border-accent bg-accent/20"
              } ${b.kind === "spot" ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"}`}
              style={{ left: pct(b.start), width: pct(previewLen) }}
              title={`${formatTime(b.start)}–${formatTime(b.start + previewLen)}`}
            />
          ))}
          {playhead !== null && (
            <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-ink" style={{ left: pct(playhead) }} />
          )}
        </div>
        <div className="relative mt-1 h-4 text-[10px] text-muted">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2 tabular-nums" style={{ left: pct(t) }}>
              {formatTime(t)}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {mode === "surprise" && (
          <button
            onClick={() => {
              const s = surpriseStart({ durationSec, waveform }, previewLen);
              setSurprise(s);
              play(s);
            }}
            className="rounded-full bg-surface-2 px-4 py-2 font-semibold text-ink transition hover:bg-line"
          >
            Hear a surprise pick
          </button>
        )}
        {mode === "start" && (
          <button onClick={() => play(0)} className="rounded-full bg-surface-2 px-4 py-2 font-semibold text-ink transition hover:bg-line">
            Hear it
          </button>
        )}
        {playing && (
          <button onClick={stop} className="rounded-full bg-surface-2 px-4 py-2 font-semibold text-ink transition hover:bg-line">
            Stop
          </button>
        )}
        <label className="ml-auto flex items-center gap-2 text-muted">
          Clip length
          <select
            value={lengthSec ?? ""}
            onChange={(e) => setLengthSec(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-ink"
          >
            <option value="">Use the game&apos;s setting</option>
            {CLIP_LENGTHS.map((l) => (
              <option key={l} value={l}>
                Always {l} seconds
              </option>
            ))}
          </select>
        </label>
      </div>
      {lengthSec === null && (
        <p className="-mt-2 text-xs text-muted">Previews here play {DEFAULT_PREVIEW_SEC} seconds.</p>
      )}

      {mode === "spots" && (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line text-sm">
          {spots.length === 0 && <li className="p-3 text-muted">No spots yet. Click the sound wave to mark one.</li>}
          {spots.map((s, i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-2">
              <span className="font-semibold">Spot {i + 1}</span>
              <span className="tabular-nums text-muted">
                {formatTime(s)}–{formatTime(s + previewLen)}
              </span>
              <button onClick={() => play(s)} className="ml-auto text-accent hover:underline">
                Play
              </button>
              <button onClick={() => setSpots((all) => all.filter((_, j) => j !== i))} className="text-danger hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-full bg-accent px-5 py-2.5 font-semibold text-accent-ink transition hover:brightness-95 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save clip setting"}
        </button>
        {dirty && !saving && <span className="text-sm text-muted">Unsaved changes</span>}
        {note && !dirty && <span className={`text-sm ${note.ok ? "text-accent" : "text-danger"}`}>{note.message}</span>}
        {note && !note.ok && dirty && <span className="text-sm text-danger">{note.message}</span>}
      </div>
    </div>
  );
}
