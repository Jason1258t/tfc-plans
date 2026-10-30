import { BoxSelect, ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { useState } from 'react';
import type { Has } from '@tfc/core/building/families';
import { sourceOf } from '@tfc/core/building/fill';
import { ROLE_PARENT, type Role } from '@tfc/core/building/grid';
import type { BuildingSpec, RoleSpec } from '@tfc/core/building/spec';
import { ItemIcon, type ItemIndex } from '@/shared/pack-data';
import { Button } from '@/shared/ui';
import { cx } from '@/shared/lib';
import type { ColorsState } from '../model/blockColors';
import { ROLE_INFO, ROLE_ORDER } from '../model/roleInfo';
import { RoleBlocks } from './RoleBlocks';
import styles from '../BuilderPage/BuilderPage.module.css';

interface Props {
  spec: BuildingSpec;
  counts: Map<Role, number> | null;
  items: ItemIndex;
  has: Has;
  colors: ColorsState;
  shown: Role | null;
  onShow: (role: Role | null) => void;
  /** Выделить все клетки роли — для правки разом */
  onSelect: (role: Role) => void;
  onChange: (role: Role, rs: RoleSpec) => void;
}

/** Роли постройки: сколько клеток, включена ли, чьи блоки берёт; раскрытая роль — выбор блоков */
export function RolesPanel({ spec, counts, items, has, colors, shown, onShow, onSelect, onChange }: Props) {
  const [open, setOpen] = useState<Role | null>('wall');
  // Роли с клетками и все, чьи блоки они берут (у фахверка клеток «стены» нет, но заполнение — её блоками)
  const used = new Set<Role>(ROLE_ORDER.filter((r) => counts?.get(r) || (r === 'door' && spec.openings.door.w > 0)));
  for (const r of [...used]) for (let p = ROLE_PARENT[r]; p; p = ROLE_PARENT[p]) used.add(p);
  const roles = ROLE_ORDER.filter((r) => used.has(r));
  return (
    <ul className={styles.roles}>
      {roles.map((role) => {
        const info = ROLE_INFO[role]!;
        const rs = spec.roles[role] ?? {};
        const src = sourceOf(spec, role);
        const own = src?.role === role;
        const parent = ROLE_PARENT[role];
        const isOpen = open === role;
        return (
          <li key={role} className={cx(styles.role, isOpen && styles.roleOpen)}>
            <div className={styles.roleHead}>
              <button
                className={cx('grow', styles.roleName)}
                onClick={() => setOpen(isOpen ? null : role)}
                aria-expanded={isOpen}
              >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>{info.name}</span>
                <span className="faint small" title="Клеток с этой ролью">
                  {counts?.get(role) ?? 0}
                </span>
                {src && <ItemIcon id={src.fill.blocks[0].id} size={18} tip={false} />}
                {!own && src && <span className="faint small">как «{ROLE_INFO[src.role]?.name}»</span>}
              </button>
              {parent && (
                <label className={cx('small', styles.toggle)} title="Выключена — берёт блоки родительской роли">
                  <input
                    type="checkbox"
                    checked={rs.on !== false}
                    onChange={(e) => onChange(role, { ...rs, on: e.target.checked })}
                  />
                  своя
                </label>
              )}
              <Button
                variant="ghost"
                size="sm"
                icon
                aria-pressed={shown === role}
                aria-label={`Показать клетки роли «${info.name}»`}
                title="Подсветить в 3D"
                onClick={() => onShow(shown === role ? null : role)}
              >
                <Eye size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon
                disabled={!counts?.get(role)}
                aria-label={`Выделить клетки роли «${info.name}»`}
                title="Выделить все клетки роли — и поправить их разом"
                onClick={() => onSelect(role)}
              >
                <BoxSelect size={14} />
              </Button>
            </div>
            {isOpen && (
              <div className={styles.roleBody}>
                <p className="faint small">{info.hint}</p>
                {rs.on === false ? (
                  <p className="small">Роль выключена — клетки берут блоки роли «{ROLE_INFO[parent!]?.name}».</p>
                ) : (
                  <RoleBlocks
                    fill={rs.fill ?? { blocks: [] }}
                    degree={spec.texture.degree}
                    need={info.need}
                    items={items}
                    has={has}
                    colors={colors}
                    onChange={(fill) => onChange(role, { ...rs, on: true, fill })}
                  />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
