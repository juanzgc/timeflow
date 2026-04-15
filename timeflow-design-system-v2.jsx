import { useState } from "react";

// ═══════════════════════════════════════════════════════════════════
//  TimeFlow Design System v2 — Modern Refined
//  Inspired by Linear, Vercel, Raycast aesthetic
//  Cool-toned, shadow-driven depth, vibrant accents
// ═══════════════════════════════════════════════════════════════════

const THEME = {
  fonts: {
    heading: "'Plus Jakarta Sans', sans-serif",
    body: "'Plus Jakarta Sans', sans-serif",
    mono: "'JetBrains Mono', monospace",
  },
  colors: {
    // Sidebar
    sidebarBg: "#101014",
    sidebarHover: "#1c1c22",
    sidebarActive: "#232329",
    sidebarText: "#6e6e7a",
    sidebarTextActive: "#ededef",
    sidebarBorder: "#1e1e26",

    // Accent (vibrant teal-cyan)
    accent: "#00b899",
    accentHover: "#00a387",
    accentMuted: "#0d3d35",
    accentGlow: "rgba(0, 184, 153, 0.12)",
    accentText: "#00b899",

    // Page
    pageBg: "#f5f5f7",
    cardBg: "#ffffff",
    cardBgHover: "#fafafa",
    cardBgElevated: "#ffffff",

    // Text
    textPrimary: "#111118",
    textSecondary: "#555568",
    textTertiary: "#9494a3",
    textQuaternary: "#bbbbc6",

    // Borders & shadows (shadow-driven, not border-driven)
    border: "rgba(0,0,0,0.06)",
    borderSubtle: "rgba(0,0,0,0.04)",
    shadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)",
    shadowMd: "0 4px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)",
    shadowLg: "0 8px 24px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04)",

    // Status
    success: "#00a86b",
    successBg: "#edfcf5",
    successBorder: "rgba(0, 168, 107, 0.15)",
    successText: "#037a4b",

    warning: "#e59500",
    warningBg: "#fef8ec",
    warningBorder: "rgba(229, 149, 0, 0.15)",
    warningText: "#9e6500",

    danger: "#e5484d",
    dangerBg: "#fef0f1",
    dangerBorder: "rgba(229, 72, 77, 0.15)",
    dangerText: "#c22d31",

    info: "#3e93de",
    infoBg: "#eef6fd",
    infoBorder: "rgba(62, 147, 222, 0.15)",
    infoText: "#1d6fb5",

    // Domain-specific
    nocturno: "#7c5cbf",
    nocturnoBg: "#f3f0fa",
    nocturnoBorder: "rgba(124, 92, 191, 0.15)",
    nocturnoText: "#5b3d99",

    festivo: "#e5484d",
    festivoBg: "#fef0f1",

    overtime: "#e59500",
    overtimeBg: "#fef8ec",

    // Group colors
    groupKitchen: "#e87040",
    groupServers: "#00b899",
    groupBar: "#7c5cbf",
    groupAdmin: "#3e93de",
  },
  radius: {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
  },
};

// ── Icons ──
const Icon = {
  Dashboard: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>,
  Clock: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Calendar: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  People: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  DollarSign: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  Settings: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852 1.002 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  Check: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  AlertTriangle: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  TrendUp: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  TrendDown: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>,
  Pencil: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Sync: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
};

