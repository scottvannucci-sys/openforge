import { NextRequest, NextResponse } from "next/server";
import { loadSettings, saveSettings } from "@/lib/settings";
import type { AppSettings } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await loadSettings());
}

export async function POST(req: NextRequest) {
  const patch = (await req.json()) as Partial<AppSettings>;
  const next = await saveSettings(patch);
  return NextResponse.json(next);
}
