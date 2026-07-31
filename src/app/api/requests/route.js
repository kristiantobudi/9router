import { NextResponse } from "next/server";
import { getRequestDetails, getDistinctProviders } from "@/lib/db";

// GET /api/requests?provider=&status=&model=&page=&pageSize=
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = {
      provider: searchParams.get("provider") || undefined,
      model: searchParams.get("model") || undefined,
      status: searchParams.get("status") || undefined,
      connectionId: searchParams.get("connectionId") || undefined,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      page: Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1),
      pageSize: Math.min(
        100,
        Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10) || 50)
      ),
    };

    const [result, providers] = await Promise.all([
      getRequestDetails(filter),
      getDistinctProviders(),
    ]);

    return NextResponse.json({ ...result, providers });
  } catch (error) {
    console.log("Error fetching request details:", error);
    return NextResponse.json({ error: "Failed to fetch request details" }, { status: 500 });
  }
}
