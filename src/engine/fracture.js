/**
 * fracture.js — 3D Voronoi-based fracture for the popadom disc.
 *
 * 1. Pre-seeds Voronoi cells across the disc (stored but hidden).
 * 2. When the user taps, cells near the press point are "released" as fragments.
 * 3. Each fragment gets extruded into a thin 3D mesh (BufferGeometry).
 * 4. The stress model determines which cells break based on distance, thickness,
 *    and accumulated pressure.
 */

import * as THREE from "three";
import { Delaunay } from "d3-delaunay";
import { sampleHeightmap } from "./popadom.js";

/**
 * Pre-compute Voronoi cells across the popadom disc.
 * Returns an array of cell objects with 2D polygon vertices in the XZ plane.
 */
export function precomputeCells(popadomData, cellCount = 55) {
  const { radius, heightmap } = popadomData;
  const radiusSq = radius * radius;

  const seeds = [];
  while (seeds.length < cellCount) {
    const x = (Math.random() * 2 - 1) * radius;
    const z = (Math.random() * 2 - 1) * radius;
    if (x * x + z * z <= radiusSq * 0.92) {
      seeds.push([x, z]);
    }
  }

  const margin = radius * 1.3;
  const bounds = [-margin, -margin, margin, margin];
  const delaunay = Delaunay.from(seeds);
  const voronoi = delaunay.voronoi(bounds);

  const cells = [];
  for (let i = 0; i < seeds.length; i++) {
    const rawPoly = voronoi.cellPolygon(i);
    if (!rawPoly) continue;

    const clipped = clipToDisc(rawPoly, radius);
    if (clipped.length < 3) continue;

    const area = polygonArea(clipped);
    if (area < 0.005) continue;

    const centroid = polygonCentroid(clipped);
    const u = (centroid[0] / radius + 1) / 2;
    const v = (centroid[1] / radius + 1) / 2;
    const thickness = sampleHeightmap(heightmap, u, v);

    cells.push({
      id: i,
      seed: seeds[i],
      vertices: clipped,
      centroid,
      area,
      thickness,
      intact: true,
    });
  }

  return cells;
}

/**
 * Determine which cells break from a tap/press.
 */
export function fractureAtPoint(cells, tapX, tapZ, radius, pressure = 0.5, mode = "finger") {
  if (mode === "chop") {
    return fractureChop(cells, tapX, tapZ, radius, pressure);
  }

  const newlyBroken = [];
  const crackRadius = radius * (0.2 + pressure * 0.4 + Math.random() * 0.1);

  for (const cell of cells) {
    if (!cell.intact) continue;

    const dx = cell.centroid[0] - tapX;
    const dz = cell.centroid[1] - tapZ;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist > crackRadius) continue;

    const distanceFactor = 1 - dist / crackRadius;
    const thicknessFactor = 1 - cell.thickness * 0.6;
    const breakProb = distanceFactor * thicknessFactor * (0.5 + pressure * 0.5);

    if (dist < crackRadius * 0.25 || Math.random() < breakProb * 0.85 + 0.15) {
      cell.intact = false;
      newlyBroken.push(cell);
    }
  }

  return newlyBroken;
}

function fractureChop(cells, tapX, tapZ, radius, pressure) {
  const newlyBroken = [];
  const chopAngle = Math.random() * Math.PI;
  const chopWidth = radius * (0.1 + pressure * 0.1);

  for (const cell of cells) {
    if (!cell.intact) continue;

    const dx = cell.centroid[0] - tapX;
    const dz = cell.centroid[1] - tapZ;
    const perpDist = Math.abs(dx * Math.sin(chopAngle) - dz * Math.cos(chopAngle));

    if (perpDist > chopWidth) continue;

    const thicknessFactor = 1 - cell.thickness * 0.5;
    if (Math.random() < thicknessFactor * 0.9 + 0.1) {
      cell.intact = false;
      newlyBroken.push(cell);
    }
  }

  return newlyBroken;
}

/**
 * Re-fracture an existing fragment into smaller sub-pieces.
 */
export function refractureFragment(fragment, tapX, tapZ) {
  const vertices = fragment.vertices;
  const area = fragment.area;

  if (area < 0.02) return null;

  const centroid = fragment.centroid;
  const subCount = 2 + Math.floor(Math.random() * 3);
  const subSeeds = [[tapX, tapZ]];

  for (let i = 0; i < subCount; i++) {
    const t = Math.random();
    const px = tapX + (centroid[0] - tapX) * t * 2 + (Math.random() - 0.5) * 0.2;
    const pz = tapZ + (centroid[1] - tapZ) * t * 2 + (Math.random() - 0.5) * 0.2;
    subSeeds.push([px, pz]);
  }

  const minX = Math.min(...vertices.map((v) => v[0]));
  const maxX = Math.max(...vertices.map((v) => v[0]));
  const minZ = Math.min(...vertices.map((v) => v[1]));
  const maxZ = Math.max(...vertices.map((v) => v[1]));

  const delaunay = Delaunay.from(subSeeds);
  const voronoi = delaunay.voronoi([minX - 0.05, minZ - 0.05, maxX + 0.05, maxZ + 0.05]);

  const subFragments = [];
  for (let i = 0; i < subSeeds.length; i++) {
    const cellPoly = voronoi.cellPolygon(i);
    if (!cellPoly) continue;

    const clipped = clipToPolygon(cellPoly, vertices);
    if (clipped.length >= 3) {
      const subArea = polygonArea(clipped);
      if (subArea > 0.003) {
        subFragments.push({
          vertices: clipped,
          centroid: polygonCentroid(clipped),
          area: subArea,
          thickness: fragment.thickness || 0.5,
        });
      }
    }
  }

  return subFragments.length >= 2 ? subFragments : null;
}

