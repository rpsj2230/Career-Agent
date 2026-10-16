import { NextResponse } from "next/server";
import { checkSchema } from "@/lib/schema";

/** Clears the schema cache and checks again, so every page reflects the database right away. */
export async function POST() {
  return NextResponse.json(await checkSchema(true));
}
