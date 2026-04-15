"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { UsersIcon, CheckIcon, XIcon, PencilIcon } from "lucide-react";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Group = { id: number; name: string; createdAt: string };

type Employee = {
  id: number;
  empCode: string;
  cedula: string | null;
  firstName: string;
  lastName: string;
  groupId: number | null;
  groupName: string | null;
  monthlySalary: string | null;
  restDay: number;
  isActive: boolean;
};

type EditState = {
  employeeId: number;
  field: "groupId" | "monthlySalary" | "restDay" | "cedula";
} | null;

const GROUP_COLORS: Record<string, string> = {
  Kitchen: "var(--group-kitchen)",
  Servers: "var(--group-servers)",
  Bar: "var(--group-bar)",
  Admin: "var(--group-admin)",
};

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroup, setActiveGroup] = useState<string>("all");
  const [editing, setEditing] = useState<EditState>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const [empRes, grpRes] = await Promise.all([
      fetch("/api/employees"),
      fetch("/api/groups"),
    ]);
    const [empData, grpData] = await Promise.all([
      empRes.json(),
      grpRes.json(),
    ]);
    setEmployees(empData);
    setGroups(grpData);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData(); // eslint-disable-line react-hooks/set-state-in-effect -- initial data fetch
  }, [fetchData]);

  const filtered =
    activeGroup === "all"
      ? employees
      : activeGroup === "unassigned"
        ? employees.filter((e) => !e.groupId)
        : employees.filter((e) => e.groupId === Number(activeGroup));

  const startEdit = (
    employeeId: number,
    field: EditState extends null ? never : NonNullable<EditState>["field"],
    currentValue: string,
  ) => {
    setEditing({ employeeId, field });
    setEditValue(currentValue);
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditValue("");
  };

  const saveEdit = async () => {
    if (!editing) return;

    const body: Record<string, unknown> = {};
    if (editing.field === "groupId") {
      body.groupId = editValue === "null" ? null : Number(editValue);
    } else if (editing.field === "monthlySalary") {
      body.monthlySalary = editValue;
    } else if (editing.field === "restDay") {
      body.restDay = Number(editValue);
    } else if (editing.field === "cedula") {
      body.cedula = editValue || null;
    }

    await fetch(`/api/employees/${editing.employeeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    cancelEdit();
    fetchData();
  };

  const activeCount = employees.filter((e) => e.isActive).length;
  const unassignedCount = employees.filter((e) => !e.groupId).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-[-0.04em]">
          Employees
        </h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Employee directory synced from BioTime with group assignments.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="relative overflow-hidden">
          <div
            className="absolute top-0 left-0 right-0 h-0.5 opacity-60"
            style={{
              background:
                "linear-gradient(90deg, var(--primary), transparent)",
            }}
          />
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Total Employees
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-[32px] font-extrabold tracking-[-0.04em]">
              {loading ? "--" : employees.length}
            </div>
            <p className="text-xs text-muted-foreground/70">
              synced from BioTime
            </p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div
            className="absolute top-0 left-0 right-0 h-0.5 opacity-60"
            style={{
              background:
                "linear-gradient(90deg, var(--success), transparent)",
            }}
          />
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Active
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-[32px] font-extrabold tracking-[-0.04em]">
              {loading ? "--" : activeCount}
            </div>
            <p className="text-xs text-muted-foreground/70">
              currently active
            </p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div
            className="absolute top-0 left-0 right-0 h-0.5 opacity-60"
            style={{
              background:
                "linear-gradient(90deg, var(--warning), transparent)",
            }}
          />
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Unassigned
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-[32px] font-extrabold tracking-[-0.04em]">
              {loading ? "--" : unassignedCount}
            </div>
            <p className="text-xs text-muted-foreground/70">
              no group assigned
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Group filter tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <FilterTab
          label="All"
          count={employees.length}
          active={activeGroup === "all"}
          onClick={() => setActiveGroup("all")}
        />
        {groups.map((g) => (
          <FilterTab
            key={g.id}
            label={g.name}
            count={employees.filter((e) => e.groupId === g.id).length}
            color={GROUP_COLORS[g.name]}
            active={activeGroup === String(g.id)}
            onClick={() => setActiveGroup(String(g.id))}
          />
        ))}
        <FilterTab
          label="Unassigned"
          count={unassignedCount}
          active={activeGroup === "unassigned"}
          onClick={() => setActiveGroup("unassigned")}
        />
      </div>

      {/* Employee table */}
      <Card>
        <CardHeader className="border-b px-5 py-3.5">
          <CardTitle className="flex items-center gap-2 text-sm font-bold tracking-[-0.01em]">
            <UsersIcon className="size-4" />
            {activeGroup === "all"
              ? "All Employees"
              : activeGroup === "unassigned"
                ? "Unassigned Employees"
                : groups.find((g) => String(g.id) === activeGroup)?.name ??
                  "Employees"}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              ({filtered.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              Loading...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              No employees found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-28">Cedula</TableHead>
                  <TableHead className="w-32">Group</TableHead>
                  <TableHead className="w-32">Salary</TableHead>
                  <TableHead className="w-28">Rest Day</TableHead>
                  <TableHead className="w-20">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell className="font-mono text-xs">
                      {emp.empCode}
                    </TableCell>
                    <TableCell className="font-medium">
                      {emp.firstName} {emp.lastName}
                    </TableCell>

                    {/* Cedula — inline editable */}
                    <TableCell>
                      {editing?.employeeId === emp.id &&
                      editing.field === "cedula" ? (
                        <div className="flex items-center gap-1">
                          <Input
                            className="h-7 w-24 text-xs"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit();
                              if (e.key === "Escape") cancelEdit();
                            }}
                            autoFocus
                          />
                          <button
                            onClick={saveEdit}
                            className="text-success hover:text-success/80"
                          >
                            <CheckIcon className="size-3.5" />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <XIcon className="size-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            startEdit(emp.id, "cedula", emp.cedula ?? "")
                          }
                        >
                          <span>{emp.cedula || "—"}</span>
                          <PencilIcon className="size-3 opacity-0 group-hover:opacity-60" />
                        </button>
                      )}
                    </TableCell>

                    {/* Group — inline editable */}
                    <TableCell>
                      {editing?.employeeId === emp.id &&
                      editing.field === "groupId" ? (
                        <div className="flex items-center gap-1">
                          <Select
                            value={editValue}
                            onValueChange={(v) => {
                              setEditValue(v ?? "");
                            }}
                          >
                            <SelectTrigger className="h-7 w-28 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="null">Unassigned</SelectItem>
                              {groups.map((g) => (
                                <SelectItem key={g.id} value={String(g.id)}>
                                  {g.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <button
                            onClick={saveEdit}
                            className="text-success hover:text-success/80"
                          >
                            <CheckIcon className="size-3.5" />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <XIcon className="size-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="group flex items-center gap-1"
                          onClick={() =>
                            startEdit(
                              emp.id,
                              "groupId",
                              emp.groupId ? String(emp.groupId) : "null",
                            )
                          }
                        >
                          {emp.groupName ? (
                            <Badge
                              variant="secondary"
                              className="text-[11px] font-semibold"
                              style={{
                                color: GROUP_COLORS[emp.groupName],
                                backgroundColor: `color-mix(in srgb, ${GROUP_COLORS[emp.groupName] ?? "gray"} 10%, transparent)`,
                              }}
                            >
                              {emp.groupName}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Unassigned
                            </span>
                          )}
                          <PencilIcon className="size-3 opacity-0 group-hover:opacity-60" />
                        </button>
                      )}
                    </TableCell>

                    {/* Salary — inline editable */}
                    <TableCell>
                      {editing?.employeeId === emp.id &&
                      editing.field === "monthlySalary" ? (
                        <div className="flex items-center gap-1">
                          <Input
                            className="h-7 w-28 font-mono text-xs"
                            type="number"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit();
                              if (e.key === "Escape") cancelEdit();
                            }}
                            autoFocus
                          />
                          <button
                            onClick={saveEdit}
                            className="text-success hover:text-success/80"
                          >
                            <CheckIcon className="size-3.5" />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <XIcon className="size-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="group flex items-center gap-1 font-mono text-xs"
                          onClick={() =>
                            startEdit(
                              emp.id,
                              "monthlySalary",
                              emp.monthlySalary ?? "",
                            )
                          }
                        >
                          <span>
                            {emp.monthlySalary
                              ? `$${Number(emp.monthlySalary).toLocaleString("es-CO")}`
                              : "—"}
                          </span>
                          <PencilIcon className="size-3 opacity-0 group-hover:opacity-60" />
                        </button>
                      )}
                    </TableCell>

                    {/* Rest Day — inline editable */}
                    <TableCell>
                      {editing?.employeeId === emp.id &&
                      editing.field === "restDay" ? (
                        <div className="flex items-center gap-1">
                          <Select
                            value={editValue}
                            onValueChange={(v) => setEditValue(v ?? "")}
                          >
                            <SelectTrigger className="h-7 w-20 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DAY_LABELS.map((d, i) => (
                                <SelectItem key={i} value={String(i)}>
                                  {d}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <button
                            onClick={saveEdit}
                            className="text-success hover:text-success/80"
                          >
                            <CheckIcon className="size-3.5" />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <XIcon className="size-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="group flex items-center gap-1 text-xs"
                          onClick={() =>
                            startEdit(emp.id, "restDay", String(emp.restDay))
                          }
                        >
                          <span>{DAY_LABELS[emp.restDay]}</span>
                          <PencilIcon className="size-3 opacity-0 group-hover:opacity-60" />
                        </button>
                      )}
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className="text-[11px] font-semibold"
                        style={
                          emp.isActive
                            ? {
                                color: "var(--success-text)",
                                backgroundColor: "var(--success-bg)",
                              }
                            : {
                                color: "var(--danger-text)",
                                backgroundColor: "var(--danger-bg)",
                              }
                        }
                      >
                        {emp.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FilterTab({
  label,
  count,
  color,
  active,
  onClick,
}: {
  label: string;
  count: number;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${
        active
          ? "bg-foreground text-background"
          : "bg-card text-muted-foreground shadow-sm hover:text-foreground"
      }`}
    >
      {color && !active && (
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
      <span
        className={`text-[11px] ${active ? "text-background/60" : "text-muted-foreground/60"}`}
      >
        {count}
      </span>
    </button>
  );
}
