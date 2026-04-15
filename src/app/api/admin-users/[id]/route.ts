import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { adminUsers } from "@/drizzle/schema";
import { auth } from "@/auth";

/** PUT /api/admin-users/[id] — update admin user */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (body.username) updates.username = body.username;
  if (body.email !== undefined) updates.email = body.email || null;
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.role) updates.role = body.role;
  if (body.password) updates.passwordHash = await hash(body.password, 12);

  updates.updatedAt = new Date();

  const [user] = await db
    .update(adminUsers)
    .set(updates)
    .where(eq(adminUsers.id, id))
    .returning({
      id: adminUsers.id,
      username: adminUsers.username,
      email: adminUsers.email,
      displayName: adminUsers.displayName,
      role: adminUsers.role,
      isActive: adminUsers.isActive,
    });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(user);
}
