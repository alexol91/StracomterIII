// Estilo visual: 'realista' (PBR, entorno HDRI, sin contornos) o 'comic' (rampas, contorno, el de antes).
// Por defecto 'realista'; se fuerza con ?estilo=comic en la URL. Es estado de módulo porque los
// materiales se crean en muchos sitios; cambiarlo en caliente lo hace el renderer (setStyle).

export type Style = 'realista' | 'comic';

let cur: Style = 'realista';
try {
  const q = new URLSearchParams(location.search).get('estilo');
  if (q === 'comic' || q === 'realista') cur = q;
} catch { /* sin URL (pruebas en Node) */ }

export function getStyleMode(): Style { return cur; }
export function setStyleMode(s: Style): void { cur = s; }
/** Los contornos de casco invertido solo existen en el estilo cómic. */
export function outlinesOn(): boolean { return cur === 'comic'; }
