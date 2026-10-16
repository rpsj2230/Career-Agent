/** Event kinds written to activity_log. The part before the dot is the category used for filtering. */
export const LOG_KINDS = [
  "run.started", "run.finished", "run.failed",
  "scan.started", "scan.finished", "scan.failed",
  "integration.tested", "integration.error", "integration.changed",
  "job.matched", "job.rejected", "job.duplicate", "job.score_failed",
  "resume.generated", "cover.generated",
  "application.prepared", "application.approved", "application.submitted", "application.skipped",
  "application.failed", "application.needs_input", "application.manual", "application.lifecycle", "application.blocked",
  "auth.login", "auth.login_failed", "auth.signup", "auth.logout",
  "config.changed", "schedule.changed", "report.generated", "report.failed",
] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export const LOG_CATEGORIES = ["run", "scan", "integration", "job", "resume", "cover", "application", "auth", "config", "schedule", "report"] as const;
export type LogLevel = "info" | "warn" | "error";

export type LogEntry = {
  kind: LogKind;
  message: string;
  level?: LogLevel;
  run_id?: string | null;
  scan_id?: string | null;
  integration?: string | null;
  portal?: string | null;
  country?: string | null;
  company?: string | null;
  job_id?: string | null;
  application_id?: string | null;
  status?: string | null;
  detail?: Record<string, unknown>;
};

export type RunKind = "pipeline" | "scan" | "score" | "prepare" | "apply" | "report" | "test";
export type RunTrigger = "schedule" | "manual" | "api" | "worker";
export type RunStatus = "running" | "succeeded" | "partial" | "failed" | "cancelled";
export type RunStats = Record<string, number>;
