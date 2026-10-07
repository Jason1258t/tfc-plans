import { Minus, Plus, Maximize } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { geoName, type GeoProfile, type MapLayer, type Waypoint } from '../lib/geo';
import { blockToGeo } from '../lib/projection';

export interface MapMarker {
  id: string;
  x: number;
  z: number;
  label: string;
  kind: 'a' | 'b' | 'task';
  color?: string;
}

interface Props {
  profile: GeoProfile;
  layer: MapLayer;
  waypoints: Waypoint[];
  /** Блоковые координаты городов (посчитаны снаружи для текущего профиля) */
  cityPos: Map<string, { x: number; z: number }>;
  markers: MapMarker[];
  /** Клик по карте (не перетаскивание): shift — вторая точка */
  onPick: (x: number, z: number, second: boolean) => void;
  onMarker?: (m: MapMarker) => void;
  /** Сдвинуть вид к точке при её смене */
  focus?: { x: number; z: number; key: string } | null;
}

interface View {
  /** Блок в центре экрана */
  cx: number;
  cz: number;
  /** Пикселей экрана на блок */
  scale: number;
}

const css = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/**
 * Карта мира на canvas: PNG мода растянут на прямоугольник [−h, h) × [−v, v) блоков.
 * Колесо/щипок — зум у курсора, перетаскивание — сдвиг, клик — выбрать точку.
 */
