"use client";

import { Bounds, ContactShadows, GizmoHelper, GizmoViewport, Html, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";
import type { AssemblyBundle, SelectedRef } from "@/caprio/client/types";
import { appearanceFromParameters, DEFAULT_CLAY } from "@/caprio/threed/appearance";
import { distanceMeters, formatCm } from "@/caprio/threed/measure";

export type SceneMarker = {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
};

type HoverInfo = {
  point: { x: number; y: number; z: number };
  label: string;
};

function Model({
  url,
  label,
  selected,
  onSelect,
  color,
  roughness,
  metalness,
}: {
  url: string;
  label: string;
  selected: boolean;
  onSelect: (additive: boolean) => void;
  color?: string;
  roughness?: number;
  metalness?: number;
}) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => {
    const cloned = gltf.scene.clone(true);
    cloned.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.geometry && !mesh.geometry.getAttribute("normal")) {
        mesh.geometry.computeVertexNormals();
      }
      mesh.userData.pick = "part";
      mesh.userData.label = label;
      mesh.material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color || DEFAULT_CLAY.color),
        roughness: typeof roughness === "number" ? roughness : DEFAULT_CLAY.roughness,
        metalness: typeof metalness === "number" ? metalness : DEFAULT_CLAY.metalness,
        side: THREE.DoubleSide,
      });
    });
    cloned.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(cloned).getCenter(new THREE.Vector3());
    cloned.position.sub(center);
    return cloned;
  }, [gltf.scene, color, roughness, metalness, label]);
  const box = useMemo(() => {
    const measured = new THREE.Box3().setFromObject(scene);
    const size = measured.getSize(new THREE.Vector3());
    const center = measured.getCenter(new THREE.Vector3());
    return { size, center };
  }, [scene]);
  return (
    <group
      onClick={(event) => {
        if (event.altKey) return;
        event.stopPropagation();
        onSelect(Boolean(event.shiftKey || event.metaKey || event.ctrlKey));
      }}
    >
      <primitive object={scene} />
      {selected ? (
        <mesh position={box.center} scale={[box.size.x * 1.08 || 0.2, box.size.y * 1.08 || 0.2, box.size.z * 1.08 || 0.2]} raycast={() => {}}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#5eead4" wireframe transparent opacity={0.45} />
        </mesh>
      ) : null}
    </group>
  );
}

const PLATE_SIZE = 4;
const SNAP_M = 0.005;

function snapPoint(point: THREE.Vector3, y = point.y) {
  const snap = (n: number) => Math.round(n / SNAP_M) * SNAP_M;
  return { x: snap(point.x), y: snap(y), z: snap(point.z) };
}

