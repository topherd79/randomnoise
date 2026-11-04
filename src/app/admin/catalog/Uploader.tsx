"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActiveSwitch } from "./ActiveSwitch";
import { setSongsActive } from "./actions";

const AUDIO_EXT = /\.(mp3|m4a|mp4|aac|wav|aif|aiff|flac|ogg|opus|m4p)$/i;
const PARALLEL = 2;

type Item = {
  key: string;
  file: File;
  status: "queued" | "uploading" | "done" | "failed";
  progress: number;
  message?: string;
  /** Set once the song is in the catalog, so it can be switched on or off right here. */
  song?: { id: string; title: string; active: boolean };
};

type UploadResponse = {
  ok: boolean;
  error?: string;
  song?: { id: string; title: string; artist: string; needsReview: boolean };
};

function upload(url: string, file: File, onProgress: (p: number) => void): Promise<UploadResponse> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText) as UploadResponse);
      } catch {
        resolve({ ok: false, error: xhr.status === 413 ? "That file is too big." : `Upload failed (${xhr.status}).` });
      }
    };
    xhr.onerror = () => resolve({ ok: false, error: "The connection dropped. Try this file again." });
    xhr.send(file);
  });
}

/** Read every file inside dropped folders (Safari, Chrome and Firefox all support this API). */
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => Boolean(e));
  if (entries.length === 0) return Array.from(dt.files);

  const out: File[] = [];
  async function walk(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns results in batches until it returns an empty list.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child);
      }
    }
  }
  for (const e of entries) await walk(e);
  return out;
}

