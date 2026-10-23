import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useItems } from '../lib/items';
import type { Schematic, Vec } from '../lib/schematic';
import { buildMesh } from '../lib/schematicMesh';
import { disposeMesh, meshObject, newRenderer } from '../lib/schematicRender';

interface Props {
  schematic: Schematic;
  replace: Map<string, string>;
  /** Срез: слои выше не показываются */
  maxY?: number;
  textured: boolean;
  /** Выделенные блоки — подсвечиваются поверх */
  selected?: Vec[];
  /** Клик ЛКМ без сдвига камеры: блок под курсором (null — мимо) */
  onPick?: (pos: Vec | null, e: { shiftKey: boolean; timeStamp: number }) => void;
  /** Блок под курсором (null — нет) */
  onHover?: (pos: Vec | null) => void;
  /** Alt+перетаскивание — рамка: inFrame проверяет, попадает ли центр блока в неё (по всей глубине) */
  onFrame?: (inFrame: (pos: Vec) => boolean, e: { shiftKey: boolean }) => void;
}

/** Рамка на экране, в пикселях от угла области */
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Сдвиг мыши, после которого нажатие — поворот камеры, а не клик */
const CLICK_PX = 4;

function disposeMarks(m: THREE.InstancedMesh) {
  m.geometry.dispose();
  (m.material as THREE.Material).dispose();
  m.dispose();
}

/**
 * 3D-просмотр схемы: упрощённые формы блоков, вращение ЛКМ, сдвиг ПКМ, масштаб колесом.
 * Рисует только при движении камеры или смене схемы — в покое видеокарту не грузит.
 */
