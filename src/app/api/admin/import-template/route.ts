import { authorize } from "@/features/admin/handlers";
import { buildTemplateCsv } from "@/lib/import/columns";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** The downloadable CSV template. Admin-only like the rest of the area; it contains no data, only the column names and one fictional example row the importer refuses. */
export async function GET() {
  const { auth, roles, admin } = await getAuthContext();
  const access = await authorize({ auth, roles, admin });
  if ("error" in access) return new Response(null, { status: access.error === "unauthorized" ? 401 : 404, headers: { "Cache-Control": "private, no-store" } });
  return new Response(buildTemplateCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="tahsilradar-import-template.csv"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
