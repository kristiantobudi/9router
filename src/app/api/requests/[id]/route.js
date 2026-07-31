import { NextResponse } from "next/server";
import { getRequestDetailById } from "@/lib/db";

// GET /api/requests/[id]
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const detail = await getRequestDetailById(id);
    if (!detail) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    return NextResponse.json({ detail });
  } catch (error) {
    console.log("Error fetching request detail:", error);
    return NextResponse.json({ error: "Failed to fetch request detail" }, { status: 500 });
  }
}
