# TFC Studio Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the site's public «TFC Планы» identity with the approved TFC Studio name and modular blueprint logo.

**Architecture:** An inline React SVG in the header adapts to the existing light/dark theme and switches to a simplified sign on narrow screens. Static SVG sources drive the favicon and the 1200×630 Open Graph PNG; technical identifiers remain unchanged.

**Tech Stack:** React 19, TypeScript, CSS Modules, SVG, Vite, `rsvg-convert`, existing oxlint/Prettier/browser-check tooling.

## Global Constraints

- Public product name: **TFC Studio**.
- Russian descriptor: **«Инженерная экосистема для TerraFirmaCraft»**.
- Selected sign: **B — Modular System**, three isometric modules with a copper upper plane.
- Full sign at 40 px and above; compact sign below 40 px and in favicons.
- Copper accent: `#D98C62`; graphite social background: `#15191D`.
- Do not rename repository, Firebase, package, URL or other technical identifiers.
- Do not change navigation or redesign unrelated pages.
- Work only in the existing `feat/tfc-studio-branding` worktree; use Russian commit messages.

---

### Task 1: Header logo and favicon

**Files:**

- Create: `src/widgets/header/Header/BrandLogo.tsx`
- Modify: `src/widgets/header/Header/Header.tsx`
- Modify: `src/widgets/header/Header/Header.module.css`
- Replace: `public/favicon.svg`

**Interfaces:**

- Consumes: existing `Header.module.css` and theme variables `--text`, `--text-2`.
- Produces: `BrandLogo(): ReactElement`, rendered inside the existing home `NavLink`; no props or external data.

- [x] **Step 1: Create the theme-aware full and compact signs**

Create `BrandLogo.tsx` with two `aria-hidden` SVGs and the two-line wordmark. The full sign contains construction lines; the compact sign contains only the three modules with thicker strokes.

```tsx
import styles from './Header.module.css';

export function BrandLogo() {
  return (
    <>
      <svg className={`${styles.brandLogo} ${styles.brandLogoFull}`} viewBox="0 0 120 120" aria-hidden="true">
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <g className={styles.logoConstruction} strokeWidth="1">
            <path d="M12 60H108M60 12V108" strokeDasharray="3 5" />
            <circle cx="60" cy="60" r="46" />
            <path d="M20 101H100M20 97V105M100 97V105" />
          </g>
          <g stroke="currentColor" strokeWidth="2.4">
            <path d="M60 19L91 37L60 55L29 37Z" />
            <path d="M24 49L50 64V96L24 81Z" />
            <path d="M96 49L70 64V96L96 81Z" />
            <path d="M60 55V69M50 64L60 69L70 64" opacity=".65" />
          </g>
          <path d="M60 19L91 37L60 55Z" fill="#d98c62" fillOpacity=".2" stroke="#d98c62" strokeWidth="2.4" />
          <g fill="#d98c62">
            <circle cx="60" cy="19" r="3" />
            <circle cx="24" cy="49" r="3" />
            <circle cx="96" cy="49" r="3" />
          </g>
        </g>
      </svg>
      <svg className={`${styles.brandLogo} ${styles.brandLogoCompact}`} viewBox="0 0 120 120" aria-hidden="true">
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <g stroke="currentColor" strokeWidth="5">
            <path d="M60 19L91 37L60 55L29 37Z" />
            <path d="M24 49L50 64V96L24 81Z" />
            <path d="M96 49L70 64V96L96 81Z" />
          </g>
          <path d="M60 19L91 37L60 55Z" fill="#d98c62" fillOpacity=".28" stroke="#d98c62" strokeWidth="5" />
        </g>
      </svg>
      <span className={styles.brandName}>
        <span className={styles.brandTitle}>TFC</span>
        <span className={styles.brandSubtitle}>STUDIO</span>
      </span>
    </>
  );
}
```

- [x] **Step 2: Mount the logo in the existing header**

Remove `ItemIcon` from the pack-data import, keep `ItemIdSearch`, add `import { BrandLogo } from './BrandLogo';`, and replace the old brand body with `<BrandLogo />`. Add `aria-label="TFC Studio — на главную"` to the brand `NavLink`.

```tsx
import { ItemIdSearch } from '@/shared/pack-data';
import { BrandLogo } from './BrandLogo';

<NavLink to="/" className={styles.brand} aria-label="TFC Studio — на главную">
  <BrandLogo />
</NavLink>;
```

- [x] **Step 3: Add responsive wordmark and sign styles**

