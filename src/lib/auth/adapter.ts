import { eq } from "drizzle-orm";
import type { Adapter, AdapterSession, AdapterUser } from "next-auth/adapters";
import { db } from "@/lib/db";
import { adminUsers, sessions } from "@/drizzle/schema";

function toAdapterUser(row: typeof adminUsers.$inferSelect): AdapterUser {
  return {
    id: String(row.id),
    email: row.email ?? "",
    name: row.displayName ?? row.username,
    image: null,
    emailVerified: null,
  };
}

function toAdapterSession(
  row: typeof sessions.$inferSelect,
): AdapterSession {
  return {
    sessionToken: row.id,
    userId: String(row.userId),
    expires: row.expires,
  };
}

export function TimeFlowAdapter(): Adapter {
  return {
    async createSession(session) {
      await db.insert(sessions).values({
        id: session.sessionToken,
        userId: Number(session.userId),
        expires: session.expires,
      });
      return session;
    },

    async getSessionAndUser(sessionToken) {
      const row = await db
        .select()
        .from(sessions)
        .innerJoin(adminUsers, eq(sessions.userId, adminUsers.id))
        .where(eq(sessions.id, sessionToken))
        .limit(1);

      if (!row.length) return null;

      const { sessions: s, admin_users: u } = row[0];

      // Check if user is still active — instant revocation
      if (!u.isActive) {
        await db.delete(sessions).where(eq(sessions.id, sessionToken));
        return null;
      }

      return {
        session: toAdapterSession(s),
        user: toAdapterUser(u),
      };
    },

    async updateSession(session) {
      if (!session.sessionToken) return null;

      const values: Partial<typeof sessions.$inferInsert> = {};
      if (session.expires) values.expires = session.expires;

      await db
        .update(sessions)
        .set(values)
        .where(eq(sessions.id, session.sessionToken));

      const updated = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, session.sessionToken))
        .limit(1);

      return updated.length ? toAdapterSession(updated[0]) : null;
    },

    async deleteSession(sessionToken) {
      await db.delete(sessions).where(eq(sessions.id, sessionToken));
    },

    async getUser(id) {
      const rows = await db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.id, Number(id)))
        .limit(1);

      return rows.length ? toAdapterUser(rows[0]) : null;
    },

    async getUserByEmail(email) {
      const rows = await db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.email, email))
        .limit(1);

      return rows.length ? toAdapterUser(rows[0]) : null;
    },
  };
}
