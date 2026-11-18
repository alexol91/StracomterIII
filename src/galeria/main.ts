// Galería de modelos 3D candidatos. Página de PRUEBA: no forma parte del juego.
// Un único WebGLRenderer con un lienzo a pantalla completa y un viewport/scissor por tarjeta visible.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { retargetClip, UAL_TO_ROCKETBOX, UAL_TO_MIXAMO24 } from '../render/retarget';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

// ---------------------------------------------------------------- textos fijos de licencia
const LIC_SOLDADO = 'Grab3D — CC0. Generado con IA (Meshy) y retocado, según su licencia.';
const LIC_GOBKIT = 'Gobkit (Alsomind) — CC0. Sin IA generativa, según su página.';
const LIC_ACTUALES = 'Quaternius, Toon Shooter Game Kit — CC0.';
const LIC_3DASSETS = '3DAssets.dev — CC0 según el sitio. Generado por IA, sin texturas.';
const LIC_CC0 = 'CC0.';
const LIC_ROCKETBOX = 'Microsoft Rocketbox — MIT (hay que incluir el aviso de copyright). Humanos realistas con esqueleto; sin animaciones de combate.';
const LIC_UAL = 'Quaternius, Universal Animation Library — CC0';
const LIC_GODOT = 'Godot TPS demo — CC-BY 3.0 (Juan Linietsky, Fernando Calabró)';

// ---------------------------------------------------------------- definición de tarjetas
type Tipo = 'personaje' | 'objeto' | 'material';

/** Cómo se tiñe el soldado. «simple» multiplica el color; «selectivo» cambia el tono solo en la tela. */
interface Tinte {
  modo: 'simple' | 'selectivo';
  /** simple: color multiplicador (hex sRGB) */
  color?: number;
  /** selectivo: tono destino (0..1), multiplicador y suma de saturación, multiplicador de valor */
  tono?: number; satMul?: number; satAdd?: number; valMul?: number;
  brazalete?: boolean;
  /** máscara selectiva: 'tela' (verdes/grises, soldado) o 'sinpiel' (todo salvo tonos de piel; sirve para ropa gris/negra) */
  masc?: 'tela' | 'sinpiel';
  /** cuánto del dibujo de tono original se conserva (0 = tono plano) */
  hueKeep?: number;
}

interface Tarjeta {
  nombre: string;
  fuente: string;      // línea de fuente/licencia (texto fijo)
  url?: string;
  /** avatar Rocketbox (carpeta en preview/rocketbox): se carga el .fbx con FBXLoader y se le ponen las texturas por código */
  rocketbox?: string;
  /** normalizar a esta altura en metros (para modelos en cm o con otro eje) */
  altura?: number;
  /** animaciones externas a aplicar (clips Rocketbox compartidos por nombre de hueso) */
  animRocketbox?: boolean;
  /** pestaña de retargeteo: clips del UAL pasados al esqueleto de este modelo ('ual' = el maniquí original, sin retargeteo) */
  retarget?: 'rocketbox' | 'soldado' | 'ual';
  tipo: Tipo;
  animInicial?: string;
  tinte?: Tinte;
  detalle?: string;
  /** material PBR: carpeta + prefijo de los tres ficheros */
  pbr?: { color: string; normal: string; rugosidad: string };
}
interface Seccion { titulo: string; nota?: string; tarjetas: Tarjeta[]; }
interface Pestana { id: string; titulo: string; secciones: Seccion[]; }

