/**
 * NeoForge: загрузчики моделей из самого NeoForge.
 *   composite — дочерние модели (children), каждая со своими текстурами;
 *   fluid_container — ведро с жидкостью слоями: base, маска fluid, залитая текстурой still жидкости с её окраской
 *     (scripts/mcp/fluids.mjs), cover (cover_is_mask, по умолчанию да, — base по форме cover); жидкость не
 *     определилась — пустое ведро (base).
 * obj и separate_transforms движок (render.mjs) понимает сам: это не правила мода, а формат модели.
 */

/** Части composite (и всего, что устроено так же — обрамлённые ящики Functional Storage) */
export function compositeChildren(ctx, part) {
  const m = part.model;
  const out = [];
  for (const [name, ref] of Object.entries(m.loaderJson?.children ?? m.children ?? {})) {
    const c = ctx.inlineModel(ref);
    if (c?.chain.length) {
      c.display = { ...m.display, ...c.display };
      out.push(...ctx.expand([{ ...part, model: c }]));
    } else ctx.warn(`${m.id}: часть «${name}» composite не нашлась`);
  }
  return out;
}

/** Ведро NeoForge с жидкостью f ({ still, tint } или null): слои для renderFlat */
export function bucketSpecs(ctx, model, f) {
  const tex = (k) => ctx.resolveTexture(model.textures, `#${k}`);
  const j = model.loaderJson ?? {};
  const specs = [];
  if (tex('base')) specs.push({ id: tex('base') });
  if (f && tex('fluid')) specs.push({ id: f.still, mask: tex('fluid'), tint: f.tint });
  const cover = tex('cover');
  if (cover && j.cover_is_mask !== false) {
    if (tex('base')) specs.push({ id: tex('base'), mask: cover });
  } else if (cover) specs.push({ id: cover });
  return specs;
}

function fluidContainer(ctx, model) {
  const j = model.loaderJson ?? {};
  const f = typeof j.fluid === 'string' ? ctx.fluidLook(j.fluid) : null;
  return { specs: bucketSpecs(ctx, model, f), fluid: f ? j.fluid : null, wanted: j.fluid ?? null };
}

export default {
  name: 'NeoForge',
  loaders: { 'neoforge:composite': compositeChildren, 'forge:composite': compositeChildren },
  flat: { 'neoforge:fluid_container': fluidContainer, 'forge:fluid_container': fluidContainer },
};
