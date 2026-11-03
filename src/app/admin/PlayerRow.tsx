"use client";

import { useActionState, useState, useTransition } from "react";
import {
  emailLoginLink,
  makeLoginLink,
  removePlayer,
  updatePlayer,
  type FormResult,
} from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { inputClass } from "./AddPlayerForm";

type Player = {
  id: string;
  name: string;
  email: string;
  lastLogin: string | null;
  isAdmin: boolean;
  isMe: boolean;
};

const smallButton =
  "rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-line disabled:opacity-50";

function formatDate(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Copy text that is still being fetched. Safari only allows clipboard writes
 * during the click itself, so we hand it a ClipboardItem whose content is a
 * promise; other browsers fall back to writeText.
 */
async function copyWhenReady(textPromise: Promise<string>) {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    const blob = textPromise.then((t) => new Blob([t], { type: "text/plain" }));
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
  } else {
    await navigator.clipboard.writeText(await textPromise);
  }
}

export function PlayerRow({ player }: { player: Player }) {
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState<{ url: string; copied: boolean } | null>(null);
  const [note, setNote] = useState<FormResult>(null);
  const [pending, startTransition] = useTransition();
  const [editResult, editAction] = useActionState<FormResult, FormData>(async (prev, fd) => {
    const r = await updatePlayer(prev, fd);
    if (r?.ok) setEditing(false);
    return r;
  }, null);

  function onCopyLink() {
    const urlPromise = makeLoginLink(player.id).then((r) => r.url);
    startTransition(async () => {
      let copied = true;
      try {
        await copyWhenReady(urlPromise);
      } catch {
        copied = false;
      }
      try {
        setLink({ url: await urlPromise, copied });
      } catch {
        setNote({ ok: false, message: "Couldn't make a link." });
      }
    });
  }

  function onEmail() {
    startTransition(async () => setNote(await emailLoginLink(player.id)));
  }

  function onRemove() {
    if (!confirm(`Remove ${player.name}? They won't be able to log in.`)) return;
    startTransition(async () => setNote(await removePlayer(player.id)));
  }

  if (editing) {
    return (
      <tr className="bg-surface/50">
        <td colSpan={4} className="px-4 py-4">
          <form action={editAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="id" value={player.id} />
            <input name="name" defaultValue={player.name} required maxLength={40} className={`${inputClass} max-w-48`} />
            <input
              name="email"
              type="email"
              defaultValue={player.email}
              required
              readOnly={player.isAdmin}
              title={player.isAdmin ? "Set by the ADMIN_EMAIL setting" : undefined}
              className={`${inputClass} max-w-72 read-only:opacity-60`}
            />
            <SubmitButton pendingText="Saving…" className="px-4 py-2 text-sm">
              Save
            </SubmitButton>
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-muted hover:text-ink">
              Cancel
            </button>
            {editResult && !editResult.ok && <p className="w-full text-sm text-danger">{editResult.message}</p>}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="align-top">
      <td className="px-4 py-4 font-semibold">
        {player.name}
        {player.isAdmin && <span className="ml-2 text-xs font-medium text-accent">admin</span>}
      </td>
      <td className="px-4 py-4 text-muted">{player.email}</td>
      <td className="whitespace-nowrap px-4 py-4 text-muted">{formatDate(player.lastLogin)}</td>
      <td className="px-4 py-4">
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={onCopyLink} disabled={pending} className={smallButton}>
            Copy login link
          </button>
          <button onClick={onEmail} disabled={pending} className={smallButton}>
            Email link
          </button>
          <button onClick={() => setEditing(true)} disabled={pending} className={smallButton}>
            Edit
          </button>
          {!player.isMe && (
            <button
              onClick={onRemove}
              disabled={pending}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger/10 disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
        {link && (
          <div className="mt-3 flex flex-col items-end gap-1">
            <input
              readOnly
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full max-w-sm rounded-lg border border-line bg-surface px-2 py-1 font-mono text-xs text-muted"
            />
            <span className="text-xs text-muted">
              {link.copied ? "Copied. It works once." : "Select and copy it. It works once."}
            </span>
          </div>
        )}
        {note && (
          <p className={`mt-2 text-right text-xs ${note.ok ? "text-accent" : "text-danger"}`}>{note.message}</p>
        )}
      </td>
    </tr>
  );
}
