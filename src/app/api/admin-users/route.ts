import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { adminUsers } from "@/drizzle/schema";
import { auth } from "@/auth";

/** GET /api/admin-users — list all admin users */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await db
    .select({
      id: adminUsers.id,
      username: adminUsers.username,
      email: adminUsers.email,
      displayName: adminUsers.displayName,
      role: adminUsers.role,
      isActive: adminUsers.isActive,
      lastLogin: adminUsers.lastLogin,
      createdAt: adminUsers.createdAt,
    })
    .from(adminUsers);

  return NextResponse.json(users);
}

/** POST /api/admin-users — create admin user */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { username, email, password, displayName, role = "admin" } = body;

  if (!username || !password) {
    return NextResponse.json(
      { error: "username and password are required" },
      { status: 400 },
    );
  }

  const passwordHash = await hash(password, 12);

  const [user] = await db
    .insert(adminUsers)
    .values({
      username,
      email: email || null,
      passwordHash,
      displayName: displayName || username,
      role,
      isActive: true,
    })
    .returning({
      id: adminUsers.id,
      username: adminUsers.username,
      email: adminUsers.email,
      displayName: adminUsers.displayName,
      role: adminUsers.role,
      isActive: adminUsers.isActive,
    });

  return NextResponse.json(user, { status: 201 });
}