export default function DesignSystemV2() {
  const [activeNav, setActiveNav] = useState("dashboard");
  const [activeGroup, setActiveGroup] = useState("all");

  const groupColors = { Kitchen: THEME.colors.groupKitchen, Servers: THEME.colors.groupServers, Bar: THEME.colors.groupBar, Admin: THEME.colors.groupAdmin };

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: THEME.fonts.body, background: THEME.colors.pageBg, color: THEME.colors.textPrimary, fontSize: 14 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=JetBrains+Mono:wght@400;500&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.25); }
      `}</style>

      {/* ══════════ SIDEBAR ══════════ */}
      <nav style={{ width: 240, background: THEME.colors.sidebarBg, display: "flex", flexDirection: "column", padding: "16px 10px", flexShrink: 0, borderRight: `1px solid ${THEME.colors.sidebarBorder}` }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 10px", marginBottom: 32 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg, ${THEME.colors.accent}, #00d4aa)`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 2px 12px ${THEME.colors.accentGlow}` }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: THEME.colors.sidebarTextActive, letterSpacing: "-0.03em" }}>TimeFlow</div>
            <div style={{ fontSize: 10.5, color: THEME.colors.sidebarText, letterSpacing: "0.01em" }}>Attendance Manager</div>
          </div>
        </div>

        <div style={{ fontSize: 10, fontWeight: 600, color: THEME.colors.sidebarText, textTransform: "uppercase", letterSpacing: "0.1em", padding: "0 12px", marginBottom: 6, opacity: 0.6 }}>Navigation</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1 }}>
          {[
            { id: "dashboard", label: "Dashboard", icon: Icon.Dashboard },
            { id: "attendance", label: "Attendance", icon: Icon.Clock },
            { id: "schedules", label: "Schedules", icon: Icon.Calendar },
            { id: "employees", label: "Employees", icon: Icon.People },
            { id: "payroll", label: "Payroll", icon: Icon.DollarSign },
            { id: "settings", label: "Settings", icon: Icon.Settings },
          ].map((item) => {
            const isActive = activeNav === item.id;
            return (
              <button key={item.id} onClick={() => setActiveNav(item.id)} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
                background: isActive ? THEME.colors.sidebarActive : "transparent",
                border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: isActive ? 600 : 500,
                color: isActive ? THEME.colors.sidebarTextActive : THEME.colors.sidebarText,
                fontFamily: THEME.fonts.body, textAlign: "left", transition: "all .12s ease",
                position: "relative",
              }}>
                {isActive && <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 3, height: 16, borderRadius: 4, background: THEME.colors.accent }} />}
                <item.icon /><span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Sync status */}
        <div style={{ padding: "12px", borderTop: `1px solid ${THEME.colors.sidebarBorder}`, marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: THEME.colors.accent, boxShadow: `0 0 8px ${THEME.colors.accentGlow}` }} />
            <span style={{ fontSize: 11.5, fontWeight: 500, color: THEME.colors.sidebarText }}>BioTime synced</span>
            <span style={{ fontSize: 10.5, color: THEME.colors.sidebarText, opacity: 0.5, marginLeft: "auto" }}>2m ago</span>
          </div>
        </div>
      </nav>

      {/* ══════════ MAIN ══════════ */}
      <main style={{ flex: 1, overflow: "auto" }}>
        {/* Header */}
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 32px 0" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.04em", color: THEME.colors.textPrimary }}>Dashboard</h1>
            <p style={{ fontSize: 13, color: THEME.colors.textTertiary, marginTop: 1, fontWeight: 400 }}>Monday, April 14, 2026 — Period: Mar 28 – Apr 12</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: THEME.colors.cardBg, border: `1px solid ${THEME.colors.border}`, borderRadius: THEME.radius.md, cursor: "pointer", fontFamily: THEME.fonts.body, fontSize: 12.5, color: THEME.colors.textTertiary, boxShadow: THEME.colors.shadow }}>
              <Icon.Sync /> Sync now
            </button>
            <div style={{ width: 34, height: 34, borderRadius: THEME.radius.md, background: `linear-gradient(135deg, ${THEME.colors.accent}, #00d4aa)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12.5, fontWeight: 700, boxShadow: `0 2px 8px ${THEME.colors.accentGlow}` }}>JD</div>
          </div>
        </header>

        <div style={{ padding: "18px 32px 40px" }}>

          {/* ══════════ KPI CARDS ══════════ */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Present Today", value: "22", sub: "of 26 employees", trend: "+2", up: true, accent: THEME.colors.accent },
              { label: "On Time", value: "82%", sub: "18 employees", trend: "+5%", up: true, accent: THEME.colors.success },
              { label: "Late Arrivals", value: "4", sub: "avg 12 min late", trend: "-1", up: true, accent: THEME.colors.warning },
              { label: "Pending Hours", value: "3.5h", sub: "overtime this period", trend: "+1.5h", up: false, accent: THEME.colors.nocturno },
            ].map((kpi, i) => (
              <div key={i} style={{ background: THEME.colors.cardBg, borderRadius: THEME.radius.xl, padding: "20px", boxShadow: THEME.colors.shadow, border: `1px solid ${THEME.colors.borderSubtle}`, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${kpi.accent}, transparent)`, opacity: 0.6 }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: THEME.colors.textTertiary }}>{kpi.label}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: kpi.up ? THEME.colors.successText : THEME.colors.dangerText, background: kpi.up ? THEME.colors.successBg : THEME.colors.dangerBg, padding: "2px 7px", borderRadius: 20 }}>
                    {kpi.up ? <Icon.TrendUp /> : <Icon.TrendDown />}{kpi.trend}
                  </span>
                </div>
                <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.04em", color: THEME.colors.textPrimary }}>{kpi.value}</span>
                <div style={{ fontSize: 12, color: THEME.colors.textQuaternary, marginTop: 4 }}>{kpi.sub}</div>
              </div>
            ))}
          </div>

          {/* ══════════ GROUP TABS ══════════ */}
          <div style={{ display: "flex", gap: 4, marginBottom: 14, background: THEME.colors.cardBg, padding: 4, borderRadius: THEME.radius.lg, boxShadow: THEME.colors.shadow, border: `1px solid ${THEME.colors.borderSubtle}`, width: "fit-content" }}>
            {[
              { key: "all", label: "All" },
              { key: "Kitchen", label: "Kitchen", color: THEME.colors.groupKitchen },
              { key: "Servers", label: "Servers", color: THEME.colors.groupServers },
              { key: "Bar", label: "Bar", color: THEME.colors.groupBar },
              { key: "Admin", label: "Admin", color: THEME.colors.groupAdmin },
            ].map((g) => (
              <button key={g.key} onClick={() => setActiveGroup(g.key)} style={{
                display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: THEME.radius.md, border: "none",
                background: activeGroup === g.key ? (g.color ? `${g.color}14` : THEME.colors.pageBg) : "transparent",
                color: activeGroup === g.key ? (g.color || THEME.colors.textPrimary) : THEME.colors.textTertiary,
                fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: THEME.fonts.body, transition: "all .12s ease",
              }}>
                {g.color && <span style={{ width: 6, height: 6, borderRadius: "50%", background: g.color, opacity: activeGroup === g.key ? 1 : 0.4 }} />}
                {g.label}
              </button>
            ))}
          </div>

          {/* ══════════ DATA TABLE ══════════ */}
          <div style={{ background: THEME.colors.cardBg, borderRadius: THEME.radius.xl, boxShadow: THEME.colors.shadow, border: `1px solid ${THEME.colors.borderSubtle}`, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: `1px solid ${THEME.colors.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: THEME.colors.textPrimary, letterSpacing: "-0.01em" }}>Today's Attendance</h3>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11.5, color: THEME.colors.textQuaternary }}>22/26 present</span>
                <div style={{ width: 60, height: 4, borderRadius: 10, background: THEME.colors.pageBg, overflow: "hidden" }}>
                  <div style={{ width: "85%", height: "100%", borderRadius: 10, background: THEME.colors.accent }} />
                </div>
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Employee", "Group", "Clock In", "Clock Out", "Worked", "Late", "Excess", "Status"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "10px 16px", fontSize: 10.5, fontWeight: 600, color: THEME.colors.textQuaternary, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${THEME.colors.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { name: "Carlos Restrepo", code: "1001", group: "Kitchen", clockIn: "8:00 AM", clockOut: "5:12 PM", worked: "8h 45m", late: null, excess: "+45m", status: "on-time", manual: false },
                  { name: "Valentina Ospina", code: "1002", group: "Bar", clockIn: "5:05 PM", clockOut: null, worked: "4h 10m", late: "5 min", excess: null, status: "late", manual: false },
                  { name: "Andrés Gutiérrez", code: "1003", group: "Servers", clockIn: "11:58 AM", clockOut: "10:30 PM", worked: "8h 32m", late: null, excess: "+32m", status: "on-time", manual: true },
                  { name: "Mariana López", code: "1004", group: "Admin", clockIn: null, clockOut: null, worked: null, late: null, excess: null, status: "absent", manual: false },
                  { name: "Santiago Moreno", code: "1005", group: "Kitchen", clockIn: "8:22 AM", clockOut: "5:00 PM", worked: "7h 38m", late: "22 min", excess: null, status: "late", manual: false },
                ].map((row, i) => {
                  const gc = groupColors[row.group];
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${THEME.colors.borderSubtle}`, transition: "background .1s", cursor: "pointer" }} onMouseOver={(e) => e.currentTarget.style.background = THEME.colors.cardBgHover} onMouseOut={(e) => e.currentTarget.style.background = "transparent"}>
                      <td style={{ padding: "11px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 32, height: 32, borderRadius: THEME.radius.md, background: `${gc}12`, color: gc, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700, flexShrink: 0 }}>
                            {row.name.split(" ").map(n => n[0]).join("")}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13, color: THEME.colors.textPrimary, letterSpacing: "-0.01em" }}>{row.name}</div>
                            <div style={{ fontSize: 11, color: THEME.colors.textQuaternary }}>#{row.code}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "11px 16px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: `${gc}10`, color: gc }}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: gc }} />
                          {row.group}
                        </span>
                      </td>
                      <td style={{ padding: "11px 16px", fontSize: 13, color: THEME.colors.textSecondary, fontFamily: THEME.fonts.mono, fontWeight: 500 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {row.clockIn || <span style={{ color: THEME.colors.textQuaternary }}>—</span>}
                          {row.manual && <span style={{ color: THEME.colors.warning, marginLeft: 2 }}><Icon.Pencil /></span>}
                        </span>
                      </td>
                      <td style={{ padding: "11px 16px", fontSize: 13, color: row.clockOut ? THEME.colors.textSecondary : THEME.colors.textQuaternary, fontFamily: THEME.fonts.mono, fontWeight: 500 }}>{row.clockOut || "—"}</td>
                      <td style={{ padding: "11px 16px", fontSize: 13, fontWeight: 600, color: THEME.colors.textPrimary, fontFamily: THEME.fonts.mono }}>{row.worked || "—"}</td>
                      <td style={{ padding: "11px 16px" }}>
                        {row.late ? (
                          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: THEME.colors.warningBg, color: THEME.colors.warningText, border: `1px solid ${THEME.colors.warningBorder}` }}>{row.late}</span>
                        ) : <span style={{ fontSize: 12, color: THEME.colors.textQuaternary }}>—</span>}
                      </td>
                      <td style={{ padding: "11px 16px" }}>
                        {row.excess ? (
                          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: THEME.colors.nocturnoBg, color: THEME.colors.nocturnoText, border: `1px solid ${THEME.colors.nocturnoBorder}` }}>{row.excess}</span>
                        ) : <span style={{ fontSize: 12, color: THEME.colors.textQuaternary }}>—</span>}
                      </td>
                      <td style={{ padding: "11px 16px" }}>
                        {row.status === "on-time" && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: THEME.colors.successText }}><Icon.Check /> On time</span>}
                        {row.status === "late" && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: THEME.colors.warningText }}><Icon.AlertTriangle /> Late</span>}
                        {row.status === "absent" && <span style={{ fontSize: 12, fontWeight: 600, color: THEME.colors.dangerText }}>Absent</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ══════════ ALERTS & PERIOD TRACKER ══════════ */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
            {/* Missing punches */}
            <div style={{ background: THEME.colors.warningBg, borderRadius: THEME.radius.xl, padding: "16px 20px", border: `1px solid ${THEME.colors.warningBorder}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                <div style={{ width: 24, height: 24, borderRadius: 8, background: `${THEME.colors.warning}20`, display: "flex", alignItems: "center", justifyContent: "center", color: THEME.colors.warningText }}><Icon.AlertTriangle /></div>
                <span style={{ fontSize: 13, fontWeight: 700, color: THEME.colors.warningText }}>Missing Punches</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: THEME.colors.warningText, opacity: 0.6, background: `${THEME.colors.warning}18`, padding: "1px 7px", borderRadius: 20, marginLeft: "auto" }}>2</span>
              </div>
              {["Valentina Ospina — no clock-out", "Diego Ríos — no clock-in"].map((alert, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: i > 0 ? `1px solid ${THEME.colors.warningBorder}` : "none" }}>
                  <span style={{ fontSize: 12.5, color: THEME.colors.warningText, fontWeight: 500 }}>{alert}</span>
                  <button style={{ padding: "4px 12px", borderRadius: 20, border: "none", background: "white", color: THEME.colors.warningText, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: THEME.fonts.body, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>Fix</button>
                </div>
              ))}
            </div>

            {/* Period tracker */}
            <div style={{ background: THEME.colors.cardBg, borderRadius: THEME.radius.xl, padding: "16px 20px", boxShadow: THEME.colors.shadow, border: `1px solid ${THEME.colors.borderSubtle}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: THEME.colors.textPrimary }}>Period Hours</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: THEME.colors.accent, background: THEME.colors.accentGlow, padding: "3px 10px", borderRadius: 20 }}>Mar 28 – Apr 12</span>
              </div>
              {[
                { name: "Carlos R.", expected: 88, actual: 91 },
                { name: "Valentina O.", expected: 88, actual: 82 },
                { name: "Andrés G.", expected: 96, actual: 96 },
              ].map((emp, i) => {
                const pct = Math.min((emp.actual / emp.expected) * 100, 110);
                const isOver = emp.actual > emp.expected;
                return (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: THEME.colors.textSecondary, fontWeight: 500 }}>{emp.name}</span>
                      <span style={{ fontFamily: THEME.fonts.mono, fontWeight: 600, fontSize: 11.5, color: isOver ? THEME.colors.warningText : THEME.colors.textPrimary }}>{emp.actual}h <span style={{ color: THEME.colors.textQuaternary, fontWeight: 400 }}>/ {emp.expected}h</span></span>
                    </div>
                    <div style={{ height: 4, borderRadius: 10, background: THEME.colors.pageBg, overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", borderRadius: 10, background: isOver ? THEME.colors.warning : THEME.colors.accent, transition: "width .3s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ══════════ SCHEDULE GRID ══════════ */}
          <div style={{ background: THEME.colors.cardBg, borderRadius: THEME.radius.xl, boxShadow: THEME.colors.shadow, border: `1px solid ${THEME.colors.borderSubtle}`, marginTop: 16, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: `1px solid ${THEME.colors.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: THEME.colors.textPrimary }}>Schedule — Week of Apr 13</h3>
              <button style={{ padding: "6px 14px", borderRadius: THEME.radius.md, border: "none", background: THEME.colors.accent, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: THEME.fonts.body }}>Edit Schedule</button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 16px", fontSize: 10.5, fontWeight: 600, color: THEME.colors.textQuaternary, textTransform: "uppercase", letterSpacing: "0.06em", width: 160, borderBottom: `1px solid ${THEME.colors.border}` }}>Employee</th>
                    {["Mon 13", "Tue 14", "Wed 15", "Thu 16", "Fri 17", "Sat 18", "Sun 19"].map((d, i) => (
                      <th key={d} style={{ textAlign: "center", padding: "10px 6px", fontSize: 10.5, fontWeight: 600, color: i >= 5 ? THEME.colors.accent : THEME.colors.textQuaternary, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: `1px solid ${THEME.colors.border}` }}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "Carlos R.", group: "Kitchen", shifts: [["8-17"], ["8-17"], ["8-17"], "OFF", ["8-17"], ["8-14"], "OFF"] },
                    { name: "Valentina O.", group: "Bar", shifts: [["17-2"], ["17-2"], "OFF", ["17-2"], ["17-2"], ["17-2"], "OFF"] },
                    { name: "Andrés G.", group: "Servers", shifts: [["12-16", "18-22"], ["12-16", "18-22"], ["12-16", "18-22"], ["12-16", "18-22"], ["12-16", "18-22"], ["12-16", "18-22"], "OFF"] },
                    { name: "Mariana L.", group: "Admin", shifts: ["OFF", ["8-17"], ["8-17"], ["8-17"], ["8-17"], "OFF", "COMP"] },
                  ].map((row, ri) => {
                    const gc = groupColors[row.group];
                    return (
                      <tr key={ri} style={{ borderBottom: `1px solid ${THEME.colors.borderSubtle}` }}>
                        <td style={{ padding: "10px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 5, height: 5, borderRadius: "50%", background: gc, flexShrink: 0 }} />
                            <span style={{ fontSize: 13, fontWeight: 600, color: THEME.colors.textPrimary }}>{row.name}</span>
                          </div>
                        </td>
                        {row.shifts.map((s, si) => (
                          <td key={si} style={{ textAlign: "center", padding: "6px 4px" }}>
                            {s === "OFF" ? (
                              <span style={{ fontSize: 11, fontWeight: 500, color: THEME.colors.textQuaternary }}>OFF</span>
                            ) : s === "COMP" ? (
                              <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 20, fontSize: 10.5, fontWeight: 600, background: THEME.colors.infoBg, color: THEME.colors.infoText, border: `1px solid ${THEME.colors.infoBorder}` }}>COMP</span>
                            ) : Array.isArray(s) && s.length > 1 ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
                                {s.map((seg, k) => (
                                  <span key={k} style={{ display: "inline-block", padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 600, background: THEME.colors.accentGlow, color: THEME.colors.accent, fontFamily: THEME.fonts.mono }}>{seg}</span>
                                ))}
                              </div>
                            ) : Array.isArray(s) && parseInt(s[0].split("-")[1]) < parseInt(s[0].split("-")[0]) ? (
                              <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 6, fontSize: 10.5, fontWeight: 600, background: THEME.colors.nocturnoBg, color: THEME.colors.nocturnoText, fontFamily: THEME.fonts.mono, border: `1px solid ${THEME.colors.nocturnoBorder}` }}>{s[0]}</span>
                            ) : (
                              <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 6, fontSize: 10.5, fontWeight: 600, background: THEME.colors.pageBg, color: THEME.colors.textSecondary, fontFamily: THEME.fonts.mono }}>{s[0]}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ══════════ COMP BALANCES & BUTTONS ══════════ */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
            <div style={{ background: THEME.colors.cardBg, borderRadius: THEME.radius.xl, padding: "16px 20px", boxShadow: THEME.colors.shadow, border: `1px solid ${THEME.colors.borderSubtle}` }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: THEME.colors.textPrimary, marginBottom: 14 }}>Comp Time Balances</h3>
              {[
                { name: "Carlos R.", balance: 14 },
                { name: "Valentina O.", balance: -3 },
                { name: "Andrés G.", balance: 7 },
                { name: "Mariana L.", balance: 0 },
              ].map((emp, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: i > 0 ? `1px solid ${THEME.colors.borderSubtle}` : "none" }}>
                  <span style={{ fontSize: 12.5, color: THEME.colors.textSecondary, fontWeight: 500 }}>{emp.name}</span>
                  <span style={{
                    fontSize: 13, fontWeight: 700, fontFamily: THEME.fonts.mono,
                    padding: "2px 10px", borderRadius: 20,
                    color: emp.balance > 0 ? THEME.colors.successText : emp.balance < 0 ? THEME.colors.dangerText : THEME.colors.textQuaternary,
                    background: emp.balance > 0 ? THEME.colors.successBg : emp.balance < 0 ? THEME.colors.dangerBg : "transparent",
                    border: emp.balance !== 0 ? `1px solid ${emp.balance > 0 ? THEME.colors.successBorder : THEME.colors.dangerBorder}` : "none",
                  }}>
                    {emp.balance > 0 ? "+" : ""}{emp.balance}h
                  </span>
                </div>
              ))}
            </div>

            <div style={{ background: THEME.colors.cardBg, borderRadius: THEME.radius.xl, padding: "16px 20px", boxShadow: THEME.colors.shadow, border: `1px solid ${THEME.colors.borderSubtle}` }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: THEME.colors.textPrimary, marginBottom: 14 }}>Component Reference</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button style={{ padding: "9px 20px", borderRadius: THEME.radius.md, border: "none", background: THEME.colors.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: THEME.fonts.body, boxShadow: `0 2px 8px ${THEME.colors.accentGlow}` }}>Primary Action</button>
                <button style={{ padding: "9px 20px", borderRadius: THEME.radius.md, border: `1px solid ${THEME.colors.border}`, background: THEME.colors.cardBg, color: THEME.colors.textSecondary, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: THEME.fonts.body, boxShadow: THEME.colors.shadow }}>Secondary</button>
                <button style={{ padding: "9px 20px", borderRadius: THEME.radius.md, border: `1px solid ${THEME.colors.dangerBorder}`, background: THEME.colors.dangerBg, color: THEME.colors.dangerText, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: THEME.fonts.body }}>Danger Action</button>
                <div style={{ display: "flex", gap: 6 }}>
                  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: THEME.colors.successBg, color: THEME.colors.successText, border: `1px solid ${THEME.colors.successBorder}` }}>On time</span>
                  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: THEME.colors.warningBg, color: THEME.colors.warningText, border: `1px solid ${THEME.colors.warningBorder}` }}>5 min late</span>
                  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: THEME.colors.nocturnoBg, color: THEME.colors.nocturnoText, border: `1px solid ${THEME.colors.nocturnoBorder}` }}>+45m excess</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
