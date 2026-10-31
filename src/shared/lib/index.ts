/** Общая библиотека без знаний о предметной области: импорт снаружи — `@/shared/lib`. */
export { uid, timeAgo, cx } from './util';
export { fnv1a, recipeHash } from '@tfc/core/hash';
export { CalcError, errorText, evalExpr, exprPath, parseExpr, type Expr, type Scope } from './calcExpr';
export {
  legacyTasksTarget,
  legacyReferenceTarget,
  mapReferenceTarget,
  recipesReferenceTarget,
  tagsReferenceTarget,
} from './routes';
