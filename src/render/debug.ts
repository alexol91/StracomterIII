// Dibujo de ai.debug: conos de visión en el suelo, camino, creencia y etiqueta de estado.
// Solo se usa si world.cheats.aiDebug; los recursos se crean al vuelo y se liberan al salir.

import * as THREE from 'three';
import type { IWorld } from '../contracts';

const SEG = 20;
const MAX_PATH = 64;

function makeFan(alpha: number, range: number, geo?: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo ?? new THREE.BufferGeometry();
  const pos = new Float32Array((SEG + 2) * 3);
  pos.set([0, 0.06, 0], 0);
  for (let i = 0; i <= SEG; i++) {
    const a = -alpha + (2 * alpha * i) / SEG;
    pos.set([Math.cos(a) * range, 0.06, Math.sin(a) * range], (i + 1) * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (!g.index) {
    const idx: number[] = [];
    for (let i = 1; i <= SEG; i++) idx.push(0, i + 1, i); // orientado hacia arriba
    g.setIndex(idx);
  }
  g.computeBoundingSphere();
  return g;
}

function makeLabel(): { sprite: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.4, 0.6, 1);
  sprite.renderOrder = 50;
  return { sprite, canvas, tex };
}

interface DebugView {
  fans: THREE.Group;
  fanP: THREE.Mesh;
  fanS: THREE.Mesh;
  fanKey: string;
  line: THREE.Line;
  linePos: Float32Array;
  belief: THREE.Mesh;
  label: THREE.Sprite;
  labelCanvas: HTMLCanvasElement;
  labelTex: THREE.CanvasTexture;
  text: string;
}

export class AiDebugLayer {
  group = new THREE.Group();
  private views = new Map<number, DebugView>();
  private matP = new THREE.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
  private matS = new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide });
  private matLine = new THREE.LineBasicMaterial({ color: 0x40ff90 });
  private matBelief = new THREE.MeshBasicMaterial({ color: 0xff40ff });
  private beliefGeo = new THREE.OctahedronGeometry(0.22, 0);

  private create(): DebugView {
    const fans = new THREE.Group();
    const fanS = new THREE.Mesh(makeFan(1, 1), this.matS);
    const fanP = new THREE.Mesh(makeFan(1, 1), this.matP);
    fanS.renderOrder = 3; fanP.renderOrder = 4;
    fanS.frustumCulled = fanP.frustumCulled = false;
    fans.add(fanS, fanP);
    const linePos = new Float32Array(MAX_PATH * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    lg.setDrawRange(0, 0);
    const line = new THREE.Line(lg, this.matLine);
    line.frustumCulled = false;
    const belief = new THREE.Mesh(this.beliefGeo, this.matBelief);
    belief.visible = false;
    const { sprite, canvas, tex } = makeLabel();
    this.group.add(fans, line, belief, sprite);
    return { fans, fanP, fanS, fanKey: '', line, linePos, belief, label: sprite, labelCanvas: canvas, labelTex: tex, text: '', };
  }

  private drop(v: DebugView): void {
    this.group.remove(v.fans, v.line, v.belief, v.label);
    v.fanP.geometry.dispose(); v.fanS.geometry.dispose(); v.line.geometry.dispose();
    v.label.material.dispose(); v.labelTex.dispose();
  }

  update(world: IWorld, posOf: (id: number) => { x: number; y: number } | null): void {
    const infos = world.aiDebug();
    const seen = new Set<number>();
    for (const info of infos) {
      const e = world.entityById(info.id);
      if (!e) continue;
      seen.add(info.id);
      let v = this.views.get(info.id);
      if (!v) { v = this.create(); this.views.set(info.id, v); }
      const p = posOf(info.id) ?? { x: e.x, y: e.y };

      // conos
      v.fans.position.set(p.x, 0, p.y);
      v.fans.rotation.y = -e.yaw;
      const key = info.cones.map((n) => n.toFixed(3)).join(',');
      if (key !== v.fanKey) {
        v.fanKey = key;
        makeFan(info.cones[0], info.cones[1], v.fanP.geometry);
        makeFan(info.cones[2], info.cones[3], v.fanS.geometry);
      }

      // camino
      const n = Math.min(MAX_PATH, info.path.length);
      for (let i = 0; i < n; i++) { v.linePos[i * 3] = info.path[i][0]; v.linePos[i * 3 + 1] = 0.12; v.linePos[i * 3 + 2] = info.path[i][1]; }
      const attr = v.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      attr.needsUpdate = true;
      v.line.geometry.setDrawRange(0, n);
      v.line.visible = n >= 2;

      // creencia
      if (info.belief) {
        v.belief.visible = true;
        v.belief.position.set(info.belief[0], 0.4, info.belief[1]);
        const s = 0.6 + info.awareness;
        v.belief.scale.set(s, s, s);
      } else v.belief.visible = false;

      // etiqueta (solo se repinta si cambia el texto)
      const text = info.state;
      if (text !== v.text) {
        v.text = text;
        const g = v.labelCanvas.getContext('2d')!;
        g.clearRect(0, 0, 256, 64);
        g.fillStyle = 'rgba(0,0,0,0.65)';
        g.fillRect(0, 8, 256, 48);
        g.fillStyle = '#ffffff';
        g.font = 'bold 30px monospace';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(text, 128, 33, 240);
        v.labelTex.needsUpdate = true;
      }
      v.label.position.set(p.x, 2.6, p.y);
    }
    if (this.views.size !== seen.size) {
      for (const [id, v] of this.views) if (!seen.has(id)) { this.drop(v); this.views.delete(id); }
    }
  }

  clear(): void {
    for (const v of this.views.values()) this.drop(v);
    this.views.clear();
  }

  dispose(): void {
    this.clear();
    this.matP.dispose(); this.matS.dispose(); this.matLine.dispose(); this.matBelief.dispose(); this.beliefGeo.dispose();
  }
}
