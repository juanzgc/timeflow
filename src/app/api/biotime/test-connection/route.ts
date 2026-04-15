import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/drizzle/schema";
import { authenticate, saveToken, markConnected, markDisconnected } from "@/lib/biotime/auth";
import { BioTimeClient } from "@/lib/biotime/client";
import { getTerminals } from "@/lib/biotime/terminals";
import { auth } from "@/auth";

/**
 * POST /api/biotime/test-connection
 * Tests connectivity to BioTime with provided (or saved) credentials.
 * On success: saves credentials + token to settings, sets connected=true.
 * On failure: returns error message.
 *
 * Body: { url?: string, username?: string, password?: string }
 * If omitted, uses saved/env credentials.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { url, username, password } = body as {
      url?: string;
      username?: string;
      password?: string;
    };

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: "url, username, and password are required" },
        { status: 400 },
      );
    }

    // Try to authenticate
    const token = await authenticate(url, username, password);

    // Test with a lightweight API call (terminals)
    const client = new BioTimeClient(url, token);
    const terminals = await getTerminals(client);

    // Save credentials and token to settings
    const upserts = [
      { key: "biotime_url", value: url },
      { key: "biotime_username", value: username },
      { key: "biotime_password", value: password },
    ];

    for (const { key, value } of upserts) {
      await db
        .insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } });
    }

    await saveToken(token);
    await markConnected();

    return NextResponse.json({
      success: true,
      terminals: terminals.length,
      message: `Connected successfully. Found ${terminals.length} terminal(s).`,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Connection failed";
    await markDisconnected(message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
