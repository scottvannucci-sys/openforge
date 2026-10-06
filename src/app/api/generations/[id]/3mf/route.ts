import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { GENERATIONS_DIR } from "@/lib/settings";
import { stlTo3mf } from "@/lib/3mf";

export const runtime = "nodejs";

/**
 * Serve the generation's model as a 3MF (named object, explicit mm units).
 * Generated on first request from model.stl and cached on disk.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId || safeId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const dir = path.join(GENERATIONS_DIR, safeId);
  const stlPath = path.join(dir, "model.stl");
  const outPath = path.join(dir, "model.3mf");
  try {
    if (!fs.existsSync(outPath)) {
      const stl = await fs.promises.readFile(stlPath);
      let name = "Model";
      try {
        const meta = JSON.parse(await fs.promises.readFile(path.join(dir, "meta.json"), "utf8"));
        if (typeof meta.name === "string" && meta.name) name = meta.name;
      } catch {
        /* optional */
      }
      await fs.promises.writeFile(outPath, stlTo3mf(stl, name));
    }
    const data = await fs.promises.readFile(outPath);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeId}.3mf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
