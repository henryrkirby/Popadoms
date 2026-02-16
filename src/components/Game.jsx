/**
 * Game.jsx — Main game component using React Three Fiber.
 *
 * Orchestrates:
 * - 3D scene with table, popadom, lighting
 * - Press-to-snap stress model (hold to build pressure, release to crack)
 * - Voronoi fracture -> 3D fragment meshes
 * - Fragment physics (outward impulse, table friction, settling)
 * - Contact mode switching (finger tap vs karate chop)
 * - Audio (Howler.js crack sounds + ambient Indian restaurant)
 */

import { useRef, useCallback, useState, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

import { createPopadomData, sampleHeightmap } from "../engine/popadom.js";
import { precomputeCells, fractureAtPoint, buildFragmentGeometry, refractureFragment } from "../engine/fracture.js";
import { createFragmentBody, stepPhysics } from "../engine/physics.js";
import { initAudio, playCrackSound, playNewPopadomSound, startAmbient } from "../audio/soundManager.js";

// ─── Popadom texture (procedural, on a canvas) ────────────────

function createPopadomCanvasTexture(heightmap, resolution = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(resolution, resolution);
  const pixels = imageData.data;
  const halfRes = resolution / 2;

  for (let py = 0; py < resolution; py++) {
    for (let px = 0; px < resolution; px++) {
      const dx = px - halfRes;
      const dy = py - halfRes;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > halfRes * 1.02) continue;

      const hx = Math.floor((px / resolution) * heightmap.width);
      const hy = Math.floor((py / resolution) * heightmap.height);
      const h = heightmap.data[hy * heightmap.width + hx] || 0.5;

      let r = 200 + h * 45;
      let g = 155 + h * 40;
      let b = 65 + h * 30;

      if (h < 0.28) {
        const ci = (0.28 - h) * 3.0;
        r -= ci * 60;
        g -= ci * 50;
        b -= ci * 25;
      }

      const grain = (Math.sin(px * 127.1 + py * 311.7) * 43758.5453) % 1;
      const speckle = (grain - 0.5) * 12;

      const edgeFactor = dist / halfRes;
      let edgeDarken = 0;
      if (edgeFactor > 0.82) edgeDarken = (edgeFactor - 0.82) * 280;

      let shadow = 0;
      if (hx > 0 && hy > 0 && hx < heightmap.width && hy < heightmap.height) {
        const hLeft = heightmap.data[hy * heightmap.width + (hx - 1)] || 0.5;
        const hUp = heightmap.data[(hy - 1) * heightmap.width + hx] || 0.5;
        shadow = ((h - hLeft) + (h - hUp)) * 55;
      }

      const idx = (py * resolution + px) * 4;
      pixels[idx] = Math.max(0, Math.min(255, r + speckle + shadow - edgeDarken));
      pixels[idx + 1] = Math.max(0, Math.min(255, g + speckle + shadow * 0.8 - edgeDarken));
      pixels[idx + 2] = Math.max(0, Math.min(255, b + speckle + shadow * 0.5 - edgeDarken));

      let alpha = 255;
      if (dist > halfRes * 0.97) {
        alpha = Math.max(0, 255 * (1 - (dist - halfRes * 0.97) / (halfRes * 0.05)));
      }
      pixels[idx + 3] = alpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Bubble highlights
  ctx.globalCompositeOperation = "screen";
  for (let y = 0; y < heightmap.height; y++) {
    for (let x = 0; x < heightmap.width; x++) {
      const h = heightmap.data[y * heightmap.width + x];
      if (h > 0.68) {
        const pxX = (x / heightmap.width) * resolution;
        const pxY = (y / heightmap.height) * resolution;
        const ddx = pxX - halfRes;
        const ddy = pxY - halfRes;
        if (ddx * ddx + ddy * ddy > halfRes * halfRes) continue;
        const intensity = (h - 0.68) * 3.0;
        const br = 1.5 + intensity * 3;
        ctx.beginPath();
        ctx.arc(pxX - 1.5, pxY - 1.5, br, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 245, 210, ${Math.min(0.35, intensity * 0.3)})`;
        ctx.fill();
      }
    }
  }
  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ─── Popadom disc geometry ─────────────────────────────────────

function createPopadomGeometry(popadomData, segments = 64) {
  const { radius, heightmap, edgeOffsets, edgeSegments } = popadomData;
  const rings = 24;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    for (let s = 0; s <= segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      const segIdx = s % edgeSegments;
      const edgeWobble = t > 0.7 ? edgeOffsets[segIdx] * ((t - 0.7) / 0.3) : 0;
      const rad = radius * t * (1 + edgeWobble);

      const x = Math.cos(angle) * rad;
      const z = Math.sin(angle) * rad;

      const u = (x / radius + 1) / 2;
      const v = (z / radius + 1) / 2;

      const h = sampleHeightmap(heightmap, u, v);
      const y = h * 0.025 * t;

      positions.push(x, y, z);
      normals.push(0, 1, 0);
      uvs.push(u, v);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;
      indices.push(a, b, a + 1);
      indices.push(a + 1, b, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  return geo;
}

// ─── Fragment mesh component ───────────────────────────────────

function Fragment({ body, popadomData, texture }) {
  const meshRef = useRef();
  const geometry = useMemo(
    () => buildFragmentGeometry(body.cell, popadomData),
    [body.cell, popadomData]
  );

  useFrame(() => {
    if (!meshRef.current) return;
    meshRef.current.position.set(
      body.x - body.cell.centroid[0],
      body.y + 0.013,
      body.z - body.cell.centroid[1]
    );
    meshRef.current.rotation.set(body.tiltX, body.rotation, body.tiltZ);
  });

  return (
    <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        map={texture}
        roughness={0.85}
        metalness={0.02}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ─── Intact popadom mesh ───────────────────────────────────────

function IntactPopadom({ popadomData, cells, texture, onPointerDown, onPointerUp, pressRef }) {
  const meshRef = useRef();
  const geometry = useMemo(
    () => createPopadomGeometry(popadomData),
    [popadomData]
  );
  const targetScale = useRef(new THREE.Vector3(1, 1, 1));

  useFrame(() => {
    if (!meshRef.current) return;
    if (pressRef.current.pressing) {
      const s = 1 - pressRef.current.pressure * 0.02;
      targetScale.current.set(s, s, s);
    } else {
      targetScale.current.set(1, 1, 1);
    }
    meshRef.current.scale.lerp(targetScale.current, 0.15);
  });

  const intactCount = cells.filter((c) => c.intact).length;
  if (intactCount === 0) return null;

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      position={[0, 0.013, 0]}
      castShadow
      receiveShadow
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <meshStandardMaterial
        map={texture}
        roughness={0.82}
        metalness={0.02}
        transparent
        opacity={0.98}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ─── Table surface ─────────────────────────────────────────────

function Table() {
  const texture = useMemo(() => {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#8B1A2B";
    ctx.fillRect(0, 0, size, size);

    for (let y = 0; y < size; y += 3) {
      for (let x = 0; x < size; x += 3) {
        const noise = (Math.sin(x * 73.7 + y * 157.3) * 43758.5453) % 1;
        const v = (noise - 0.5) * 12;
        ctx.fillStyle = `rgb(${139 + v}, ${26 + v * 0.3}, ${43 + v * 0.4})`;
        ctx.fillRect(x, y, 3, 3);
      }
    }

    const bandSpacing = 120;
    const bandWidth = 28;
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#D4A843";
    for (let offset = bandSpacing; offset < size; offset += bandSpacing) {
      ctx.fillRect(0, offset - bandWidth / 2, size, bandWidth);
      ctx.fillRect(offset - bandWidth / 2, 0, bandWidth, size);
    }

    ctx.globalAlpha = 0.15;
    ctx.fillStyle = "#F0D060";
    for (let y = bandSpacing; y < size; y += bandSpacing) {
      for (let x = bandSpacing; x < size; x += bandSpacing) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-5, -5, 10, 10);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
      <planeGeometry args={[8, 8]} />
      <meshStandardMaterial map={texture} roughness={0.9} metalness={0.0} />
    </mesh>
  );
}

// ─── Stress indicator ring ─────────────────────────────────────

function StressRing({ pressRef }) {
  const ringRef = useRef();

  useFrame(() => {
    if (!ringRef.current) return;
    const p = pressRef.current;
    if (p.pressing && p.worldX !== null) {
      ringRef.current.visible = true;
      ringRef.current.position.set(p.worldX, 0.02, p.worldZ);
      const scale = 0.1 + p.pressure * 0.8;
      ringRef.current.scale.set(scale, scale, 1);
      ringRef.current.material.opacity = 0.15 + p.pressure * 0.3;
    } else {
      ringRef.current.visible = false;
    }
  });

  return (
    <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[0.8, 1.0, 32]} />
      <meshBasicMaterial color="#fff8e0" transparent opacity={0.2} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ─── Scene (inner component, lives inside Canvas) ──────────────

function Scene({ contactMode, onAllBroken, popadomKey }) {
  const ambientStarted = useRef(false);

  const popadomData = useMemo(() => createPopadomData(1.0), [popadomKey]);
  const cellsRef = useRef([]);
  const fragmentsRef = useRef([]);
  const [, forceRender] = useState(0);

  const texture = useMemo(
    () => createPopadomCanvasTexture(popadomData.heightmap),
    [popadomData]
  );

  // Reset on new popadom
  useEffect(() => {
    cellsRef.current = precomputeCells(popadomData, 55);
    fragmentsRef.current = [];
    forceRender((n) => n + 1);
  }, [popadomData]);

  // Stress model
  const pressRef = useRef({
    pressing: false,
    startTime: 0,
    pressure: 0,
    worldX: null,
    worldZ: null,
  });

  useFrame((_, delta) => {
    const p = pressRef.current;
    if (p.pressing) {
      p.pressure = Math.min(1, (performance.now() - p.startTime) / 1000);
    }

    if (fragmentsRef.current.length > 0) {
      stepPhysics(fragmentsRef.current, Math.min(delta, 0.033));
    }
  });

  const handlePointerDown = useCallback((e) => {
    e.stopPropagation();

    initAudio();
    if (!ambientStarted.current) {
      ambientStarted.current = true;
      startAmbient();
    }

    const point = e.point;
    pressRef.current = {
      pressing: true,
      startTime: performance.now(),
      pressure: 0,
      worldX: point.x,
      worldZ: point.z,
    };
  }, []);

  const handlePointerUp = useCallback(() => {
    const p = pressRef.current;
    if (!p.pressing) return;

    const tapX = p.worldX;
    const tapZ = p.worldZ;
    const pressure = p.pressure;

    p.pressing = false;
    p.pressure = 0;

    const currentCells = cellsRef.current;
    const intactBefore = currentCells.filter((c) => c.intact).length;
    if (intactBefore === 0) return;

    const mode = contactMode === "chop" ? "chop" : "finger";
    const broken = fractureAtPoint(currentCells, tapX, tapZ, 1.0, pressure, mode);

    if (broken.length > 0) {
      const newBodies = broken.map((cell) => createFragmentBody(cell, tapX, tapZ));
      fragmentsRef.current = [...fragmentsRef.current, ...newBodies];
      forceRender((n) => n + 1);

      const intensity = Math.min(1, broken.length / 8);
      playCrackSound(intensity, broken.length);
    }

    const intactAfter = currentCells.filter((c) => c.intact).length;
    if (intactAfter === 0) {
      onAllBroken();
    }
  }, [contactMode, onAllBroken]);

  const handleFragmentTap = useCallback((e, body) => {
    e.stopPropagation();
    initAudio();

    const point = e.point;
    const subs = refractureFragment(body.cell, point.x, point.z);
    if (!subs) return;

    const oldBodies = fragmentsRef.current.filter((b) => b.id !== body.id);
    const newBodies = subs.map((cell) => createFragmentBody(cell, point.x, point.z));
    fragmentsRef.current = [...oldBodies, ...newBodies];
    forceRender((n) => n + 1);

    playCrackSound(0.3, subs.length);
  }, []);

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[3, 5, 2]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.5}
        shadow-camera-far={15}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
      />
      <pointLight position={[-2, 3, -1]} intensity={0.3} color="#ffe8c0" />

      <Table />
      <StressRing pressRef={pressRef} />

      <IntactPopadom
        popadomData={popadomData}
        cells={cellsRef.current}
        texture={texture}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        pressRef={pressRef}
      />

      {fragmentsRef.current.map((body) => (
        <group key={body.id} onPointerDown={(e) => handleFragmentTap(e, body)}>
          <Fragment body={body} popadomData={popadomData} texture={texture} />
        </group>
      ))}

      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 3}
        minDistance={1.5}
        maxDistance={5}
        target={[0, 0, 0]}
      />
    </>
  );
}

// ─── Main Game component ───────────────────────────────────────

export default function Game() {
  const [showNewButton, setShowNewButton] = useState(false);
  const [contactMode, setContactMode] = useState("finger");
  const [popadomKey, setPopadomKey] = useState(0);

  const handleAllBroken = useCallback(() => {
    setShowNewButton(true);
  }, []);

  const handleNewPopadom = useCallback(() => {
    playNewPopadomSound();
    setPopadomKey((k) => k + 1);
    setShowNewButton(false);
  }, []);

  const toggleContactMode = useCallback(() => {
    setContactMode((prev) => (prev === "finger" ? "chop" : "finger"));
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <Canvas
        shadows
        camera={{ position: [0, 3.2, 1.8], fov: 40, near: 0.1, far: 50 }}
        style={{ background: "#1a0a05" }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      >
        <Scene
          contactMode={contactMode}
          onAllBroken={handleAllBroken}
          popadomKey={popadomKey}
        />
      </Canvas>

      {/* Contact mode toggle */}
      <button
        onClick={toggleContactMode}
        style={{
          position: "absolute",
          top: "15px",
          right: "15px",
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: "rgba(0, 0, 0, 0.5)",
          color: "#FFF5E6",
          border: "2px solid rgba(255, 245, 230, 0.3)",
          cursor: "pointer",
          fontSize: "24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backdropFilter: "blur(8px)",
          boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
          transition: "all 0.2s ease",
          zIndex: 10,
        }}
        onMouseEnter={(e) => {
          e.target.style.background = "rgba(0, 0, 0, 0.7)";
          e.target.style.transform = "scale(1.1)";
        }}
        onMouseLeave={(e) => {
          e.target.style.background = "rgba(0, 0, 0, 0.5)";
          e.target.style.transform = "scale(1)";
        }}
        title={contactMode === "finger" ? "Switch to Karate Chop" : "Switch to Finger Tap"}
      >
        {contactMode === "finger" ? "\u261D\uFE0F" : "\u270B"}
      </button>

      <div
        style={{
          position: "absolute",
          top: "78px",
          right: "15px",
          color: "#FFF5E6",
          fontSize: "11px",
          fontFamily: "'Georgia', serif",
          textAlign: "center",
          width: "56px",
          opacity: 0.7,
          textShadow: "0 1px 3px rgba(0,0,0,0.5)",
          zIndex: 10,
        }}
      >
        {contactMode === "finger" ? "Tap" : "Chop"}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: showNewButton ? "100px" : "30px",
          left: "50%",
          transform: "translateX(-50%)",
          color: "rgba(255, 245, 230, 0.5)",
          fontSize: "13px",
          fontFamily: "'Georgia', serif",
          textShadow: "0 1px 3px rgba(0,0,0,0.5)",
          pointerEvents: "none",
          transition: "all 0.3s ease",
          zIndex: 10,
        }}
      >
        Hold longer to crack more
      </div>

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
            zIndex: 10,
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