const P = 'preview/';
const bonito = (f: string) => f.replace(/\.glb$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');

function gobkit(carpeta: string, titulo: string, nota: string, ficheros: string[]): Seccion {
  return {
    titulo, nota,
    tarjetas: ficheros.map((f) => ({
      nombre: bonito(f), fuente: LIC_GOBKIT, url: `${P}gobkit/${carpeta}/${f}`, tipo: 'personaje' as Tipo, animInicial: 'Idle',
    })),
  };
}

// Variantes de color del soldado (la misma tabla para las dos técnicas).
interface Variante { nombre: string; simple: number; sel: Omit<Tinte, 'modo' | 'color'>; brazalete?: boolean; }
const ALIADOS: Variante[] = [
  { nombre: 'Capitán — azul marino', simple: 0x34518f, sel: { tono: 0.62, satMul: 1.6, satAdd: 0.18, valMul: 0.9 } },
  { nombre: 'Técnico — cian apagado', simple: 0x3f8f95, sel: { tono: 0.5, satMul: 1.2, satAdd: 0.08, valMul: 1.15 } },
  { nombre: 'Especialista — verde oliva', simple: 0x5e7a2a, sel: { tono: 0.2, satMul: 1.5, satAdd: 0.12, valMul: 1.0 } },
  { nombre: 'Explosivo — arena/ocre', simple: 0xc9a25a, sel: { tono: 0.11, satMul: 1.7, satAdd: 0.18, valMul: 1.9 } },
];
const HOSTILES: Variante[] = [
  { nombre: 'Hostil — gris urbano + brazalete rojo', simple: 0x8a8f99, sel: { tono: 0.6, satMul: 0.15, satAdd: 0, valMul: 1.35 }, brazalete: true },
  { nombre: 'Hostil — negro', simple: 0x2a2a2e, sel: { tono: 0.6, satMul: 0.25, satAdd: 0, valMul: 0.35 } },
  { nombre: 'Hostil — marrón rojizo', simple: 0x8a4a35, sel: { tono: 0.04, satMul: 1.8, satAdd: 0.22, valMul: 1.15 } },
];

function variantes(lista: Variante[], modo: 'simple' | 'selectivo'): Tarjeta[] {
  return lista.map((v) => ({
    nombre: v.nombre, fuente: LIC_SOLDADO, url: `${P}soldado/soldier-rigged.glb`, tipo: 'personaje' as Tipo, animInicial: 'walk',
    tinte: modo === 'simple'
      ? { modo, color: v.simple, brazalete: v.brazalete }
      : { modo, ...v.sel, brazalete: v.brazalete },
    detalle: modo === 'simple'
      ? `Tinte simple: color × #${v.simple.toString(16).padStart(6, '0')}`
      : `Tono selectivo: tono ${v.sel.tono}, sat ×${v.sel.satMul} +${v.sel.satAdd}, valor ×${v.sel.valMul}`,
  }));
}

// 3DAssets: [fichero (sin extensión), carpeta, nombre en español]
const ASSETS_3D: [string, string][] = [
  ['bench-desk-4-position-f2aa185d', 'Escritorio bench de 4 puestos'],
  ['desk-sit-stand-raised-19facdb2', 'Escritorio elevable (alto)'],
  ['desk-executive-6ef42aca', 'Escritorio ejecutivo'],
  ['desk-corner-return-22d5a449', 'Escritorio con ala en esquina'],
  ['task-chair-mesh-b69df323', 'Silla de oficina (malla)'],
  ['executive-chair-9801b58f', 'Sillón ejecutivo'],
  ['boardroom-table-12-f45f2bb7', 'Mesa de sala de juntas (12)'],
  ['filing-cabinet-4-drawer-e816dbb7', 'Archivador de 4 cajones'],
  ['bookcase-open-899a72be', 'Estantería abierta'],
  ['glazed-partition-module-0a8e7f14', 'Mampara de cristal'],
  ['glazed-boardroom-5c7c7a97', 'Sala de juntas acristalada'],
  ['monitor-24-inch-cd110e8d', 'Monitor de 24"'],
  ['printer-multifunction-0b3b5d41', 'Impresora multifunción'],
  ['reception-desk-curved-83bd6cd6', 'Mostrador de recepción curvo'],
  ['security-speedgate-pair-47e9073d', 'Torno de seguridad (speedgate)'],
  ['server-rack-42u-doors-02e5b888', 'Rack de servidores 42U'],
  ['ups-cabinet-068f2ef6', 'Armario SAI/UPS'],
  ['in-row-cooling-unit-b833df74', 'Unidad de climatización de rack'],
  ['vending-machine-drink-a914f649', 'Máquina expendedora (bebidas)'],
  ['vending-machine-snack-1311deb7', 'Máquina expendedora (snacks)'],
  ['lobby-armchair-b7009456', 'Butaca de vestíbulo'],
  ['visitor-sofa-three-seat-0919a142', 'Sofá de visitas (3 plazas)'],
  ['floor-planter-large-8b6e3c88', 'Jardinera grande de suelo'],
  ['rooftop-ac-unit', 'Equipo de aire de azotea'],
];
const POLY: [string, string][] = [
  ['metal_office_desk', 'Escritorio metálico'], ['modern_arm_chair_01', 'Sillón moderno'], ['sofa_02', 'Sofá'],
  ['steel_frame_shelves_03', 'Estantería metálica'], ['wooden_bookshelf_worn', 'Librería de madera gastada'],
  ['exterior_aircon_unit', 'Unidad exterior de aire acondicionado'], ['medical_box', 'Botiquín'], ['ammo_box', 'Caja de munición'],
  ['calathea_orbifolia_01', 'Planta (calathea)'], ['cardboard_box_01', 'Caja de cartón'],
];

function mat(nombre: string, fuente: string, dir: string, c: string, n: string, r: string): Tarjeta {
  return {
    nombre, fuente, tipo: 'material', detalle: 'Color + normal + rugosidad, 1K. Baldosa de 2×2 m (cada textura = 1 m).',
    pbr: { color: `${P}tex/${dir}/${c}`, normal: `${P}tex/${dir}/${n}`, rugosidad: `${P}tex/${dir}/${r}` },
  };
}
const PH = (dir: string) => [`${dir}_diff_1k.jpg`, `${dir}_nor_gl_1k.jpg`, `${dir}_rough_1k.jpg`] as const;
const AC = (dir: string) => [`${dir}_1K-JPG_Color.jpg`, `${dir}_1K-JPG_NormalGL.jpg`, `${dir}_1K-JPG_Roughness.jpg`] as const;

// Rocketbox: [carpeta, nombre, triángulos aprox., materiales]
const ROCKETBOX: [string, string][] = [
  ['Military_Male_01', 'Militar 01'], ['Military_Male_02', 'Militar 02'], ['Military_Male_03', 'Militar 03'],
  ['Military_Male_04', 'Militar 04'], ['Military_Male_05', 'Militar 05'], ['Military_Female_01', 'Militar (mujer) 01'],
  ['Police_Male_01', 'Policía 01'], ['Police_Male_02', 'Policía 02'], ['Security_Male_01', 'Seguridad 01'],
];
const rbBase = (id: string, nombre: string): Tarjeta => ({
  nombre: `${nombre} — ${id}`, fuente: LIC_ROCKETBOX, rocketbox: id, altura: 1.8, animRocketbox: true, tipo: 'personaje', animInicial: 'Idle neutral',
});
// Variantes de color para la prueba (paleta ajustada a texturas casi neutras: tono plano, saturación añadida).
const RB_ALIADOS: Variante[] = [
  { nombre: 'Capitán — azul marino', simple: 0, sel: { tono: 0.62, satMul: 1, satAdd: 0.38, valMul: 0.8 } },
  { nombre: 'Técnico — cian apagado', simple: 0, sel: { tono: 0.5, satMul: 1, satAdd: 0.24, valMul: 1.0 } },
  { nombre: 'Especialista — verde oliva', simple: 0, sel: { tono: 0.17, satMul: 1, satAdd: 0.32, valMul: 0.85 } },
  { nombre: 'Explosivo — arena/ocre', simple: 0, sel: { tono: 0.11, satMul: 1, satAdd: 0.36, valMul: 1.4 } },
];
const RB_HOSTILES: Variante[] = [
  { nombre: 'Hostil — gris urbano + brazalete rojo', simple: 0, sel: { tono: 0.6, satMul: 0, satAdd: 0.04, valMul: 0.8 }, brazalete: true },
  { nombre: 'Hostil — negro', simple: 0, sel: { tono: 0.6, satMul: 0, satAdd: 0, valMul: 0.3 } },
  { nombre: 'Hostil — marrón rojizo', simple: 0, sel: { tono: 0.04, satMul: 1, satAdd: 0.42, valMul: 0.85 } },
];
function variantesRB(id: string, quien: string, lista: Variante[]): Tarjeta[] {
  return lista.map((v) => ({
    ...rbBase(id, `${quien}: ${v.nombre}`),
    tinte: { modo: 'selectivo' as const, ...v.sel, masc: 'sinpiel' as const, hueKeep: 0, brazalete: v.brazalete },
    detalle: `Tono selectivo (sin piel): tono ${v.sel.tono}, sat ×${v.sel.satMul} +${v.sel.satAdd}, valor ×${v.sel.valMul}. Cabeza y armas sin tocar.`,
  }));
}

const RT_UAL: Tarjeta = { nombre: 'Maniquí UAL (referencia)', fuente: LIC_UAL, url: `${P}anim/ual.glb`, retarget: 'ual', tipo: 'personaje' };
const rtRocketbox = (id: string, nombre: string): Tarjeta => ({
  nombre: `${nombre} — retargeteo UAL → Rocketbox`, fuente: LIC_ROCKETBOX, rocketbox: id, altura: 1.8, retarget: 'rocketbox', tipo: 'personaje',
});

const PESTANAS: Pestana[] = [
  {
    id: 'retargeteo', titulo: 'Retargeteo (prueba)',
    secciones: [
      {
        titulo: 'Rocketbox',
        nota: 'Clips del maniquí UAL pasados al esqueleto Bip01 (UAL_TO_ROCKETBOX). El primero es el maniquí original, que repite el último clip pulsado para comparar.',
        tarjetas: [RT_UAL, rtRocketbox('Military_Male_01', 'Militar 01'), rtRocketbox('Police_Male_02', 'Policía 02'), rtRocketbox('Security_Male_01', 'Seguridad 01')],
      },
      {
        titulo: 'Soldado Grab3D',
        nota: 'Los mismos clips pasados al esqueleto Mixamo de 24 huesos (UAL_TO_MIXAMO24).',
        tarjetas: [RT_UAL, { nombre: 'Soldado — retargeteo UAL → Mixamo24', fuente: LIC_SOLDADO, url: `${P}soldado/soldier-rigged.glb`, retarget: 'soldado', tipo: 'personaje' }],
      },
    ],
  },
  {
    id: 'rocketbox', titulo: 'Rocketbox (realistas)',
    secciones: [
      {
        titulo: 'Microsoft Rocketbox — los 9 avatares',
        nota: 'Se cargan desde el .fbx original (FBXLoader), normalizados a 1,80 m y de pie, con texturas de color y normal asignadas por código. Animaciones: las 5 de Rocketbox, compartidas por nombre de hueso (en el sitio).',
        tarjetas: ROCKETBOX.map(([id, n]) => rbBase(id, n)),
      },
      { titulo: 'Prueba de color — Militar 01, aliados', nota: 'Cambio de tono selectivo con máscara «sin piel»: la cabeza (material propio), las armas, la piel de manos y cuello se respetan.', tarjetas: variantesRB('Military_Male_01', 'Militar 01', RB_ALIADOS) },
      { titulo: 'Prueba de color — Militar 01, hostiles', tarjetas: variantesRB('Military_Male_01', 'Militar 01', RB_HOSTILES) },
      { titulo: 'Prueba de color — Seguridad 01, aliados', tarjetas: variantesRB('Security_Male_01', 'Seguridad 01', RB_ALIADOS) },
      { titulo: 'Prueba de color — Seguridad 01, hostiles', tarjetas: variantesRB('Security_Male_01', 'Seguridad 01', RB_HOSTILES) },
    ],
  },
  {
    id: 'realistas', titulo: 'Soldado Grab3D',
    secciones: [
      {
        titulo: 'Soldado realista (original)',
        nota: '279.000 triángulos, 24 huesos, texturas PBR. Si existe soldier-lite.glb en public/preview/soldado/ aparece a su lado.',
        tarjetas: [{ nombre: 'Soldado — original', fuente: LIC_SOLDADO, url: `${P}soldado/soldier-rigged.glb`, tipo: 'personaje', animInicial: 'walk' }],
      },
      {
        titulo: 'Prueba de color — aliados, cambio de tono selectivo',
        nota: 'El tono, la saturación y el valor se cambian solo en los píxeles de tela (verdes/grises de camuflaje); piel y negro del arma se respetan.',
        tarjetas: variantes(ALIADOS, 'selectivo'),
      },
      {
        titulo: 'Prueba de color — aliados, tinte simple',
        nota: 'Se multiplica el color base por un color: más fácil, pero también tiñe la piel y ensucia el camuflaje.',
        tarjetas: variantes(ALIADOS, 'simple'),
      },
      { titulo: 'Prueba de color — hostiles, cambio de tono selectivo', tarjetas: variantes(HOSTILES, 'selectivo') },
      { titulo: 'Prueba de color — hostiles, tinte simple', tarjetas: variantes(HOSTILES, 'simple') },
    ],
  },
  {
    id: 'gobkit', titulo: 'Personajes Gobkit',
    secciones: [
      gobkit('human004', 'Militares (Vol. 4)', 'Ocho personajes, esqueleto compartido, ~0,5 MB cada uno.',
        ['Rifleman.glb', 'ArmySniper.glb', 'CombatEngineer.glb', 'ReconScout.glb', 'CombatMedic.glb', 'MachineGunner.glb', 'ArmyOfficer.glb', 'ArmyGeneral.glb']),
      gobkit('human022', 'Asalto táctico (Vol. 22)', '',
        ['FrontlineRifleman.glb', 'AssaultTeamLeader.glb', 'BlackOpsOperator.glb', 'GhillieSniper.glb', 'NightReconScout.glb', 'DropZoneParatrooper.glb', 'FieldRadioOperator.glb', 'ConvictCommando.glb']),
      gobkit('human012', 'Policía (Vol. 12)', '',
        ['PatrolConstable.glb', 'HighwayPatrol.glb', 'StationDetective.glb', 'RaidOfficer.glb', 'PoliceChief.glb', 'EscapedConvict.glb', 'BookedSuspect.glb', 'ToughInmate.glb']),
      gobkit('human002', 'Oficina (Vol. 2)', '',
        ['SalesRep.glb', 'ItEngineer.glb', 'Accountant.glb', 'CompanyCeo.glb', 'OfficeManager.glb', 'Receptionist.glb', 'OfficeIntern.glb', 'SecurityGuard.glb']),
    ],
  },
  {
    id: 'actuales', titulo: 'Personajes actuales',
    secciones: [{
      titulo: 'Los que usa el juego ahora', nota: 'Para comparar tamaño de detalle y estilo con los candidatos.',
      tarjetas: [
        { nombre: 'Soldado (actual)', fuente: LIC_ACTUALES, url: 'models/chars/Character_Soldier.gltf', tipo: 'personaje', animInicial: 'Idle' },
        { nombre: 'Enemigo (actual)', fuente: LIC_ACTUALES, url: 'models/chars/Character_Enemy.gltf', tipo: 'personaje', animInicial: 'Idle' },
        { nombre: 'Hazmat (actual)', fuente: LIC_ACTUALES, url: 'models/chars/Character_Hazmat.gltf', tipo: 'personaje', animInicial: 'Idle' },
      ],
    }, {
      titulo: 'Maniquíes de animaciones', nota: 'Solo interesan sus clips (botones): el maniquí es neutro.',
      tarjetas: [
        { nombre: 'Maniquí — Universal Animation Library', fuente: LIC_UAL, url: `${P}anim/ual.glb`, tipo: 'personaje', animInicial: 'Idle_Loop' },
        { nombre: 'Robot — Godot TPS demo', fuente: LIC_GODOT, url: `${P}anim/godot-player.glb`, tipo: 'personaje', animInicial: 'Idlecombat-cycle' },
      ],
    }],
  },
  {
    id: 'oficina', titulo: 'Oficina',
    secciones: [
      {
        titulo: '3DAssets.dev — mobiliario e instalaciones', nota: 'Sin texturas: el color es el material gris por defecto.',
        tarjetas: ASSETS_3D.map(([f, n]) => ({
          nombre: n, fuente: LIC_3DASSETS, url: `${P}oficina/${f}.glb`, tipo: 'objeto' as Tipo,
        })),
      },
      {
        titulo: 'Poly Haven — con texturas',
        tarjetas: POLY.map(([id, n]) => ({
          nombre: n, fuente: LIC_CC0, url: `${P}poly/${id}/${id}_1k.gltf`, tipo: 'objeto' as Tipo, detalle: `Poly Haven: ${id}`,
        })),
      },
    ],
  },
  {
    id: 'materiales', titulo: 'Materiales',
    secciones: [{
      titulo: 'Texturas PBR', nota: 'Baldosa de 2×2 m con una esfera de 0,5 m de radio, iluminada con luz rasante para que se note la normal.',
      tarjetas: [
        mat('Mármol — Poly Haven marble_tiles', LIC_CC0, 'marble_tiles', ...PH('marble_tiles')),
        mat('Mármol — ambientCG Marble006', LIC_CC0, 'Marble006', ...AC('Marble006')),
        mat('Moqueta — Poly Haven dirty_carpet', LIC_CC0, 'dirty_carpet', ...PH('dirty_carpet')),
        mat('Moqueta — ambientCG Carpet012', LIC_CC0, 'Carpet012', ...AC('Carpet012')),
        mat('Laminado — Poly Haven laminate_floor_02', LIC_CC0, 'laminate_floor_02', ...PH('laminate_floor_02')),
        mat('Yeso pintado — Poly Haven painted_plaster_wall', LIC_CC0, 'painted_plaster_wall', ...PH('painted_plaster_wall')),
        mat('Yeso pintado — ambientCG PaintedPlaster017', LIC_CC0, 'PaintedPlaster017', ...AC('PaintedPlaster017')),
        mat('Hormigón — Poly Haven rough_concrete', LIC_CC0, 'rough_concrete', ...PH('rough_concrete')),
        mat('Hormigón — ambientCG Concrete034', LIC_CC0, 'Concrete034', ...AC('Concrete034')),
      ],
    }],
  },
];

// ---------------------------------------------------------------- renderer único
const lienzo = document.getElementById('lienzo') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.setScissorTest(true);
function redimensionar(): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
redimensionar();
window.addEventListener('resize', redimensionar);

const COLOR_FONDO = new THREE.Color(0x1b2029);
const escenaVacia = new THREE.Scene();
escenaVacia.background = COLOR_FONDO;

// Entorno de luz (HDRI). Si falla, las luces de cada escena bastan.
let entorno: THREE.Texture | null = null;
const promesaEntorno: Promise<void> = new Promise((ok) => {
  new RGBELoader().load(`${P}hdri/unfinished_office_1k.hdr`, (hdr) => {
    const pm = new THREE.PMREMGenerator(renderer);
    entorno = pm.fromEquirectangular(hdr).texture;
    hdr.dispose(); pm.dispose();
    ok();
  }, undefined, () => ok());
});

// Texturas compartidas: suelo con borde que se desvanece y sombra «blob» suave.
function degradado(centro: string, borde: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, centro); r.addColorStop(1, borde);
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const alfaSuelo = (() => { // alphaMap usa el canal verde: blanco opaco, negro transparente
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 20, 64, 64, 64);
  r.addColorStop(0, '#fff'); r.addColorStop(0.6, '#bbb'); r.addColorStop(1, '#000');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const texSombra = degradado('rgba(0,0,0,0.65)', 'rgba(0,0,0,0)');

// ---------------------------------------------------------------- carga con caché
const cargador = new GLTFLoader();
const cacheGltf = new Map<string, Promise<GLTF>>();
function cargarGltf(url: string): Promise<GLTF> {
  let p = cacheGltf.get(url);
  if (!p) { p = cargador.loadAsync(url); cacheGltf.set(url, p); }
  return p;
}
const cargadorTex = new THREE.TextureLoader();
function cargarTex(url: string, color: boolean): Promise<THREE.Texture> {
  return cargadorTex.loadAsync(url).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2);
    t.anisotropy = 8;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

// ---------------------------------------------------------------- tinte del soldado (sin editar el fichero)
const GLSL_TINTE = /* glsl */ `
uniform float uModo; uniform float uMasc; uniform float uHueKeep; uniform vec3 uColor; uniform float uTono; uniform float uSatMul; uniform float uSatAdd; uniform float uValMul;
vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1.0e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)), d/(q.x+e), q.x); }
vec3 hsv2rgb(vec3 c){ vec4 K=vec4(1.,2./3.,1./3.,3.); vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www); return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y); }
vec3 tinteSoldado(vec3 lin){
  if (uModo < 0.5) return lin;
  if (uModo < 1.5) return clamp(lin * uColor, 0., 1.);            // tinte simple
  vec3 s = pow(max(lin, vec3(0.)), vec3(1./2.2));                // selectivo: trabaja en sRGB aproximado
  vec3 hsv = rgb2hsv(s);
  // Máscara de tela: tono verde/oliva/cian (excluye la piel rosada, tono ~0..0.08), no demasiado oscuro ni gris puro.
  float m = smoothstep(0.08, 0.14, hsv.x) * (1. - smoothstep(0.45, 0.52, hsv.x));
  if (uMasc > 1.5) {
    // «sinpiel»: todo lo que no sea tono de piel (rosa/naranja con saturación apreciable); vale para grises y negros.
    float piel = (1. - smoothstep(0.09, 0.13, hsv.x) + smoothstep(0.94, 0.98, hsv.x)) * smoothstep(0.15, 0.22, hsv.y);
    m = (1. - clamp(piel, 0., 1.)) * smoothstep(0.04, 0.12, hsv.z);
  } else {
    m *= smoothstep(0.05, 0.13, hsv.z) * smoothstep(0.03, 0.08, hsv.y);
  }
  float h = fract(uTono + (hsv.x - 0.22) * uHueKeep);                // conserva algo del dibujo del camuflaje
  float sa = clamp(hsv.y * uSatMul + uSatAdd, 0., 1.);
  float va = clamp(hsv.z * uValMul, 0., 1.);
  vec3 nuevo = hsv2rgb(vec3(h, sa, va));
  return pow(mix(s, nuevo, m), vec3(2.2));
}`;

function aplicarTinte(root: THREE.Object3D, t: Tinte, filtro: (nombre: string) => boolean = () => true): void {
  const col = new THREE.Color(t.color ?? 0xffffff).multiplyScalar(1.9);
  const clonar = (original: THREE.Material): THREE.Material => {
    if (!filtro(original.name)) return original;
    const mt = (original as THREE.MeshStandardMaterial).clone(); // se comparten las texturas, no el material
    mt.onBeforeCompile = (sh) => {
      sh.uniforms.uModo = { value: t.modo === 'simple' ? 1 : 2 };
      sh.uniforms.uMasc = { value: t.masc === 'sinpiel' ? 2 : 1 };
      sh.uniforms.uHueKeep = { value: t.hueKeep ?? 0.35 };
      sh.uniforms.uColor = { value: new THREE.Vector3(col.r, col.g, col.b) };
      sh.uniforms.uTono = { value: t.tono ?? 0 };
      sh.uniforms.uSatMul = { value: t.satMul ?? 1 };
      sh.uniforms.uSatAdd = { value: t.satAdd ?? 0 };
      sh.uniforms.uValMul = { value: t.valMul ?? 1 };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLSL_TINTE)
        .replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef USE_MAP\ndiffuseColor.rgb = tinteSoldado(diffuseColor.rgb);\n#endif');
    };
    mt.customProgramCacheKey = () => 'tinte-soldado-v2'; // mismo código, uniformes por material
    return mt;
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = Array.isArray(m.material) ? m.material.map(clonar) : clonar(m.material);
  });
}

