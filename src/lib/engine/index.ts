/**
 * Calculation Engine — Main Entry Point
 *
 * Orchestrates all 4 layers:
 *   Layer 1: Punch Resolver    — raw punches → business day records
 *   Layer 2: Punch Normalizer  — raw times → effective (payable) times
 *   Layer 3: Daily Classifier  — effective times → surcharge buckets
 *   Layer 4: Period Reconciler — daily records → period overtime & costs
 */

export { resolvePunches, type ResolvedPunches, type PunchLog, type ShiftSchedule } from "./punch-resolver";
export { normalizePunches, type NormalizedPunches } from "./punch-normalizer";
export { classifyDay, type DailyClassification, type ShiftSegment } from "./daily-classifier";
export {
  reconcilePeriod,
  applyCompDecision,
  type PeriodReconciliation,
  type DailyRecord,
} from "./period-reconciler";

export {
  getSurchargeConfig,
  getDailyLimitMins,
  getDailyLimitForDate,
  isHolidayDate,
  getHoraOrdinaria,
} from "./colombian-labor";

export {
  parseTimeToMinutes,
  minutesToTime,
  floorTo15Min,
  getDayOfWeek,
  minutesBetween,
  combineDateAndTime,
  combineDateAndTimeWithCrossing,
  addMinutes,
  getBusinessDay,
  formatDateISO,
} from "./time-utils";

export {
  calculateAttendance,
  type AttendanceOptions,
  type AttendanceResult,
} from "./attendance-calculator";
