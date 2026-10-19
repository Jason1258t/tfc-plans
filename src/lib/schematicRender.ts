import * as THREE from 'three';
import type { ItemIndex } from './items';
import type { Schematic } from './schematic';
import { buildMesh, type MeshData } from './schematicMesh';

/**
 * Отрисовка геометрии схемы three.js: общий объект сцены для 3D-просмотра и превью библиотеки.
 * Цвета без управления цветом — как в текстурах игры, пиксель в пиксель.
 */

THREE.ColorManagement.enabled = false;

export function meshObject(data: MeshData, textured: boolean): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(textured ? data.light : data.flat, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(data.indices, 1));
  let map: THREE.Texture | null = null;
  if (textured) {
    map = new THREE.CanvasTexture(data.atlas.canvas);
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.generateMipmaps = false;
    map.colorSpace = THREE.NoColorSpace;
  }
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, map, alphaTest: textured ? 0.3 : 0 });
  return new THREE.Mesh(g, mat);
}

export function disposeMesh(m: THREE.Mesh) {
  m.geometry.dispose();
  const mat = m.material as THREE.MeshBasicMaterial;
  mat.map?.dispose();
  mat.dispose();
}

export function newRenderer(canvas?: HTMLCanvasElement, preserve = false) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: preserve });
  r.outputColorSpace = THREE.LinearSRGBColorSpace;
  return r;
}

/** Направление взгляда превью: с юго-востока и сверху, как на скриншотах схем */
const VIEW_DIR = new THREE.Vector3(1, 0.85, 1).normalize();

/** Ортографическая камера, в которую рамка [lo, hi] целиком помещается с отступом */
export function isoCamera(lo: THREE.Vector3, hi: THREE.Vector3, aspect: number, margin = 1.06) {
  const [sx, sy, sz] = [hi.x - lo.x, hi.y - lo.y, hi.z - lo.z];
  const center = lo.clone().add(hi).multiplyScalar(0.5);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10_000);
  const dist = Math.max(sx, sy, sz) * 3 + 10;
  cam.position.copy(center).addScaledVector(VIEW_DIR, dist);
  cam.lookAt(center);
  cam.updateMatrixWorld();
  // Углы габарита в системе камеры — по ним рамка кадра
  const inv = cam.matrixWorldInverse;
  let l = Infinity;
  let r = -Infinity;
  let b = Infinity;
  let t = -Infinity;
  for (const x of [lo.x, hi.x])
    for (const y of [lo.y, hi.y])
      for (const z of [lo.z, hi.z]) {
        const p = new THREE.Vector3(x, y, z).applyMatrix4(inv);
        l = Math.min(l, p.x);
        r = Math.max(r, p.x);
        b = Math.min(b, p.y);
        t = Math.max(t, p.y);
      }
  let w = (r - l) * margin;
  let h = (t - b) * margin;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  const cx = (l + r) / 2;
  const cy = (b + t) / 2;
  cam.left = cx - w / 2;
  cam.right = cx + w / 2;
  cam.bottom = cy - h / 2;
  cam.top = cy + h / 2;
  cam.far = dist * 2 + Math.max(sx, sy, sz) * 2;
  cam.updateProjectionMatrix();
  return cam;
}

/**
 * Превью схемы для библиотеки: текстуры, вид сверху-сбоку, прозрачный фон. Считается в браузере
 * того, кто сохраняет. Возвращает data URL (webp, если браузер умеет, иначе png).
 */
export async function renderPreview(
  s: Schematic,
  replace: Map<string, string>,
  items: ItemIndex,
  width = 480,
  height = 320,
): Promise<string> {
  const data = await buildMesh(s, replace, items);
  const renderer = newRenderer(undefined, true);
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  const mesh = meshObject(data, true);
  scene.add(mesh);
  try {
    // Рамка — по самим блокам: пустой объём схемы не уменьшает картинку
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const lo = bb && !bb.isEmpty() ? bb.min : new THREE.Vector3();
    const hi = bb && !bb.isEmpty() ? bb.max : new THREE.Vector3(...data.size);
    renderer.render(scene, isoCamera(lo, hi, width / height, 1.04));
    const canvas = renderer.domElement;
    const webp = canvas.toDataURL('image/webp', 0.82);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  } finally {
    disposeMesh(mesh);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
