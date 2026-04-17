import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { Session } from "next-auth";

type AuthResult =
  | { session: Session; response: null }
  | { session: null; response: NextResponse };

export async function requireAuth(): Promise<AuthResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { session, response: null };
}

export async function requireSuperadmin(): Promise<AuthResult> {
  const { session, response } = await requireAuth();
  if (!session) return { session: null, response: response! };
  if (session.user.role !== "superadmin") {
    return {
      session: null,
      response: NextResponse.json(
        { error: "Superadmin access required" },
        { status: 403 },
      ),
    };
  }
  return { session, response: null };
}
