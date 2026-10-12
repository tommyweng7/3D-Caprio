import type { AssemblyComponent, PlannedComponent, Vec3 } from "@/caprio/domain/types";
import { CANONICAL_SIZE, canonicalSize, inferPartKind, type PartKind } from "@/caprio/threed/part-shape";

export type Size3 = { x: number; y: number; z: number };

export type AssemblyFrame = {
  seat: Size3;
  cushion: Size3;
  back: Size3;
  leg: Size3;
  arm: Size3;
};

type NamedPart = { name: string; parameters?: Array<{ key: string; value: number | string; unit?: string }> };

export function frameFromParts(parts: NamedPart[]): AssemblyFrame {
  const pick = (kind: PartKind) => parts.find((part) => inferPartKind(part.name) === kind);
  const seat = canonicalSize("seat", pick("seat")?.parameters);
  const leg = canonicalSize("leg", pick("leg")?.parameters);
  const cushion = canonicalSize("cushion", pick("cushion")?.parameters);
  const back = canonicalSize("back", pick("back")?.parameters);
  const arm = canonicalSize("arm", pick("arm")?.parameters);
  return {
    seat,
    leg,
    cushion: { x: seat.x * 0.96, y: cushion.y, z: seat.z * 0.92 },
    back: { x: seat.x, y: back.y, z: back.z },
    arm: { x: arm.x, y: arm.y, z: seat.z * 0.85 },
  };
}

export function mergeMeasuredFrame(frame: AssemblyFrame, measured: Partial<Record<PartKind, Size3>>): AssemblyFrame {
  const seat = measured.seat || frame.seat;
  const leg = measured.leg || frame.leg;
  return {
    seat,
    leg,
    cushion: measured.cushion || { x: seat.x * 0.96, y: frame.cushion.y, z: seat.z * 0.92 },
    back: measured.back || { x: seat.x, y: frame.back.y, z: frame.back.z },
    arm: measured.arm || { x: frame.arm.x, y: frame.arm.y, z: seat.z * 0.85 },
  };
}

export function targetForKind(frame: AssemblyFrame, kind: PartKind): Size3 {
  if (kind === "generic") return frame.seat;
  return frame[kind];
}

export function poseForPart(
  kind: PartKind,
  instanceIndex: number,
  frame: AssemblyFrame,
): { position: Vec3; rotation: Vec3; scale: Vec3 } {
  const size = targetForKind(frame, kind);
  const { seat, leg } = frame;
  const rotation = { x: 0, y: 0, z: 0 };
  const scale = { x: 1, y: 1, z: 1 };
  const seatTop = leg.y + seat.y;
  const hx = seat.x / 2 - leg.x / 2;
  const hz = seat.z / 2 - leg.z / 2;

  if (kind === "seat") {
    return { position: { x: 0, y: leg.y + size.y / 2, z: 0 }, rotation, scale };
  }
  if (kind === "cushion") {
    return { position: { x: 0, y: seatTop + size.y / 2, z: 0 }, rotation, scale };
  }
  if (kind === "back") {
    return {
      position: {
        x: 0,
        y: seatTop + size.y / 2 - 0.02,
        z: -(seat.z / 2) - size.z / 2 + 0.008,
      },
      rotation,
      scale,
    };
  }
  if (kind === "arm") {
    const side = instanceIndex % 2 === 0 ? -1 : 1;
    return { position: { x: (seat.x / 2 - size.x / 2) * side, y: seatTop + size.y / 2, z: 0 }, rotation, scale };
  }
  if (kind === "leg") {
    const corners: Vec3[] = [
      { x: -hx, y: size.y / 2, z: hz },
      { x: hx, y: size.y / 2, z: hz },
      { x: -hx, y: size.y / 2, z: -hz },
      { x: hx, y: size.y / 2, z: -hz },
    ];
    return { position: corners[instanceIndex % 4], rotation, scale };
  }
  return { position: { x: instanceIndex * 0.35, y: size.y / 2, z: 0 }, rotation, scale };
}

export function defaultTransformFor(
  planned: PlannedComponent,
  instanceIndex: number,
  frame?: AssemblyFrame,
): { position: Vec3; rotation: Vec3; scale: Vec3 } {
  const resolved = frame || frameFromParts([planned]);
  return poseForPart(inferPartKind(planned.name), instanceIndex, resolved);
}

export function defaultConnectionPoints(label: string, position: Vec3) {
  const name = label.toLowerCase();
  if (/leg/.test(name)) {
    return [
      {
        name: "top",
        type: "tenon",
        position: { x: 0, y: CANONICAL_SIZE.leg.y / 2, z: 0 },
        orientation: { x: 0, y: 1, z: 0 },
        compatibleTypes: ["mortise", "seat_socket"],
        tolerance: 0.01,
        attachmentType: "tenon",
      },
    ];
  }
  if (/seat/.test(name)) {
    return [
      {
        name: "rear",
        type: "mortise",
        position: { ...position, z: position.z - CANONICAL_SIZE.seat.z / 2 },
        orientation: { x: 0, y: 0, z: -1 },
        compatibleTypes: ["back_tenon"],
        tolerance: 0.02,
        attachmentType: "mortise",
      },
      {
        name: "leg_socket",
        type: "seat_socket",
        position: { x: 0, y: -CANONICAL_SIZE.seat.y / 2, z: 0 },
        orientation: { x: 0, y: -1, z: 0 },
        compatibleTypes: ["tenon"],
        tolerance: 0.01,
        attachmentType: "socket",
      },
    ];
  }
  return [];
}

export function compatible(a: string[], b: string[]): boolean {
  return a.some((type) => b.includes(type));
}

export function instanceLabel(name: string, quantity: number, index: number): string {
  if (quantity <= 1) return name;
  if (/leg/i.test(name) && quantity === 4) {
    const corners = ["front left", "front right", "back left", "back right"];
    return `${name} ${index + 1} (${corners[index % 4]})`;
  }
  return `${name} ${index + 1}`;
}

export function transformsEqual(a: AssemblyComponent, b: Pick<AssemblyComponent, "position" | "rotation" | "scale">) {
  return a.position.x === b.position.x && a.position.y === b.position.y && a.position.z === b.position.z;
}
