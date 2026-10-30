import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, ErrorBox } from '@/shared/ui';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useItems } from '@/shared/pack-data';
import { cx } from '@/shared/lib';
import type { Schematic, Vec } from '../schematic';
import { buildMesh } from '../schematicMesh';
import { disposeMesh, meshObject, newRenderer } from '../schematicRender';
import styles from './SchematicView3D.module.css';

const NO_REPLACE: Map<string, string> = new Map();

interface Props {
  schematic: Schematic;
  replace?: Map<string, string>;
  /** Срез: слои выше не показываются */
  maxY?: number;
  textured: boolean;
  /** Выделенные блоки — подсвечиваются поверх */
  selected?: Vec[];
  /** Клик ЛКМ без сдвига камеры: блок под курсором (null — мимо) */
  onPick?: (pos: Vec | null, e: { shiftKey: boolean; timeStamp: number }) => void;
  /** Блок под курсором (null — нет) */
  onHover?: (pos: Vec | null) => void;
  /** Перетаскивание ЛКМ — рамка: inFrame проверяет, попадает ли центр блока в неё (по всей глубине) */
  onFrame?: (inFrame: (pos: Vec) => boolean, e: { shiftKey: boolean }) => void;
  /**
   * Просмотр (гайд, мультиблок IE), а не редактор: перетаскивание ЛКМ и пальцем вращает, колесо без Ctrl/⌘
   * прокручивает страницу, есть кнопка «Вернуть вид»; счётчик граней не показываем
   */
  viewer?: boolean;
  /** Зеркально по x (лево ↔ право) — IE принимает и такую постройку */
  mirrored?: boolean;
  /** Клетка, обведённая рамкой (блок для удара молотом IE) */
  trigger?: Vec | null;
  /** Класс обёртки: у просмотра — своя высота, у редактора — во весь оверлей */
  className?: string;
  /** WebGL нет или схема не строится — пусть родитель покажет запасной вид */
  onFail?: (message: string) => void;
}

/** Рамка на экране, в пикселях от угла области */
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Сдвиг мыши, после которого нажатие ЛКМ — рамка, а не клик */
const CLICK_PX = 4;

function disposeMarks(m: THREE.InstancedMesh) {
  m.geometry.dispose();
  (m.material as THREE.Material).dispose();
  m.dispose();
}

/**
 * 3D-вид схемы — общий для редактора на странице «Схемы» и просмотров (гайды, мультиблоки IE): блоки по моделям
 * из jar (нет модели — упрощённая форма), копикаты по материалу. Редактор: вращение зажатым колесом вокруг точки под
 * курсором, сдвиг ПКМ, масштаб колесом к курсору, ЛКМ — клик и рамка. Просмотр (viewer): вращение ЛКМ/пальцем,
 * масштаб Ctrl+колесо или щипком. Рисует только при движении камеры или смене схемы — в покое видеокарту не грузит.
 */
