import { NextRequest, NextResponse } from "next/server";
import { listGenerations, deleteGeneration } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ generations: await listGenerations() });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    await deleteGeneration(id);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
