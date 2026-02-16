/**
 * Game.jsx — The main game component. This is where everything comes together.
 *
 * What this does:
 * - Creates the full-screen canvas
 * - Initialises the popadom, physics, and sound systems
 * - Runs the game loop (60fps render + physics update)
 * - Handles tap-to-crack and drag-to-push interactions
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { createPopadom } from "../engine/popadom.js";
import { precomputeVoronoi, fractureAtPoint, refractureFragment, polygonCentroid, polygonArea } from "../engine/fracture.js";
import { createPhysics } from "../engine/physics.js";
import { createPopadomTexture, render } from "../engine/renderer.js";
import { initAudio, playCrackSound, playSlideSound, playNewPopadomSound } from "../audio/soundManager.js";
import { setupInput } from "../input/inputHandler.js";

export default function Game() {
  const canvasRef = useRef(null);
  const gameStateRef = useRef(null);
  const animFrameRef = useRef(null);
  const cleanupInputRef = useRef(null);
  const [showNewButton, setShowNewButton] = useState(false);

  /**
   * Initialise or reset the game with a fresh popadom.
   */
  const initGame = useCallback((canvas) => {
    const width = canvas.width;
    const height = canvas.height;

    // Create the popadom — centred on screen, sized to fit nicely
    const radius = Math.min(width, height) * 0.35;
    const centerX = width / 2;
    const centerY = height / 2;

    const popadom = createPopadom(centerX, centerY, radius);

    // Pre-compute the Voronoi cells (invisible fracture lines)
    const cells = precomputeVoronoi(popadom, 90);

    // Create the texture (the visual surface of the popadom)
    const texture = createPopadomTexture(popadom);

    // Set up physics (or reuse existing, just clear fragments)
    let physics = gameStateRef.current?.physics;
    if (physics) {
      physics.clearFragments();
      physics.resize(width, height);
    } else {
      physics = createPhysics(width, height);
    }

    gameStateRef.current = {
      width,
      height,
      popadom,
      cells,
      physics,
      texture,
      dragTarget: null, // the body being dragged
    };

    setShowNewButton(false);
  }, []);

  /**
   * Handle a tap/click — crack the popadom or break a fragment further.
   */
  const handleTap = useCallback((x, y) => {
    const state = gameStateRef.current;
    if (!state) return;

    initAudio(); // ensure audio is ready (browser requires user gesture)

    const { cells, physics, popadom } = state;

    // First, check if we tapped on an existing physics fragment
    const hitBody = physics.bodyAtPoint(x, y);
    if (hitBody && hitBody.popadomData) {
      // Re-fracture this fragment into smaller pieces
      const subFragments = refractureFragment(hitBody.popadomData, x, y);
      if (subFragments) {
        physics.removeBody(hitBody);
        for (const sub of subFragments) {
          physics.addFragment(sub, x, y);
        }
        playCrackSound(0.3, subFragments.length);
        return;
      }
    }

    // Otherwise, crack the intact popadom
    const intactCount = cells.filter((c) => c.intact).length;
    if (intactCount === 0) return; // nothing left to crack

    const newlyBroken = fractureAtPoint(cells, x, y, popadom.radius);

    if (newlyBroken.length > 0) {
      // Convert broken cells to physics bodies
      for (const cell of newlyBroken) {
        physics.addFragment(cell, x, y);
      }

      // Play crack sound — louder and richer for bigger cracks
      const intensity = Math.min(1, newlyBroken.length / 8);
      playCrackSound(intensity, newlyBroken.length);
    }

    // Check if the whole popadom is broken
    const remaining = cells.filter((c) => c.intact).length;
    if (remaining === 0) {
      setShowNewButton(true);
    }
  }, []);

  /**
   * Handle drag — push fragments around.
   */
  const handleDragMove = useCallback((x, y, dx, dy) => {
    const state = gameStateRef.current;
    if (!state) return;

    const body = state.physics.bodyAtPoint(x, y);
    if (body && body.label === "fragment") {
      const force = 0.0003;
      state.physics.pushBody(body, dx * force, dy * force);

      const speed = Math.sqrt(dx * dx + dy * dy);
      playSlideSound(speed);
    }
  }, []);

  /**
   * Handle new popadom request.
   */
  const handleNewPopadom = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    playNewPopadomSound();
    initGame(canvas);
  }, [initGame]);

  /**
   * Main setup: canvas sizing, input binding, game loop.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    // Size the canvas to fill the screen
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.scale(dpr, dpr);

      // Reinitialise the game at the new size
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initGame(canvas);
    }

    resize();
    window.addEventListener("resize", resize);

    // Set up input handling
    cleanupInputRef.current = setupInput(canvas, {
      onTap: handleTap,
      onDragStart: () => {},
      onDragMove: handleDragMove,
      onDragEnd: () => {},
    });

    // Game loop — runs every frame (~60fps)
    let lastTime = performance.now();
    function gameLoop(timestamp) {
      const delta = timestamp - lastTime;
      lastTime = timestamp;

      const state = gameStateRef.current;
      if (state) {
        // Step the physics simulation
        state.physics.update(Math.min(delta, 32)); // cap delta to prevent physics explosions

        // Draw everything
        render(ctx, state);
      }

      animFrameRef.current = requestAnimationFrame(gameLoop);
    }

    animFrameRef.current = requestAnimationFrame(gameLoop);

    // Cleanup when component unmounts
    return () => {
      window.removeEventListener("resize", resize);
      if (cleanupInputRef.current) cleanupInputRef.current();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [initGame, handleTap, handleDragMove]);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          touchAction: "none", // prevent browser gestures on mobile
          cursor: "pointer",
        }}
      />

      {/* New Popadom button — appears when the popadom is fully broken */}
      {showNewButton && (
        <button
          onClick={handleNewPopadom}
          style={{
            position: "absolute",
            bottom: "40px",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "14px 32px",
            fontSize: "18px",
            fontFamily: "'Georgia', serif",
            background: "rgba(139, 90, 43, 0.85)",
            color: "#FFF5E6",
            border: "2px solid rgba(255, 245, 230, 0.3)",
            borderRadius: "30px",
            cursor: "pointer",
            backdropFilter: "blur(8px)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
            transition: "all 0.2s ease",
            letterSpacing: "1px",
          }}
          onMouseEnter={(e) => {
            e.target.style.background = "rgba(160, 105, 50, 0.95)";
            e.target.style.transform = "translateX(-50%) scale(1.05)";
          }}
          onMouseLeave={(e) => {
            e.target.style.background = "rgba(139, 90, 43, 0.85)";
            e.target.style.transform = "translateX(-50%) scale(1)";
          }}
        >
          New Popadom
        </button>
      )}
    </div>
  );
}
