import { canonicalSize, inferPartKind, looksLikeChairProfile, type PartKind } from "@/caprio/threed/part-shape";

type GlbJson = {
  accessors?: Array<{
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
    sparse?: unknown;
  }>;
  bufferViews?: Array<{
    buffer?: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }>;
  meshes?: Array<{
    primitives?: Array<{
      attributes?: { POSITION?: number; NORMAL?: number };
    }>;
  }>;
  nodes?: Array<{
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    matrix?: number[];
  }>;
};

const FLOAT = 5126;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function parseGlb(bytes: Buffer): { json: GlbJson; bin: Buffer } {
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF") {
    throw new Error("Not a GLB");
  }
  let offset = 12;
  let json: GlbJson = {};
  let bin = Buffer.alloc(0);
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) break;
    const chunk = bytes.subarray(start, end);
    if (type === JSON_CHUNK) json = JSON.parse(chunk.toString("utf8").trim()) as GlbJson;
    if (type === BIN_CHUNK) bin = Buffer.from(chunk);
    offset = end;
  }
  return { json, bin };
}

function packGlb(json: GlbJson, bin: Buffer): Buffer {
  const jsonBuf = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binBuf = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(JSON_CHUNK, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBuf.length, 0);
  binHeader.writeUInt32LE(BIN_CHUNK, 4);
  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binBuf]);
}

function pad(buf: Buffer, fill: number): Buffer {
  const extra = (4 - (buf.length % 4)) % 4;
  return extra ? Buffer.concat([buf, Buffer.alloc(extra, fill)]) : buf;
}

function accessorStride(json: GlbJson, accessorIndex: number): { offset: number; stride: number; count: number } | null {
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor || accessor.componentType !== FLOAT || accessor.type !== "VEC3" || accessor.sparse) return null;
  const view = json.bufferViews?.[accessor.bufferView ?? 0];
  if (!view || (view.buffer ?? 0) !== 0) return null;
  const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride || 12;
  return { offset, stride, count: accessor.count };
}

function readVec3(bin: Buffer, offset: number): [number, number, number] {
  return [bin.readFloatLE(offset), bin.readFloatLE(offset + 4), bin.readFloatLE(offset + 8)];
}

function writeVec3(bin: Buffer, offset: number, v: [number, number, number]) {
  bin.writeFloatLE(v[0], offset);
  bin.writeFloatLE(v[1], offset + 4);
  bin.writeFloatLE(v[2], offset + 8);
}

function permute(v: [number, number, number], order: [number, number, number]): [number, number, number] {
  return [v[order[0]], v[order[1]], v[order[2]]];
}

function axisOrder(kind: PartKind, size: [number, number, number]): [number, number, number] {
  const max = Math.max(...size);
  const min = Math.min(...size);
  if (max / Math.max(min, 1e-6) < 1.2) return [0, 1, 2];

  const ranked = [0, 1, 2].sort((a, b) => size[a] - size[b]);
  if (kind === "leg") {
    const up = ranked[2];
    const rest = [0, 1, 2].filter((i) => i !== up);
    return [rest[0], up, rest[1]];
  }
  if (kind === "back") {
    const thick = ranked[0];
    const rest = [0, 1, 2].filter((i) => i !== thick);
    const up = rest.includes(1) ? 1 : rest[1];
    const width = rest.find((i) => i !== up) ?? rest[0];
    return [width, up, thick];
  }
  const thick = ranked[0];
  const rest = [0, 1, 2].filter((i) => i !== thick);
  const width = size[rest[0]] >= size[rest[1]] ? rest[0] : rest[1];
  const depth = rest.find((i) => i !== width) ?? rest[0];
  return [width, thick, depth];
}

function positionAccessors(json: GlbJson): number[] {
  const ids = new Set<number>();
  for (const mesh of json.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      if (typeof primitive.attributes?.POSITION === "number") ids.add(primitive.attributes.POSITION);
    }
  }
  return [...ids];
}

function normalAccessors(json: GlbJson): number[] {
  const ids = new Set<number>();
  for (const mesh of json.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      if (typeof primitive.attributes?.NORMAL === "number") ids.add(primitive.attributes.NORMAL);
    }
  }
  return [...ids];
}

export function glbSize(bytes: Buffer): { x: number; y: number; z: number } {
  const { json } = parseGlb(bytes);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const index of positionAccessors(json)) {
    const acc = json.accessors?.[index];
    if (acc?.min && acc?.max) {
      for (let i = 0; i < 3; i += 1) {
        min[i] = Math.min(min[i], acc.min[i]);
        max[i] = Math.max(max[i], acc.max[i]);
      }
    }
  }
  return { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
}

