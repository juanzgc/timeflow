"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { MoreHorizontalIcon, CopyIcon, Trash2Icon, EraserIcon } from "lucide-react";
import { COL_TZ } from "@/lib/timezone";

export function ScheduleActions({
  weekStart,
  groupName,
  scheduleId,
  onCopyPrevious,
  onClearAll,
  onDelete,
}: {
  weekStart: string;
  groupName: string;
  scheduleId: number | null;
  onCopyPrevious: () => Promise<void>;
  onClearAll: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [confirmAction, setConfirmAction] = useState<
    "copy" | "clear" | "delete" | null
  >(null);
  const [loading, setLoading] = useState(false);

  const prevMonday = new Date(weekStart + "T12:00:00");
  const prevMondayShifted = new Date(prevMonday.getTime() - 7 * 86400000);
  const prevWeekLabel = `${prevMondayShifted.toLocaleDateString("es-CO", { month: "short", day: "numeric", timeZone: COL_TZ })} – ${new Date(prevMondayShifted.getTime() + 6 * 86400000).toLocaleDateString("es-CO", { month: "short", day: "numeric", timeZone: COL_TZ })}`;

  const currentMonday = new Date(weekStart + "T12:00:00");
  const currentWeekLabel = `${currentMonday.toLocaleDateString("es-CO", { month: "short", day: "numeric", timeZone: COL_TZ })} – ${new Date(currentMonday.getTime() + 6 * 86400000).toLocaleDateString("es-CO", { month: "short", day: "numeric", timeZone: COL_TZ })}`;

  const confirmMessages = {
    copy: `Esto copiará todos los turnos de ${prevWeekLabel} a ${currentWeekLabel} para ${groupName}. ¿Continuar?`,
    clear: `Esto eliminará todos los turnos de ${currentWeekLabel} para ${groupName}. Esta acción no se puede deshacer.`,
    delete: `Esto eliminará el horario completo de ${currentWeekLabel} para ${groupName}, incluyendo todos los turnos. Esta acción no se puede deshacer.`,
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      if (confirmAction === "copy") await onCopyPrevious();
      else if (confirmAction === "clear") await onClearAll();
      else if (confirmAction === "delete") await onDelete();
    } finally {
      setLoading(false);
      setConfirmAction(null);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm">
              <MoreHorizontalIcon className="mr-1.5 size-4" />
              Acciones
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setConfirmAction("copy")}>
            <CopyIcon className="mr-2 size-4" />
            Copiar de semana anterior
          </DropdownMenuItem>
          {scheduleId && (
            <>
              <DropdownMenuItem onClick={() => setConfirmAction("clear")}>
                <EraserIcon className="mr-2 size-4" />
                Limpiar todos los turnos
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-danger focus:text-danger"
                onClick={() => setConfirmAction("delete")}
              >
                <Trash2Icon className="mr-2 size-4" />
                Eliminar horario
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={!!confirmAction}
        onOpenChange={(o) => !o && setConfirmAction(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {confirmAction === "copy"
                ? "Copiar semana anterior"
                : confirmAction === "clear"
                  ? "Limpiar todos los turnos"
                  : "Eliminar horario"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmAction && confirmMessages[confirmAction]}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmAction(null)}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              variant={confirmAction === "delete" ? "destructive" : "default"}
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading
                ? "Procesando..."
                : confirmAction === "copy"
                  ? "Copiar"
                  : confirmAction === "clear"
                    ? "Limpiar"
                    : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
