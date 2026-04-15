// ─── BioTime API response types ─────────────────────────────────────────────

export interface BioTimeEmployee {
  id: number;
  emp_code: string;
  first_name: string;
  last_name: string;
  department?: { id: number; dept_name: string };
}

export interface BioTimeTransaction {
  id: number;
  emp_code: string;
  punch_time: string; // ISO datetime from BioTime
  punch_state: string; // '0'=in, '1'=out
  verify_type: number;
  terminal_sn: string;
}

export interface BioTimeTerminal {
  id: number;
  sn: string;
  alias: string;
  ip_address: string;
  state: number; // 1=online, 0=offline
  last_activity: string;
}

export interface BioTimePaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  code: number;
  msg: string;
  data: T[];
}

export interface BioTimeError {
  detail?: string;
  non_field_errors?: string[];
}

// ─── Sync result types ──────────────────────────────────────────────────────

export interface EmployeeSyncResult {
  total: number;
  created: number;
  updated: number;
}

export interface TransactionSyncResult {
  total: number;
  inserted: number;
  skipped: number;
  affectedDays: string[]; // "empCode:YYYY-MM-DD" pairs
}

export interface SyncResult {
  employees: EmployeeSyncResult;
  transactions: TransactionSyncResult;
  syncedAt: string;
}

// ─── Connection status ──────────────────────────────────────────────────────

export interface BioTimeStatus {
  connected: boolean;
  lastSync: string | null;
  minutesAgo: number | null;
  isStale: boolean;
  lastError: string | null;
  syncInProgress: boolean;
}
