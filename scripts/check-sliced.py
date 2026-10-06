import zipfile, sys

z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()
print(len(names), "entries")
gcode = [n for n in names if n.endswith(".gcode")]
print("gcode:", gcode)
if gcode:
    data = z.read(gcode[0])
    print("gcode size:", len(data))
    head = data[:400].decode("utf-8", "replace")
    print("head:", head[:300].replace("\n", " | ")[:300])
for want in ("Metadata/slice_info.config", "Metadata/project_settings.config", "Metadata/plate_1.png"):
    print(want, "present:", want in names)