export function looksLikeChairMesh(bytes: Buffer): boolean {
  const { json, bin } = parseGlb(bytes);
  const points: Array<[number, number, number]> = [];
  for (const index of positionAccessors(json)) {
    const layout = accessorStride(json, index);
    if (!layout) continue;
    const step = Math.max(1, Math.floor(layout.count / 3500));
    for (let i = 0; i < layout.count; i += step) {
      points.push(readVec3(bin, layout.offset + i * layout.stride));
    }
  }
  return looksLikeChairProfile(points);
}

export function fitPartGlb(
  bytes: Buffer,
  kind: PartKind,
  parameters?: Array<{ key: string; value: number | string; unit?: string }>,
  targetSize?: { x: number; y: number; z: number },
): Buffer {
  const { json, bin } = parseGlb(bytes);
  const positions = positionAccessors(json);
  if (!positions.length) return bytes;

  const rawMin = [Infinity, Infinity, Infinity];
  const rawMax = [-Infinity, -Infinity, -Infinity];
  for (const index of positions) {
    const layout = accessorStride(json, index);
    if (!layout) continue;
    for (let i = 0; i < layout.count; i += 1) {
      const v = readVec3(bin, layout.offset + i * layout.stride);
      for (let a = 0; a < 3; a += 1) {
        rawMin[a] = Math.min(rawMin[a], v[a]);
        rawMax[a] = Math.max(rawMax[a], v[a]);
      }
    }
  }
  const rawSize: [number, number, number] = [rawMax[0] - rawMin[0], rawMax[1] - rawMin[1], rawMax[2] - rawMin[2]];
  if (!rawSize.every((s) => Number.isFinite(s) && s > 1e-6)) return bytes;

  const order = axisOrder(kind, rawSize);
  const target = targetSize ?? canonicalSize(kind, parameters);
  const permutedMin = [Infinity, Infinity, Infinity];
  const permutedMax = [-Infinity, -Infinity, -Infinity];
  for (const index of positions) {
    const layout = accessorStride(json, index);
    if (!layout) continue;
    for (let i = 0; i < layout.count; i += 1) {
      const p = permute(readVec3(bin, layout.offset + i * layout.stride), order);
      for (let a = 0; a < 3; a += 1) {
        permutedMin[a] = Math.min(permutedMin[a], p[a]);
        permutedMax[a] = Math.max(permutedMax[a], p[a]);
      }
    }
  }
  const size = [0, 1, 2].map((a) => Math.max(permutedMax[a] - permutedMin[a], 1e-6));
  const scale = [target.x / size[0], target.y / size[1], target.z / size[2]];

  for (const index of positions) {
    const layout = accessorStride(json, index);
    if (!layout) continue;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < layout.count; i += 1) {
      const p = permute(readVec3(bin, layout.offset + i * layout.stride), order);
      const out: [number, number, number] = [
        (p[0] - permutedMin[0]) * scale[0] - target.x / 2,
        (p[1] - permutedMin[1]) * scale[1] - target.y / 2,
        (p[2] - permutedMin[2]) * scale[2] - target.z / 2,
      ];
      writeVec3(bin, layout.offset + i * layout.stride, out);
      for (let a = 0; a < 3; a += 1) {
        min[a] = Math.min(min[a], out[a]);
        max[a] = Math.max(max[a], out[a]);
      }
    }
    const accessor = json.accessors?.[index];
    if (accessor) {
      accessor.min = min;
      accessor.max = max;
    }
  }

  for (const index of normalAccessors(json)) {
    const layout = accessorStride(json, index);
    if (!layout) continue;
    for (let i = 0; i < layout.count; i += 1) {
      const n = permute(readVec3(bin, layout.offset + i * layout.stride), order);
      const scaled: [number, number, number] = [n[0] / scale[0], n[1] / scale[1], n[2] / scale[2]];
      const len = Math.hypot(...scaled) || 1;
      writeVec3(bin, layout.offset + i * layout.stride, [scaled[0] / len, scaled[1] / len, scaled[2] / len]);
    }
  }

  for (const node of json.nodes || []) {
    delete node.translation;
    delete node.rotation;
    delete node.scale;
    delete node.matrix;
  }

  return packGlb(json, bin);
}

export function fitPartGlbSafe(
  bytes: Buffer,
  partName?: string,
  prompt?: string,
  parameters?: Array<{ key: string; value: number | string; unit?: string }>,
  targetSize?: { x: number; y: number; z: number },
): Buffer {
  try {
    return fitPartGlb(bytes, inferPartKind(partName, prompt), parameters, targetSize);
  } catch {
    return bytes;
  }
}
