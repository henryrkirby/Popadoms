/**
 * physics.js — Matter.js physics for popadom fragments.
 *
 * Key change from v1: NO gravity. Fragments receive a small outward impulse
 * when they break off, then settle quickly with high friction. They stay
 * on the table exactly where they land — like a real popadom.
 */

import Matter from "matter-js";

const { Engine, Bodies, Body, Composite, Vertices, Bounds } = Matter;

/**
 * Create the physics engine.
 */
export function createPhysics(width, height) {
  // Zero gravity — fragments stay on the table surface
  const engine = Engine.create({
    gravity: { x: 0, y: 0, scale: 0.001 },
  });

  // Invisible walls to keep things on screen
  const wallThickness = 50;
  const walls = createWalls(width, height, wallThickness);
  Composite.add(engine.world, walls);

  return {
    engine,
    walls,

    update(delta = 16.667) {
      Engine.update(engine, delta);

      // Apply strong damping so fragments settle quickly
      const bodies = Composite.allBodies(engine.world);
      for (const body of bodies) {
        if (body.label === "fragment" && !body.isStatic) {
          // Gradually slow down — simulates table friction
          const speed = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2);
          if (speed > 0.05) {
            Body.setVelocity(body, {
              x: body.velocity.x * 0.92,
              y: body.velocity.y * 0.92,
            });
            Body.setAngularVelocity(body, body.angularVelocity * 0.9);
          } else if (speed > 0) {
            // Fully stop when barely moving
            Body.setVelocity(body, { x: 0, y: 0 });
            Body.setAngularVelocity(body, 0);
          }
        }
      }
    },

    /**
     * Convert a fractured cell into a physics body.
     * Applies a small outward impulse from the tap point.
     */
    addFragment(cell, tapX, tapY) {
      const { vertices, centroid, thickness, area } = cell;

      const matterVerts = vertices.map((v) => ({
        x: Array.isArray(v) ? v[0] : v.x,
        y: Array.isArray(v) ? v[1] : v.y,
      }));

      const body = Bodies.fromVertices(centroid[0], centroid[1], matterVerts, {
        density: 0.001 * (0.5 + (thickness || 0.5) * 0.5),
        friction: 0.9,
        frictionAir: 0.15,    // High air friction = quick settling
        restitution: 0.05,    // Almost no bounce
        label: "fragment",
        popadomData: {
          originalVertices: vertices,
          thickness: thickness || 0.5,
          area,
          centroid: Array.isArray(centroid) ? [...centroid] : [centroid.x, centroid.y],
        },
      });

      if (!body) return null;

      // Small outward impulse from the tap — pieces spread slightly apart
      const dx = centroid[0] - tapX;
      const dy = centroid[1] - tapY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const forceMag = 0.0003 * (1 + area * 0.000005);

      Body.applyForce(body, body.position, {
        x: (dx / dist) * forceMag,
        y: (dy / dist) * forceMag,
      });

      // Tiny random spin
      Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.015);

      Composite.add(engine.world, body);
      return body;
    },

    removeBody(body) {
      Composite.remove(engine.world, body);
    },

    getFragments() {
      return Composite.allBodies(engine.world).filter(
        (b) => b.label === "fragment"
      );
    },

    pushBody(body, forceX, forceY) {
      Body.applyForce(body, body.position, { x: forceX, y: forceY });
    },

    bodyAtPoint(x, y) {
      const bodies = Composite.allBodies(engine.world);
      for (const body of bodies) {
        if (body.label === "fragment" && Bounds.contains(body.bounds, { x, y })) {
          if (Vertices.contains(body.vertices, { x, y })) {
            return body;
          }
        }
      }
      return null;
    },

    clearFragments() {
      const fragments = this.getFragments();
      for (const f of fragments) {
        Composite.remove(engine.world, f);
      }
    },

    resize(newWidth, newHeight) {
      for (const wall of walls) {
        Composite.remove(engine.world, wall);
      }
      walls.length = 0;
      const newWalls = createWalls(newWidth, newHeight, wallThickness);
      walls.push(...newWalls);
      Composite.add(engine.world, walls);
    },
  };
}

function createWalls(width, height, thickness) {
  const opts = { isStatic: true, friction: 0.9, label: "wall" };
  return [
    Bodies.rectangle(width / 2, height + thickness / 2, width + 100, thickness, opts),
    Bodies.rectangle(width / 2, -thickness / 2, width + 100, thickness, opts),
    Bodies.rectangle(-thickness / 2, height / 2, thickness, height + 100, opts),
    Bodies.rectangle(width + thickness / 2, height / 2, thickness, height + 100, opts),
  ];
}
