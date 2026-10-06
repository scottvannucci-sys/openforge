import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { GENERATIONS_DIR } from "@/lib/settings";

export const runtime = "nodejs";

const FILES: Record<string, { file: string; type: string; download: string }> = {
  stl: { file: "model.stl", type: "application/octet-stream", download: "model.stl" },
  scad: { file: "model.scad", type: "text/plain; charset=utf-8", download: "model.scad" },
  thumb: { file: "thumb.png", type: "image/png", download: "" },
  input: { file: "", type: "", download: "" },
  sliced: { file: "p1s-print.3mf", type: "application/octet-stream", download: "p1s-print.3mf" },
  sliceresult: { file: "result.json", type: "application/json", download: "" },
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await ctx.params;
  const spec = FILES[file];
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!spec || !safeId || safeId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let filePath: string;
  let contentType = spec.type;
  if (file === "input") {
    // serve the originally uploaded image, whatever extension it has
    const dir = path.join(GENERATIONS_DIR, safeId);
    const found = fs.existsSync(dir)
      ? fs.readdirSync(dir).find((f) => /^input\.(png|jpe?g|gif)$/i.test(f))
      : undefined;
    if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
    filePath = path.join(dir, found);
    contentType = /\.png$/i.test(found)
      ? "image/png"
      : /\.gif$/i.test(found)
        ? "image/gif"
        : "image/jpeg";
  } else {
    filePath = path.join(GENERATIONS_DIR, safeId, spec.file);
  }

  try {
    const data = await fs.promises.readFile(filePath);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType || "application/octet-stream",
        "Cache-Control": "no-store",
        ...(spec.download
          ? { "Content-Disposition": `attachment; filename="${safeId}-${spec.download}"` }
          : {}),
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
