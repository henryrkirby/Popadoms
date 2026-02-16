/**
 * physics.js — Lightweight fragment physics using simple integration.
 *
 * Fragments on a table surface: zero gravity, high friction, small outward
 * impulse on break. We avoid a full physics engine for fragments and use
 * simple velocity + damping. Rapier is available for future upgrades.
 */

/**
 * Create a fragment body for table-top physics.
 */
export function createFragmentBody(cell, tapX, tapZ) {
  const centroid = cell.centroid;
  const dx = centroid[0] - tapX;
  const dz = centroid[1] - tapZ;
  const dist = Math.sqrt(dx * dx + dz * dz) || 0.01;

  // Small outward impulse proportional to area
  const forceMag = 0.3 + cell.area * 0.5;

  return {
    id: Math.random().toString(36).slice(2, 9),
    cell,
    x: centroid[0],
    y: 0,
    z: centroid[1],
    vx: (dx / dist) * forceMag * (0.8 + Math.random() * 0.4),
    vy: 0.02 + Math.random() * 0.03, // tiny upward pop
    vz: (dz / dist) * forceMag * (0.8 + Math.random() * 0.4),
    rotation: 0,
    angularVel: (Math.random() - 0.5) * 2,
    // Tilt for the "landing" effect
    tiltX: (Math.random() - 0.5) * 0.3,
    tiltZ: (Math.random() - 0.5) * 0.3,
    settled: false,
    settleTimer: 0,
  };
}

/**
 * Step physics for all fragment bodies. dt in seconds.
 */
export function stepPhysics(bodies, dt) {
  const FRICTION = 0.92;
  const ANGULAR_FRICTION = 0.88;
  const GRAVITY = -2.0;
  const TABLE_Y = 0;

  for (const body of bodies) {
    if (body.settled) continue;

    // Integrate velocity
    body.vy += GRAVITY * dt;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    body.z += body.vz * dt;
    body.rotation += body.angularVel * dt;

    // Table collision
    if (body.y <= TABLE_Y) {
      body.y = TABLE_Y;
      body.vy *= -0.05; // almost no bounce
      if (Math.abs(body.vy) < 0.01) body.vy = 0;
    }

    // Friction (only when on table)
    if (body.y <= TABLE_Y + 0.001) {
      body.vx *= FRICTION;
      body.vz *= FRICTION;
      body.angularVel *= ANGULAR_FRICTION;
      body.tiltX *= 0.95;
      body.tiltZ *= 0.95;
    }

    // Check if settled
    const speed = Math.abs(body.vx) + Math.abs(body.vz) + Math.abs(body.vy);
    if (speed < 0.002 && body.y <= TABLE_Y + 0.001) {
      body.settleTimer += dt;
      if (body.settleTimer > 0.3) {
        body.settled = true;
        body.vx = 0;
        body.vy = 0;
        body.vz = 0;
        body.angularVel = 0;
        body.y = TABLE_Y;
      }
    } else {
      body.settleTimer = 0;
    }
  }
}

/**
 * Push a body (for drag interaction).
 */
export function pushBody(body, forceX, forceZ) {
  body.settled = false;
  body.settleTimer = 0;
  body.vx += forceX;
  body.vz += forceZ;
}
