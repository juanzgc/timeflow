"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { PlusIcon, TrashIcon, EyeIcon } from "lucide-react";
import Link from "next/link";
import { formatCOP, formatPeriodRange } from "@/lib/format";

type Period = {
  periodStart: string;
  periodEnd: string;
  status: string;
  employeeCount: number;
  totalSurcharges: number;
  firstId: number;
};

export default function PayrollPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newStatus, setNewStatus] = useState<"draft" | "test">("draft");
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchPeriods = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/payroll");
    if (res.ok) {
      setPeriods(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPeriods();
  }, [fetchPeriods]);

  const handleCreate = async () => {
    if (!newStart || !newEnd) return;
    setCreating(true);
    try {
      const res = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodStart: newStart,
          periodEnd: newEnd,
          status: newStatus,
        }),
      });
      if (res.ok) {
        setCreateOpen(false);
        setNewStart("");
        setNewEnd("");
        fetchPeriods();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (periodId: number) => {
    setDeleting(true);
    try {
      await fetch(`/api/payroll/${periodId}`, { method: "DELETE" });
      setDeleteId(null);
      fetchPeriods();
    } finally {
      setDeleting(false);
    }
  };

  const daysInPeriod = (start: string, end: string) => {
    const s = new Date(start + "T00:00:00");
    const e = new Date(end + "T00:00:00");
    return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  };

  const statusStyle = (status: string) => {
    const map: Record<string, { color: string; bg: string }> = {
      draft: { color: "var(--muted-foreground)", bg: "var(--secondary)" },
      finalized: { color: "var(--success-text)", bg: "var(--success-bg)" },
      exported: { color: "var(--info-text)", bg: "var(--info-bg)" },
      test: { color: "var(--warning-text)", bg: "var(--warning-bg)" },
    };
    return map[status] ?? map.draft;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.04em]">
            Payroll
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Pay period summaries with surcharge breakdown and comp decisions.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
            <PlusIcon className="size-4" />
            Create Period
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Pay Period</DialogTitle>
              <DialogDescription>
                This will run the reconciler for all active employees in the date
                range.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Period Start
                </label>
                <Input
                  type="date"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Period End
                </label>
                <Input
                  type="date"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Type
                </label>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="periodType"
                      checked={newStatus === "draft"}
                      onChange={() => setNewStatus("draft")}
                      className="accent-primary"
                    />
                    Regular
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="periodType"
                      checked={newStatus === "test"}
                      onChange={() => setNewStatus("test")}
                      className="accent-primary"
                    />
                    Test
                  </label>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={creating || !newStart || !newEnd}>
                {creating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Period List */}
      <Card>
        <CardHeader className="border-b px-5 py-3.5">
          <CardTitle className="text-sm font-bold tracking-[-0.01em]">
            Pay Periods
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({periods.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              Loading...
            </div>
          ) : periods.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              No pay periods created yet.
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateOpen(true)}
              >
                Create Period
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead className="w-16">Days</TableHead>
                  <TableHead className="w-24">Employees</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead className="w-32">Total Surcharges</TableHead>
                  <TableHead className="w-28">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((p) => {
                  const ss = statusStyle(p.status);
                  return (
                    <TableRow key={`${p.periodStart}-${p.periodEnd}`}>
                      <TableCell className="text-[13px] font-semibold">
                        {formatPeriodRange(p.periodStart, p.periodEnd)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {daysInPeriod(p.periodStart, p.periodEnd)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {p.employeeCount}
                      </TableCell>
                      <TableCell>
                        <span
                          className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize"
                          style={{ color: ss.color, backgroundColor: ss.bg }}
                        >
                          {p.status}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold">
                        {formatCOP(p.totalSurcharges)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Link href={`/payroll/${p.firstId}`}>
                            <Button variant="ghost" size="icon-xs">
                              <EyeIcon className="size-3.5" />
                            </Button>
                          </Link>
                          {(p.status === "draft" || p.status === "test") && (
                            <Dialog
                              open={deleteId === p.firstId}
                              onOpenChange={(open) =>
                                setDeleteId(open ? p.firstId : null)
                              }
                            >
                              <DialogTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="text-danger hover:text-danger"
                                  />
                                }
                              >
                                <TrashIcon className="size-3.5" />
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Delete Period</DialogTitle>
                                  <DialogDescription>
                                    This will delete all payroll records for{" "}
                                    {formatPeriodRange(p.periodStart, p.periodEnd)}.
                                    Comp transactions will be reversed.
                                  </DialogDescription>
                                </DialogHeader>
                                <DialogFooter>
                                  <Button
                                    variant="outline"
                                    onClick={() => setDeleteId(null)}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    variant="destructive"
                                    onClick={() => handleDelete(p.firstId)}
                                    disabled={deleting}
                                  >
                                    {deleting ? "Deleting..." : "Delete"}
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
