import type { GenerateArgs } from "./base";

/**
 * Demo provider: no AI at all. It returns hand-written, print-tested-style
 * OpenSCAD templates so the entire pipeline (compile → preview → export)
 * can be exercised before any model is configured.
 */

const PHONE_STAND = `// NAME: Phone Stand
// SUPPORTS: no
// MATERIAL: PLA
// A simple angled phone stand, printed flat-side down, no supports needed.
$fn = 48;

width = 80;    // side-to-side
depth = 70;    // front-to-back
height = 80;   // total height
base_t = 5;    // base plate thickness
lip_h = 12;    // lip height that catches the phone
plate_t = 9;   // leaning plate thickness

// Profile drawn in the XZ plane: x = depth, y = height, then extruded across.
module profile() {
  polygon([
    [0, 0], [depth, 0], [depth, base_t],
    [58, height], [49, height],
    [25, base_t], [14, base_t],
    [14, base_t + lip_h], [3, base_t + lip_h], [3, base_t],
    [0, base_t]
  ]);
}

rotate([90, 0, 0])
  linear_extrude(height = width, center = true)
    profile();
`;

const GEAR = `// NAME: Spur Gear
// SUPPORTS: no
// MATERIAL: PLA
// Straight-cut spur gear with a bore. Scale teeth/bore to your needs.
$fn = 64;

teeth = 14;
radius = 26;     // pitch radius
tooth_len = 8;   // radial tooth length
tooth_w = 8;     // tangential tooth width
bore_d = 8;      // center bore diameter
thickness = 8;

module tooth() {
  translate([radius - 2, 0, 0])
    cube([tooth_len + 2, tooth_w, thickness], center = true);
}

difference() {
  union() {
    cylinder(h = thickness, r = radius, center = true);
    for (i = [0 : teeth - 1])
      rotate([0, 0, i * 360 / teeth])
        tooth();
  }
  translate([0, 0, -thickness])
    cylinder(h = thickness * 3, d = bore_d);
}
`;

const VASE = `// NAME: Hex Vase
// SUPPORTS: no
// MATERIAL: PETG
// Hexagonal vase with a 2.4 mm floor — print without supports.
$fn = 6;   // six-sided "circles" make the hexagon

height = 110;
r_out = 40;    // outer radius (across corners)
wall = 2.4;

difference() {
  linear_extrude(height = height) circle(r = r_out);
  translate([0, 0, wall])
    linear_extrude(height = height) circle(r = r_out - wall);
}
`;

const CUBE = `// NAME: Calibration Cube
// SUPPORTS: no
// MATERIAL: PLA
// 20 mm calibration cube with a 5 mm bore through the Z axis.
$fn = 48;

difference() {
  cube([20, 20, 20]);
  translate([10, 10, -1])
    cylinder(h = 22, d = 5);
}
`;

const TEMPLATES: { match: RegExp; note: string; scad: string }[] = [
  { match: /stand|phone|tablet|holder|dock/i, note: "matched keyword → phone stand template", scad: PHONE_STAND },
  { match: /gear|cog|sprocket|pinion/i, note: "matched keyword → gear template", scad: GEAR },
  { match: /vase|cup|pot|planter|container/i, note: "matched keyword → vase template", scad: VASE },
];

export async function generateDemo(args: GenerateArgs): Promise<string> {
  const text = args.user;
  const tpl = TEMPLATES.find((t) => t.match.test(text)) ?? {
    note: "no keyword match → calibration cube template",
    scad: CUBE,
  };
  if (args.images.length && args.onProgress) {
    args.onProgress("demo provider ignores attached images — switch to a vision model to use them");
  }
  if (args.onProgress) args.onProgress(tpl.note);
  await new Promise((r) => setTimeout(r, 400));
  if (args.signal?.aborted) throw new Error("Cancelled");
  return tpl.scad;
}

export const DEMO_MODELS = ["sample-templates"];