Add these rules to `Header.module.css`, keeping the existing mobile `.brand-name` hide rule:

```css
.brand-logo {
  width: 42px;
  height: 42px;
  flex: none;
  color: var(--text);
}

.brand-logo-compact {
  display: none;
}

.logo-construction {
  stroke: var(--text-2);
  opacity: 0.55;
}

.brand-name {
  display: flex;
  flex-direction: column;
  gap: 3px;
  line-height: 1;
}

.brand-title {
  font-size: 16px;
  font-weight: 750;
  letter-spacing: -0.4px;
}

.brand-subtitle {
  color: var(--text-2);
  font-size: 8px;
  font-weight: 650;
  letter-spacing: 2.4px;
}

@media (max-width: 560px) {
  .brand-logo {
    width: 34px;
    height: 34px;
  }
  .brand-logo-full {
    display: none;
  }
  .brand-logo-compact {
    display: block;
  }
}
```

- [x] **Step 4: Replace the favicon with the compact sign**

Write `public/favicon.svg` as this standalone static SVG:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <style>
    .outline { stroke: #1c252b; }
    @media (prefers-color-scheme: dark) { .outline { stroke: #d8e2e7; } }
  </style>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g class="outline" stroke-width="5">
      <path d="M60 19L91 37L60 55L29 37Z" />
      <path d="M24 49L50 64V96L24 81Z" />
      <path d="M96 49L70 64V96L96 81Z" />
    </g>
    <path d="M60 19L91 37L60 55Z" fill="#d98c62" fill-opacity=".28" stroke="#d98c62" stroke-width="5" />
  </g>
</svg>
```

- [x] **Step 5: Type-check and commit the header identity**

Run: `npx tsc -b`
Expected: exit 0 with no TypeScript errors.

```bash
git add src/widgets/header/Header/BrandLogo.tsx src/widgets/header/Header/Header.tsx src/widgets/header/Header/Header.module.css public/favicon.svg
git commit -m "Сайт: логотип TFC Studio в шапке и favicon"
```

### Task 2: Public name and metadata

**Files:**

- Modify: `src/lib/onboarding.ts:34`
- Modify: `src/lib/kubejsFix.ts:76`
- Modify: `index.html:8-14`

**Interfaces:**

- Consumes: existing onboarding tour and static HTML metadata.
- Produces: public-facing «TFC Studio» copy; no runtime API changes.

- [x] **Step 1: Rename the welcome tour**

Replace the welcome title exactly:

```ts
title: 'Добро пожаловать в TFC Studio',
```

- [x] **Step 2: Rename the generated KubeJS attribution**

Replace the generated comment exactly:

```ts
// Сгенерировано «TFC Studio». Положить в kubejs/server_scripts/ на сервере, затем /reload.
```

- [x] **Step 3: Update HTML title and social text**

Set `<title>`, `og:site_name` and `og:title` to `TFC Studio`. Keep the existing RealWorld feature descriptions and URL identifiers unchanged.

```html
<title>TFC Studio</title>
<meta property="og:site_name" content="TFC Studio" />
<meta property="og:title" content="TFC Studio" />
```

- [x] **Step 4: Verify the scoped rename**

Run:

```bash
rg -n "TFC Планы" src/widgets/header src/lib/onboarding.ts src/lib/kubejsFix.ts index.html public/favicon.svg
```

Expected: exit 1 and no matches.

Run: `npx tsc -b`
Expected: exit 0.

```bash
git add src/lib/onboarding.ts src/lib/kubejsFix.ts index.html
git commit -m "Сайт: публичное название TFC Studio"
```

### Task 3: Open Graph artwork

**Files:**

- Replace: `scripts/og-image.svg`
- Regenerate: `public/og.png`

**Interfaces:**

- Consumes: installed `/opt/homebrew/bin/rsvg-convert`.
- Produces: static 1200×630 `public/og.png` referenced by the existing `index.html`.

- [x] **Step 1: Replace the social artwork**

Use a graphite background, the full modular sign on the left and the TFC Studio lockup on the right. Keep the existing RealWorld version and feature summary. The SVG must include the compact wordmark text `TFC` and `STUDIO`, not «TFC Планы».

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0H0V32" fill="none" stroke="#607784" stroke-opacity=".1" />
    </pattern>
  </defs>
  <rect width="1200" height="630" fill="#15191d" />
  <rect width="1200" height="630" fill="url(#grid)" />
  <g transform="translate(86 174) scale(2.25)" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g stroke="#607784" stroke-width="1" opacity=".55">
      <path d="M12 60H108M60 12V108" stroke-dasharray="3 5" />
      <circle cx="60" cy="60" r="46" />
      <path d="M20 101H100M20 97V105M100 97V105" />
    </g>
    <g stroke="#d8e2e7" stroke-width="2.4">
      <path d="M60 19L91 37L60 55L29 37Z" />
      <path d="M24 49L50 64V96L24 81Z" />
      <path d="M96 49L70 64V96L96 81Z" />
      <path d="M60 55V69M50 64L60 69L70 64" opacity=".65" />
    </g>
    <path d="M60 19L91 37L60 55Z" fill="#d98c62" fill-opacity=".2" stroke="#d98c62" stroke-width="2.4" />
    <g fill="#d98c62"><circle cx="60" cy="19" r="3" /><circle cx="24" cy="49" r="3" /><circle cx="96" cy="49" r="3" /></g>
  </g>
  <g font-family="Helvetica Neue, Arial, sans-serif">
    <text x="420" y="246" font-size="100" font-weight="750" letter-spacing="-3" fill="#edf2f4">TFC</text>
    <text x="425" y="298" font-size="30" font-weight="650" letter-spacing="13" fill="#9aaab4">STUDIO</text>
    <text x="424" y="386" font-size="32" fill="#d98c62">Инженерная экосистема для TerraFirmaCraft</text>
    <text x="424" y="442" font-size="27" fill="#aab6bd">Задачи, схемы Create, датапаки, рецепты,</text>
    <text x="424" y="482" font-size="27" fill="#aab6bd">справочник, аддоны и карта мира</text>
    <text x="424" y="548" font-size="22" fill="#71838e">TerraFirmaCraft RealWorld · 1.21.1</text>
  </g>
</svg>
```

- [x] **Step 2: Regenerate and inspect the PNG**

Run:

```bash
rsvg-convert -w 1200 -h 630 scripts/og-image.svg -o public/og.png
file public/og.png
```

Expected: `PNG image data, 1200 x 630`.

- [x] **Step 3: Commit the social artwork**

```bash
git add scripts/og-image.svg public/og.png
git commit -m "Сайт: превью ссылок TFC Studio"
```

### Task 4: Verification and project record

**Files:**

- Modify: `docs/state/site.md`
- Verify: all files from Tasks 1–3

**Interfaces:**

- Consumes: completed TFC Studio visual identity.
- Produces: a short project-state record and verified build.

- [x] **Step 1: Record the deployed-facing change**

After the checks in Steps 2–3 pass, add this English section near the top of `docs/state/site.md`:

```markdown
## TFC Studio branding (2026-10-31)

- The header, favicon, welcome copy, generated KubeJS attribution, HTML metadata and Open Graph artwork use the public name **TFC Studio** and the modular blueprint sign. Desktop uses the full sign; narrow screens and favicons use the compact sign. Repository, Firebase, package and URL identifiers are intentionally unchanged.
- Verified with Prettier, oxlint (zero errors), FSD and package boundary checks, TypeScript, a production build, and desktop/mobile light/dark browser captures of the tasks page.
```

- [x] **Step 2: Run static checks**

Run:

```bash
npx prettier --write src/widgets/header/Header/BrandLogo.tsx src/widgets/header/Header/Header.tsx src/widgets/header/Header/Header.module.css src/lib/onboarding.ts src/lib/kubejsFix.ts index.html scripts/og-image.svg docs/state/site.md docs/superpowers/plans/2026-10-31-tfc-studio-branding.md
npm run lint
npm run ui:boundaries
npm run boundaries
npx tsc -b
```

Expected: formatting completes; lint has zero errors; all other commands exit 0. Existing lint warnings are not part of this change.

- [x] **Step 3: Check the production build and browser rendering**

Run `npm run build`; expect exit 0. Start the existing preview workflow on port 5176 (or 5177 if occupied), inspect the tasks page in desktop/mobile and light/dark themes, and verify the full sign at desktop, compact sign below 560 px, legible copper accent and unchanged navigation. Capture the existing `tasks` and `tasks.dark` scenarios with `npm run ui:shots -- capture after --only tasks`. Stop every development server started for verification before finishing.

- [x] **Step 4: Commit the verified record**

```bash
git add docs/state/site.md docs/superpowers/plans/2026-10-31-tfc-studio-branding.md
git commit -m "Документация: проверка фирменного стиля TFC Studio"
```
