import {
  getTodayAttendance,
  getCompBalances,
  getPeriodTracker,
  getDashboardAlerts,
} from "@/lib/dashboard/queries";
import {
  todayColombiaISO,
  colAddDays,
  formatColombiaDateISO,
} from "@/lib/timezone";
import DashboardView from "./DashboardView";

export default async function DashboardPage() {
  const todayStr = todayColombiaISO();
  const lastWeekStr = formatColombiaDateISO(colAddDays(new Date(), -7));

  const [today, periodData, compBalances, alerts] = await Promise.all([
    getTodayAttendance(todayStr, lastWeekStr),
    getPeriodTracker(),
    getCompBalances(),
    getDashboardAlerts(todayStr),
  ]);

  return (
    <DashboardView
      today={today}
      periodData={periodData}
      compBalances={compBalances}
      alerts={alerts}
    />
  );
}
