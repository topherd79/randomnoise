import "server-only";
import { spawn } from "node:child_process";

/** Run a command and collect its stdout as a Buffer. Rejects with stderr on failure. */
function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => {
      if (err.length < 4000) err += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${cmd} exited with ${code}: ${err.trim().slice(0, 500)}`));
    });
  });
}

export type ProbeResult = {
  durationSec: number;
  /** Container format names from ffprobe, e.g. "mp3" or "mov,mp4,m4a,3gp,3g2,mj2". */
  format: string;
  /** Codec of the first audio stream, e.g. "mp3", "aac", "alac", "pcm_s16le". */
  codec: string;
  tags: { title?: string; artist?: string; album?: string; year?: number; genre?: string };
};

/** Read duration, codec and the title/artist/album tags of an audio file. Null if it has no audio. */
export async function probe(file: string): Promise<ProbeResult | null> {
  let json: {
    format?: { duration?: string; format_name?: string; tags?: Record<string, string> };
    streams?: { codec_type?: string; codec_name?: string; duration?: string; tags?: Record<string, string> }[];
  };
  try {
    const out = await run("ffprobe", [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      file,
    ]);
    json = JSON.parse(out.toString());
  } catch {
    return null;
  }

  const audio = json.streams?.find((s) => s.codec_type === "audio");
  if (!audio?.codec_name) return null;
  const durationSec = Number(json.format?.duration ?? audio.duration ?? 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;

  // Tag keys vary in case between formats (TITLE, title, ©nam is mapped to title by ffmpeg).
  const raw: Record<string, string> = {};
  for (const source of [audio.tags, json.format?.tags]) {
    for (const [k, v] of Object.entries(source ?? {})) {
      if (typeof v === "string" && v.trim()) raw[k.toLowerCase()] = v.trim();
    }
  }
  const yearMatch = (raw.date ?? raw.year ?? raw.tyer ?? "").match(/\b(1[89]\d\d|20\d\d)\b/);

  return {
    durationSec,
    format: json.format?.format_name ?? "",
    codec: audio.codec_name,
    tags: {
      title: raw.title,
      artist: raw.artist ?? raw.album_artist ?? raw.albumartist,
      album: raw.album,
      year: yearMatch ? Number(yearMatch[1]) : undefined,
      genre: raw.genre,
    },
  };
}

/**
 * Files we can keep as they are: MP3, and AAC in an MP4/M4A container (iTunes
 * purchases). Everything else (WAV, AIFF, FLAC, Apple Lossless…) is converted.
 */
export function keepAsIs(p: ProbeResult): { ext: string; mimeType: string } | null {
  if (p.codec === "mp3" && p.format.includes("mp3")) return { ext: "mp3", mimeType: "audio/mpeg" };
  if (p.codec === "aac" && p.format.includes("mp4")) return { ext: "m4a", mimeType: "audio/mp4" };
  return null;
}

/** Convert any audio file to a 256 kbps MP3 (constant bit rate seeks reliably in Safari). */
export async function convertToMp3(input: string, output: string): Promise<void> {
  await run(
    "ffmpeg",
    ["-v", "error", "-y", "-i", input, "-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", "256k", "-ar", "44100", output],
    600_000,
  );
}

export const WAVEFORM_POINTS = 600;

/**
 * Loudness of the song in WAVEFORM_POINTS evenly spaced slices, scaled 0–100
 * (100 = the loudest slice). Used for the sound-wave picture and to steer
 * "surprise me" clips away from quiet parts.
 */
export async function waveform(file: string): Promise<number[]> {
  const rate = 8000;
  const pcm = await run(
    "ffmpeg",
    ["-v", "error", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"],
    300_000,
  );
  const samples = Math.floor(pcm.length / 2);
  const perPoint = Math.max(1, Math.floor(samples / WAVEFORM_POINTS));
  const rms: number[] = [];
  for (let p = 0; p < WAVEFORM_POINTS; p++) {
    const start = p * perPoint;
    const end = Math.min(samples, start + perPoint);
    let sum = 0;
    for (let i = start; i < end; i++) {
      const v = pcm.readInt16LE(i * 2) / 32768;
      sum += v * v;
    }
    rms.push(end > start ? Math.sqrt(sum / (end - start)) : 0);
  }
  const max = Math.max(...rms, 1e-9);
  return rms.map((v) => Math.round((v / max) * 100));
}

/**
 * Cut a game clip: a short fade in and out, re-encoded to MP3 with every tag
 * removed (an iPhone can show a file's title and artist on the lock screen,
 * which would give the answer away) and no embedded artwork.
 */
export async function cutClip(opts: {
  input: string;
  output: string;
  startSec: number;
  lengthSec: number;
}): Promise<void> {
  const len = opts.lengthSec;
  const fadeOut = Math.min(0.8, len / 4);
  await run("ffmpeg", [
    "-v", "error",
    "-y",
    "-ss", opts.startSec.toFixed(3),
    "-i", opts.input,
    "-t", len.toFixed(3),
    "-map", "0:a:0",
    "-vn",
    "-af", `afade=t=in:st=0:d=0.3,afade=t=out:st=${(len - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`,
    "-map_metadata", "-1",
    "-fflags", "+bitexact",
    "-flags:a", "+bitexact",
    "-id3v2_version", "0",
    "-write_id3v1", "0",
    "-c:a", "libmp3lame",
    "-b:a", "192k",
    "-ar", "44100",
    "-ac", "2",
    opts.output,
  ]);
}