export default function SchematicView3D({
  schematic,
  replace,
  maxY,
  textured,
  selected,
  onPick,
  onHover,
  onFrame,
}: Props) {
  const items = useItems();
  const wrapRef = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    mesh: THREE.Mesh | null;
    marks: THREE.InstancedMesh | null;
    /** Рамка блока под курсором */
    cursor: THREE.LineSegments;
    render: () => void;
  } | null>(null);
  const [stats, setStats] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const framed = useRef(false);
  // Обработчики — через ref: сцена создаётся один раз, а они меняются с каждой отрисовкой
  const pickRef = useRef(onPick);
  const hoverRef = useRef(onHover);
  const frameRef = useRef(onFrame);
  useEffect(() => {
    pickRef.current = onPick;
    hoverRef.current = onHover;
    frameRef.current = onFrame;
  });

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
    const cursor = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
      new THREE.LineBasicMaterial({ color: getComputedStyle(wrap).getPropertyValue('--text').trim() || '#fff' }),
    );
    cursor.visible = false;
    scene.add(cursor);
    three.current = { renderer, scene, camera, controls, mesh: null, marks: null, cursor, render };
    resize();

    // Блок под курсором: луч до геометрии схемы, чуть дальше точки попадания — внутрь грани
    const ray = new THREE.Raycaster();
    const blockAt = (e: PointerEvent): Vec | null => {
      const mesh = three.current?.mesh;
      if (!mesh) return null;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1),
        camera,
      );
      const hit = ray.intersectObject(mesh, false)[0];
      if (!hit) return null;
      const p = hit.point.addScaledVector(ray.ray.direction, 0.01);
      return [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
    };
    const showCursor = (pos: Vec | null) => {
      const same =
        pos && cursor.visible && cursor.position.equals(new THREE.Vector3(pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5));
      if (same || (!pos && !cursor.visible)) return;
      cursor.visible = !!pos;
      if (pos) cursor.position.set(pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5);
      render();
      hoverRef.current?.(pos);
    };

    let down: { x: number; y: number } | null = null;
    let frame = 0;
    let last: PointerEvent | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) >= CLICK_PX) return;
      pickRef.current?.(blockAt(e), { shiftKey: e.shiftKey, timeStamp: e.timeStamp });
    };
    // Наведение — не чаще кадра, и не во время поворота камеры
    const onMove = (e: PointerEvent) => {
      last = e;
      if (e.buttons || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (last && !last.buttons) showCursor(blockAt(last));
      });
    };
    const onLeave = () => showCursor(null);

    // Alt+ЛКМ — рамка объекта: перехватываем нажатие до OrbitControls (захват на обёртке), камера стоит
    let frameStart: { x: number; y: number; id: number } | null = null;
    const local = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onFrameDown = (e: PointerEvent) => {
      if (e.button !== 0 || !e.altKey || !frameRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      const p = local(e);
      frameStart = { ...p, id: e.pointerId };
      setRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      showCursor(null);
      window.addEventListener('pointermove', onFrameMove);
      window.addEventListener('pointerup', onFrameUp);
      window.addEventListener('pointercancel', onFrameCancel);
    };
    const onFrameMove = (e: PointerEvent) => {
      if (!frameStart || e.pointerId !== frameStart.id) return;
      const p = local(e);
      setRect({ x0: frameStart.x, y0: frameStart.y, x1: p.x, y1: p.y });
    };
    const endFrame = () => {
      frameStart = null;
      setRect(null);
      window.removeEventListener('pointermove', onFrameMove);
      window.removeEventListener('pointerup', onFrameUp);
      window.removeEventListener('pointercancel', onFrameCancel);
    };
    const onFrameCancel = () => endFrame();
    const onFrameUp = (e: PointerEvent) => {
      const st = frameStart;
      if (!st || e.pointerId !== st.id) return;
      endFrame();
      const p = local(e);
      if (Math.hypot(p.x - st.x, p.y - st.y) < CLICK_PX) return;
      // Рамка в координатах экрана −1…1; блок — в рамке, если туда проецируется его центр и он перед камерой
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const nx0 = (Math.min(st.x, p.x) / w) * 2 - 1;
      const nx1 = (Math.max(st.x, p.x) / w) * 2 - 1;
      const ny0 = 1 - (Math.max(st.y, p.y) / h) * 2;
      const ny1 = 1 - (Math.min(st.y, p.y) / h) * 2;
      camera.updateMatrixWorld();
      const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const v = new THREE.Vector3();
      const inFrame = ([x, y, z]: Vec) => {
        v.set(x + 0.5, y + 0.5, z + 0.5).applyMatrix4(m);
        return v.z > -1 && v.z < 1 && v.x >= nx0 && v.x <= nx1 && v.y >= ny0 && v.y <= ny1;
      };
      frameRef.current?.(inFrame, { shiftKey: e.shiftKey });
    };
    wrap.addEventListener('pointerdown', onFrameDown, { capture: true });

    const el = renderer.domElement;
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);

    return () => {
      cancelAnimationFrame(frame);
      endFrame();
      wrap.removeEventListener('pointerdown', onFrameDown, { capture: true });
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      cursor.geometry.dispose();
      (cursor.material as THREE.Material).dispose();
      ro.disconnect();
      controls.dispose();
      if (three.current?.mesh) disposeMesh(three.current.mesh);
      if (three.current?.marks) disposeMarks(three.current.marks);
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

  // Подсветка выделения — полупрозрачные кубы чуть больше блока; срез прячет и их
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    if (t.marks) {
      t.scene.remove(t.marks);
      disposeMarks(t.marks);
      t.marks = null;
    }
    const shown = (selected ?? []).filter((p) => maxY === undefined || p[1] <= maxY);
    if (shown.length) {
      const color = getComputedStyle(wrapRef.current!).getPropertyValue('--accent').trim() || '#4c8a2b';
      const marks = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1.04, 1.04, 1.04),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }),
        shown.length,
      );
      const m = new THREE.Matrix4();
      shown.forEach(([x, y, z], i) => marks.setMatrixAt(i, m.makeTranslation(x + 0.5, y + 0.5, z + 0.5)));
      marks.renderOrder = 1;
      t.marks = marks;
      t.scene.add(marks);
    }
    t.render();
  }, [selected, maxY]);

  return (
    <div className="view3d" ref={wrapRef}>
      {error && <div className="error-box view3d-error">{error}</div>}
      {stats && <div className="view3d-stats faint small">{stats}</div>}
      {rect && (
        <div
          className="view3d-frame"
          style={{
            left: Math.min(rect.x0, rect.x1),
            top: Math.min(rect.y0, rect.y1),
            width: Math.abs(rect.x1 - rect.x0),
            height: Math.abs(rect.y1 - rect.y0),
          }}
        />
      )}
    </div>
  );
}
