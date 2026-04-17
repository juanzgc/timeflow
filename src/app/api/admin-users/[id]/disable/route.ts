import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { adminUsers, sessions } from "@/drizzle/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";

/** PUT /api/admin-users/[id]/disable — disable user + kill sessions (superadmin only) */
export async function PUT(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireSuperadmin();
  if (response) return response;

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // Prevent disabling yourself
  if (String(id) === session.user.id) {
    return NextResponse.json(
      { error: "Cannot disable your own account" },
      { status: 409 },
    );
  }

  // Set is_active = false
  const [user] = await db
    .update(adminUsers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(adminUsers.id, id))
    .returning({ id: adminUsers.id, username: adminUsers.username });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Delete all sessions for this user
  await db.delete(sessions).where(eq(sessions.userId, id));

  return NextResponse.json({ disabled: true, username: user.username });
}
