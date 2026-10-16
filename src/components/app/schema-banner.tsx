import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { checkSchema } from "@/lib/schema";

/** Shown on every page while the database is behind the code, so nothing fails silently. */
export async function SchemaBanner() {
  let status;
  try { status = await checkSchema(); } catch { return null; }
  if (status.ok) return null;
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTitle>{status.unreachable ? "Database check failed" : "Database update needed"}</AlertTitle>
      <AlertDescription>
        {status.unreachable
          ? `${status.unreachable}. `
          : `${status.problems.length} item${status.problems.length === 1 ? " is" : "s are"} missing for the newest features (${status.pendingMigrations.join(", ")}). `}
        <Link href="/system" className="underline">Open System to fix it</Link>. Until then some pages show a notice instead of data.
      </AlertDescription>
    </Alert>
  );
}
