"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PlusIcon,
  XIcon,
  RotateCcwIcon,
  SaveIcon,
  UserPlusIcon,
  ShieldOffIcon,
  PencilIcon,
  CheckIcon,
  UsersIcon,
} from "lucide-react";

type Group = {
  id: number;
  name: string;
  employeeCount: number;
};
type Holiday = { date: string; name: string };
type AdminUser = {
  id: number;
  username: string;
  email: string | null;
  displayName: string | null;
  role: string;
  isActive: boolean;
  lastLogin: string | null;
};

export default function SettingsPage() {
  // ── Groups ──────────────────────────────────────────────
  const [groupsList, setGroupsList] = useState<Group[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [savingGroupId, setSavingGroupId] = useState<number | null>(null);

  // ── General settings ──────────────────────────────────
  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({});
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  // ── Holidays ──────────────────────────────────────────
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loadingHolidays, setLoadingHolidays] = useState(true);
  const [addHolidayOpen, setAddHolidayOpen] = useState(false);
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");
  const [resettingHolidays, setResettingHolidays] = useState(false);

  // ── Admin users ───────────────────────────────────────
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newRole, setNewRole] = useState("admin");
  const [creatingUser, setCreatingUser] = useState(false);

  // ── Fetch all data ────────────────────────────────────
  const fetchGroups = useCallback(async () => {
    setLoadingGroups(true);
    const res = await fetch("/api/groups");
    if (res.ok) setGroupsList(await res.json());
    setLoadingGroups(false);
  }, []);

  const fetchSettings = useCallback(async () => {
    setLoadingSettings(true);
    const res = await fetch("/api/settings");
    if (res.ok) setSettingsMap(await res.json());
    setLoadingSettings(false);
  }, []);

  const fetchHolidays = useCallback(async () => {
    setLoadingHolidays(true);
    const res = await fetch("/api/settings/holidays?year=2026");
    if (res.ok) setHolidays(await res.json());
    setLoadingHolidays(false);
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    const res = await fetch("/api/admin-users");
    if (res.ok) setUsers(await res.json());
    setLoadingUsers(false);
  }, []);

  useEffect(() => {
    fetchGroups();
    fetchSettings(); // eslint-disable-line react-hooks/set-state-in-effect -- initial data fetch
    fetchHolidays();
    fetchUsers();
  }, [fetchGroups, fetchSettings, fetchHolidays, fetchUsers]);

  // ── Group handlers ───────────────────────────────────
  const addGroup = async () => {
    if (!newGroupName.trim()) return;
    setCreatingGroup(true);
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newGroupName.trim() }),
    });
    if (res.ok) {
      setAddGroupOpen(false);
      setNewGroupName("");
      fetchGroups();
    }
    setCreatingGroup(false);
  };

  const renameGroup = async (id: number) => {
    if (!editingGroupName.trim()) return;
    setSavingGroupId(id);
    const res = await fetch(`/api/groups/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingGroupName.trim() }),
    });
    if (res.ok) {
      setEditingGroupId(null);
      setEditingGroupName("");
      fetchGroups();
    }
    setSavingGroupId(null);
  };

  // ── Handlers ──────────────────────────────────────────
  const updateSetting = (key: string, value: string) => {
    setSettingsMap((prev) => ({ ...prev, [key]: value }));
  };

  const saveDailyLimits = async () => {
    setSavingSettings(true);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        daily_limit_sun_thu: settingsMap["daily_limit_sun_thu"] || "420",
        daily_limit_fri_sat: settingsMap["daily_limit_fri_sat"] || "480",
      }),
    });
    setSavingSettings(false);
  };

  const saveSiigoConfig = async () => {
    setSavingSettings(true);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siigo_concept_hed: settingsMap["siigo_concept_hed"] || "HED",
        siigo_concept_hen: settingsMap["siigo_concept_hen"] || "HEN",
        siigo_concept_rn: settingsMap["siigo_concept_rn"] || "RN",
        siigo_concept_rf: settingsMap["siigo_concept_rf"] || "RF",
        siigo_concept_rfn: settingsMap["siigo_concept_rfn"] || "RFN",
        siigo_include_valor: settingsMap["siigo_include_valor"] || "true",
        siigo_identification_field:
          settingsMap["siigo_identification_field"] || "cedula",
      }),
    });
    setSavingSettings(false);
  };

  const addHoliday = async () => {
    if (!newHolidayDate || !newHolidayName) return;
    const res = await fetch("/api/settings/holidays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: newHolidayDate,
        name: newHolidayName,
        year: 2026,
      }),
    });
    if (res.ok) {
      setHolidays(await res.json());
      setAddHolidayOpen(false);
      setNewHolidayDate("");
      setNewHolidayName("");
    }
  };

  const removeHoliday = async (date: string) => {
    const res = await fetch(`/api/settings/holidays/${date}?year=2026`, {
      method: "DELETE",
    });
    if (res.ok) setHolidays(await res.json());
  };

  const resetHolidays = async () => {
    setResettingHolidays(true);
    const res = await fetch("/api/settings/holidays/reset?year=2026", {
      method: "POST",
    });
    if (res.ok) setHolidays(await res.json());
    setResettingHolidays(false);
  };

  const createUser = async () => {
    if (!newUsername || !newPassword) return;
    setCreatingUser(true);
    const res = await fetch("/api/admin-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: newUsername,
        email: newEmail || undefined,
        password: newPassword,
        displayName: newDisplayName || newUsername,
        role: newRole,
      }),
    });
    if (res.ok) {
      setCreateUserOpen(false);
      setNewUsername("");
      setNewEmail("");
      setNewPassword("");
      setNewDisplayName("");
      setNewRole("admin");
      fetchUsers();
    }
    setCreatingUser(false);
  };

  const disableUser = async (id: number) => {
    await fetch(`/api/admin-users/${id}/disable`, { method: "PUT" });
    fetchUsers();
  };

  const enableUser = async (id: number) => {
    await fetch(`/api/admin-users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: true }),
    });
    fetchUsers();
  };

  if (loadingSettings) {
    return (
      <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
        Cargando configuración...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-[22px] font-extrabold tracking-[-0.04em]">
          Configuración
        </h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Grupos de empleados, límites diarios, exportación Siigo, festivos y
          gestión de usuarios.
        </p>
      </div>

      {/* ── Employee Groups ───────────────────────────────── */}
      <Card>
        <CardHeader className="border-b px-5 py-3.5">
          <CardTitle className="flex items-center justify-between text-sm font-bold tracking-[-0.01em]">
            Grupos de empleados
            <Dialog open={addGroupOpen} onOpenChange={setAddGroupOpen}>
              <DialogTrigger
                render={<Button size="sm" className="gap-1.5 text-xs" />}
              >
                <PlusIcon className="size-3.5" />
                Agregar grupo
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Agregar grupo</DialogTitle>
                  <DialogDescription>
                    Crear un nuevo grupo de empleados.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Nombre del grupo
                    </label>
                    <Input
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      className="text-sm"
                      placeholder="Ej: Cocina, Bar, etc."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addGroup();
                      }}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={addGroup}
                    disabled={creatingGroup || !newGroupName.trim()}
                  >
                    {creatingGroup ? "Creando..." : "Crear"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingGroups ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              Cargando...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="w-32">Empleados</TableHead>
                  <TableHead className="w-24">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupsList.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>
                      {editingGroupId === g.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editingGroupName}
                            onChange={(e) =>
                              setEditingGroupName(e.target.value)
                            }
                            className="h-7 w-48 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") renameGroup(g.id);
                              if (e.key === "Escape") {
                                setEditingGroupId(null);
                                setEditingGroupName("");
                              }
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => renameGroup(g.id)}
                            disabled={
                              savingGroupId === g.id ||
                              !editingGroupName.trim()
                            }
                          >
                            <CheckIcon className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => {
                              setEditingGroupId(null);
                              setEditingGroupName("");
                            }}
                          >
                            <XIcon className="size-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs font-semibold">
                          {g.name}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <UsersIcon className="size-3" />
                        {g.employeeCount}
                      </span>
                    </TableCell>
                    <TableCell>
                      {editingGroupId !== g.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-xs"
                          onClick={() => {
                            setEditingGroupId(g.id);
                            setEditingGroupName(g.name);
                          }}
                        >
                          <PencilIcon className="size-3" />
                          Renombrar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {groupsList.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="py-6 text-center text-xs text-muted-foreground"
                    >
                      No hay grupos configurados.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Daily Limits & Overtime ───────────────────────── */}
      <Card>
        <CardHeader className="border-b px-5 py-3.5">
          <CardTitle className="text-sm font-bold tracking-[-0.01em]">
            Límites diarios y horas extra
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Límite diario dom–jue (minutos)
              </label>
              <Input
                type="number"
                value={settingsMap["daily_limit_sun_thu"] || "420"}
                onChange={(e) =>
                  updateSetting("daily_limit_sun_thu", e.target.value)
                }
                className="w-32 text-sm"
              />
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Por defecto: 420 (7h)
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Límite diario vie–sáb (minutos)
              </label>
              <Input
                type="number"
                value={settingsMap["daily_limit_fri_sat"] || "480"}
                onChange={(e) =>
                  updateSetting("daily_limit_fri_sat", e.target.value)
                }
                className="w-32 text-sm"
              />
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Por defecto: 480 (8h)
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={saveDailyLimits}
            disabled={savingSettings}
            className="gap-1.5"
          >
            <SaveIcon className="size-3.5" />
            {savingSettings ? "Guardando..." : "Guardar"}
          </Button>
        </CardContent>
      </Card>

      {/* ── Siigo Export Configuration ────────────────────── */}
      <Card>
        <CardHeader className="border-b px-5 py-3.5">
          <CardTitle className="text-sm font-bold tracking-[-0.01em]">
            Configuración de exportación Siigo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Campo de identificación
              </label>
              <Select
                value={
                  settingsMap["siigo_identification_field"] || "cedula"
                }
                onValueChange={(v) =>
                  updateSetting(
                    "siigo_identification_field",
                    v ?? "cedula",
                  )
                }
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cedula">Cédula</SelectItem>
                  <SelectItem value="emp_code">Código empleado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 pt-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={
                    settingsMap["siigo_include_valor"] !== "false"
                  }
                  onChange={(e) =>
                    updateSetting(
                      "siigo_include_valor",
                      e.target.checked ? "true" : "false",
                    )
                  }
                  className="accent-primary"
                />
                Incluir columna de valor calculado
              </label>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">
              Mapeo de códigos de concepto
            </label>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  key: "siigo_concept_hed",
                  label: "Hora extra diurna (HED)",
                  default: "HED",
                },
                {
                  key: "siigo_concept_hen",
                  label: "Hora extra nocturna (HEN)",
                  default: "HEN",
                },
                {
                  key: "siigo_concept_rn",
                  label: "Recargo nocturno (RN)",
                  default: "RN",
                },
                {
                  key: "siigo_concept_rf",
                  label: "Recargo festivo diurno (RF)",
                  default: "RF",
                },
                {
                  key: "siigo_concept_rfn",
                  label: "Recargo festivo nocturno (RFN)",
                  default: "RFN",
                },
              ].map((c) => (
                <div key={c.key}>
                  <label className="mb-0.5 block text-[11px] text-muted-foreground">
                    {c.label}
                  </label>
                  <Input
                    value={settingsMap[c.key] || c.default}
                    onChange={(e) => updateSetting(c.key, e.target.value)}
                    className="w-24 font-mono text-sm"
                    placeholder={c.default}
                  />
                </div>
              ))}
            </div>
          </div>

          <Button
            size="sm"
            onClick={saveSiigoConfig}
            disabled={savingSettings}
            className="gap-1.5"
          >
            <SaveIcon className="size-3.5" />
            {savingSettings ? "Guardando..." : "Guardar"}
          </Button>
        </CardContent>
      </Card>

      {/* ── Holiday Management ────────────────────────────── */}
      <Card>
        <CardHeader className="border-b px-5 py-3.5">
          <CardTitle className="flex items-center justify-between text-sm font-bold tracking-[-0.01em]">
            Gestión de festivos — 2026
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={resetHolidays}
                disabled={resettingHolidays}
                className="gap-1.5 text-xs"
              >
                <RotateCcwIcon className="size-3" />
                Restablecer por defecto
              </Button>
              <Dialog
                open={addHolidayOpen}
                onOpenChange={setAddHolidayOpen}
              >
                <DialogTrigger
                  render={
                    <Button size="sm" className="gap-1.5 text-xs" />
                  }
                >
                  <PlusIcon className="size-3.5" />
                  Agregar festivo
                </DialogTrigger>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Agregar festivo</DialogTitle>
                    <DialogDescription>
                      Agregar una fecha de festivo personalizada para 2026.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Fecha
                      </label>
                      <Input
                        type="date"
                        value={newHolidayDate}
                        onChange={(e) => setNewHolidayDate(e.target.value)}
                        className="text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Nombre
                      </label>
                      <Input
                        value={newHolidayName}
                        onChange={(e) => setNewHolidayName(e.target.value)}
                        className="text-sm"
                        placeholder="Nombre del festivo"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={addHoliday}
                      disabled={!newHolidayDate || !newHolidayName}
                    >
                      Agregar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingHolidays ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              Cargando...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.map((h) => (
                  <TableRow key={h.date}>
                    <TableCell className="font-mono text-xs">
                      {h.date}
                    </TableCell>
                    <TableCell className="text-xs">{h.name}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-danger hover:text-danger"
                        onClick={() => removeHoliday(h.date)}
                      >
                        <XIcon className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Admin Users ───────────────────────────────────── */}
      <Card>
        <CardHeader className="border-b px-5 py-3.5">
          <CardTitle className="flex items-center justify-between text-sm font-bold tracking-[-0.01em]">
            Usuarios administradores
            <Dialog
              open={createUserOpen}
              onOpenChange={setCreateUserOpen}
            >
              <DialogTrigger
                render={<Button size="sm" className="gap-1.5 text-xs" />}
              >
                <UserPlusIcon className="size-3.5" />
                Agregar usuario
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Crear usuario administrador</DialogTitle>
                  <DialogDescription>
                    Crear una nueva cuenta de administrador.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Usuario
                    </label>
                    <Input
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Email (opcional)
                    </label>
                    <Input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Nombre a mostrar
                    </label>
                    <Input
                      value={newDisplayName}
                      onChange={(e) => setNewDisplayName(e.target.value)}
                      className="text-sm"
                      placeholder={newUsername || "Nombre a mostrar"}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Contraseña
                    </label>
                    <Input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Rol
                    </label>
                    <Select
                      value={newRole}
                      onValueChange={(v) => setNewRole(v ?? "admin")}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="superadmin">
                          Superadmin
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={createUser}
                    disabled={creatingUser || !newUsername || !newPassword}
                  >
                    {creatingUser ? "Creando..." : "Crear"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingUsers ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              Cargando...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Nombre a mostrar</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead className="w-20">Estado</TableHead>
                  <TableHead className="w-24">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="text-xs font-semibold">
                      {u.username}
                    </TableCell>
                    <TableCell className="text-xs">
                      {u.displayName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <span
                        className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize"
                        style={{
                          color:
                            u.role === "superadmin"
                              ? "var(--primary)"
                              : "var(--muted-foreground)",
                          backgroundColor:
                            u.role === "superadmin"
                              ? "color-mix(in srgb, var(--primary) 10%, transparent)"
                              : "var(--secondary)",
                        }}
                      >
                        {u.role}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                        style={{
                          color: u.isActive
                            ? "var(--success-text)"
                            : "var(--danger-text)",
                          backgroundColor: u.isActive
                            ? "var(--success-bg)"
                            : "var(--danger-bg)",
                        }}
                      >
                        {u.isActive ? "Activo" : "Deshabilitado"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {u.isActive ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-xs text-danger hover:text-danger"
                          onClick={() => disableUser(u.id)}
                        >
                          <ShieldOffIcon className="size-3" />
                          Deshabilitar
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-xs"
                          onClick={() => enableUser(u.id)}
                        >
                          Habilitar
                        </Button>
                      )}
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
