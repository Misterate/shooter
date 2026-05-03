import { NextRequest, NextResponse } from "next/server";
import { getAxisById, updateAxis, softDeleteAxis } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const axis = getAxisById(params.id);
    if (!axis) {
      return NextResponse.json({ error: "Axis not found" }, { status: 404 });
    }

    const body = await req.json();
    const allowed = ["name", "positive", "negative", "description", "active", "sort_order"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) {
        updates[key] = body[key];
      }
    }

    const updated = updateAxis(params.id, updates);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating axis:", error);
    return NextResponse.json(
      { error: "Failed to update axis" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const axis = getAxisById(params.id);
    if (!axis) {
      return NextResponse.json({ error: "Axis not found" }, { status: 404 });
    }

    softDeleteAxis(params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting axis:", error);
    return NextResponse.json(
      { error: "Failed to delete axis" },
      { status: 500 }
    );
  }
}