export function Uploader() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const queue = useRef<Item[]>([]);
  const running = useRef(0);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // React has no prop for this; it turns the input into a folder picker.
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  function update(key: string, patch: Partial<Item>) {
    setItems((all) => all.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  /** Start queued uploads while there's a free slot; refresh the list when the batch is done. */
  function pump() {
    while (running.current < PARALLEL && queue.current.length > 0) {
      const item = queue.current.shift()!;
      running.current++;
      update(item.key, { status: "uploading" });
      upload("/api/admin/songs", item.file, (p) => update(item.key, { progress: p })).then((r) => {
        running.current--;
        update(item.key, {
          status: r.ok ? "done" : "failed",
          progress: 1,
          message: r.ok
            ? `${r.song?.title} · ${r.song?.artist}${r.song?.needsReview ? " (check the details)" : ""}`
            : r.error,
          // New songs start switched on, like everything in the catalog.
          song: r.ok && r.song ? { id: r.song.id, title: r.song.title, active: true } : undefined,
        });
        if (running.current === 0 && queue.current.length === 0) {
          // Show the new songs (this also starts the details lookup).
          router.refresh();
        } else {
          pump();
        }
      });
    }
  }

  function add(files: File[]) {
    const audio = files.filter((f) => AUDIO_EXT.test(f.name));
    setSkipped((s) => s + files.length - audio.length);
    const stamp = Date.now();
    const fresh = audio.map((file, n) => ({
      key: `${stamp}-${n}-${file.name}`,
      file,
      status: "queued" as const,
      progress: 0,
    }));
    setItems((all) => [...all, ...fresh]);
    queue.current.push(...fresh);
    pump();
  }

  const active = items.some((i) => i.status === "queued" || i.status === "uploading");

  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "failed");

  // On/off for the songs added in this batch.
  const added = items.flatMap((i) => (i.song ? [i.song] : []));
  const onCount = added.filter((s) => s.active).length;
  const [switching, startSwitching] = useTransition();
  const [switchNote, setSwitchNote] = useState<{ ok: boolean; message: string } | null>(null);

  function setSongState(id: string, on: boolean) {
    setItems((all) => all.map((i) => (i.song?.id === id ? { ...i, song: { ...i.song, active: on } } : i)));
  }

  function switchAll(on: boolean) {
    const ids = added.filter((s) => s.active !== on).map((s) => s.id);
    if (ids.length === 0) return;
    setSwitchNote(null);
    startSwitching(async () => {
      const r = await setSongsActive(ids, on).catch(() => null);
      if (!r?.ok) {
        setSwitchNote({ ok: false, message: r?.message ?? "That didn't save. Try again." });
        return;
      }
      setItems((all) => all.map((i) => (i.song && ids.includes(i.song.id) ? { ...i, song: { ...i.song, active: on } } : i)));
      setSwitchNote(r);
      router.refresh();
    });
  }

  return (
    <section>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragging(false);
          add(await filesFromDrop(e.dataTransfer));
        }}
        className={`flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition ${
          dragging ? "border-accent bg-accent/5" : "border-line"
        }`}
      >
        <p className="text-lg font-semibold">Drop a folder of songs here</p>
        <p className="max-w-lg text-sm text-muted">
          MP3s and iTunes purchases (M4A) are kept as they are; WAV, AIFF and lossless files are converted to
          MP3. Title and artist come from each file, then artwork, year, genre and links are looked up.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <label className="cursor-pointer rounded-full bg-accent px-5 py-2.5 font-semibold text-accent-ink hover:brightness-95">
            Choose a folder
            <input
              ref={folderInput}
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => {
                add(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </label>
          <label className="cursor-pointer rounded-full bg-surface-2 px-5 py-2.5 font-semibold text-ink hover:bg-line">
            Choose files
            <input
              type="file"
              multiple
              accept="audio/*,.mp3,.m4a,.wav,.aif,.aiff,.flac"
              className="sr-only"
              onChange={(e) => {
                add(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {items.length > 0 && (
        <div className="mt-4 rounded-2xl bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="font-semibold">
              {active ? `Uploading… ${done} of ${items.length} added` : `${done} of ${items.length} added`}
              {failed.length > 0 && <span className="text-danger"> · {failed.length} didn’t work</span>}
              {skipped > 0 && <span className="font-normal text-muted"> · {skipped} non-audio files skipped</span>}
            </p>
            {!active && (
              <button
                onClick={() => {
                  setItems([]);
                  setSkipped(0);
                  setSwitchNote(null);
                }}
                className="text-muted hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
          {added.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-bg/60 px-3 py-2 text-sm">
              <span className="text-muted">
                This batch: <span className="text-ink">{onCount} in games</span> · {added.length - onCount} left out
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => switchAll(false)}
                  disabled={switching || onCount === 0}
                  className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-ink transition hover:bg-line disabled:opacity-40"
                >
                  Switch all off
                </button>
                <button
                  type="button"
                  onClick={() => switchAll(true)}
                  disabled={switching || onCount === added.length}
                  className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-ink transition hover:bg-line disabled:opacity-40"
                >
                  Switch all on
                </button>
              </span>
              {switchNote && (
                <span className={`text-xs ${switchNote.ok ? "text-muted" : "text-danger"}`} role="status">
                  {switchNote.message}
                </span>
              )}
            </div>
          )}
          <ul className="mt-3 max-h-72 divide-y divide-line overflow-y-auto text-sm">
            {items.map((i) => (
              <li key={i.key} className="flex items-center gap-3 py-2">
                <span className="w-5 text-center" aria-hidden="true">
                  {i.status === "done" ? "✓" : i.status === "failed" ? "✕" : i.status === "uploading" ? "↑" : "·"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{i.file.name}</span>
                  {i.message && (
                    <span className={`block truncate text-xs ${i.status === "failed" ? "text-danger" : "text-muted"}`}>
                      {i.message}
                    </span>
                  )}
                </span>
                {i.status === "uploading" && (
                  <span className="w-24 overflow-hidden rounded-full bg-surface-2">
                    <span className="block h-1.5 bg-accent" style={{ width: `${Math.round(i.progress * 100)}%` }} />
                  </span>
                )}
                {i.song && (
                  // Keyed on its state so "Switch all" redraws it; its own taps report back via onSaved.
                  <ActiveSwitch
                    key={`${i.song.id}-${i.song.active}`}
                    id={i.song.id}
                    active={i.song.active}
                    title={i.song.title}
                    onSaved={(on) => setSongState(i.song!.id, on)}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
