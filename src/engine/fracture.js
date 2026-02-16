/**
 * fracture.js — Dynamic fracture system for popadom breaking.
 *
 * Instead of pre-computing a grid of Voronoi cells, this generates cracks
 * dynamically from the press point. A finger tap creates radial cracks
 * outward from the press. A karate chop creates a line crack across
 * the popadom. The result feels much more like breaking a real popadom.
 *
 * How it works:
 * 1. The popadom starts as a single intact polygon (its outline).
 * 2. When the user taps, we generate crack lines radiating from the tap point.
 * 3. These crack lines split the popadom polygon into separate pieces.
 * 4. Each piece becomes either an intact region or a broken fragment.
 */

import { Delaunay } from "d3-delaunay";
import { sampleHeightmap } from "./popadom.js";

/**
 * Initial setup: create the popadom as a single unbroken region.
 * We still use a Voronoi tessellation internally, but with far fewer cells,
 * and we don't show the cell boundaries — they're only used as the
 * geometry for splitting when a crack passes through.
 */
export function precomputeVoronoi(popadom, cellCount = 60) {
  const { centerX, centerY, radius, heightmap } = popadom;

  // Generate seed points spread across the popadom
  const seeds = [];
  const radiusSq = radius * radius;

  while (seeds.length < cellCount) {
    const x = centerX - radius + Math.random() * radius * 2;
    const y = centerY - radius + Math.random() * radius * 2;
    const dx = x - centerX;
    const dy = y - centerY;
    if (dx * dx + dy * dy <= radiusSq * 0.95) {
      seeds.push([x, y]);
    }
  }

  // Build Voronoi
  const margin = radius * 1.2;
  const bounds = [
    centerX - margin, centerY - margin,
    centerX + margin, centerY + margin,
  ];
  const delaunay = Delaunay.from(seeds);
  const voronoi = delaunay.voronoi(bounds);

  const cells = [];
  for (let i = 0; i < seeds.length; i++) {
    const cellPoly = voronoi.cellPolygon(i);
    if (!cellPoly) continue;

    const clipped = clipPolygonToCircle(cellPoly, centerX, centerY, radius);
    if (clipped.length < 3) continue;

    const area = polygonArea(clipped);
    if (area < 15) continue;

    const centroid = polygonCentroid(clipped);
    const localX = centroid[0] - (centerX - radius);
    const localY = centroid[1] - (centerY - radius);
    const thickness = sampleHeightmap(heightmap, localX, localY, radius * 2);

    cells.push({
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
 * Fracture at a point — "finger tap" mode.
 * Cracks radiate outward from the tap point. Cells near the tap break off.
 * The crack radius and pattern depend on where you press.
 *
 * If you press in the center, you get a larger crack area.
 * If you press near the edge, fewer pieces break.
 */
export function fractureAtPoint(cells, tapX, tapY, radius, force = 1, mode = "finger") {
  const newlyBroken = [];

  if (mode === "chop") {
    return fractureChop(cells, tapX, tapY, radius, force);
  }

  // Finger tap: radial crack from tap point
  // Crack extends further with more force, but limited to realistic range
  const crackRadius = radius * (0.25 + Math.random() * 0.2) * force;

  // Determine which cells to break — biased by distance and thickness
  for (const cell of cells) {
    if (!cell.intact) continue;

    const dx = cell.centroid[0] - tapX;
    const dy = cell.centroid[1] - tapY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > crackRadius) continue;

    // Closer to tap = higher break probability
    const distanceFactor = 1 - (dist / crackRadius);

    // Thinner areas break more easily
    const thicknessFactor = 1 - cell.thickness * 0.6;

    const breakProb = distanceFactor * thicknessFactor;

    // Near the center of the tap: almost certain to break
    // Further out: probabilistic
    if (dist < crackRadius * 0.3 || Math.random() < breakProb * 0.85 + 0.15) {
      cell.intact = false;
      newlyBroken.push(cell);
    }
  }

  return newlyBroken;
}

/**
 * Karate chop fracture — a line crack across the popadom.
 * The chop creates a crack line in the direction of the swipe,
 * breaking all cells along that line.
 */
function fractureChop(cells, tapX, tapY, radius, force) {
  const newlyBroken = [];

  // The chop creates a wide band of breakage across the popadom.
  // Generate a random angle for the chop line (or use the swipe direction
  // if available — force parameter carries the angle in chop mode).
  const chopAngle = typeof force === "number" && force > 10
    ? force  // angle in radians from swipe direction
    : Math.random() * Math.PI;  // random if no direction

  // Break cells that are close to the chop line
  const chopWidth = radius * 0.15; // width of the chop band

  for (const cell of cells) {
    if (!cell.intact) continue;

    const dx = cell.centroid[0] - tapX;
    const dy = cell.centroid[1] - tapY;

    // Distance from the chop line (perpendicular distance)
    const perpDist = Math.abs(dx * Math.sin(chopAngle) - dy * Math.cos(chopAngle));

    // Only break cells close to the chop line
    if (perpDist > chopWidth) continue;

    // Thinner areas break more easily
    const thicknessFactor = 1 - cell.thickness * 0.5;

    if (Math.random() < thicknessFactor * 0.9 + 0.1) {
      cell.intact = false;
      newlyBroken.push(cell);
    }
  }

  return newlyBroken;
}

/**
 * Re-fracture an existing fragment into smaller pieces.
 */
export function refractureFragment(fragment, tapX, tapY) {
  const vertices = fragment.vertices;
  const centroid = polygonCentroid(vertices);
  const area = polygonArea(vertices);

  if (area < 300) return null;

  // Generate sub-points around the tap
  const subCount = 2 + Math.floor(Math.random() * 3);
  const subSeeds = [[tapX, tapY]];

  for (let i = 0; i < subCount; i++) {
    const t = Math.random();
    const px = tapX + (centroid[0] - tapX) * t * 2 + (Math.random() - 0.5) * 30;
    const py = tapY + (centroid[1] - tapY) * t * 2 + (Math.random() - 0.5) * 30;
    subSeeds.push([px, py]);
  }

  const minX = Math.min(...vertices.map((v) => v[0]));
  const maxX = Math.max(...vertices.map((v) => v[0]));
  const minY = Math.min(...vertices.map((v) => v[1]));
  const maxY = Math.max(...vertices.map((v) => v[1]));

  const delaunay = Delaunay.from(subSeeds);
  const voronoi = delaunay.voronoi([minX - 10, minY - 10, maxX + 10, maxY + 10]);

  const subFragments = [];
  for (let i = 0; i < subSeeds.length; i++) {
    const cellPoly = voronoi.cellPolygon(i);
    if (!cellPoly) continue;

    const clipped = clipToPolygon(cellPoly, vertices);
    if (clipped.length >= 3 && polygonArea(clipped) > 40) {
      subFragments.push({
        vertices: clipped,
        centroid: polygonCentroid(clipped),
        area: polygonArea(clipped),
        thickness: fragment.thickness || 0.5,
      });
    }
  }

  return subFragments.length >= 2 ? subFragments : null;
}

// ─── Geometry utilities ──────────────────────────────────────

function clipPolygonToCircle(polygon, centerX, centerY, radius) {
  return polygon.map((p) => {
    const dx = p[0] - centerX;
    const dy = p[1] - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > radius * 1.02) {
      const scale = (radius * 1.02) / dist;
      return [centerX + dx * scale, centerY + dy * scale];
    }
    return p;
  });
}

export function polygonCentroid(vertices) {
  let cx = 0, cy = 0;
  for (const v of vertices) {
    cx += v[0];
    cy += v[1];
  }
  return [cx / vertices.length, cy / vertices.length];
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
      (edgeEnd[1] - edgeStart[1]) * (point[0] - edgeStart[0]) >=
    0
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