/** Brazalete rojo en el brazo izquierdo. Soldado: hueso LeftArm (eje Y, cm). Rocketbox: Bip01_L_UpperArm (eje X, cm). */
function ponerBrazalete(root: THREE.Object3D, rocketbox: boolean): void {
  const hueso = root.getObjectByName(rocketbox ? 'Bip01_L_UpperArm' : 'LeftArm');
  if (!hueso) return;
  const geo = new THREE.CylinderGeometry(rocketbox ? 6.6 : 7.2, rocketbox ? 6.6 : 7.2, 5, 20, 1, true);
  const banda = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc01818, roughness: 0.7, side: THREE.DoubleSide }));
  banda.name = 'brazalete';
  if (rocketbox) { banda.rotation.z = Math.PI / 2; banda.position.set(14, 0, 0); } else banda.position.set(0, 13, 0);
  hueso.add(banda);
}

// ---------------------------------------------------------------- Rocketbox (FBX con texturas asignadas por código)
// Vía elegida: FBXLoader sobre el .fbx. La conversión assimp→GLB deja nodos $AssimpFbx$ que duplican la
// transformación de Bip01 al aplicar los clips, y baseColorFactor = negro.
const NOMBRES_ANIM_RB: [string, string][] = [
  ['m_idle_neutral_01', 'Idle neutral'], ['m_idle_look_around_01', 'Mirar alrededor'], ['m_idle_angry_01', 'Idle enfadado'],
  ['m_crouch_idle', 'Agachado'], ['m_waiting_walk', 'Esperando / caminar'],
];
const cacheRB = new Map<string, Promise<THREE.Group>>();
function cargarRocketbox(nombre: string): Promise<THREE.Group> {
  let p = cacheRB.get(nombre);
  if (!p) {
    p = (async () => {
      const [g, tabla] = await Promise.all([
        new FBXLoader().loadAsync(`${P}rocketbox/${nombre}/${nombre}.fbx`),
        fetch(`${P}rocketbox/texturas.json`).then((r) => r.json() as Promise<Record<string, Record<string, { color?: string; normal?: string }>>>),
      ]);
      const mats = tabla[nombre] ?? {};
      const cargar = async (f: string | undefined, color: boolean) => {
        if (!f) return null;
        const t = await cargadorTex.loadAsync(`${P}rocketbox/${nombre}/${f}`);
        t.anisotropy = 8; if (color) t.colorSpace = THREE.SRGBColorSpace; // flipY por defecto (true): es lo correcto para FBX
        return t;
      };
      const cache = new Map<string, THREE.Material>();
      const convertidos = new Map<THREE.Material, Promise<THREE.Material>>();
      const convertir = (m: THREE.Material) => {
        let r = convertidos.get(m);
        if (!r) {
          r = (async () => {
            const def = mats[m.name] ?? {};
            const [map, normalMap] = await Promise.all([cargar(def.color, true), cargar(def.normal, false)]);
            const mt = new THREE.MeshStandardMaterial({ name: m.name, map: map ?? undefined, normalMap: normalMap ?? undefined, roughness: 0.78, metalness: 0, side: (m as THREE.MeshPhongMaterial).side });
            cache.set(m.name, mt); return mt;
          })();
          convertidos.set(m, r);
        }
        return r;
      };
      const mallas: THREE.Mesh[] = [];
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) mallas.push(o as THREE.Mesh); });
      for (const m of mallas) {
        m.material = Array.isArray(m.material) ? await Promise.all(m.material.map(convertir)) : await convertir(m.material);
        m.frustumCulled = false;
      }
      return g;
    })();
    cacheRB.set(nombre, p);
  }
  return p;
}

