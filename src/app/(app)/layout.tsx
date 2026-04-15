import { SessionProvider } from "next-auth/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <header className="flex h-12 shrink-0 items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
            </header>
            <main className="flex-1 overflow-y-auto px-4 pb-10 sm:px-6 lg:px-8">{children}</main>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </SessionProvider>
  );
}