export function WorldMap({ profile, layer, waypoints, cityPos, markers, onPick, onMarker, focus }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [hover, setHover] = useState<{ x: number; z: number } | null>(null);
  const [, setImgTick] = useState(0);
  const h = profile.horizontalScale;
  const v = profile.verticalScale;

  const fit = useCallback(
    (w: number, ht: number): View => ({ cx: 0, cz: 0, scale: Math.min(w / (2 * h), ht / (2 * v)) }),
    [h, v],
  );

  // Размер контейнера
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      const ht = Math.round(e.contentRect.height);
      setSize({ w, h: ht });
      setView((cur) => cur ?? fit(w, ht));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // Новый профиль — заново вписать
  useEffect(() => {
    if (size.w) setView(fit(size.w, size.h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, h, v]);

  // Картинка слоя
  useEffect(() => {
    const src = profile.maps[layer];
    if (!src) {
      imgRef.current = null;
      setImgTick((t) => t + 1);
      return;
    }
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgTick((t) => t + 1);
    };
    img.src = `${import.meta.env.BASE_URL}${src}`;
  }, [profile, layer]);

  // Перелёт к выбранной точке
  useEffect(() => {
    if (!focus || !size.w) return;
    setView((cur) => {
      const base = cur ?? fit(size.w, size.h);
      // Приблизить, если сейчас видна вся карта
      const scale = Math.max(base.scale, (fit(size.w, size.h).scale || 0.01) * 6);
      return { cx: focus.x, cz: focus.z, scale };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key, size.w > 0]);

  const toScreen = useCallback(
    (x: number, z: number, vw: View) => [(x - vw.cx) * vw.scale + size.w / 2, (z - vw.cz) * vw.scale + size.h / 2],
    [size],
  );
  const toWorld = useCallback(
    (sx: number, sy: number, vw: View) => [(sx - size.w / 2) / vw.scale + vw.cx, (sy - size.h / 2) / vw.scale + vw.cz],
    [size],
  );

  // Отрисовка
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css('--surface-2', '#222');
    ctx.fillRect(0, 0, size.w, size.h);

    const [x0, y0] = toScreen(-h, -v, view);
    const mapW = 2 * h * view.scale;
    const mapH = 2 * v * view.scale;
    const img = imgRef.current;
    if (img) {
      ctx.imageSmoothingEnabled = mapW < img.width * 2;
      ctx.drawImage(img, x0, y0, mapW, mapH);
    }
    ctx.strokeStyle = css('--border-strong', '#555');
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, mapW, mapH);

    // Города: столицы всегда, остальные — при приближении; подписи — когда хватает места
    const accent = css('--text', '#eee');
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const w of waypoints) {
      if (!w.capital && mapW < 2500) continue;
      const pos = cityPos.get(w.id);
      if (!pos) continue;
      const [sx, sy] = toScreen(pos.x, pos.z, view);
      if (sx < -40 || sy < -10 || sx > size.w + 40 || sy > size.h + 10) continue;
      ctx.fillStyle = w.capital ? accent : css('--text-2', '#bbb');
      ctx.beginPath();
      ctx.arc(sx, sy, w.capital ? 2.5 : 1.8, 0, Math.PI * 2);
      ctx.fill();
      if ((w.capital && mapW > 1800) || mapW > 5000) {
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.lineWidth = 3;
        const label = geoName(w.name);
        ctx.strokeText(label, sx + 5, sy);
        ctx.fillText(label, sx + 5, sy);
      }
    }

    // Отметки: задачи, точки A и B
    for (const m of markers) {
      const [sx, sy] = toScreen(m.x, m.z, view);
      const color =
        m.color ??
        (m.kind === 'a'
          ? css('--accent', '#7c4')
          : m.kind === 'b'
            ? css('--diamond', '#4cc')
            : css('--amethyst', '#a6f'));
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (m.kind === 'task') ctx.rect(sx - 5, sy - 5, 10, 10);
      else ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeText(m.label, sx + 9, sy);
      ctx.fillStyle = css('--text', '#fff');
      ctx.fillText(m.label, sx + 9, sy);
    }
    // Линия A → B
    const a = markers.find((m) => m.kind === 'a');
    const b = markers.find((m) => m.kind === 'b');
    if (a && b) {
      const [ax, ay] = toScreen(a.x, a.z, view);
      const [bx, by] = toScreen(b.x, b.z, view);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = css('--text-2', '#ccc');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // ---------------------------------------------------------------- ввод
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ moved: boolean; pinchDist?: number } | null>(null);

  const zoomAt = (sx: number, sy: number, factor: number) =>
    setView((cur) => {
      if (!cur) return cur;
      const min = fit(size.w, size.h).scale * 0.8;
      const scale = Math.min(Math.max(cur.scale * factor, min), 64);
      const [wx, wz] = toWorld(sx, sy, cur);
      // Точка под курсором остаётся на месте
      return { scale, cx: wx - (sx - size.w / 2) / scale, cz: wz - (sy - size.h / 2) / scale };
    });

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const local = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hitMarker = (sx: number, sy: number) =>
    view
      ? markers.find((m) => {
          const [mx, my] = toScreen(m.x, m.z, view);
          return Math.hypot(mx - sx, my - sy) < 9;
        })
      : undefined;

  const hoverGeo = hover ? blockToGeo(profile, hover.x, hover.z) : null;

  return (
    <div className="wmap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h }}
        onPointerDown={(e) => {
          canvasRef.current!.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, local(e));
          drag.current = { moved: false };
        }}
        onPointerMove={(e) => {
          const p = local(e);
          if (view) {
            const [wx, wz] = toWorld(p.x, p.y, view);
            setHover({ x: wx, z: wz });
          }
          const prev = pointers.current.get(e.pointerId);
          if (!prev || !drag.current) return;
          pointers.current.set(e.pointerId, p);
          if (pointers.current.size === 2) {
            const [p1, p2] = [...pointers.current.values()];
            const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
            if (drag.current.pinchDist) zoomAt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, dist / drag.current.pinchDist);
            drag.current.pinchDist = dist;
            drag.current.moved = true;
            return;
          }
          const dx = p.x - prev.x;
          const dy = p.y - prev.y;
          if (Math.abs(dx) + Math.abs(dy) > 0) {
            if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true;
            setView((cur) => (cur ? { ...cur, cx: cur.cx - dx / cur.scale, cz: cur.cz - dy / cur.scale } : cur));
          }
        }}
        onPointerUp={(e) => {
          const p = local(e);
          pointers.current.delete(e.pointerId);
          if (drag.current && !drag.current.moved && view && pointers.current.size === 0) {
            const m = hitMarker(p.x, p.y);
            if (m && onMarker) onMarker(m);
            else {
              const [wx, wz] = toWorld(p.x, p.y, view);
              onPick(Math.round(wx), Math.round(wz), e.shiftKey);
            }
          }
          if (pointers.current.size === 0) drag.current = null;
        }}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          drag.current = null;
        }}
      />
      <div className="wmap-zoom">
        <button className="btn sm icon" aria-label="Приблизить" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.6)}>
          <Plus size={15} />
        </button>
        <button className="btn sm icon" aria-label="Отдалить" onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.6)}>
          <Minus size={15} />
        </button>
        <button className="btn sm icon" aria-label="Весь мир" onClick={() => setView(fit(size.w, size.h))}>
          <Maximize size={14} />
        </button>
      </div>
      {hover && hoverGeo && (
        <div className="wmap-readout">
          x {Math.round(hover.x)} · z {Math.round(hover.z)} · {hoverGeo.lat.toFixed(2)}°, {hoverGeo.lon.toFixed(2)}°
        </div>
      )}
    </div>
  );
}