/**
 * Build a Three.js BufferGeometry for a fragment.
 * Extrudes the 2D polygon into a thin 3D slab.
 */
export function buildFragmentGeometry(cell, popadomData, halfThickness = 0.012) {
  const { vertices } = cell;
  const { heightmap, radius } = popadomData;
  const n = vertices.length;

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const centroid = polygonCentroid(vertices);

  // Top face vertices
  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    const u = (v[0] / radius + 1) / 2;
    const uv = (v[1] / radius + 1) / 2;
    const h = sampleHeightmap(heightmap, u, uv);
    const yOffset = h * 0.02;

    positions.push(v[0], halfThickness + yOffset, v[1]);
    normals.push(0, 1, 0);
    uvs.push(u, uv);
  }

  // Centroid for top fan
  const cu = (centroid[0] / radius + 1) / 2;
  const cv = (centroid[1] / radius + 1) / 2;
  const ch = sampleHeightmap(heightmap, cu, cv);
  positions.push(centroid[0], halfThickness + ch * 0.02, centroid[1]);
  normals.push(0, 1, 0);
  uvs.push(cu, cv);
  const topCenterIdx = n;

  for (let i = 0; i < n; i++) {
    indices.push(topCenterIdx, i, (i + 1) % n);
  }

  // Bottom face
  const bottomStart = n + 1;
  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    const u = (v[0] / radius + 1) / 2;
    const uv = (v[1] / radius + 1) / 2;
    positions.push(v[0], -halfThickness, v[1]);
    normals.push(0, -1, 0);
    uvs.push(u, uv);
  }
  positions.push(centroid[0], -halfThickness, centroid[1]);
  normals.push(0, -1, 0);
  uvs.push(cu, cv);
  const bottomCenterIdx = bottomStart + n;

  for (let i = 0; i < n; i++) {
    indices.push(bottomCenterIdx, bottomStart + (i + 1) % n, bottomStart + i);
  }

  // Side faces
  const sideStart = bottomCenterIdx + 1;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const vCurr = vertices[i];
    const vNext = vertices[next];

    const ex = vNext[0] - vCurr[0];
    const ez = vNext[1] - vCurr[1];
    const len = Math.sqrt(ex * ex + ez * ez) || 1;
    const nx = ez / len;
    const nz = -ex / len;

    const baseIdx = sideStart + i * 4;

    const topY_i = positions[i * 3 + 1];
    const topY_next = positions[next * 3 + 1];

    positions.push(vCurr[0], topY_i, vCurr[1]);
    normals.push(nx, 0, nz);
    uvs.push(0, 1);

    positions.push(vNext[0], topY_next, vNext[1]);
    normals.push(nx, 0, nz);
    uvs.push(1, 1);

    positions.push(vNext[0], -halfThickness, vNext[1]);
    normals.push(nx, 0, nz);
    uvs.push(1, 0);

    positions.push(vCurr[0], -halfThickness, vCurr[1]);
    normals.push(nx, 0, nz);
    uvs.push(0, 0);

    indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return geometry;
}

// ─── Geometry helpers ──────────────────────────────────────────

function clipToDisc(polygon, radius) {
  const result = [];
  const rSq = radius * radius;
  for (const p of polygon) {
    const x = p[0], z = p[1];
    const dSq = x * x + z * z;
    if (dSq <= rSq) {
      result.push([x, z]);
    } else {
      const scale = radius / Math.sqrt(dSq);
      result.push([x * scale, z * scale]);
    }
  }
  return result;
}

export function polygonCentroid(vertices) {
  let cx = 0, cz = 0;
  for (const v of vertices) {
    cx += v[0];
    cz += v[1];
  }
  return [cx / vertices.length, cz / vertices.length];
}

export function polygonArea(vertices) {
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i][0] * vertices[j][1];
    area -= vertices[j][0] * vertices[i][1];
  }
  return Math.abs(area) / 2;
}

function clipToPolygon(subject, clip) {
  let output = subject.map((p) => (Array.isArray(p) ? p : [p.x, p.y]));
  const clipVerts = clip.map((p) => (Array.isArray(p) ? p : [p.x, p.y]));

  for (let i = 0; i < clipVerts.length; i++) {
    if (output.length === 0) return [];
    const input = output;
    output = [];

    const edgeStart = clipVerts[i];
    const edgeEnd = clipVerts[(i + 1) % clipVerts.length];

    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const previous = input[(j + input.length - 1) % input.length];

      const currInside = isInside(current, edgeStart, edgeEnd);
      const prevInside = isInside(previous, edgeStart, edgeEnd);

      if (currInside) {
        if (!prevInside) {
          const inter = intersect(previous, current, edgeStart, edgeEnd);
          if (inter) output.push(inter);
        }
        output.push(current);
      } else if (prevInside) {
        const inter = intersect(previous, current, edgeStart, edgeEnd);
        if (inter) output.push(inter);
      }
    }
  }

  return output;
}

function isInside(point, edgeStart, edgeEnd) {
  return (
    (edgeEnd[0] - edgeStart[0]) * (point[1] - edgeStart[1]) -
      (edgeEnd[1] - edgeStart[1]) * (point[0] - edgeStart[0]) >= 0
  );
}

function intersect(a, b, c, d) {
  const denom =
    (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  if (Math.abs(denom) < 1e-10) return null;
  const t =
    ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / denom;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}
