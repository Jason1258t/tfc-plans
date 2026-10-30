/** Публичный API 3D-движка схем. Отдельный подмодуль сохраняет его ленивую загрузку. */
export { buildMesh } from '../schematicMesh';
export type { Atlas, MeshData } from '../schematicMesh';
export { disposeMesh, isoCamera, meshObject, newRenderer, renderPreview } from '../schematicRender';
export { default as SchematicView3D } from '../ui/SchematicView3D';
