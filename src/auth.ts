import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { adminUsers } from "@/drizzle/schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = credentials?.username as string | undefined;
        const password = credentials?.password as string | undefined;

        if (!username || !password) return null;

        const rows = await db
          .select()
          .from(adminUsers)
          .where(eq(adminUsers.username, username))
          .limit(1);

        if (!rows.length) return null;

        const user = rows[0];
        if (!user.isActive) return null;

        const valid = await compare(password, user.passwordHash);
        if (!valid) return null;

        // Update last login
        await db
          .update(adminUsers)
          .set({ lastLogin: new Date() })
          .where(eq(adminUsers.id, user.id));

        return {
          id: String(user.id),
          email: user.email ?? "",
          name: user.displayName ?? user.username,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      // Check is_active + refresh role on every token refresh to enable instant revocation
      if (token.id) {
        const rows = await db
          .select({ isActive: adminUsers.isActive, role: adminUsers.role })
          .from(adminUsers)
          .where(eq(adminUsers.id, Number(token.id)))
          .limit(1);

        if (!rows.length || !rows[0].isActive) {
          return { ...token, isActive: false };
        }
        token.role = rows[0].role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.isActive === false) {
        // Return empty session — proxy will redirect to login
        return {} as typeof session;
      }
      session.user.id = token.id as string;
      session.user.role = token.role as string;
      return session;
    },
  },
});
