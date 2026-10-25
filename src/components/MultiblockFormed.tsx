import { useEffect, useRef, useState } from 'react';
import { ErrorBox } from '@/shared/ui';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { MbFormed } from '../lib/multiblocks';
import { newRenderer } from '../lib/schematicRender';

/**
 * Итоговый вид мультиблока: модель собранной машины из jar (OBJ + текстуры, scripts/mods/multiblock-models.mjs),
 * поставленная на место постройки (поворот r и сдвиг t найдены скриптом по клеткам модели). Вращение ЛКМ,
 * сдвиг ПКМ, масштаб колесом; рисует только при движении камеры. Отдельный чанк (lazy) — three.js тяжёлый.
 */

const BASE = `${import.meta.env.BASE_URL}multiblocks/`;
const texCache = new Map<string, THREE.Texture>();
/** Кто ждёт загрузки текстур: сцена рисует только по событию, поэтому перерисовываем, когда картинка пришла */
const onTexture = new Set<() => void>();

function texture(rel: string, frames = 1) {
  const key = `${rel}|${frames}`;
  let t = texCache.get(key);
  if (!t) {
    t = new THREE.TextureLoader().load(BASE + rel, () => onTexture.forEach((f) => f()));
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace;
    // V как в обычном OBJ (0 — низ картинки): и neoforge:obj с flip_v, и ie_obj берут строку 1 − v
    // (ObjModel, PolygonUtils.toBakedQuad) — это и есть flipY по умолчанию
    t.flipY = true;
    if (frames > 1) {
      // Анимированная текстура — кадры столбиком, берём первый (верхний)
      t.repeat.set(1, 1 / frames);
      t.offset.set(0, t.flipY ? 1 - 1 / frames : 0);
    }
    texCache.set(key, t);
  }
  return t;
}

export default function MultiblockFormed({
  formed,
  size,
  mirrored,
}: {
  formed: MbFormed;
  size: [number, number, number];
  mirrored: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const three = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    holder: THREE.Group;
    render: () => void;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Сцена и камера — один раз
  useEffect(() => {
    const wrap = wrapRef.current!;
    const renderer = newRenderer();
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    wrap.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(-0.4, 1, 0.7);
    scene.add(sun);
    const holder = new THREE.Group();
    scene.add(holder);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    const [sx, sy, sz] = size;
    const center = new THREE.Vector3(sx / 2, sy / 2, sz / 2);
    const r = Math.hypot(sx, sy, sz) / 2;
    controls.target.copy(center);
    // С лицевой стороны (+Z), справа и сверху — как в объёмном виде постройки
    camera.position.copy(center).add(new THREE.Vector3(0.7, 0.6, 1).normalize().multiplyScalar(r * 2.7 + 2));
    camera.far = r * 30 + 100;
    controls.update();
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
    three.current = { scene, camera, controls, holder, render };
    onTexture.add(render);
    resize();
    return () => {
      onTexture.delete(render);
      ro.disconnect();
      controls.dispose();
      holder.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const mat of [o.material].flat()) mat.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
    // size — у одной карточки не меняется (компонент пересоздаётся по key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Модель
  useEffect(() => {
    let cancelled = false;
    fetch(BASE + formed.obj)
      .then((r) => {
        if (!r.ok) throw new Error(`модель не загрузилась (${r.status})`);
        return r.text();
      })
      .then((text) => {
        const t = three.current;
        if (cancelled || !t) return;
        const group = new OBJLoader().parse(text);
        const matCache = new Map<string, THREE.Material>();
        const material = (name: string) => {
          let mat = matCache.get(name);
          if (!mat) {
            const def = formed.mats[name] ?? {};
            mat = new THREE.MeshLambertMaterial({
              map: def.tex ? texture(def.tex, def.frames) : null,
              color: def.tex || !def.color ? 0xffffff : new THREE.Color(...def.color),
              transparent: def.alpha !== undefined,
              opacity: def.alpha ?? 1,
              alphaTest: 0.1,
              side: THREE.DoubleSide,
            });
            matCache.set(name, mat);
          }
          return mat;
        };
        group.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          const old = [o.material].flat() as THREE.Material[];
          const next = old.map((m) => material(m.name));
          for (const m of old) m.dispose();
          o.material = Array.isArray(o.material) ? next : next[0];
        });
        // Поворот вокруг центра клетки модели и сдвиг на место в постройке
        const pivot = new THREE.Group();
        group.position.set(-0.5, 0, -0.5);
        pivot.add(group);
        pivot.rotation.y = (-formed.r * Math.PI) / 2;
        pivot.position.set(formed.t[0] + 0.5, formed.t[1], formed.t[2] + 0.5);
        t.holder.clear();
        t.holder.add(pivot);
        t.render();
        setLoading(false);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [formed]);

  // Зеркало: x → ширина − x, как у постройки
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    t.holder.scale.x = mirrored ? -1 : 1;
    t.holder.position.x = mirrored ? size[0] : 0;
    t.render();
  }, [mirrored, size]);

  return (
    <div className="mb-formed" ref={wrapRef}>
      {loading && !error && <div className="mb-formed-note faint small">Загружаю модель…</div>}
      {error && <ErrorBox className="mb-formed-note">{error}</ErrorBox>}
      <span className="mb-iso-hint faint small">ЛКМ — повернуть, ПКМ — сдвинуть, колесо — ближе</span>
    </div>
  );
}
