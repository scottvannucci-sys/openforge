import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { loadSettings, ensureDataDirs, GENERATIONS_DIR } from "@/lib/settings";
import { compileSCAD, renderThumbnail, parseMetaComments } from "@/lib/openscad";
import { parseStl } from "@/lib/stl";
import { SYSTEM_PROMPT, buildUserPrompt, extractScad } from "@/lib/prompt";
import { generateWithProvider } from "@/lib/providers";
import type { ProviderConfig, GenerateArgs } from "@/lib/providers/base";
import { generationDir, newGenerationId, saveGenerationMeta } from "@/lib/storage";
import type { GenerationMeta, ProviderId, StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 600;

interface GenerateBody {
  prompt: string;
  provider?: string;
  model?: string;
  imageBase64?: string;
  imageMime?: string;
  refineScad?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as GenerateBody;
  const settings = await loadSettings();
  await ensureDataDirs();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      const log = (level: "info" | "warn" | "error", message: string) =>
        send({ type: "log", level, message });

      const started = Date.now();
      const id = newGenerationId();
      const dir = path.join(GENERATIONS_DIR, id);

      try {
        const prompt = (body.prompt ?? "").trim();
        const refine = Boolean(body.refineScad);
        if (!prompt && !body.imageBase64 && !refine) {
          throw new Error("Enter a build request first.");
        }

        const providerRaw = (body.provider ?? settings.activeProvider) as string;
        const validProviders = ["demo", "ollama", "openai", "codex"];
        if (!providerRaw || !validProviders.includes(providerRaw)) throw new Error("Pick a provider.");
        const provider = providerRaw as ProviderId;

        let model = body.model ?? "";
        if (provider === "demo") model = model || "sample-templates";
        if (provider === "ollama" && !model) model = settings.providers.ollama.model;
        if (provider === "openai" && !model) model = settings.providers.openai.model;
        if (provider === "codex" && !model) model = settings.providers.codex.model;

        if (!settings.openscadPath || !fs.existsSync(settings.openscadPath)) {
          throw new Error(
            "OpenSCAD not found. Install it from openscad.org (or drop a portable copy in tools/OpenSCAD), then set the path in Settings.",
          );
        }

        fs.mkdirSync(dir, { recursive: true });

        const images =
          body.imageBase64 && body.imageMime
            ? [{ base64: body.imageBase64, mime: body.imageMime }]
            : [];
        if (images.length) {
          fs.writeFileSync(
            path.join(dir, `input.${images[0].mime.includes("png") ? "png" : "jpg"}`),
            Buffer.from(images[0].base64, "base64"),
          );
        }

        let progressNote = "";
        let lastProgressSent = 0;
        const onProgress = (note: string) => {
          const now = Date.now();
          progressNote = note;
          if (now - lastProgressSent > 1200) {
            lastProgressSent = now;
            log("info", note);
          }
        };

        const providerConfig: ProviderConfig = settings.providers;
        const genArgs: Omit<GenerateArgs, "system" | "user"> = {
          model,
          images,
          onProgress,
          signal: req.signal,
          workDir: dir,
        };

        log("info", `Provider: ${provider}${model ? ` · model: ${model}` : ""}`);

        let scad: string | null = null;
        let attempt = 0;
        const maxAttempts = Math.min(Math.max(settings.maxRepairAttempts, 1), 5);
        let lastErrors = "";

        for (attempt = 1; attempt <= maxAttempts; attempt++) {
          if (req.signal.aborted) throw new Error("Cancelled");
          if (attempt > 1) {
            log("info", `Repair attempt ${attempt}/${maxAttempts}: asking the model to fix the compiler errors…`);
          }
          const userPrompt = buildUserPrompt({
            userText: prompt || "Turn the attached image into a 3D-printable model.",
            hasImage: images.length > 0,
            previousScad: refine ? body.refineScad : undefined,
            repairErrors: attempt > 1 ? lastErrors : undefined,
          });

          log("info", attempt === 1 ? "Asking the model to write OpenSCAD…" : "Regenerating OpenSCAD…");
          const text = await generateWithProvider(provider, providerConfig, {
            ...genArgs,
            system: SYSTEM_PROMPT,
            user: userPrompt,
          });
          if (progressNote && Date.now() - lastProgressSent > 1200) {
            log("info", progressNote);
            lastProgressSent = Date.now();
          }

          scad = extractScad(text);
          if (!scad) {
            lastErrors = "Your reply contained no recognizable OpenSCAD code. Reply with ONLY the complete OpenSCAD file.";
            log("warn", "No OpenSCAD code found in the reply — asking again.");
            continue;
          }
          log("info", `Received ${scad.length.toLocaleString()} chars of OpenSCAD.`);

          const scadFile = path.join(dir, "model.scad");
          const stlFile = path.join(dir, "model.stl");
          fs.writeFileSync(scadFile, scad, "utf8");

          log("info", `Compiling with OpenSCAD (attempt ${attempt}/${maxAttempts})…`);
          const result = await compileSCAD(
            settings.openscadPath,
            scadFile,
            stlFile,
            Math.min(Math.max(settings.openscadTimeoutSec, 10), 3600) * 1000,
            req.signal,
          );
          for (const line of result.log.slice(0, 4)) log("info", `openscad: ${line}`);
          if (result.ok) {
            log("info", "Compiled cleanly.");
            break;
          }
          lastErrors = result.errors.join("\n").slice(0, 3000);
          for (const e of result.errors.slice(0, 4)) log("error", e);
          scad = null;
        }

        if (!scad) {
          throw new Error(
            `Couldn't produce a valid model after ${maxAttempts} attempt${maxAttempts > 1 ? "s" : ""}. Try simplifying the request or switching models.`,
          );
        }

        const stlBuffer = fs.readFileSync(path.join(dir, "model.stl"));
        const stats = parseStl(stlBuffer);
        if (!stats.valid) throw new Error("Compiled STL contains no triangles.");
        log(
          "info",
          `Mesh: ${stats.triangles.toLocaleString()} triangles · ${stats.dims.x.toFixed(1)} × ${stats.dims.y.toFixed(1)} × ${stats.dims.z.toFixed(1)} mm`,
        );

        const meta = parseMetaComments(scad);
        const genMeta: GenerationMeta = {
          id,
          name: meta.name || (prompt ? prompt.split(/\s+/).slice(0, 4).join(" ").slice(0, 40) : "Model"),
          prompt: prompt || "(image build)",
          provider,
          model,
          createdAt: started,
          durationMs: Date.now() - started,
          attempts: attempt,
          hasImage: images.length > 0,
          material: meta.material || "PLA",
          supports: meta.supports ?? false,
          stats: {
            triangles: stats.triangles,
            dims: stats.dims,
            volumeMM3: stats.volumeMM3,
            areaMM2: stats.areaMM2,
          },
        };
        await saveGenerationMeta(id, genMeta);

        log("info", "Rendering thumbnail…");
        const gotThumb = await renderThumbnail(
          settings.openscadPath,
          path.join(dir, "model.scad"),
          path.join(dir, "thumb.png"),
        );
        if (!gotThumb) log("info", "(thumbnail skipped — not critical)");

        log("info", `Done in ${(genMeta.durationMs / 1000).toFixed(1)}s.`);
        send({ type: "result", generation: genMeta, scad });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