export default function SchematicView3D({
  schematic,
  replace = NO_REPLACE,
  maxY,
  textured,
  selected,
  onPick,
  onHover,
  onFrame,
  viewer = false,
  mirrored = false,
  trigger = null,
  className,
  onFail,
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
    /** Рамка блока для молота */
    triggerBox: THREE.LineSegments;
    /** Всё содержимое схемы: зеркало — его масштаб −1 по x */
    holder: THREE.Group;
    /** Камера как при открытии — для «Вернуть вид» */
    home: () => void;
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
  const failRef = useRef(onFail);
  useEffect(() => {
    pickRef.current = onPick;
    hoverRef.current = onHover;
    frameRef.current = onFrame;
    failRef.current = onFail;
  });

  // Сцена — один раз
  useEffect(() => {
    const wrap = wrapRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = newRenderer();
    } catch (e) {
      // Нет WebGL (старый браузер, выключено ускорение) — объёмного вида не будет
      const message = e instanceof Error ? e.message : String(e);
      setError(`Объёмный вид недоступен: ${message}`);
      failRef.current?.(message);
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    wrap.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    // Вращение и ЛКМ — свои (ниже); OrbitControls — сдвиг ПКМ, зум колесом к курсору и пальцы (поворот, щипок)
    controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: THREE.MOUSE.PAN };
    controls.zoomToCursor = true;
    controls.zoomSpeed = 2.5;
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
    const holder = new THREE.Group();
    scene.add(holder);
    holder.add(cursor);
    const triggerBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.08, 1.08, 1.08)),
      new THREE.LineBasicMaterial({
        color: getComputedStyle(wrap).getPropertyValue('--imp-2').trim() || '#e0a020',
        depthTest: false,
      }),
    );
    triggerBox.renderOrder = 3;
    triggerBox.visible = false;
    holder.add(triggerBox);
    three.current = {
      renderer,
      scene,
      camera,
      controls,
      mesh: null,
      marks: null,
      cursor,
      triggerBox,
      holder,
      home: () => {},
      render,
    };
    resize();

    // Блок под курсором: луч до геометрии схемы, чуть дальше точки попадания — внутрь грани
    const ray = new THREE.Raycaster();
    const hitAt = (e: PointerEvent) => {
      const mesh = three.current?.mesh;
      if (!mesh) return undefined;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1),
        camera,
      );
      return ray.intersectObject(mesh, false)[0];
    };
    const blockAt = (e: PointerEvent): Vec | null => {
      const hit = hitAt(e);
      if (!hit) return null;
      const p = holder.worldToLocal(hit.point.addScaledVector(ray.ray.direction, 0.01));
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

    /**
     * Точка вращения — как «Auto Depth» в Blender и вращение вокруг курсора в CAD: блок под курсором в момент нажатия.
     * Мимо схемы — точка на луче под курсором на глубине прежнего центра (учитывает зум и положение камеры),
     * прижатая к габаритам схемы, чтобы не крутиться вокруг пустоты.
     */
    const fwd = new THREE.Vector3();
    const pivotFor = (e: PointerEvent) => {
      const hit = hitAt(e);
      if (hit) return hit.point.clone();
      const mesh = three.current?.mesh;
      if (!mesh) return controls.target.clone();
      camera.getWorldDirection(fwd);
      const depth = controls.target.clone().sub(camera.position).dot(fwd);
      const cos = ray.ray.direction.dot(fwd);
      const p = ray.ray.at(Math.max(0.5, depth) / Math.max(0.1, cos), new THREE.Vector3());
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox?.clone().applyMatrix4(holder.matrixWorld);
      return bb ? bb.clampPoint(p, p) : p;
    };
    // Метка точки вращения — видна, пока крутим
    const pivotMark = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({
        color: getComputedStyle(wrap).getPropertyValue('--accent').trim() || '#4c8a2b',
        depthTest: false,
        transparent: true,
        opacity: 0.85,
      }),
    );
    pivotMark.renderOrder = 2;
    pivotMark.visible = false;
    scene.add(pivotMark);
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const turn = (pivot: THREE.Vector3, axis: THREE.Vector3, angle: number) => {
      q.setFromAxisAngle(axis, angle);
      camera.position.sub(pivot).applyQuaternion(q).add(pivot);
      camera.quaternion.premultiply(q);
    };
    /** Поворот камеры вокруг pivot: по горизонтали — вокруг вертикали, по вертикали — без переворота через полюс */
    const orbit = (pivot: THREE.Vector3, dx: number, dy: number) => {
      const h = wrap.clientHeight || 1;
      camera.getWorldDirection(fwd);
      const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
      const lim = Math.PI / 2 - 0.02;
      const next = THREE.MathUtils.clamp(pitch - (2 * Math.PI * dy) / h, -lim, lim);
      turn(pivot, right.set(1, 0, 0).applyQuaternion(camera.quaternion), next - pitch);
      turn(pivot, up, (-2 * Math.PI * dx) / h);
      // Центр OrbitControls — на оси взгляда на глубине точки вращения: зум и сдвиг дальше идут от неё
      camera.getWorldDirection(fwd);
      const depth = Math.max(0.5, pivot.clone().sub(camera.position).dot(fwd));
      controls.target.copy(camera.position).addScaledVector(fwd, depth);
      camera.updateMatrixWorld();
      render();
    };

    let frame = 0;
    let last: PointerEvent | null = null;
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

    /**
     * Мышь: колесо (или Alt+ЛКМ — для тачпада) — вращение вокруг точки под курсором; ЛКМ — клик выбирает блок,
     * перетаскивание — рамка. Перехватываем до OrbitControls (захват на обёртке); ему остаются ПКМ и колесо-зум.
     */
    let gesture: {
      id: number;
      x: number;
      y: number;
      lx: number;
      ly: number;
      pivot: THREE.Vector3 | null;
      framing: boolean;
    } | null = null;
    const local = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onGestureDown = (e: PointerEvent) => {
      if (gesture || e.pointerType !== 'mouse' || e.target !== renderer.domElement) return;
      // Просмотр: ЛКМ сразу вращает (щелчок без сдвига — выделение, см. onGestureUp)
      const rotate = e.button === 1 || (e.button === 0 && (e.altKey || viewer));
      if (!rotate && e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const p = local(e);
      gesture = { id: e.pointerId, ...p, lx: e.clientX, ly: e.clientY, pivot: null, framing: false };
      if (rotate) {
        const pivot = pivotFor(e);
        gesture.pivot = pivot;
        pivotMark.position.copy(pivot);
        pivotMark.scale.setScalar(Math.max(0.06, camera.position.distanceTo(pivot) * 0.008));
        // В просмотре метку показываем, только когда начали тянуть: щелчок не должен мигать точкой
        pivotMark.visible = !viewer;
        showCursor(null);
        render();
      }
      window.addEventListener('pointermove', onGestureMove);
      window.addEventListener('pointerup', onGestureUp);
      window.addEventListener('pointercancel', onGestureCancel);
    };
    const onGestureMove = (e: PointerEvent) => {
      const g = gesture;
      if (!g || e.pointerId !== g.id) return;
      if (g.pivot) {
        if (viewer && !g.framing) {
          // Просмотр: до сдвига на CLICK_PX это ещё щелчок
          if (Math.hypot(e.clientX - g.lx, e.clientY - g.ly) < CLICK_PX) return;
          g.framing = true;
          pivotMark.visible = true;
        }
        orbit(g.pivot, e.clientX - g.lx, e.clientY - g.ly);
        g.lx = e.clientX;
        g.ly = e.clientY;
        return;
      }
      const p = local(e);
      if (!g.framing && frameRef.current && Math.hypot(p.x - g.x, p.y - g.y) >= CLICK_PX) {
        g.framing = true;
        showCursor(null);
      }
      if (g.framing) setRect({ x0: g.x, y0: g.y, x1: p.x, y1: p.y });
    };
    const endGesture = () => {
      gesture = null;
      setRect(null);
      if (pivotMark.visible) {
        pivotMark.visible = false;
        render();
      }
      window.removeEventListener('pointermove', onGestureMove);
      window.removeEventListener('pointerup', onGestureUp);
      window.removeEventListener('pointercancel', onGestureCancel);
    };
    const onGestureCancel = () => endGesture();
    const onGestureUp = (e: PointerEvent) => {
      const st = gesture;
      if (!st || e.pointerId !== st.id) return;
      endGesture();
      const p = local(e);
      if (st.pivot) {
        // Щелчок без поворота в просмотре — выделение
        if (viewer && !st.framing) pickRef.current?.(blockAt(e), { shiftKey: e.shiftKey, timeStamp: e.timeStamp });
        return;
      }
      if (!st.framing) {
        if (Math.hypot(p.x - st.x, p.y - st.y) < CLICK_PX)
          pickRef.current?.(blockAt(e), { shiftKey: e.shiftKey, timeStamp: e.timeStamp });
        return;
      }
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
        v.set(x + 0.5, y + 0.5, z + 0.5)
          .applyMatrix4(holder.matrixWorld)
          .applyMatrix4(m);
        return v.z > -1 && v.z < 1 && v.x >= nx0 && v.x <= nx1 && v.y >= ny0 && v.y <= ny1;
      };
      frameRef.current?.(inFrame, { shiftKey: e.shiftKey });
    };
    // Средняя кнопка в Windows включает автопрокрутку — гасим
    const noAutoscroll = (e: MouseEvent) => e.button === 1 && e.preventDefault();
    // Просмотр в статье: колесо без Ctrl/⌘ листает страницу, а не масштабирует (щипок тачпада приходит с Ctrl)
    const pageWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    };
    // Палец: поворот и щипок — у OrbitControls; короткое касание без сдвига — выделение
    let tap: { id: number; x: number; y: number; t: number } | null = null;
    const onTapDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      tap = e.isPrimary ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
    };
    const onTapUp = (e: PointerEvent) => {
      const st = tap;
      tap = null;
      if (!st || st.id !== e.pointerId || e.timeStamp - st.t > 500) return;
      if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < CLICK_PX * 2)
        pickRef.current?.(blockAt(e), { shiftKey: false, timeStamp: e.timeStamp });
    };
    wrap.addEventListener('pointerdown', onTapDown, { capture: true });
    wrap.addEventListener('pointerup', onTapUp, { capture: true });
    wrap.addEventListener('pointerdown', onGestureDown, { capture: true });
    wrap.addEventListener('mousedown', noAutoscroll);
    if (viewer) wrap.addEventListener('wheel', pageWheel, { capture: true });

    const el = renderer.domElement;
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);

    return () => {
      cancelAnimationFrame(frame);
      endGesture();
      wrap.removeEventListener('pointerdown', onGestureDown, { capture: true });
      wrap.removeEventListener('mousedown', noAutoscroll);
      wrap.removeEventListener('wheel', pageWheel, { capture: true });
      wrap.removeEventListener('pointerdown', onTapDown, { capture: true });
      wrap.removeEventListener('pointerup', onTapUp, { capture: true });
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      cursor.geometry.dispose();
      (cursor.material as THREE.Material).dispose();
      triggerBox.geometry.dispose();
      (triggerBox.material as THREE.Material).dispose();
      pivotMark.geometry.dispose();
      (pivotMark.material as THREE.Material).dispose();
      ro.disconnect();
      controls.dispose();
      if (three.current?.mesh) disposeMesh(three.current.mesh);
      if (three.current?.marks) disposeMarks(three.current.marks);
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
    // viewer не меняется у одного экземпляра (редактор или просмотр)
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
          t.holder.remove(t.mesh);
          disposeMesh(t.mesh);
        }
        t.mesh = meshObject(data, textured);
        t.holder.add(t.mesh);
        if (!framed.current) {
          // Камера — один раз на открытие: потом срез по слоям не сбивает ракурс
          framed.current = true;
          const [sx, sy, sz] = data.size;
          const center = new THREE.Vector3(sx / 2, sy / 2, sz / 2);
          const r = Math.hypot(sx, sy, sz) / 2;
          t.home = () => {
            // Просмотр: шар вокруг схемы — во весь кадр по узкой стороне окна; редактор — с запасом вокруг
            const half = THREE.MathUtils.degToRad(t.camera.fov / 2);
            const fit = Math.min(half, Math.atan(Math.tan(half) * t.camera.aspect));
            const dist = viewer ? r / Math.sin(fit) + 0.5 : r * 2.6 + 4;
            t.controls.target.copy(center);
            t.camera.position.copy(center).add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(dist));
            t.camera.lookAt(center);
            t.camera.far = r * 20 + 100;
            t.camera.updateProjectionMatrix();
            t.controls.update();
          };
          t.home();
        }
        t.render();
        setError(null);
        setStats(`${data.blocks} блоков · ${data.faces} граней`);
      })
      .catch((e) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        failRef.current?.(message);
      });
    return () => {
      cancelled = true;
    };
  }, [schematic, replace, items, maxY, textured, viewer]);

  // Зеркало: схема отражается по x внутри своего объёма (выделение и рамки — вместе с ней)
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const sx = schematic.size?.[0] ?? 0;
    t.holder.scale.x = mirrored ? -1 : 1;
    t.holder.position.x = mirrored ? sx : 0;
    t.holder.updateMatrixWorld();
    t.render();
  }, [mirrored, schematic]);

  // Блок для молота — рамка поверх всего; срез выше него — прячем
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const show = !!trigger && (maxY === undefined || trigger[1] <= maxY);
    t.triggerBox.visible = show;
    if (trigger) t.triggerBox.position.set(trigger[0] + 0.5, trigger[1] + 0.5, trigger[2] + 0.5);
    t.render();
  }, [trigger, maxY]);

  // Подсветка выделения — полупрозрачные кубы чуть больше блока; срез прячет и их
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    if (t.marks) {
      t.holder.remove(t.marks);
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
      t.holder.add(marks);
    }
    t.render();
  }, [selected, maxY]);

  return (
    <div className={cx(styles.view, className)} ref={wrapRef}>
      {error && <ErrorBox className={styles.error}>{error}</ErrorBox>}
      {stats && !viewer && <div className={cx(styles.stats, 'faint', 'small')}>{stats}</div>}
      {viewer && !error && (
        <Button
          variant="ghost"
          icon
          size="sm"
          className={styles.reset}
          aria-label="Вернуть вид"
          title="Вернуть вид"
          onClick={() => {
            three.current?.home();
            three.current?.render();
          }}
        >
          <RotateCcw size={14} />
        </Button>
      )}
      {rect && (
        <div
          className={styles.frame}
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
