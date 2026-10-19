import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useItems } from '../lib/items';
import type { Schematic } from '../lib/schematic';
import { buildMesh } from '../lib/schematicMesh';
import { disposeMesh, meshObject, newRenderer } from '../lib/schematicRender';

interface Props {
  schematic: Schematic;
  replace: Map<string, string>;
  /** Срез: слои выше не показываются */
  maxY?: number;
  textured: boolean;
}

/**
 * 3D-просмотр схемы: упрощённые формы блоков, вращение ЛКМ, сдвиг ПКМ, масштаб колесом.
 * Рисует только при движении камеры или смене схемы — в покое видеокарту не грузит.
 */
export default function SchematicView3D({ schematic, replace, maxY, textured }: Props) {
  const items = useItems();
  const wrapRef = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    mesh: THREE.Mesh | null;
    render: () => void;
  } | null>(null);
  const [stats, setStats] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const framed = useRef(false);

  // Сцена — один раз
  useEffect(() => {
    const wrap = wrapRef.current!;
    const renderer = newRenderer();
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    wrap.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    three.current = { renderer, scene, camera, controls, mesh: null, render };
    resize();
    return () => {
      ro.disconnect();
      controls.dispose();
      if (three.current?.mesh) disposeMesh(three.current.mesh);
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  // Геометрия — при смене схемы, замен, среза, режима
  useEffect(() => {
    if (!items) return;
    let cancelled = false;
    buildMesh(schematic, replace, items, { maxY })
      .then((data) => {
        const t = three.current;
        if (cancelled || !t) return;
        if (t.mesh) {
          t.scene.remove(t.mesh);
          disposeMesh(t.mesh);
        }
        t.mesh = meshObject(data, textured);
        t.scene.add(t.mesh);
        if (!framed.current) {
          // Камера — один раз на открытие: потом срез по слоям не сбивает ракурс
          framed.current = true;
          const [sx, sy, sz] = data.size;
          const center = new THREE.Vector3(sx / 2, sy / 2, sz / 2);
          const r = Math.hypot(sx, sy, sz) / 2;
          t.controls.target.copy(center);
          t.camera.position.copy(center).add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(r * 2.6 + 4));
          t.camera.far = r * 20 + 100;
          t.camera.updateProjectionMatrix();
          t.controls.update();
        }
        t.render();
        setError(null);
        setStats(`${data.blocks} блоков · ${data.faces} граней`);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [schematic, replace, items, maxY, textured]);

  return (
    <div className="view3d" ref={wrapRef}>
      {error && <div className="error-box view3d-error">{error}</div>}
      {stats && <div className="view3d-stats faint small">{stats}</div>}
    </div>
  );
}
