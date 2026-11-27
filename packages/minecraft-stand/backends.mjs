/** Установленные адаптеры входят в SHA256 дистрибутива runner; задание выбирает их по имени. */
import { jvmBackend } from './jvm.mjs';
export const BACKENDS = Object.freeze({ jvm: jvmBackend });
