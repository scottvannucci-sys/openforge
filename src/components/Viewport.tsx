"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

interface ViewportProps {
  stlUrl: string | null;
  wireframe: boolean;
  edges: boolean;
  autoRotate: boolean;
  showPlate: boolean;
  /** increment to re-frame the camera on the model */
  resetSignal: number;
  /** increment to download a PNG screenshot of the viewport */
  screenshotSignal: number;
}

export default function Viewport(props: ViewportProps) {
  const { stlUrl, wireframe, edges, autoRotate, showPlate, resetSignal, screenshotSignal } = props;
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    modelGroup: THREE.Group;
    plateGroup: THREE.Group;
    mesh: THREE.Mesh | null;
    edgeLines: THREE.LineSegments | null;
  } | null>(null);
  const [loadingMesh, setLoadingMesh] = useState(false);

  // --- init once ---
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0d0d16");

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(
      42,
      mount.clientWidth / mount.clientHeight,
      0.5,
      5000,
    );
    camera.position.set(260, 190, 260);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotateSpeed = 1.4;
    controls.maxPolarAngle = Math.PI * 0.52;

    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x201a12, 0.5));
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(180, 320, 140);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0x7dd3fc, 0.35);
    dir2.position.set(-200, 120, -160);
    scene.add(dir2);

    // build plate group
    const plateGroup = new THREE.Group();
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(256, 256),
      new THREE.MeshStandardMaterial({ color: 0x15151f, roughness: 0.95, metalness: 0.05 }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = -0.4;
    plateGroup.add(plate);

    const grid = new THREE.GridHelper(256, 32, 0x2c2c44, 0x1d1d2e);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.8;
    plateGroup.add(grid);

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(256, 256)),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.4 }),
    );
    border.rotation.x = -Math.PI / 2;
    border.position.y = 0.15;
    plateGroup.add(border);
    scene.add(plateGroup);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    stateRef.current = { renderer, scene, camera, controls, modelGroup, plateGroup, mesh: null, edgeLines: null };

    const resize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      modelGroup.traverse((o) => {
        const obj = o as THREE.Mesh;
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) (obj.material as THREE.Material).dispose();
      });
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, []);

  // --- load model ---
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;

    // clear previous (dispose GPU resources)
    st.modelGroup.traverse((o) => {
      const obj = o as THREE.Mesh;
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) (obj.material as THREE.Material).dispose();
    });
    st.modelGroup.clear();
    st.mesh = null;
    st.edgeLines = null;
    if (!stlUrl) return;

    let cancelled = false;
    setLoadingMesh(true);
    fetch(stlUrl, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        if (cancelled || !stateRef.current) return;
        const geometry = new STLLoader().parse(buf);
        geometry.computeBoundingBox();
        const bb = geometry.boundingBox!;
        const size = new THREE.Vector3();
        bb.getSize(size);
        // center X/Z, rest on the plate
        geometry.translate(-(bb.min.x + size.x / 2), -bb.min.y, -(bb.min.z + size.z / 2));
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
          color: 0xfb923c,
          roughness: 0.38,
          metalness: 0.06,
          wireframe,
        });
        const mesh = new THREE.Mesh(geometry, material);
        st.modelGroup.add(mesh);
        st.mesh = mesh;

        const edgeGeo = new THREE.EdgesGeometry(geometry, 28);
        const edgeLines = new THREE.LineSegments(
          edgeGeo,
          new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.22 }),
        );
        edgeLines.visible = edges;
        st.modelGroup.add(edgeLines);
        st.edgeLines = edgeLines;

        // frame camera
        const maxDim = Math.max(size.x, size.y, size.z, 10);
        const dist = maxDim * 1.9 + 90;
        st.camera.position.set(dist * 0.82, dist * 0.58, dist * 0.82);
        st.controls.target.set(0, size.y / 2, 0);
        st.controls.update();
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoadingMesh(false));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stlUrl]);

  // --- toggle states ---
  useEffect(() => {
    const st = stateRef.current;
    if (st?.mesh) (st.mesh.material as THREE.MeshStandardMaterial).wireframe = wireframe;
  }, [wireframe]);
  useEffect(() => {
    const st = stateRef.current;
    if (st?.edgeLines) st.edgeLines.visible = edges;
  }, [edges]);
  useEffect(() => {
    const st = stateRef.current;
    if (st) st.controls.autoRotate = autoRotate;
  }, [autoRotate]);
  useEffect(() => {
    const st = stateRef.current;
    if (st) st.plateGroup.visible = showPlate;
  }, [showPlate]);

  // --- reset framing ---
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !resetSignal) return;
    const box = new THREE.Box3();
    if (st.mesh) box.setFromObject(st.mesh);
    if (box.isEmpty()) {
      st.camera.position.set(260, 190, 260);
      st.controls.target.set(0, 0, 0);
    } else {
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z, 10);
      const dist = maxDim * 1.9 + 90;
      st.camera.position.set(dist * 0.82, dist * 0.58, dist * 0.82);
      st.controls.target.set(0, size.y / 2, 0);
    }
    st.controls.update();
  }, [resetSignal]);

  // --- screenshot ---
  useEffect(() => {
    if (!screenshotSignal) return;
    const st = stateRef.current;
    if (!st) return;
    st.renderer.render(st.scene, st.camera);
    const url = st.renderer.domElement.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "openforge-preview.png";
    a.click();
  }, [screenshotSignal]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-ink-700 bg-ink-900">
      <div ref={mountRef} className="absolute inset-0" />
      {!stlUrl && !loadingMesh && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-ink-600 bg-ink-800/80 text-2xl">
            🖨️
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-300">No model loaded</p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
              Describe a part on the left (or drop in an image) and hit Forge. The result appears here
              resting on a 256&nbsp;mm P1S plate.
            </p>
          </div>
        </div>
      )}
      {loadingMesh && (
        <div className="absolute right-3 top-3 rounded-lg border border-ink-600 bg-ink-850/90 px-2.5 py-1 text-[11px] text-zinc-400">
          loading mesh…
        </div>
      )}
    </div>
  );
}