function BuildPlate() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} userData={{ pick: "plate", label: "build plate" }}>
      <planeGeometry args={[PLATE_SIZE, PLATE_SIZE]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/* eslint-disable react-hooks/immutability -- The per-frame loop below writes the
   HUD text and the measure line in place. That is the point: cursor readout and
   pin distance update on every frame, and routing them through React state would
   re-render the whole viewer 60 times a second. */
function SceneCursor({
  onAltPin,
  markers,
  hudCursor,
  hudGap,
  pinButton,
  hoverRef,
}: {
  onAltPin: (point: HoverInfo["point"]) => void;
  markers: SceneMarker[];
  hudCursor: RefObject<HTMLDivElement | null>;
  hudGap: RefObject<HTMLDivElement | null>;
  pinButton: RefObject<HTMLButtonElement | null>;
  hoverRef: MutableRefObject<HoverInfo | null>;
}) {
  const { camera, pointer, scene, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const latest = useRef<HoverInfo | null>(null);
  const lastKey = useRef("");
  const pinFn = useRef(onAltPin);
  const positions = useMemo(() => new Float32Array(6), []);
  const measureLine = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x5eead4 }));
    line.frustumCulled = false;
    line.visible = false;
    line.raycast = () => {};
    return line;
  }, [positions]);

  useEffect(() => {
    pinFn.current = onAltPin;
  }, [onAltPin]);

  useFrame(() => {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster
      .intersectObjects(scene.children, true)
      .filter((hit) => hit.object.userData.pick && hit.distance < 8);
    const part = hits.find((hit) => hit.object.userData.pick === "part");
    const plate = hits.find((hit) => hit.object.userData.pick === "plate");
    const hit = part || plate;
    if (!hit) {
      latest.current = null;
      hoverRef.current = null;
      if (lastKey.current) {
        lastKey.current = "";
        if (hudCursor.current) hudCursor.current.textContent = "cursor — · move over the plate or a part";
        if (hudGap.current) hudGap.current.textContent = "Alt-click or Pin cursor to drop a landmark";
        if (pinButton.current) pinButton.current.disabled = true;
      }
      if (measureLine.visible) measureLine.visible = false;
      return;
    }
    const onPlate = hit.object.userData.pick === "plate";
    if (onPlate && (Math.abs(hit.point.x) > PLATE_SIZE / 2 || Math.abs(hit.point.z) > PLATE_SIZE / 2)) {
      return;
    }
    const point = snapPoint(hit.point, onPlate ? 0 : hit.point.y);
    const info: HoverInfo = {
      point,
      label: onPlate ? "build plate" : (hit.object.userData.label as string) || "part",
    };
    latest.current = info;
    hoverRef.current = info;
    const key = `${info.label}:${formatCm(info.point)}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      if (hudCursor.current) hudCursor.current.textContent = `cursor ${formatCm(info.point)} · ${info.label}`;
      if (pinButton.current) pinButton.current.disabled = false;
    }
    const active = markers.at(-1);
    if (active) {
      positions[0] = active.position.x;
      positions[1] = active.position.y;
      positions[2] = active.position.z;
      positions[3] = point.x;
      positions[4] = point.y;
      positions[5] = point.z;
      const attr = measureLine.geometry.getAttribute("position") as THREE.BufferAttribute;
      attr.needsUpdate = true;
      measureLine.visible = true;
      const gap = distanceMeters(point, active.position) * 100;
      if (hudGap.current) hudGap.current.textContent = `${gap.toFixed(1)} cm from pin ${active.name}`;
    } else {
      measureLine.visible = false;
      if (hudGap.current) hudGap.current.textContent = "Alt-click or Pin cursor to drop a landmark";
    }
  });

  useEffect(() => {
    const canvas = gl.domElement;
    const onClick = (event: MouseEvent) => {
      if (!event.altKey || !latest.current) return;
      event.preventDefault();
      pinFn.current(latest.current.point);
    };
    canvas.addEventListener("click", onClick);
    return () => canvas.removeEventListener("click", onClick);
  }, [gl]);

  return <primitive object={measureLine} />;
}
/* eslint-enable react-hooks/immutability */

function PinMarkers({ markers, activeId }: { markers: SceneMarker[]; activeId: string | null }) {
  const active = markers.find((marker) => marker.id === activeId) || markers.at(-1);
  return (
    <group>
      {markers.map((marker) => (
        <group key={marker.id} position={[marker.position.x, marker.position.y, marker.position.z]}>
          <mesh raycast={() => {}} userData={{ pick: undefined }}>
            <sphereGeometry args={[0.012, 12, 12]} />
            <meshBasicMaterial color={marker.id === active?.id ? "#f472b6" : "#fb7185"} />
          </mesh>
          <Html center distanceFactor={6} style={{ pointerEvents: "none" }}>
            <div className="whitespace-nowrap rounded bg-zinc-950/80 px-1.5 py-0.5 font-mono text-[10px] text-pink-100">
              {marker.name} {formatCm(marker.position)}
            </div>
          </Html>
        </group>
      ))}
    </group>
  );
}

export function AssemblyViewer({
  bundle,
  selected = [],
  markers = [],
  onSelect,
  onPlaceMarker,
  emptyLabel = "Generate an object to view the assembly",
}: {
  bundle: AssemblyBundle | null;
  selected: SelectedRef[];
  markers?: SceneMarker[];
  onSelect: (ref: SelectedRef | null, additive?: boolean) => void;
  onPlaceMarker?: (point: { x: number; y: number; z: number }, name?: string) => void;
  emptyLabel?: string;
}) {
  const selectedIds = new Set((selected || []).map((item) => item.instanceId));
  const hoverRef = useRef<HoverInfo | null>(null);
  const hudCursor = useRef<HTMLDivElement>(null);
  const hudGap = useRef<HTMLDivElement>(null);
  const pinButton = useRef<HTMLButtonElement>(null);
  const [pinName, setPinName] = useState("");
  const activeId = markers.at(-1)?.id || null;

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <Canvas
        camera={{ position: [1.6, 1.4, 1.8], fov: 45 }}
        onPointerMissed={(event) => {
          if (!event.shiftKey && !event.altKey) onSelect(null);
        }}
      >
        <color attach="background" args={["#09090b"]} />
        <hemisphereLight args={["#e2e8f0", "#27272a", 0.85]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[3, 5, 2]} intensity={1.35} />
        <Suspense fallback={<Html center className="text-xs text-zinc-400">Loading models…</Html>}>
          <Bounds fit margin={1.3}>
            <group>
              {bundle?.instances?.map((instance) => {
                const version =
                  bundle.versions.find((v) => v.id === instance.versionId) ||
                  bundle.versions.find((v) => v.componentId === instance.componentId);
                if (!version?.geometryPath) return null;
                const look = appearanceFromParameters(version.parameters || []);
                const component = bundle.components.find((item) => item.id === instance.componentId);
                return (
                  <group
                    key={instance.id}
                    position={[instance.position.x, instance.position.y, instance.position.z]}
                    rotation={[instance.rotation.x, instance.rotation.y, instance.rotation.z]}
                    scale={[instance.scale.x, instance.scale.y, instance.scale.z]}
                  >
                    <Model
                      key={`${instance.id}:${version.geometryPath}:${instance.versionId}:${look.color || ""}:${look.roughness}:${look.metalness}`}
                      url={version.geometryPath}
                      label={instance.label || component?.name || "part"}
                      selected={selectedIds.has(instance.id)}
                      color={look.color}
                      roughness={look.roughness}
                      metalness={look.metalness}
                      onSelect={(additive) =>
                        onSelect({ instanceId: instance.id, componentId: instance.componentId }, additive)
                      }
                    />
                  </group>
                );
              })}
            </group>
          </Bounds>
          <ContactShadows opacity={0.35} scale={4} blur={2.4} far={2} />
        </Suspense>
        <gridHelper args={[4, 80, "#3f3f46", "#27272a"]} />
        <BuildPlate />
        <PinMarkers markers={markers} activeId={activeId} />
        <SceneCursor
          markers={markers}
          hudCursor={hudCursor}
          hudGap={hudGap}
          pinButton={pinButton}
          hoverRef={hoverRef}
          onAltPin={(point) => onPlaceMarker?.(point, pinName.trim() || undefined)}
        />
        <OrbitControls makeDefault enablePan enableZoom />
        <GizmoHelper alignment="bottom-left" margin={[52, 52]}>
          <GizmoViewport axisColors={["#f87171", "#4ade80", "#60a5fa"]} labelColor="#e4e4e7" />
        </GizmoHelper>
      </Canvas>
      <div className="pointer-events-none absolute bottom-3 left-16 right-3 flex flex-wrap items-end justify-between gap-2 text-[11px]">
        <div className="rounded-md border border-zinc-800 bg-zinc-950/85 px-2 py-1.5 font-mono text-zinc-300">
          <div>X red · Y green · Z blue · cm</div>
          <div ref={hudCursor}>cursor — · move over the plate or a part</div>
          <div ref={hudGap} className="text-teal-200">
            Alt-click or Pin cursor to drop a landmark
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-1">
          <input
            value={pinName}
            onChange={(e) => setPinName(e.target.value)}
            placeholder="Pin name"
            aria-label="Pin name"
            className="w-28 rounded border border-zinc-700 bg-zinc-950/90 px-2 py-1 text-[11px] text-zinc-100"
          />
          <button
            ref={pinButton}
            type="button"
            disabled
            onClick={() => {
              if (!hoverRef.current) return;
              onPlaceMarker?.(hoverRef.current.point, pinName.trim() || undefined);
            }}
            className="rounded border border-zinc-700 bg-zinc-950/90 px-2 py-1 text-zinc-200 disabled:opacity-40"
          >
            Pin cursor
          </button>
        </div>
      </div>
      {!bundle?.instances.length ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
          {emptyLabel}
        </div>
      ) : null}
    </div>
  );
}
