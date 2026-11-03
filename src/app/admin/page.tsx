import { asc, eq, max } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { adminEmail } from "@/lib/env";
import { AddPlayerForm } from "./AddPlayerForm";
import { PlayerRow } from "./PlayerRow";

export default async function PlayersPage() {
  const me = await requireAdmin();

  const players = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
      lastLogin: max(sessions.createdAt),
    })
    .from(users)
    .leftJoin(sessions, eq(sessions.userId, users.id))
    .groupBy(users.id)
    .orderBy(asc(users.name));

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
      <section>
        <h1 className="text-2xl font-bold">Players</h1>
        <p className="mt-1 text-muted">
          {players.length} {players.length === 1 ? "person" : "people"} can log in. Pick 1 to 5 of them
          when you start a game.
        </p>

        <div className="mt-6 overflow-hidden rounded-2xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Last login</th>
                <th className="px-4 py-3 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {players.map((p) => (
                <PlayerRow
                  key={p.id}
                  player={{
                    id: p.id,
                    name: p.name,
                    email: p.email,
                    lastLogin: p.lastLogin ? new Date(p.lastLogin).toISOString() : null,
                    isAdmin: p.email === adminEmail(),
                    isMe: p.id === me.id,
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside>
        <h2 className="text-lg font-bold">Add a player</h2>
        <AddPlayerForm />
      </aside>
    </div>
  );
}
