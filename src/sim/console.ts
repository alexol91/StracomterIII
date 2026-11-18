// Consola de trucos (§18). Cada comando hace de verdad lo que dice: los flags que activa los LEE la
// simulación (god en World.damage, noclip en World.moveUnits y computeCam, ai.debug en World.aiDebug).

import type { ConsoleHost, IConsole, IWorld } from '../contracts';
import { AMMO_CAP, GRENADE_COUNT, isClass } from './data';
import type { Kind } from './types';
import type { Unit, World } from './world';

const KINDS: Kind[] = ['captain', 'technic', 'especialist', 'explosives', 'enemy1', 'enemy2', 'enemy3', 'miniboss', 'megaboss'];

export function createConsole(host: ConsoleHost): IConsole {
  const spawn = (w: World, kind: Kind, x: number, y: number): Unit | null => {
    const c = w.level.nearestFree(x, y, true, 40);
    if (c < 0) return null;
    const u = w.spawnUnit(kind, w.level.cellX(c), w.level.cellY(c));
    if (isClass(kind)) { u.brain = null; u.aiState = 'refuerzo'; (u as Unit).brain = { extra: true, targetId: -1, senseAt: 0, visible: 0, bossVisible: false, reactAt: 0, burstUntil: 0, restUntil: 0, hurtAt: -99, hurtBy: -1, faceYaw: 0, slot: [u.x, u.y], slotAt: -1, unstuck: 0 }; }
    return u;
  };
  return {
    exec(line: string, world: IWorld | null): string[] {
      const parts = line.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return [];
      const cmd = parts[0].toLowerCase();
      const w = world as World | null;
      if (cmd === 'help' || cmd === 'ayuda') {
        return ['spawn <tipo> <x> <y> · team <tipo> <x> <y> · kill all|bad|me · god · noclip · ammo · health',
          'floor <n> · zone <n> · objective <clear|defuse|defend|rescue> · tp <x> <y> · info [id] · ai.debug · chutaos on|off', 'tipos: ' + KINDS.join(', ')];
      }
      // v1.2: cualquier comando que altere la partida la invalida para récords (todos salvo help, info y ai.debug)
      const ALTERA = ['spawn', 'team', 'kill', 'god', 'noclip', 'ammo', 'health', 'tp', 'chutaos', 'floor', 'zone', 'objective'];
      if (w && ALTERA.includes(cmd)) w.cheated = true;
      if (cmd === 'floor' || cmd === 'zone') {
        const n = parseInt(parts[1], 10);
        if (!Number.isFinite(n)) return [`uso: ${cmd} <n>`];
        return [cmd === 'floor' ? host.gotoFloorZone(n, null) : host.gotoFloorZone(null, n)];
      }
      if (!w) return ['No hay partida en curso.'];
      const p = w.player;
      switch (cmd) {
        case 'spawn':
        case 'team': {
          const kind = (parts[1] || '').toLowerCase() as Kind;
          if (!KINDS.includes(kind)) return ['tipo desconocido. Tipos: ' + KINDS.join(', ')];
          const x = parts[2] !== undefined ? parseFloat(parts[2]) : p.x + Math.cos(p.yaw) * 5;
          const y = parts[3] !== undefined ? parseFloat(parts[3]) : p.y + Math.sin(p.yaw) * 5;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return [`uso: ${cmd} <tipo> <x> <y>`];
          const n = cmd === 'team' ? 10 : 1;
          const ids: number[] = [];
          for (let i = 0; i < n; i++) {
            const a = i * 2.4, r = n > 1 ? 0.7 * Math.sqrt(i) : 0;
            const u = spawn(w, kind, x + Math.cos(a) * r, y + Math.sin(a) * r);
            if (u) ids.push(u.id);
          }
          if (ids.length === 0) return ['no hay suelo libre cerca de ese punto'];
          return [`creado ${kind} ×${ids.length} en (${x.toFixed(1)}, ${y.toFixed(1)}) — id ${ids.join(', ')}`];
        }
        case 'kill': {
          const what = (parts[1] || '').toLowerCase();
          if (what === 'me') { w.kill(p); return ['jugador muerto']; }
          if (what === 'bad') {
            let n = 0;
            for (const e of w.entities.slice()) if (e.alive && e.team === 'enemy') { e.shielded = false; w.kill(e); n++; }
            const pend = w.director.pending();
            return [`${n} enemigos muertos` + (pend > 0 ? ` (quedan ${pend} por aparecer)` : '')];
          }
          if (what === 'all') {
            let n = 0;
            for (const e of w.entities.slice()) if (e.alive) { e.shielded = false; w.kill(e); n++; }
            return [`${n} entidades muertas (tú también)`];
          }
          return ['uso: kill all | kill bad | kill me'];
        }
        case 'god': w.cheats.god = !w.cheats.god; return ['modo dios ' + (w.cheats.god ? 'ACTIVADO' : 'desactivado')];
        case 'noclip': w.cheats.noclip = !w.cheats.noclip; return ['noclip ' + (w.cheats.noclip ? 'ACTIVADO' : 'desactivado')];
        case 'ammo': p.mag = p.magSize; p.ammo = AMMO_CAP - p.mag; p.reloading = 0; p.grenades = GRENADE_COUNT; p.abilityCd = 0; return [`munición al máximo (${p.mag} + ${p.ammo})`];
        case 'health': if (!p.alive) return ['estás muerto']; p.hp = p.maxHp; return [`vida al máximo (${p.hp})`];
        case 'tp': {
          const x = parseFloat(parts[1]), y = parseFloat(parts[2]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return ['uso: tp <x> <y>'];
          let tx = x, ty = y;
          if (!w.cheats.noclip) { const c = w.level.nearestFree(x, y, true, 40); if (c < 0) return ['no hay suelo libre cerca']; tx = w.level.cellX(c); ty = w.level.cellY(c); }
          p.x = tx; p.y = ty; p.vx = p.vy = 0;
          return [`teletransportado a (${tx.toFixed(1)}, ${ty.toFixed(1)})`];
        }
        case 'info': {
          if (parts[1] === undefined) {
            return [`tú: id ${p.id} en (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`,
              ...w.entities.filter(e => e.alive).slice(0, 60).map(e => `${e.id}: ${e.kind} ${Math.round(e.hp)}/${e.maxHp}`)];
          }
          const e = w.entityById(parseInt(parts[1], 10));
          if (!e) return ['no existe esa entidad'];
          return [`#${e.id} ${e.kind} (${e.team}) ${e.alive ? 'vivo' : 'MUERTO'} — vida ${Math.round(e.hp)}/${e.maxHp} — munición ${e.mag}+${e.ammo}` +
            ` — pos (${e.x.toFixed(1)}, ${e.y.toFixed(1)}) — estado: ${e.isPlayer ? 'jugador' : e.aiState || '-'}`];
        }
        case 'chutaos': {
          // Modo Chutaos: lo lee el audio (src/audio) en cada sonido
          const arg = (parts[1] || '').toLowerCase();
          if (arg !== 'on' && arg !== 'off') return ['uso: chutaos on | chutaos off  (ahora: ' + (w.cheats.chutaos ? 'on' : 'off') + ')'];
          w.cheats.chutaos = arg === 'on';
          return ['Modo Chutaos ' + (w.cheats.chutaos ? 'ACTIVADO' : 'desactivado')];
        }
        case 'objective': {
          // cambia el objetivo de ESTA zona en caliente (cuenta como truco)
          const k = (parts[1] || '').toLowerCase();
          if (k !== 'clear' && k !== 'defuse' && k !== 'defend' && k !== 'rescue') return ['uso: objective clear|defuse|defend|rescue  (ahora: ' + w.objective.kind + ')'];
          if (w.horde) return ['no hay objetivos en el modo horda'];
          w.initObjective(k);
          return ['objetivo de la zona: ' + k];
        }
        case 'ai.debug': w.cheats.aiDebug = !w.cheats.aiDebug; return ['ai.debug ' + (w.cheats.aiDebug ? 'ACTIVADO' : 'desactivado')];
      }
      return [`comando desconocido: ${cmd} (escribe help)`];
    },
  };
}
