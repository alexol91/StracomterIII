// Interruptor del audio de combate en el modo NORMAL (fuera de «chutaos on»).
//
//  'sintetizado'    — (por defecto) disparos, explosiones, escopeta, cuchillo, heridas y muertes
//                     se generan por código (src/audio/gunsynth.ts + capas de sfx.ts), cada arma
//                     con su sonido propio. Las muestras del dueño NO suenan en modo normal.
//  'muestras-dueno' — comportamiento anterior (v1.2-v1.3): las muestras de public/audio/efectos
//                     (pistol, machine, knife, ouch, dead) hacen de cuerpo del sonido.
//
// El Modo Chutaos (truco «chutaos on») no depende de esto: siempre suena como antes, con sus voces.
export type AudioNormal = 'sintetizado' | 'muestras-dueno';
export const AUDIO_NORMAL: AudioNormal = 'sintetizado';
