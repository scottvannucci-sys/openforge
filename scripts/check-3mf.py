import zipfile, re, sys

z = zipfile.ZipFile(r".data/final-test.3mf")
names = z.namelist()
print("entries:", names)
xml = z.read("3D/3dmodel.model").decode()
m = re.search(r'object id="1" name="([^"]+)"', xml)
print("object name:", m.group(1) if m else "NONE")
print("unit:", re.search(r'<model unit="([^"]+)"', xml).group(1))
print("vertices:", xml.count("<vertex"), "triangles:", xml.count("<triangle"))
# validate triangle indices are within range
vidx = xml.count("<vertex")
bad = [t for t in re.findall(r'<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"', xml) if any(int(i) >= vidx for i in t)]
print("bad index refs:", len(bad))
print("OK" if not bad and vidx > 0 and m else "PROBLEM")
