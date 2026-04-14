import { auth } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-2 text-foreground/60">
        Welcome back, {session?.user?.name ?? "Admin"}.
      </p>
    </div>
  );
}
