"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const DAY_OPTIONS = [
  { value: 0, label: "Lunes" },
  { value: 1, label: "Martes" },
  { value: 2, label: "Miércoles" },
  { value: 3, label: "Jueves" },
  { value: 4, label: "Viernes" },
  { value: 5, label: "Sábado" },
  { value: 6, label: "Domingo" },
];

interface EditEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  employee: {
    id: number;
    firstName: string;
    lastName: string;
    groupId: number | null;
    groupName: string | null;
    monthlySalary: string | null;
    cedula: string | null;
    restDay: number;
    isActive: boolean;
  };
  groups: Array<{ id: number; name: string }>;
}

export function EditEmployeeModal({
  isOpen,
  onClose,
  onSaved,
  employee,
  groups,
}: EditEmployeeModalProps) {
  const [groupId, setGroupId] = useState<number | null>(employee.groupId);
  const [salary, setSalary] = useState(employee.monthlySalary ?? "");
  const [cedula, setCedula] = useState(employee.cedula ?? "");
  const [restDay, setRestDay] = useState(employee.restDay);
  const [isActive, setIsActive] = useState(employee.isActive);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [groupWarning, setGroupWarning] = useState(false);

  useEffect(() => {
    setGroupId(employee.groupId);
    setSalary(employee.monthlySalary ?? "");
    setCedula(employee.cedula ?? "");
    setRestDay(employee.restDay);
    setIsActive(employee.isActive);
    setGroupWarning(false);
    setError("");
  }, [employee, isOpen]);

  const handleGroupChange = (val: number | null) => {
    setGroupId(val);
    if (val !== employee.groupId) {
      setGroupWarning(true);
    } else {
      setGroupWarning(false);
    }
  };

  const handleSave = async () => {
    setError("");

    if (salary && Number(salary) <= 0) {
      setError("El salario debe ser mayor a 0");
      return;
    }

    const updates: Record<string, unknown> = {};
    if (groupId !== employee.groupId) updates.groupId = groupId;
    if (salary !== (employee.monthlySalary ?? "")) updates.monthlySalary = salary || null;
    if (cedula !== (employee.cedula ?? "")) updates.cedula = cedula || null;
    if (restDay !== employee.restDay) updates.restDay = restDay;
    if (isActive !== employee.isActive) updates.isActive = isActive;

    if (Object.keys(updates).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Error al guardar");
        return;
      }

      onSaved();
      onClose();
    } catch {
      setError("Error de red");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Editar empleado — {employee.firstName} {employee.lastName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Group */}
          <div>
            <Label className="text-xs">Grupo</Label>
            <Select
              value={groupId ?? undefined}
              onValueChange={(val) => handleGroupChange(val as unknown as number)}
            >
              <SelectTrigger className="mt-1 w-full">
                <SelectValue placeholder="Seleccionar grupo" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {groupWarning && (
              <p className="mt-1 text-[10px] text-warning-text">
                Cambiar el grupo solo afecta horarios futuros. Las asignaciones existentes se conservan.
              </p>
            )}
          </div>

          {/* Salary */}
          <div>
            <Label className="text-xs">Salario mensual (COP)</Label>
            <Input
              type="number"
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              placeholder="ej. 2000000"
              className="mt-1 h-8 text-sm"
            />
          </div>

          {/* Cedula */}
          <div>
            <Label className="text-xs">Cédula</Label>
            <Input
              value={cedula}
              onChange={(e) => setCedula(e.target.value)}
              placeholder="ej. 1017234567"
              className="mt-1 h-8 text-sm"
            />
            {cedula && !/^\d{6,12}$/.test(cedula) && (
              <p className="mt-1 text-[10px] text-warning-text">
                La cédula debe tener entre 6 y 12 dígitos
              </p>
            )}
          </div>

          {/* Rest Day */}
          <div>
            <Label className="text-xs">Día de descanso</Label>
            <Select
              value={restDay}
              onValueChange={(val) => setRestDay(val as unknown as number)}
            >
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status */}
          <div>
            <Label className="text-xs">Estado</Label>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsActive(!isActive)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  isActive ? "bg-primary" : "bg-muted-foreground/30"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block size-4 rounded-full bg-white shadow transition-transform ${
                    isActive ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
              <span className="text-sm">{isActive ? "Activo" : "Inactivo"}</span>
            </div>
            {!isActive && (
              <p className="mt-1 text-[10px] text-warning-text">
                Desactivar ocultará a este empleado de todos los horarios y reportes. Los registros existentes se conservan.
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-md bg-danger-bg p-2 text-xs text-danger-text">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
