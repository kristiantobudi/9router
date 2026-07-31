import { NextResponse } from "next/server";
import { getLimitEvents } from "@/lib/db";

// GET /api/quota/limit-events?limit=50
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));
    const events = await getLimitEvents(limit);
    return NextResponse.json({ events });
  } catch (error) {
    console.log("Error fetching limit events:", error);
    return NextResponse.json({ error: "Failed to fetch limit events" }, { status: 500 });
  }
}
