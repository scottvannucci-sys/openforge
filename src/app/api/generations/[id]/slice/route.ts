import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { GENERATIONS_DIR } from "@/lib/settings";
import { sliceForP1S, findBambuStudio, bambuProfilesReady } from "@/lib/bambu";

export const runtime = "nodejs";
export const maxDuration = 1200;

/** Slice a generation's STL for the P1S via the local Bambu Studio CLI. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId || safeId !== id) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  if (!findBambuStudio()) {
    return NextResponse.json(
      { ok: false, error: "Bambu Studio is not installed (looked in Program Files)." },
      { status: 400 },
    );
  }
  if (!bambuProfilesReady()) {
    return NextResponse.json({ ok: false, error: "P1S profiles missing on the server." }, { status: 500 });
  }
  const dir = path.join(GENERATIONS_DIR, safeId);
  const stl = path.join(dir, "model.stl");
  if (!fs.existsSync(stl)) {
    return NextResponse.json({ ok: false, error: "This generation has no model.stl." }, { status: 404 });
  }

  const result = await sliceForP1S(dir, stl, { timeoutMs: 15 * 60 * 1000 });
  return NextResponse.json({
    ok: result.ok,
    code: result.code,
    error: result.error,
    warning: result.warning,
    predictSeconds: result.predictSeconds,
    filamentGrams: result.filamentGrams,
    triangles: result.triangles,
    slicedUrl: result.ok ? `/api/generations/${safeId}/sliced` : undefined,
    resultUrl: `/api/generations/${safeId}/sliceresult`,
  });
}
