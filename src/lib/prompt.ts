export const SYSTEM_PROMPT = `You are a CAD engineer that writes OpenSCAD models for FDM 3D printing on a Bambu Lab P1S.

Output rules (STRICT):
- Reply with ONE complete OpenSCAD source file and nothing else. No markdown fences, no commentary, no explanation.
- Units are millimeters. The finished model must fit inside a 256 x 256 x 256 mm build volume and use the space sensibly (a 10 mm trinket is as wrong as a 500 mm monster).
- The solid must sit with its base flat on the Z=0 plane and be a single closed manifold solid.
- Design for FDM printing: no feature thinner than 1.2 mm, no unsupported overhangs steeper than 45 degrees unless unavoidable, small holes >= 2 mm diameter, large flat ceilings get support-friendly geometry.
- Do NOT use import() and do NOT use external libraries (no \`use <...>\` or \`include <...>\`). Core OpenSCAD primitives only: 2D/3D primitives, boolean ops, hull, minkowski, linear_extrude, rotate_extrude, offset, resize, text.
- Use $fn between 24 and 128. Prefer named parameters at the top and modules for repeated parts.
- The file MUST begin with exactly these three metadata comments:
// NAME: <short model name, 2-4 words>
// SUPPORTS: yes|no
// MATERIAL: PLA|PETG|ABS`;

export interface PromptContext {
  userText: string;
  hasImage: boolean;
  previousScad?: string;
  repairErrors?: string;
}

export function buildUserPrompt(ctx: PromptContext): string {
  const parts: string[] = [];

  if (ctx.repairErrors) {
    parts.push(
      `The previous OpenSCAD file you produced failed to compile. Compiler output:\n\n${ctx.repairErrors}\n\nFix every problem and return ONE complete corrected OpenSCAD file following all rules.`,
    );
  }

  if (ctx.previousScad) {
    parts.push(
      `Here is the current version of the model. Modify it according to the request below and return the complete updated file.\n\n--- CURRENT MODEL ---\n${ctx.previousScad}\n--- END CURRENT MODEL ---`,
    );
  }

  parts.push(ctx.hasImage
    ? `Build request (an image is attached — treat it as the design reference; match its shape, proportions and key features as closely as printable geometry allows):\n${ctx.userText || "Turn the attached image into a 3D-printable model."}`
    : `Build request:\n${ctx.userText}`);

  return parts.join("\n\n");
}

/** Pull a usable OpenSCAD file out of a model response. */
export function extractScad(text: string): string | null {
  const fences = [...text.matchAll(/```(?:scad|openscad)?\s*\n([\s\S]*?)```/gi)].map((m) => m[1]);
  const shapey = (s: string) =>
    /\b(cube|cylinder|sphere|polyhedron|difference|union|intersection|hull|linear_extrude|rotate_extrude|minkowski|text\s*\(|surface|polygon)\b/.test(
      s,
    );
  let code: string | null = null;
  for (const f of fences) {
    if (shapey(f)) {
      code = f;
      break;
    }
  }
  if (!code && fences.length) code = fences[0];
  if (!code) {
    const t = text.trim();
    if (shapey(t)) code = t;
  }
  if (!code) return null;
  code = code.replace(/^\s*```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  // Models sometimes prepend a prose sentence on the first line before the metadata header; drop lines until the first "//" or code token.
  if (!/^\s*\/\//.test(code)) {
    const firstCode = code.search(/^(\$fn|\$fa|\$fs|module\s|cube|cylinder|sphere|polyhedron|difference|union|intersection|hull|linear_extrude|rotate_extrude|color|translate|rotate|scale|mirror|resize|offset|minkowski|render|text|polygon|for\s*\(|if\s*\()/im);
    if (firstCode > 0) {
      const header = code.slice(0, firstCode);
      if (!/\/\//.test(header)) code = code.slice(firstCode);
    }
  }
  return code.length > 10 ? code : null;
}
