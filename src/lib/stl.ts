import type { GenStats } from "./types";

/**
 * Minimal STL parser (binary + ASCII) that computes triangle count,
 * bounding box, enclosed volume and surface area. Good enough for
 * print statistics on watertight meshes, which is all we need here.
 */
export function parseStl(buffer: Buffer): GenStats & { valid: boolean } {
  const isAscii =
    buffer.length > 15 &&
    buffer.slice(0, 5).toString("ascii").toLowerCase() === "solid" &&
    buffer.slice(0, 1024).toString("latin1").includes("facet");

  let triangles = 0;
  let volume = 0;
  let area = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  const accumulate = (a: number[], b: number[], c: number[]) => {
    for (const v of [a, b, c]) {
      for (let i = 0; i < 3; i++) {
        if (v[i] < min[i]) min[i] = v[i];
        if (v[i] > max[i]) max[i] = v[i];
      }
    }
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
  };

  if (isAscii) {
    const text = buffer.toString("latin1");
    const num = "-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?";
    const re = new RegExp(`vertex\\s+(${num})\\s+(${num})\\s+(${num})`, "gi");
    let pending: number[][] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      pending.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
      if (pending.length === 3) {
        accumulate(pending[0], pending[1], pending[2]);
        triangles++;
        pending = [];
      }
    }
  } else {
    if (buffer.length < 84) {
      return { triangles: 0, dims: { x: 0, y: 0, z: 0 }, volumeMM3: 0, areaMM2: 0, valid: false };
    }
    triangles = buffer.readUInt32LE(80);
    const maxTris = Math.floor((buffer.length - 84) / 50);
    if (triangles > maxTris) triangles = maxTris;
    let off = 84;
    for (let i = 0; i < triangles; i++) {
      // skip normal (12 bytes), read 3 vertices
      const a = [buffer.readFloatLE(off + 12), buffer.readFloatLE(off + 16), buffer.readFloatLE(off + 20)];
      const b = [buffer.readFloatLE(off + 24), buffer.readFloatLE(off + 28), buffer.readFloatLE(off + 32)];
      const c = [buffer.readFloatLE(off + 36), buffer.readFloatLE(off + 40), buffer.readFloatLE(off + 44)];
      accumulate(a, b, c);
      off += 50;
    }
  }

  const dims = {
    x: Math.max(0, max[0] - min[0]),
    y: Math.max(0, max[1] - min[1]),
    z: Math.max(0, max[2] - min[2]),
  };
  return {
    triangles,
    dims,
    volumeMM3: Math.abs(volume),
    areaMM2: area,
    valid: triangles > 0,
  };
}

const DENSITY: Record<string, number> = { PLA: 1.24, PETG: 1.27, ABS: 1.04, TPU: 1.21 };

/** Rough material usage in grams: walls ~0.8mm thick over the whole surface + infill fraction of the volume. */
export function estimateGrams(
  stats: GenStats,
  infillPct: number,
  material: string,
): { grams: number; solidGrams: number } {
  const density = DENSITY[material.toUpperCase()] ?? 1.24;
  const solid = (stats.volumeMM3 / 1000) * density;
  const wallMM3 = stats.areaMM2 * 0.8;
  const infillMM3 = Math.max(0, stats.volumeMM3 - wallMM3) * (infillPct / 100);
  const grams = ((wallMM3 + infillMM3) / 1000) * density;
  return { grams: Math.max(grams, solid * 0.05), solidGrams: solid };
}

export const BUILD_VOLUME = { x: 256, y: 256, z: 256 }; // Bambu Lab P1S

export function fitsBuildVolume(dims: { x: number; y: number; z: number }): boolean {
  return (
    dims.x <= BUILD_VOLUME.x + 0.5 &&
    dims.y <= BUILD_VOLUME.y + 0.5 &&
    dims.z <= BUILD_VOLUME.z + 0.5
  );
}