let promesaClipsRB: Promise<THREE.AnimationClip[]> | null = null;
/** Los 5 clips solo-esqueleto de Rocketbox, «en el sitio» (se anula el desplazamiento horizontal de Bip01). */
function cargarClipsRB(): Promise<THREE.AnimationClip[]> {
  if (!promesaClipsRB) {
    promesaClipsRB = Promise.all(NOMBRES_ANIM_RB.map(async ([f, nombre]) => {
      const g = await new FBXLoader().loadAsync(`${P}rocketbox/anim/${f}.fbx`);
      const clip = g.animations[0];
      clip.name = nombre;
      clip.tracks = clip.tracks.filter((t) => !/^(MotionExtractionHelper|ExposeTransformHelper)\./.test(t.name));
      const raiz = clip.tracks.find((t) => t.name === 'Bip01.position');
      if (raiz) { const v = raiz.values; const x0 = v[0], z0 = v[2]; for (let i = 0; i < v.length; i += 3) { v[i] -= x0; v[i + 2] -= z0; } }
      return clip;
    }));
  }
  return promesaClipsRB;
}

// ---------------------------------------------------------------- tarjeta
const tarjetas: Carta[] = [];
const reloj = new THREE.Clock();
let modoFoto = false;

// ---------------------------------------------------------------- pestaña «Retargeteo (prueba)»: controles globales
const CLIPS_RT = ['Idle_Loop', 'Pistol_Idle_Loop', 'Pistol_Aim_Neutral', 'Pistol_Shoot', 'Pistol_Reload', 'Walk_Loop', 'Jog_Fwd_Loop',
  'Sprint_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Punch_Jab', 'Punch_Cross', 'Hit_Chest', 'Hit_Head', 'Death01', 'Roll'];
