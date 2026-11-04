// Shared by the server (cutting clips when a game is created) and the admin
// clip editor (previewing a "surprise me" pick). No server-only imports here.

export const CLIP_LENGTHS = [5, 10, 20, 30] as const;
export type ClipLength = (typeof CLIP_LENGTHS)[number];

type ClipSource = {
  durationSec: number;
  waveform: number[];
  clipMode: "surprise" | "start" | "spots";
  clipSpots: number[];
};

/** Clamp a start time so the whole clip fits inside the song. */
export function clampStart(startSec: number, lengthSec: number, durationSec: number): number {
  return Math.max(0, Math.min(startSec, durationSec - lengthSec));
}

/** Average loudness (0–100) of the waveform between two times. */
function loudness(waveform: number[], durationSec: number, from: number, to: number): number {
  const n = waveform.length;
  if (!n || durationSec <= 0) return 0;
  const a = Math.max(0, Math.floor((from / durationSec) * n));
  const b = Math.min(n, Math.max(a + 1, Math.ceil((to / durationSec) * n)));
  let sum = 0;
  for (let i = a; i < b; i++) sum += waveform[i];
  return sum / (b - a);
}

/**
 * "Surprise me": a random start that avoids the very start and end of the song
 * (up to 20 seconds each, less for short songs) and parts quieter than most of it.
 */
export function surpriseStart(
  song: Pick<ClipSource, "durationSec" | "waveform">,
  lengthSec: number,
  random: () => number = Math.random,
): number {
  const { durationSec, waveform } = song;
  const margin = Math.min(20, durationSec * 0.12);
  const lo = margin;
  const hi = durationSec - lengthSec - margin;
  if (hi <= lo) return clampStart((durationSec - lengthSec) / 2, lengthSec, durationSec);

  const candidates: { start: number; level: number }[] = [];
  for (let s = lo; s <= hi; s += 0.5) {
    candidates.push({ start: s, level: loudness(waveform, durationSec, s, s + lengthSec) });
  }
  const sorted = [...waveform].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  let pool = candidates.filter((c) => c.level >= median * 0.75);
  if (pool.length === 0) {
    // Mostly quiet song: take the loudest third of the candidates.
    pool = [...candidates].sort((x, y) => y.level - x.level).slice(0, Math.max(1, Math.ceil(candidates.length / 3)));
  }
  const pick = pool[Math.floor(random() * pool.length)];
  return Math.round(pick.start * 10) / 10;
}

/** Where a clip of this song starts, following its clip setting. */
export function pickClipStart(
  song: ClipSource,
  lengthSec: number,
  random: () => number = Math.random,
): number {
  if (song.clipMode === "start") return 0;
  if (song.clipMode === "spots" && song.clipSpots.length > 0) {
    const spot = song.clipSpots[Math.floor(random() * song.clipSpots.length)];
    return clampStart(spot, lengthSec, song.durationSec);
  }
  return surpriseStart(song, lengthSec, random);
}

/** "3:07" */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
