// Convert an STL buffer into a minimal, spec-correct 3MF package.
// 3MF is an OPC container: [Content_Types].xml + _rels/.rels + 3D/3dmodel.model.
import { makeZip, type ZipEntry } from "./zip";

interface TriSink {
  vertices: Map<string, number>;
  order: string[];
  tris: [number, number, number][];
}

function key(x: number, y: number, z: number): string {
  return `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );
}

// Iterate triangles of a binary STL; returns null when the buffer isn't binary STL.
function* binaryTriangles(buf: Buffer): Generator<[number[], number[], number[]]> {
  if (buf.length < 84) return;
  const count = buf.readUInt32LE(80);
  const max = Math.floor((buf.length - 84) / 50);
  if (count > max) return;
  let off = 84;
  for (let i = 0; i < count; i++) {
    off += 12; // skip normal
    const a = [buf.readFloatLE(off), buf.readFloatLE(off + 4), buf.readFloatLE(off + 8)];
    const b = [buf.readFloatLE(off + 12), buf.readFloatLE(off + 16), buf.readFloatLE(off + 20)];
    const c = [buf.readFloatLE(off + 24), buf.readFloatLE(off + 28), buf.readFloatLE(off + 32)];
    off += 36 + 2;
    yield [a, b, c];
  }
}

// ASCII STL fallback: parse "vertex x y z" triplets.
function* asciiTriangles(buf: Buffer): Generator<[number[], number[], number[]]> {
  const num = "-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?";
  const re = new RegExp(`vertex\\s+(${num})\\s+(${num})\\s+(${num})`, "gi");
  const text = buf.toString("latin1");
  let pending: number[][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    pending.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
    if (pending.length === 3) {
      yield pending as [number[], number[], number[]];
      pending = [];
    }
  }
}

export function stlTriangleCount(buf: Buffer): number {
  if (buf.length > 84) {
    const count = buf.readUInt32LE(80);
    if (count === Math.floor((buf.length - 84) / 50)) return count;
  }
  let n = 0;
  for (const _ of asciiTriangles(buf)) n++;
  return n;
}

export function stlTo3mf(stl: Buffer, name: string): Buffer {
  const sink: TriSink = { vertices: new Map(), order: [], tris: [] };
  const index = (v: number[]) => {
    const k = key(v[0], v[1], v[2]);
    let idx = sink.vertices.get(k);
    if (idx === undefined) {
      idx = sink.order.length;
      sink.vertices.set(k, idx);
      sink.order.push(k);
    }
    return idx;
  };

  const isAscii = (() => {
    // binary STL: 80-byte header then uint32 count matching (size-84)/50
    if (stl.length > 84) {
      const count = stl.readUInt32LE(80);
      if (count === Math.floor((stl.length - 84) / 50) && count > 0) return false;
    }
    return true;
  })();

  if (isAscii) {
    for (const t of asciiTriangles(stl)) sink.tris.push([index(t[0]), index(t[1]), index(t[2])]);
  } else {
    for (const t of binaryTriangles(stl)) sink.tris.push([index(t[0]), index(t[1]), index(t[2])]);
  }

  // Build the model XML. Vertices are emitted in discovery order.
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  parts.push(
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">\n',
  );
  parts.push("  <metadata name=\"Title\">", xmlEscape(name), "</metadata>\n");
  parts.push("  <resources>\n");
  parts.push('    <object id="1" name="', xmlEscape(name), '" type="model">\n');
  parts.push("      <mesh>\n");
  parts.push("        <vertices>\n");
  for (const k of sink.order) {
    const [x, y, z] = k.split(",");
    parts.push(`          <vertex x="${x}" y="${y}" z="${z}"/>\n`);
  }
  parts.push("        </vertices>\n");
  parts.push("        <triangles>\n");
  for (const [a, b, c] of sink.tris) parts.push(`          <triangle v1="${a}" v2="${b}" v3="${c}"/>\n`);
  parts.push("        </triangles>\n");
  parts.push("      </mesh>\n");
  parts.push("    </object>\n");
  parts.push("  </resources>\n");
  parts.push('  <build><item objectid="1"/></build>\n');
  parts.push("</model>\n");

  const modelXml = Buffer.from(parts.join(""), "utf8");

  const contentTypes = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
      `</Types>\n`,
    "utf8",
  );

  const rels = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
      `</Relationships>\n`,
    "utf8",
  );

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "3D/3dmodel.model", data: modelXml },
  ];
  return makeZip(entries);
}
