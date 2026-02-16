/**
 * physics.js — Matter.js physics engine setup for popadom fragments.
 *
 * What this does:
 * - Creates a physics world where fragments can fall, slide, settle, and collide
 * - Converts Voronoi cell polygons into physics bodies with realistic mass
 * - Handles fragment interactions (pushing with finger/cursor)
 * - Fragments settle naturally due to gravity and friction
 */

import Matter from "matter-js";

const { Engine, World, Bodies, Body, Composite, Events, Mouse, MouseConstraint, Vector } = Matter;

/**
 * Initialise the physics engine.
 * Returns an object with the engine and methods to add/remove bodies.
 *
 * @param {number} width - canvas width
 * @param {number} height - canvas height
 * @returns {object} physics controller
 */
export function createPhysics(width, height) {
  // Create the physics engine with gentle gravity (fragments should settle, not fly)
  const engine = Engine.create({
    gravity: { x: 0, y: 0.3, scale: 0.001 },
  });

  // Add invisible walls so fragments don't fly off screen
  const wallThickness = 50;
  const walls = [
    // bottom
    Bodies.rectangle(width / 2, height + wallThickness / 2, width + 100, wallThickness, {
      isStatic: true,
      friction: 0.8,
      label: "wall",
    }),
    // top
    Bodies.rectangle(width / 2, -wallThickness / 2, width + 100, wallThickness, {
      isStatic: true,
      friction: 0.8,
      label: "wall",
    }),
    // left
    Bodies.rectangle(-wallThickness / 2, height / 2, wallThickness, height + 100, {
      isStatic: true,
      friction: 0.8,
      label: "wall",
    }),
    // right
    Bodies.rectangle(width + wallThickness / 2, height / 2, wallThickness, height + 100, {
      isStatic: true,
      friction: 0.8,
      label: "wall",
    }),
  ];

  Composite.add(engine.world, walls);

  return {
    engine,
    walls,

    /**
     * Step the physics simulation forward.
     * Call this every frame (60fps = delta of ~16.67ms).
     */
    update(delta = 16.667) {
      Engine.update(engine, delta);
    },

    /**
     * Convert a fractured Voronoi cell into a physics body.
     *
     * @param {object} cell - cell from the fracture system
     * @param {number} tapX - where the user tapped (for impulse direction)
     * @param {number} tapY
     * @returns {Matter.Body} the physics body
     */
    addFragment(cell, tapX, tapY) {
      const { vertices, centroid, thickness, area } = cell;

      // Create the body from the cell's polygon vertices
      // Matter.js needs vertices relative to a position, so we'll use fromVertices
      const matterVerts = vertices.map((v) => ({
        x: Array.isArray(v) ? v[0] : v.x,
        y: Array.isArray(v) ? v[1] : v.y,
      }));

      const body = Bodies.fromVertices(centroid[0], centroid[1], matterVerts, {
        // Mass scales with area and thickness (thick bubbles are heavier)
        density: 0.001 * (0.5 + thickness * 0.5),
        friction: 0.6,
        frictionAir: 0.05, // air drag so fragments don't slide forever
        restitution: 0.1, // very slight bounce (popadoms don't bounce much)
        label: "fragment",
        // Store our custom data on the body for rendering
        popadomData: {
          originalVertices: vertices,
          thickness,
          area,
          centroid: [...centroid],
        },
      });

      if (!body) return null;

      // Apply a small impulse away from the tap point (crack force)
      const dx = centroid[0] - tapX;
      const dy = centroid[1] - tapY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const forceMagnitude = 0.0005 * (1 + area * 0.00001);

      Body.applyForce(body, body.position, {
        x: (dx / dist) * forceMagnitude,
        y: (dy / dist) * forceMagnitude + 0.0002, // slight downward bias
      });

      // Add a tiny random spin for visual interest
      Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.02);

      Composite.add(engine.world, body);
      return body;
    },

    /**
     * Remove a specific body (used when re-fracturing a fragment).
     */
    removeBody(body) {
      Composite.remove(engine.world, body);
    },

    /**
     * Get all fragment bodies currently in the world.
     */
    getFragments() {
      return Composite.allBodies(engine.world).filter(
        (b) => b.label === "fragment"
      );
    },

    /**
     * Apply a push force to a body (for dragging fragments).
     */
    pushBody(body, forceX, forceY) {
      Body.applyForce(body, body.position, { x: forceX, y: forceY });
    },

    /**
     * Find the body at a given point (for tap detection).
     */
    bodyAtPoint(x, y) {
      const bodies = Composite.allBodies(engine.world);
      for (const body of bodies) {
        if (body.label === "fragment" && Matter.Bounds.contains(body.bounds, { x, y })) {
          if (Matter.Vertices.contains(body.vertices, { x, y })) {
            return body;
          }
        }
      }
      return null;
    },

    /**
     * Clear all fragment bodies (for resetting / new popadom).
     */
    clearFragments() {
      const fragments = this.getFragments();
      for (const f of fragments) {
        Composite.remove(engine.world, f);
      }
    },

    /**
     * Resize the physics world (when window resizes).
     */
    resize(newWidth, newHeight) {
      // Remove old walls
      for (const wall of walls) {
        Composite.remove(engine.world, wall);
      }
      // Create new walls
      walls.length = 0;
      walls.push(
        Bodies.rectangle(newWidth / 2, newHeight + wallThickness / 2, newWidth + 100, wallThickness, {
          isStatic: true, friction: 0.8, label: "wall",
        }),
        Bodies.rectangle(newWidth / 2, -wallThickness / 2, newWidth + 100, wallThickness, {
          isStatic: true, friction: 0.8, label: "wall",
        }),
        Bodies.rectangle(-wallThickness / 2, newHeight / 2, wallThickness, newHeight + 100, {
          isStatic: true, friction: 0.8, label: "wall",
        }),
        Bodies.rectangle(newWidth + wallThickness / 2, newHeight / 2, wallThickness, newHeight + 100, {
          isStatic: true, friction: 0.8, label: "wall",
        })
      );
      Composite.add(engine.world, walls);
    },
  };
}
