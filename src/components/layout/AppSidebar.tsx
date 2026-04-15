"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboardIcon,
  ClockIcon,
  CalendarDaysIcon,
  UsersIcon,
  BanknoteIcon,
  SettingsIcon,
  LogOutIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/attendance", label: "Attendance", icon: ClockIcon },
  { href: "/schedules", label: "Schedules", icon: CalendarDaysIcon },
  { href: "/employees", label: "Employees", icon: UsersIcon },
  { href: "/payroll", label: "Payroll", icon: BanknoteIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div
            className="flex size-[34px] items-center justify-center rounded-[10px] text-white shadow-[0_2px_12px_rgba(0,184,153,0.12)]"
            style={{ background: "linear-gradient(135deg, #00b899, #00d4aa)" }}
          >
            <ClockIcon className="size-[18px]" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-[16px] font-bold tracking-[-0.03em] text-sidebar-foreground">
              TimeFlow
            </div>
            <div className="text-[10.5px] tracking-[0.01em] text-sidebar-foreground/50">
              Attendance Manager
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.1em] opacity-60">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.label}
                      render={<Link href={item.href} />}
                    >
                      <item.icon className="size-[18px]" strokeWidth={1.7} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => signOut({ callbackUrl: "/login" })}
              tooltip="Sign out"
            >
              <LogOutIcon className="size-[18px]" strokeWidth={1.7} />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