const EN_SITIO = new Set(['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Fwd_Loop']);
type Vista = '34' | 'frente' | 'perfil' | 'espalda';
const AZIMUT: Record<Vista, number> = { '34': 35, frente: 0, perfil: 90, espalda: 180 };
const params = new URLSearchParams(location.search);
const vistaParam = (params.get('vista') ?? '').toLowerCase();
const ctl = {
  pausa: params.get('pausa') === '1' || params.get('pausa') === 'true',
  x: Math.min(0.999, Math.max(0, parseFloat(params.get('t') ?? '0') || 0)),
  vista: (['frente', 'perfil', 'espalda'].includes(vistaParam) ? vistaParam : '34') as Vista,
  huesos: false,
  clipUrl: params.get('clip'),
  clipUltimo: params.get('clip') ?? 'Pistol_Idle_Loop', // último clip pulsado (lo siguen los maniquíes UAL)
};
/** El UAL «de cálculo»: escena recién cargada, en reposo, sin mixer; solo sirve de origen del retargeteo. */
let promesaUal: Promise<GLTF> | null = null;
const cargarUal = () => (promesaUal ??= cargarGltf(`${P}anim/ual.glb`));
let ualCalcObj: THREE.Object3D | null = null;
/** Origen del retargeteo: copia del UAL en reposo, sin mixer (retargetClip lo anima y lo restaura). Imprime los nombres de hueso una vez. */
async function ualCalculo(): Promise<THREE.Object3D> {
  if (!ualCalcObj) {
    const g = await cargarUal();
    ualCalcObj = SkeletonUtils.clone(g.scene);
    ualCalcObj.updateMatrixWorld(true);
    const nombres: string[] = []; ualCalcObj.traverse((o) => { if ((o as THREE.Bone).isBone) nombres.push(o.name); });
    console.info(`Huesos del UAL tal como los carga GLTFLoader (${nombres.length}):`, nombres.join(' '));
  }
  return ualCalcObj;
}

class Carta {
  el: HTMLElement; vista: HTMLElement; estado: HTMLElement; datos: HTMLElement; anims: HTMLElement;
  visible = false; iniciada = false; lista = false;
  escena = new THREE.Scene();
  camara = new THREE.PerspectiveCamera(35, 4 / 3, 0.05, 200);
  controles: OrbitControls | null = null;
  mezclador: THREE.AnimationMixer | null = null;
  acciones = new Map<string, THREE.AnimationAction>();
  botones = new Map<string, HTMLButtonElement>();
  accion: THREE.AnimationAction | null = null;
  // retargeteo
  ref: THREE.Object3D | null = null;            // copia del destino en reposo (nunca animada), con la misma transformación
  ualClips: THREE.AnimationClip[] = [];
  ayudante: THREE.SkeletonHelper | null = null;
  vistaAplicada = '';
  errorEl: HTMLElement | null = null;
  parar = 0; // marca de tiempo hasta la que no se gira sola (tras arrastrar)

  constructor(public def: Tarjeta, contenedor: HTMLElement) {
    const el = document.createElement('article'); el.className = 'tarjeta';
    el.innerHTML = `<div class="vista"><div class="estado">En cola…</div></div>
      <div class="info"><h3></h3><div class="fuente"></div><div class="datos"></div><div class="detalle"></div><div class="anims"></div></div>`;
    (el.querySelector('h3') as HTMLElement).textContent = def.nombre;
    (el.querySelector('.fuente') as HTMLElement).textContent = def.fuente;
    const det = el.querySelector('.detalle') as HTMLElement;
    if (def.detalle) det.textContent = def.detalle; else det.remove();
    this.el = el;
    this.vista = el.querySelector('.vista') as HTMLElement;
    this.estado = el.querySelector('.estado') as HTMLElement;
    this.datos = el.querySelector('.datos') as HTMLElement;
    this.anims = el.querySelector('.anims') as HTMLElement;
    if (def.retarget) {
      this.errorEl = document.createElement('div'); this.errorEl.className = 'error';
      (el.querySelector('.info') as HTMLElement).appendChild(this.errorEl);
    }
    contenedor.appendChild(el);
    this.escena.background = COLOR_FONDO;
  }

