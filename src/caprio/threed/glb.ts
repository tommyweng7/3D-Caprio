import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function concat(chunks: Uint8Array[]): Buffer {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = Buffer.alloc(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function pad4(buf: Buffer): Buffer {
  const pad = (4 - (buf.length % 4)) % 4;
  if (!pad) return buf;
  return concat([buf, Buffer.alloc(pad, 0x20)]);
}

export function buildBoxGlb(sx = 1, sy = 1, sz = 1, color: [number, number, number] = [0.72, 0.52, 0.3]): Buffer {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const faces: Array<{ n: [number, number, number]; v: Array<[number, number, number]> }> = [
    { n: [0, 1, 0], v: [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, -1, 0], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [-hx, -hy, -hz]] },
    { n: [0, 0, 1], v: [[-hx, -hy, hz], [-hx, hy, hz], [hx, hy, hz], [hx, -hy, hz]] },
    { n: [0, 0, -1], v: [[hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz], [-hx, -hy, -hz]] },
    { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, hy, hz], [hx, hy, -hz], [hx, -hy, -hz]] },
    { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, hy, -hz], [-hx, hy, hz], [-hx, -hy, hz]] },
  ];
  const indices: number[] = [];
  let i = 0;
  for (const face of faces) {
    for (const p of face.v) {
      positions.push(...p);
      normals.push(...face.n);
    }
    indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    i += 4;
  }
  return packGlb(positions, normals, indices, color);
}

export function buildCylinderGlb(
  radius = 0.04,
  height = 0.45,
  segments = 16,
  color: [number, number, number] = [0.45, 0.28, 0.14],
): Buffer {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const hy = height / 2;

  for (let s = 0; s <= segments; s += 1) {
    const t = (s / segments) * Math.PI * 2;
    const x = Math.cos(t) * radius;
    const z = Math.sin(t) * radius;
    positions.push(x, -hy, z, x, hy, z);
    const nx = Math.cos(t);
    const nz = Math.sin(t);
    normals.push(nx, 0, nz, nx, 0, nz);
  }
  for (let s = 0; s < segments; s += 1) {
    const a = s * 2;
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }

  const topCenter = positions.length / 3;
  positions.push(0, hy, 0);
  normals.push(0, 1, 0);
  const bottomCenter = positions.length / 3;
  positions.push(0, -hy, 0);
  normals.push(0, -1, 0);

  for (let s = 0; s < segments; s += 1) {
    const t0 = (s / segments) * Math.PI * 2;
    const t1 = ((s + 1) / segments) * Math.PI * 2;
    const i0 = positions.length / 3;
    positions.push(Math.cos(t0) * radius, hy, Math.sin(t0) * radius);
    normals.push(0, 1, 0);
    const i1 = positions.length / 3;
    positions.push(Math.cos(t1) * radius, hy, Math.sin(t1) * radius);
    normals.push(0, 1, 0);
    indices.push(topCenter, i0, i1);

    const j0 = positions.length / 3;
    positions.push(Math.cos(t0) * radius, -hy, Math.sin(t0) * radius);
    normals.push(0, -1, 0);
    const j1 = positions.length / 3;
    positions.push(Math.cos(t1) * radius, -hy, Math.sin(t1) * radius);
    normals.push(0, -1, 0);
    indices.push(bottomCenter, j1, j0);
  }

  return packGlb(positions, normals, indices, color);
}

function packGlb(
  positions: number[],
  normals: number[],
  indices: number[],
  color: [number, number, number],
): Buffer {
  const pos = new Float32Array(positions);
  const nrm = new Float32Array(normals);
  const idx = new Uint16Array(indices);
  const bin = Buffer.concat([
    Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength),
    Buffer.from(nrm.buffer, nrm.byteOffset, nrm.byteLength),
    Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength),
  ]);

  const posLen = pos.byteLength;
  const nrmLen = nrm.byteLength;
  const json = {
    asset: { version: "2.0", generator: "3D-Caprio local primitive" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: "VEC3",
        min: min3(positions),
        max: max3(positions),
      },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: indices.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posLen },
      { buffer: 0, byteOffset: posLen, byteLength: nrmLen },
      { buffer: 0, byteOffset: posLen + nrmLen, byteLength: idx.byteLength, target: 34963 },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [...color, 1],
          metallicFactor: 0.05,
          roughnessFactor: 0.7,
        },
      },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  const jsonBuf = pad4(Buffer.from(JSON.stringify(json), "utf8"));
  const binPad = (4 - (bin.length % 4)) % 4;
  const binBuf = binPad ? Buffer.concat([bin, Buffer.alloc(binPad)]) : bin;
  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBuf.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binBuf]);
}

function min3(p: number[]): [number, number, number] {
  let x = Infinity,
    y = Infinity,
    z = Infinity;
  for (let i = 0; i < p.length; i += 3) {
    x = Math.min(x, p[i]);
    y = Math.min(y, p[i + 1]);
    z = Math.min(z, p[i + 2]);
  }
  return [x, y, z];
}

function max3(p: number[]): [number, number, number] {
  let x = -Infinity,
    y = -Infinity,
    z = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    x = Math.max(x, p[i]);
    y = Math.max(y, p[i + 1]);
    z = Math.max(z, p[i + 2]);
  }
  return [x, y, z];
}

export async function writeGlb(filePath: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
}
