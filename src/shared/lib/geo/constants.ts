// Constantes geográficas del mapa — UNA sola fuente de verdad. El código
// anterior (NOSEE) duplicaba el centro de Bogotá en 7 literales dispersos; acá
// vive en un único módulo tipado que comparten LocationPicker y sus tests.
export const DEFAULT_MAP_CENTER = { latitude: 4.711, longitude: -74.0721 } as const;

export const DEFAULT_MAP_ZOOM = 16;