  /** Se llama la primera vez que la tarjeta entra en pantalla. */
  async iniciar(): Promise<void> {
    if (this.iniciada) return;
    this.iniciada = true;
    this.estado.textContent = 'Cargando…';
    try {
      await promesaEntorno;
      if (this.def.pbr) await this.montarMaterial(); else await this.montarModelo();
      this.lista = true;
      this.estado.remove();
    } catch (e) {
      console.error(this.def.nombre, e);
      this.estado.textContent = 'Error al cargar: ' + (e instanceof Error ? e.message : String(e));
      this.iniciada = false;
    }
  }

  private luces(): void {
    const e = this.escena;
    if (entorno) { e.environment = entorno; e.environmentIntensity = 1.3; }
    e.add(new THREE.HemisphereLight(0xffffff, 0x6a707c, 0.85));
    const clave = new THREE.DirectionalLight(0xfff2e0, 2.1); clave.position.set(3, 5, 4); e.add(clave);
    const relleno = new THREE.DirectionalLight(0xbfd4ff, 0.9); relleno.position.set(-4, 2, -3); e.add(relleno);
  }

  /** Suelo gris con borde difuminado y sombra suave, a escala del modelo. */
  private suelo(radio: number, ancho: number, fondo: number): void {
    const s = new THREE.Mesh(new THREE.CircleGeometry(radio * 2.4, 48),
      new THREE.MeshStandardMaterial({ color: 0x6e737c, roughness: 0.95, metalness: 0, transparent: true, alphaMap: alfaSuelo }));
    s.rotation.x = -Math.PI / 2; this.escena.add(s);
    const sombra = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: texSombra, transparent: true, depthWrite: false, toneMapped: false }));
    sombra.rotation.x = -Math.PI / 2; sombra.position.y = radio * 0.004;
    sombra.scale.set(Math.max(ancho, radio) * 1.9, Math.max(fondo, radio) * 1.9, 1);
    this.escena.add(sombra);
  }

  private encuadrar(caja: THREE.Box3, elevacionGrados: number, azimutGrados: number): void {
    const tam = caja.getSize(new THREE.Vector3());
    const centro = new THREE.Vector3(0, tam.y / 2, 0); // el modelo ya está centrado en x/z y apoyado en y=0
    const rxz = Math.hypot(tam.x, tam.z) / 2;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camara.fov / 2));
    const dV = (tam.y / 2) * 1.3 / tan;
    const dH = rxz * 1.25 / (tan * this.camara.aspect);
    const dist = Math.max(dV, dH) + rxz * 0.6;
    const el = THREE.MathUtils.degToRad(elevacionGrados), az = THREE.MathUtils.degToRad(azimutGrados);
    this.camara.position.set(
      centro.x + dist * Math.cos(el) * Math.sin(az),
      centro.y + dist * Math.sin(el),
      centro.z + dist * Math.cos(el) * Math.cos(az));
    this.camara.near = dist / 100; this.camara.far = dist * 20;
    this.camara.updateProjectionMatrix();
    this.camara.lookAt(centro);
    const c = new OrbitControls(this.camara, this.vista);
    c.target.copy(centro); c.enableZoom = false; c.enablePan = false;
    c.autoRotate = true; c.autoRotateSpeed = 1.6; c.maxPolarAngle = Math.PI * 0.49;
    c.addEventListener('start', () => { this.parar = Infinity; });
    c.addEventListener('end', () => { this.parar = performance.now() + 4000; });
    c.update();
    this.controles = c;
  }

  private async montarModelo(): Promise<void> {
    const esPersonaje = this.def.tipo === 'personaje';
    let base: THREE.Object3D; let clips: THREE.AnimationClip[];
    if (this.def.rocketbox) {
      base = await cargarRocketbox(this.def.rocketbox);
      clips = this.def.animRocketbox ? await cargarClipsRB() : [];
    } else {
      const gltf = await cargarGltf(this.def.url!);
      base = gltf.scene; clips = gltf.animations;
    }
    // Cada tarjeta necesita su propia copia (esqueleto propio); la geometría y las texturas se comparten.
    const modelo = SkeletonUtils.clone(base);
    if (this.def.tinte) {
      // Rocketbox separa la cabeza (piel) y armas en materiales propios: solo se tiñe la ropa/casco/equipo.
      const filtro = this.def.rocketbox ? (n: string) => !/(_head|_pistol|_knife|_opacity)/.test(n) : undefined;
      aplicarTinte(modelo, this.def.tinte, filtro);
      if (this.def.tinte.brazalete) ponerBrazalete(modelo, !!this.def.rocketbox);
    }
    const pivote = new THREE.Group(); pivote.add(modelo);
    this.luces(); this.escena.add(pivote);

    // Caja del modelo: para SkinnedMesh, tras updateMatrixWorld y con el cálculo preciso (aplica el esqueleto).
    pivote.updateMatrixWorld(true);
    let caja = new THREE.Box3().setFromObject(pivote, true);
    if (this.def.altura) { // modelos en cm / otro eje: se normaliza la altura (el eje vertical ya viene en Y con FBXLoader)
      pivote.scale.setScalar(this.def.altura / caja.getSize(new THREE.Vector3()).y);
      pivote.updateMatrixWorld(true);
      caja = new THREE.Box3().setFromObject(pivote, true);
    }
    const centro = caja.getCenter(new THREE.Vector3());
    const tamReal = caja.getSize(new THREE.Vector3());
    pivote.position.set(-centro.x, -caja.min.y, -centro.z);
    pivote.updateMatrixWorld(true);

    // Triángulos reales, huesos y animaciones
    let tris = 0, mallas = 0; const huesos = new Set<THREE.Bone>();
    pivote.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && m.name !== 'brazalete') {
        mallas++;
        tris += m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
      }
      const sk = o as THREE.SkinnedMesh;
      if (sk.isSkinnedMesh) sk.skeleton.bones.forEach((b) => huesos.add(b));
    });
    const f = (n: number) => Math.round(n).toLocaleString('es-ES');
    const dim = `${this.def.altura ? '(normalizado) ' : ''}${tamReal.x.toFixed(2)} × ${tamReal.y.toFixed(2)} × ${tamReal.z.toFixed(2)} m`;
    this.datos.textContent = `${f(tris)} triángulos · ${huesos.size} huesos · ${mallas} malla${mallas === 1 ? '' : 's'} · ${dim}`;

    const tamNorm = new THREE.Box3().setFromObject(pivote, true).getSize(new THREE.Vector3());
    const radio = Math.max(tamNorm.x, tamNorm.z, tamNorm.y * 0.5);
    this.suelo(radio, tamNorm.x, tamNorm.z);
    // Personajes: miran hacia +Z; cámara a tres cuartos (unos 35° a un lado) y casi a la altura del pecho.
    this.encuadrar(new THREE.Box3().setFromObject(pivote, true), esPersonaje ? 10 : 22, esPersonaje ? 35 : 38);

    const rt = this.def.retarget;
    if (rt) {
      this.ayudante = new THREE.SkeletonHelper(modelo);
      this.ayudante.visible = ctl.huesos; this.escena.add(this.ayudante);
    }
    const inicialRT = ctl.clipUrl ?? 'Pistol_Idle_Loop';
    if (rt === 'rocketbox' || rt === 'soldado') {
      // Copia de referencia del destino (en reposo, nunca animada) con la transformación con la que se dibuja.
      const refG = new THREE.Group();
      refG.add(SkeletonUtils.clone(base));
      refG.position.copy(pivote.position); refG.scale.copy(pivote.scale); refG.quaternion.copy(pivote.quaternion);
      refG.updateMatrixWorld(true);
      this.ref = refG;
      this.ualClips = (await cargarUal()).animations;
      await ualCalculo(); // fuerza la carga del origen y el volcado de nombres
      this.mezclador = new THREE.AnimationMixer(modelo);
      this.crearBotones(CLIPS_RT);
      await this.poner(inicialRT);
    } else if (clips.length) {
      this.mezclador = new THREE.AnimationMixer(modelo);
      for (const clip of clips) this.acciones.set(clip.name, this.mezclador.clipAction(clip));
      this.crearBotones(rt === 'ual' ? CLIPS_RT : undefined);
      const pref = rt === 'ual' ? inicialRT : this.def.animInicial;
      const ini = pref && this.acciones.has(pref) ? pref : clips[0].name;
      this.reproducir(ini);
    } else {
      this.anims.remove();
    }
  }

  /** Pulsación de un botón: en la pestaña de retargeteo, los maniquíes UAL siguen al último clip pulsado. */
  private async pulsar(n: string | null): Promise<void> {
    await this.poner(n);
    if (n !== null && this.def.retarget) {
      ctl.clipUltimo = n;
      for (const c of tarjetas) if (c !== this && c.def.retarget === 'ual' && c.lista) void c.poner(n);
    }
  }

  /** Reproduce un clip; en las tarjetas con retargeteo lo calcula la primera vez y lo guarda en caché. */
  async poner(n: string | null): Promise<void> {
    const rt = this.def.retarget;
    if (n !== null && (rt === 'rocketbox' || rt === 'soldado') && !this.acciones.has(n)) {
      try {
        const clip = this.ualClips.find((c) => c.name === n);
        if (!clip) throw new Error(`El UAL no tiene el clip «${n}»`);
        const origen = await ualCalculo();
        const r = retargetClip(clip, origen, this.ref!, rt === 'soldado' ? UAL_TO_MIXAMO24 : UAL_TO_ROCKETBOX, { inPlace: EN_SITIO.has(n), name: n });
        this.acciones.set(n, this.mezclador!.clipAction(r));
      } catch (e) {
        console.error('retargeteo', this.def.nombre, n, e);
        if (this.errorEl) this.errorEl.textContent = `Error en «${n}»: ` + (e instanceof Error ? e.message : String(e));
        return;
      }
    }
    if (this.errorEl) this.errorEl.textContent = '';
    this.reproducir(n);
  }

  private crearBotones(nombres?: Iterable<string>): void {
    const quieto = document.createElement('button');
    quieto.textContent = 'Pose base';
    quieto.onclick = () => void this.pulsar(null);
    this.anims.appendChild(quieto); this.botones.set('', quieto);
    for (const n of nombres ?? this.acciones.keys()) {
      const b = document.createElement('button'); b.textContent = n;
      b.onclick = () => void this.pulsar(n);
      this.anims.appendChild(b); this.botones.set(n, b);
    }
  }

  private reproducir(nombre: string | null): void {
    this.accion = null;
    for (const [n, a] of this.acciones) {
      if (n === nombre) {
        a.reset().setLoop(THREE.LoopRepeat, Infinity);
        if (!this.def.retarget) a.fadeIn(0.15); // en la prueba de retargeteo no se funde: en pausa el mezclador no avanza
        a.play(); this.accion = a;
      } else a.stop();
    }
    this.mezclador?.update(0);
    for (const [n, b] of this.botones) b.classList.toggle('activa', n === (nombre ?? ''));
  }

  /** Baldosa de 2×2 m y una esfera, con el material PBR. */
  private async montarMaterial(): Promise<void> {
    const p = this.def.pbr!;
    const [c, n, r] = await Promise.all([cargarTex(p.color, true), cargarTex(p.normal, false), cargarTex(p.rugosidad, false)]);
    const material = new THREE.MeshStandardMaterial({ map: c, normalMap: n, roughnessMap: r, roughness: 1, metalness: 0 });
    this.luces();
    const baldosa = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    baldosa.rotation.x = -Math.PI / 2; this.escena.add(baldosa);
    const mS = material.clone();
    mS.map = c.clone(); mS.normalMap = n.clone(); mS.roughnessMap = r.clone();
    for (const t of [mS.map, mS.normalMap, mS.roughnessMap]) { t.repeat.set(1, 1); t.needsUpdate = true; }
    mS.map.colorSpace = THREE.SRGBColorSpace;
    const esfera = new THREE.Mesh(new THREE.SphereGeometry(0.5, 48, 32), mS);
    esfera.position.set(0.15, 0.5, 0.1); this.escena.add(esfera);
    // Luz rasante extra para que se vea el relieve
    const rasante = new THREE.DirectionalLight(0xffffff, 1.4); rasante.position.set(-4, 1.2, 1.5); this.escena.add(rasante);
    this.datos.textContent = 'Baldosa 2,00 × 2,00 m · esfera r = 0,50 m';
    this.camara.position.set(1.9, 1.5, 2.6);
    this.camara.lookAt(0, 0.2, 0);
    const ctl = new OrbitControls(this.camara, this.vista);
    ctl.target.set(0, 0.2, 0); ctl.enableZoom = false; ctl.enablePan = false; ctl.autoRotate = true; ctl.autoRotateSpeed = 1.2;
    ctl.maxPolarAngle = Math.PI * 0.49;
    ctl.addEventListener('start', () => { this.parar = Infinity; });
    ctl.addEventListener('end', () => { this.parar = performance.now() + 4000; });
    ctl.update();
    this.controles = ctl;
    this.anims.remove();
  }

  /** Pone la cámara a un azimut fijo (grados; 0 = delante, +Z) conservando distancia y altura. */
  private fijarAzimut(grados: number): void {
    const c = this.controles; if (!c) return;
    const t = c.target, p = this.camara.position;
    const r = Math.hypot(p.x - t.x, p.z - t.z), a = THREE.MathUtils.degToRad(grados);
    p.set(t.x + r * Math.sin(a), p.y, t.z + r * Math.cos(a));
    this.camara.lookAt(t); c.update();
  }

  dibujar(dt: number, ancho: number, alto: number): void {
    const r = this.vista.getBoundingClientRect();
    if (r.bottom < 0 || r.top > alto || r.right < 0 || r.left > ancho || r.width < 2) return;
    const y = alto - r.bottom;
    renderer.setViewport(r.left, y, r.width, r.height);
    renderer.setScissor(r.left, y, r.width, r.height);
    if (!this.lista) { renderer.render(escenaVacia, this.camara); return; }
    this.camara.aspect = r.width / r.height; this.camara.updateProjectionMatrix();
    if (this.def.retarget && ctl.pausa) {
      // en pausa: cada tarjeta muestra su clip en el instante fijado (fracción de la duración)
      if (this.accion && this.mezclador) { this.accion.time = this.accion.getClip().duration * ctl.x; this.mezclador.update(0); }
    } else this.mezclador?.update(dt);
    if (this.ayudante) this.ayudante.visible = ctl.huesos;
    if (this.controles) {
      if (this.def.retarget) {
        if (this.vistaAplicada !== ctl.vista) { this.fijarAzimut(AZIMUT[ctl.vista]); this.vistaAplicada = ctl.vista; }
        this.controles.autoRotate = ctl.vista === '34' && !ctl.pausa && !modoFoto && performance.now() > this.parar;
      } else this.controles.autoRotate = !modoFoto && performance.now() > this.parar;
      this.controles.update(dt);
    }
    renderer.render(this.escena, this.camara);
  }
}

