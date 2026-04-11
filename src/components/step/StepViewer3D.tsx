'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BodyState } from './StepSidebar';

export interface FaceMeshData {
  face_index: number;
  vertices: number[];
  indices: number[];
}

export interface BodyMeshData {
  body_index: number;
  face_meshes: FaceMeshData[];
}

interface Props {
  meshData: BodyMeshData[];
  bodyStates: BodyState[];
  selectedBodyIdx: number;
  selectedFaceIndices: Record<number, number>;
  onSelectFace: (bodyIdx: number, faceIdx: number) => void;
}

// Distinct pastel-ish colors per body (cycles)
const BODY_PALETTE = [
  0x93c5fd, // blue-300
  0x86efac, // green-300
  0xfda4af, // rose-300
  0xd8b4fe, // purple-300
  0xfdba74, // orange-300
  0x67e8f9, // cyan-300
  0xbef264, // lime-300
  0xfde68a, // yellow-300
  0xf9a8d4, // pink-300
  0x6ee7b7, // emerald-300
];

const SEL_FACE_COLOR  = 0x2563eb; // blue-600
const SEL_FACE_EMIT   = 0x1e3a8a;
const HOVER_EMIT      = 0xd97706; // amber-600
const SEL_BODY_EMIT   = 0x1e3a8a;

