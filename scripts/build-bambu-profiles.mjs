// Build "full config" JSONs for bambu-studio CLI slicing of a P1S.
// Base shape: wiki example full configs (machine/process/filament).
// Overrides: real P1S profiles + gcode templates from the local Bambu Studio install.
import fs from "fs";

const RES = "C:/Program Files/Bambu Studio/resources/profiles/BBL";
const OUT = "resources/bambu";
fs.mkdirSync(OUT, { recursive: true });

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const write = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2));
// keys from resource (partial) profiles that must not leak into a full config
const STRIP = new Set(["name", "inherits", "from", "instantiation", "type", "printers", "printables", "templates", "filament_ids", "default_filament_profile", "default_print_profile"]);

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (!STRIP.has(k)) out[k] = v;
  }
  return out;
}

// ---------- machine ----------
const machineBase = read("wiki-cfg/machine.json");
const p1s = read(`${RES}/machine/Bambu Lab P1S 0.4 nozzle.json`);
let machine = merge(machineBase, p1s);
// gcode templates for the P1S
const gcodeTemplates = [
  "machine_start_gcode",
  "machine_end_gcode",
  "layer_change_gcode",
  "change_filament_gcode",
  "time_lapse_gcode",
];
for (const t of gcodeTemplates) {
  const f = `${RES}/machine/Bambu Lab P1S 0.4 nozzle template ${t}.json`;
  if (fs.existsSync(f)) {
    const tpl = read(f);
    if (tpl[t] != null) machine[t] = tpl[t];
  }
}
machine.printer_model = "Bambu Lab P1S";
machine.printer_settings_id = "Bambu Lab P1S 0.4 nozzle";
// the CLI reads the machine's identity from its "name" key and matches the
// process preset's compatible_printers against it — keep all three consistent
machine.name = "Bambu Lab P1S 0.4 nozzle";
machine.from = "system";
machine.type = "machine";
write(`${OUT}/machine-p1s-0.4.json`, machine);

// ---------- process (P1S uses X1C's standard profiles) ----------
const processBase = read("wiki-cfg/process.json");
const proc = read(`${RES}/process/0.20mm Standard @BBL X1C.json`);
const processFull = merge(processBase, proc);
// the CLI checks the process preset against the selected printer by name
processFull.printer_model = "Bambu Lab P1S";
processFull.printer_settings_id = "Bambu Lab P1S 0.4 nozzle";
processFull.compatible_printers = ["Bambu Lab P1S 0.4 nozzle"];
processFull.name = "0.20mm Standard @BBL P1S";
processFull.from = "system";
processFull.type = "process";
write(`${OUT}/process-020-standard.json`, processFull);

// ---------- filament (Bambu PLA Basic on P1S 0.4) ----------
const filamentBase = read("wiki-cfg/filament.json");
const fil = read(`${RES}/filament/Bambu PLA Basic @BBL P1S 0.4 nozzle.json`);
const filamentFull = merge(filamentBase, fil);
filamentFull.printer_model = "Bambu Lab P1S";
filamentFull.printer_settings_id = "Bambu Lab P1S 0.4 nozzle";
filamentFull.compatible_printers = ["Bambu Lab P1S 0.4 nozzle"];
filamentFull.name = "Bambu PLA Basic @BBL P1S 0.4 nozzle";
filamentFull.from = "system";
filamentFull.type = "filament";
write(`${OUT}/filament-pla-basic.json`, filamentFull);

console.log("written:", fs.readdirSync(OUT).join(", "));
