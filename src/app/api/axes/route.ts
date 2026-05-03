import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getAllAxes, createAxis } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const axes = getAllAxes();
    return NextResponse.json(axes);
  } catch (error) {
    console.error("Error fetching axes:", error);
    return NextResponse.json(
      { error: "Failed to fetch axes" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, positive, negative, description } = body;

    if (!name || !positive || !negative || !description) {
      return NextResponse.json(
        { error: "name, positive, negative, description are required" },
        { status: 400 }
      );
    }

    const axis = createAxis({
      id: uuidv4(),
      name: name.trim(),
      positive: positive.trim(),
      negative: negative.trim(),
      description: description.trim(),
    });

    return NextResponse.json(axis, { status: 201 });
  } catch (error) {
    console.error("Error creating axis:", error);
    return NextResponse.json(
      { error: "Failed to create axis" },
      { status: 500 }
    );
  }
}