// ---------------------------------------------------------------- barra de controles de la pestaña de retargeteo
let deslizador: HTMLInputElement, etiquetaX: HTMLElement, botonPausa: HTMLButtonElement;
function crearBarraRT(): HTMLElement {
  const barra = document.createElement('div'); barra.className = 'barra-rt';
  const f = (x: number) => Math.round(x * 100) + ' %';
  barra.innerHTML = `<button class="pausa"></button>
    <label>Instante <input type="range" min="0" max="100" step="0.5"> <output></output></label>
    <label>Vista <select><option value="34">3/4</option><option value="frente">Frente</option><option value="perfil">Perfil</option><option value="espalda">Espalda</option></select></label>
    <label><input type="checkbox" class="huesos"> Ver huesos</label>`;
  botonPausa = barra.querySelector('.pausa') as HTMLButtonElement;
  deslizador = barra.querySelector('input[type=range]') as HTMLInputElement;
  etiquetaX = barra.querySelector('output') as HTMLElement;
  const sel = barra.querySelector('select') as HTMLSelectElement;
  const chk = barra.querySelector('.huesos') as HTMLInputElement;
  const pintar = () => { botonPausa.textContent = ctl.pausa ? 'Reproducir' : 'Pausa'; deslizador.value = String(ctl.x * 100); etiquetaX.textContent = f(ctl.x); };
  botonPausa.onclick = () => {
    ctl.pausa = !ctl.pausa;
    if (ctl.pausa) { const a = tarjetas.find((c) => c.def.retarget && c.accion)?.accion; if (a) ctl.x = Math.min(0.999, (a.time % a.getClip().duration) / a.getClip().duration); }
    pintar();
  };
  deslizador.oninput = () => { ctl.pausa = true; ctl.x = Math.min(0.999, parseFloat(deslizador.value) / 100); pintar(); };
  sel.value = ctl.vista; sel.onchange = () => { ctl.vista = sel.value as Vista; };
  chk.onchange = () => { ctl.huesos = chk.checked; };
  pintar();
  return barra;
}
/** Mientras se reproduce, el deslizador sigue al primer clip activo. */
function sincronizarDeslizador(): void {
  if (!deslizador || ctl.pausa || activa !== 'retargeteo') return;
  const a = tarjetas.find((c) => c.def.retarget && c.accion)?.accion;
  if (!a) return;
  ctl.x = (a.time % a.getClip().duration) / a.getClip().duration;
  deslizador.value = String(ctl.x * 100); etiquetaX.textContent = Math.round(ctl.x * 100) + ' %';
}

