import { sql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    await sql("SELECT 1 AS ok");
    return Response.json({ status: "healthy" });
  } catch {
    return Response.json({ status: "unhealthy" }, { status: 503 });
  }
}