export function StepViewer3D({
  meshData,
  bodyStates,
  selectedBodyIdx,
  selectedFaceIndices,
  onSelectFace,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep a ref to latest props so the Three.js loop can read them without
  // restarting the effect every render.
  const propsRef = useRef({ bodyStates, selectedBodyIdx, selectedFaceIndices, onSelectFace });
  propsRef.current = { bodyStates, selectedBodyIdx, selectedFaceIndices, onSelectFace };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !meshData.length) return;

    // ── Renderer ────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0xf8fafc);
    container.appendChild(renderer.domElement);

    // ── Scene / lights ───────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambient);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dir1.position.set(1, 2, 1.5);
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-1, -1, -1);
    scene.add(dir2);

    // ── Camera ───────────────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.01,
      1_000_000
    );

    // ── Controls ─────────────────────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.screenSpacePanning = true;

    // ── Build geometry ───────────────────────────────────────────────────────
    // faceMeshMap: mesh → { bodyIdx, faceIdx }
    const faceMeshMap = new Map<THREE.Mesh, { bodyIdx: number; faceIdx: number }>();
    const overallBox = new THREE.Box3();

    for (const bodyData of meshData) {
      const group = new THREE.Group();
      const baseHex = BODY_PALETTE[bodyData.body_index % BODY_PALETTE.length];

      for (const fm of bodyData.face_meshes) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(fm.vertices), 3)
        );
        geo.setIndex(fm.indices);
        geo.computeVertexNormals();

        const mat = new THREE.MeshPhongMaterial({
          color: baseHex,
          emissive: 0x000000,
          emissiveIntensity: 0,
          side: THREE.DoubleSide,
          shininess: 25,
        });

        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);
        faceMeshMap.set(mesh, { bodyIdx: bodyData.body_index, faceIdx: fm.face_index });

        // Expand bounding box
        const box = new THREE.Box3().setFromBufferAttribute(
          geo.attributes.position as THREE.BufferAttribute
        );
        overallBox.union(box);
      }

      scene.add(group);
    }

    // ── Fit camera to all geometry ───────────────────────────────────────────
    const center = new THREE.Vector3();
    overallBox.getCenter(center);
    const size = overallBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 2.2;
    camera.position.set(center.x + dist * 0.4, center.y + dist * 0.5, center.z + dist);
    camera.near = maxDim * 0.001;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();

    // ── Color update (runs every frame) ─────────────────────────────────────
    function updateColors() {
      const { bodyStates, selectedBodyIdx, selectedFaceIndices } = propsRef.current;
      for (const [mesh, { bodyIdx, faceIdx }] of faceMeshMap) {
        const mat = mesh.material as THREE.MeshPhongMaterial;
        const baseHex = BODY_PALETTE[bodyIdx % BODY_PALETTE.length];
        const isVisible = bodyStates[bodyIdx]?.included !== false;
        const isBodySel = bodyIdx === selectedBodyIdx;
        const isFaceSel = selectedFaceIndices[bodyIdx] === faceIdx;

        mesh.visible = isVisible;
        if (!isVisible) continue;

        if (isFaceSel) {
          mat.color.setHex(SEL_FACE_COLOR);
          mat.emissive.setHex(SEL_FACE_EMIT);
          mat.emissiveIntensity = 0.15;
        } else if (isBodySel) {
          mat.color.setHex(baseHex);
          mat.emissive.setHex(SEL_BODY_EMIT);
          mat.emissiveIntensity = 0.08;
        } else {
          mat.color.setHex(baseHex);
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }
      }
    }

    // ── Hover / click ────────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoveredMesh: THREE.Mesh | null = null;
    let mouseDownAt = { x: 0, y: 0 };

    function getPointer(e: MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function castRay(): THREE.Mesh | null {
      raycaster.setFromCamera(pointer, camera);
      const meshes = Array.from(faceMeshMap.keys()).filter((m) => m.visible);
      const hits = raycaster.intersectObjects(meshes, false);
      return hits.length > 0 ? (hits[0].object as THREE.Mesh) : null;
    }

    function onPointerMove(e: MouseEvent) {
      getPointer(e);
      const hit = castRay();

      // Clear previous hover
      if (hoveredMesh && hoveredMesh !== hit) {
        const info = faceMeshMap.get(hoveredMesh)!;
        const isFaceSel = propsRef.current.selectedFaceIndices[info.bodyIdx] === info.faceIdx;
        if (!isFaceSel) {
          const mat = hoveredMesh.material as THREE.MeshPhongMaterial;
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }
        hoveredMesh = null;
      }

      if (hit && hit !== hoveredMesh) {
        const info = faceMeshMap.get(hit)!;
        const isFaceSel = propsRef.current.selectedFaceIndices[info.bodyIdx] === info.faceIdx;
        if (!isFaceSel) {
          const mat = hit.material as THREE.MeshPhongMaterial;
          mat.emissive.setHex(HOVER_EMIT);
          mat.emissiveIntensity = 0.35;
        }
        hoveredMesh = hit;
        renderer.domElement.style.cursor = 'pointer';
      } else if (!hit) {
        renderer.domElement.style.cursor = 'default';
      }
    }

    function onPointerDown(e: MouseEvent) {
      mouseDownAt = { x: e.clientX, y: e.clientY };
    }

    function onPointerUp(e: MouseEvent) {
      // Only treat as a click if mouse didn't move (not a drag)
      const dx = e.clientX - mouseDownAt.x;
      const dy = e.clientY - mouseDownAt.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) return;

      getPointer(e);
      const hit = castRay();
      if (hit) {
        const info = faceMeshMap.get(hit)!;
        propsRef.current.onSelectFace(info.bodyIdx, info.faceIdx);
      }
    }

    const el = renderer.domElement;
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);

    // ── Animation loop ───────────────────────────────────────────────────────
    let animId: number;
    function animate() {
      animId = requestAnimationFrame(animate);
      controls.update();
      updateColors();
      renderer.render(scene, camera);
    }
    animate();

    // ── Resize ───────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    // ── Cleanup ──────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      for (const mesh of faceMeshMap.keys()) {
        mesh.geometry.dispose();
        (mesh.material as THREE.MeshPhongMaterial).dispose();
      }
      renderer.dispose();
      if (container.contains(el)) container.removeChild(el);
    };
  }, [meshData]); // Re-init only when mesh changes; state changes go through propsRef

  return <div ref={containerRef} className="w-full h-full" />;
}
