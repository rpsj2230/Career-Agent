import { NextResponse } from "next/server";
import { integrationById, type IntegrationDef } from "./catalog";

/** Resolves a route param to an available integration, or the JSON error to return. */
export function parseIntegration(id: string): { def: IntegrationDef } | { error: NextResponse } {
  const def = integrationById(id);
  if (!def) return { error: NextResponse.json({ error: "Unknown integration" }, { status: 404 }) };
  if (!def.available) return { error: NextResponse.json({ error: `${def.name} is planned and not available yet` }, { status: 409 }) };
  return { def };
}