// ---------------------------------------------------------------- construcción de la página
const nav = document.getElementById('pestanas')!;
const contenido = document.getElementById('contenido')!;
const secciones = new Map<string, HTMLElement>();
const botonesPestana = new Map<string, HTMLButtonElement>();
let activa = '';

function activar(id: string): void {
  activa = id;
  for (const [k, s] of secciones) s.classList.toggle('activa', k === id);
  for (const [k, b] of botonesPestana) b.classList.toggle('activa', k === id);
  try { history.replaceState(null, '', location.pathname + location.search + '#' + id); } catch { /* sin historial: da igual */ }
  window.scrollTo(0, 0);
}

for (const p of PESTANAS) {
  const b = document.createElement('button');
  b.className = 'pestana'; b.textContent = p.titulo; b.onclick = () => activar(p.id);
  nav.appendChild(b); botonesPestana.set(p.id, b);

  const sec = document.createElement('section'); sec.className = 'pestana-contenido';
  if (p.id === 'retargeteo') sec.appendChild(crearBarraRT());
  for (const s of p.secciones) {
    const h = document.createElement('h2'); h.textContent = s.titulo; sec.appendChild(h);
    if (s.nota) { const n = document.createElement('p'); n.className = 'nota'; n.textContent = s.nota; sec.appendChild(n); }
    const rej = document.createElement('div'); rej.className = 'rejilla'; sec.appendChild(rej);
    for (const t of s.tarjetas) tarjetas.push(new Carta(t, rej));
  }
  contenido.appendChild(sec); secciones.set(p.id, sec);
}

// Botón «Foto»: detiene el giro automático para que las capturas salgan estables.
const botonFoto = document.createElement('button');
botonFoto.className = 'foto'; botonFoto.textContent = 'Foto';
botonFoto.onclick = () => { modoFoto = !modoFoto; botonFoto.classList.toggle('activa', modoFoto); window.scrollTo(0, 0); };
nav.appendChild(botonFoto);

// Carga perezosa: solo las tarjetas que entran en pantalla (las de pestañas ocultas no intersectan).
const observador = new IntersectionObserver((entradas) => {
  for (const en of entradas) {
    const c = tarjetas.find((t) => t.vista === en.target);
    if (!c) continue;
    c.visible = en.isIntersecting;
    if (c.visible) void c.iniciar();
  }
}, { rootMargin: '150px' });
for (const c of tarjetas) observador.observe(c.vista);

// Si existe la versión aligerada del soldado, se añade a su lado (se comprueba que no sea el index.html de reserva).
fetch(`${P}soldado/soldier-lite.glb`, { method: 'HEAD' }).then((r) => {
  if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return;
  const rej = secciones.get('realistas')!.querySelector('.rejilla')!;
  const c = new Carta({ nombre: 'Soldado — versión aligerada', fuente: LIC_SOLDADO, url: `${P}soldado/soldier-lite.glb`, tipo: 'personaje', animInicial: 'walk' }, rej as HTMLElement);
  tarjetas.push(c); observador.observe(c.vista);
}).catch(() => { /* sin versión aligerada */ });

activar(PESTANAS.some((p) => '#' + p.id === location.hash) ? location.hash.slice(1) : PESTANAS[0].id);

function bucle(): void {
  requestAnimationFrame(bucle);
  const dt = Math.min(reloj.getDelta(), 0.1);
  renderer.setScissorTest(false);
  renderer.clear();
  renderer.setScissorTest(true);
  const w = window.innerWidth, h = window.innerHeight;
  for (const c of tarjetas) if (c.visible) c.dibujar(dt, w, h);
  sincronizarDeslizador();
}
bucle();
void activa;
// Altura real de la cabecera (sticky) para que la barra de controles quede justo debajo.
const cabecera = document.querySelector('header');
if (cabecera) {
  const ajustar = () => document.documentElement.style.setProperty('--alto-cabecera', cabecera.getBoundingClientRect().height + 'px');
  ajustar(); window.addEventListener('resize', ajustar);
}
