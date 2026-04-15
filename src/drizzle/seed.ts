import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
import { hash } from "bcryptjs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { adminUsers, groups, settings } from "./schema";

async function seed() {
  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client);

  // Seed groups
  await db
    .insert(groups)
    .values([
      { name: "Kitchen" },
      { name: "Servers" },
      { name: "Bar" },
      { name: "Admin" },
    ])
    .onConflictDoNothing();

  console.log("Seeded groups: Kitchen, Servers, Bar, Admin");

  // Seed admin user
  const username = process.env.ADMIN_USERNAME ?? "admin";
  const email = process.env.ADMIN_EMAIL ?? "gerencia@zelavi.co";
  const password = process.env.ADMIN_PASSWORD ?? "password";
  const passwordHash = await hash(password, 12);

  await db
    .insert(adminUsers)
    .values({
      username,
      email,
      passwordHash,
      displayName: "Administrator",
      role: "superadmin",
      isActive: true,
    })
    .onConflictDoNothing();

  console.log(`Seeded admin user: ${username}`);

  // Seed default settings
  await db
    .insert(settings)
    .values([
      { key: "biotime_url", value: process.env.BIOTIME_URL ?? "" },
      { key: "sync_interval_minutes", value: "10" },
      { key: "daily_limit_sun_thu", value: "420" },
      { key: "daily_limit_fri_sat", value: "480" },
      { key: "last_sync_time", value: "" },
      { key: "biotime_connected", value: "false" },
      { key: "biotime_last_error", value: "" },
      { key: "sync_in_progress", value: "false" },
    ])
    .onConflictDoNothing();

  console.log("Seeded default settings");

  await client.end();
  console.log("Seed complete.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
