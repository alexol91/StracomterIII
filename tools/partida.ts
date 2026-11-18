// Partida sin pantalla: un jugador automático recorre la campaña con la simulación real.
//
//   npx tsx tools/partida.ts                 → campaña entera (zona 1 de cada planta)
//   npx tsx tools/partida.ts 3 5             → solo planta 3, zona 5
//   npx tsx tools/partida.ts campaña 3       → campaña eligiendo siempre la zona 3
//
// QUÉ REPRODUCE: toda la lógica de juego (IA, director, combate, puertas, recompensas, guardado).
// QUÉ NO REPRODUCE: nada de dibujo, audio, interfaz ni controles reales; el bot apunta con datos
// perfectos del mundo (no «ve» por la cámara), no se cansa y no juega como una persona. Que el bot
// gane no demuestra que un humano lo pase bien; que el bot NO pueda ganar sí demuestra un problema.

import type { CampaignState, KVStorage } from '../src/contracts';
import { createCampaign } from '../src/sim/campaign';
import { emptyInput, type ClassId } from '../src/sim/types';
import { angDiff, type Unit, type World } from '../src/sim/world';

const mem = new Map<string, string>();
const storage: KVStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: k => void mem.delete(k) };

export interface ZoneReport {
  floor: number; zone: number; result: 'cleared' | 'dead' | 'timeout'; time: number; kills: number;
  states: Record<string, number>; maxStuck: number; unstuck: number; alliesAlive: number; hp: number; enemyHits: number; enemyShots: number;
  doorsOpenedByEnemies: number; ms: number; playerKills: number; dmgTaken: number;
}

export function playZone(world: World, maxTime = 900, god = false): ZoneReport {
  const input = emptyInput();
  const p = world.player;
  input.yaw = p.yaw;
  world.cheats.god = god;
  const states: Record<string, number> = {};
  let path: [number, number][] | null = null, pathAt = -9, enemyHits = 0, enemyShots = 0, doorsE = 0;
  const t0 = Date.now();
  let lastProgress = 0, lastKills = 0, playerKills = 0;
  const lastHit = new Map<number, number>();
  const pasivo = process.env.PASIVO === '1';
  while (world.status === 'playing' && world.time < maxTime) {
    // ── bot ──
    input.fire = false; input.knife = false; input.moveF = 0; input.moveR = 0;
    let tgt: Unit | null = null, td = Infinity;
    for (const e of world.entities) {
      if (!e.alive || e.team !== 'enemy' || e.shielded) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < td && d < 30 && world.shotLine(p, e) >= 0 && world.canSee(p, e)) { td = d; tgt = e; }
    }
    const total = p.mag + p.ammo;
    if (tgt) {
      const wantYaw = Math.atan2(tgt.y - p.y, tgt.x - p.x);
      const dy = angDiff(wantYaw, input.yaw);
      input.yaw += Math.max(-0.12, Math.min(0.12, dy)); // gira como una persona rápida, no al instante
      // apunta al pecho desde la cámara
      const dz = world.height(tgt) * 0.6 - world.cam.z, dh = Math.hypot(tgt.x - world.cam.x, tgt.y - world.cam.y);
      input.pitch += (Math.atan2(dz, dh) - input.pitch) * 0.3;
      if (Math.abs(dy) < 0.06) {
        if (p.cls === 'explosives' && td < 4) input.moveF = -1;
        else if (total > 0 && !pasivo) input.fire = true;
      }
      if (td < 1.6 || total === 0) { input.knife = td < 1.7; if (total === 0) input.moveF = 1; }
      // se mueve de lado para no ser un blanco quieto
      input.moveR = Math.sin(world.time * 1.3) > 0 ? 0.7 : -0.7;
      if (p.cls === 'especialist' && p.abilityCd <= 0) input.ability = true;
    } else {
      // ir hacia el enemigo vivo más cercano (el bot «sabe» dónde están: es un bot de pruebas)
      let goal: Unit | null = null, gd = Infinity;
      for (const e of world.entities) { if (e.alive && e.team === 'enemy') { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < gd) { gd = d; goal = e; } } }
      if (goal) {
        if (!path || world.time - pathAt > 1) { path = world.nav.path(p.x, p.y, goal.x, goal.y, { doors: true }); pathAt = world.time; }
        if (path && path.length) {
          while (path.length > 1 && Math.hypot(path[0][0] - p.x, path[0][1] - p.y) < 0.5) path.shift();
          const wantYaw = Math.atan2(path[0][1] - p.y, path[0][0] - p.x);
          input.yaw += Math.max(-0.15, Math.min(0.15, angDiff(wantYaw, input.yaw)));
          if (Math.abs(angDiff(wantYaw, input.yaw)) < 0.8) input.moveF = 1;
          input.pitch *= 0.9;
        }
        if (world.interactDoor >= 0 && !world.level.doors[world.interactDoor].open) input.interact = true;
      }
    }
    if (p.mag === 0 && p.ammo > 0) input.reload = true;
    // inventario: botiquín si va justo, munición si no queda
    const it = p.inventory[p.invSel];
    if (it) {
      const med = it.startsWith('vida');
      if ((med && p.hp < p.maxHp * 0.5) || (!med && total < 15)) input.useItem = true;
      else if ((p.hp < p.maxHp * 0.5 && p.inventory.some(i => i && i.startsWith('vida'))) || (total < 15 && p.inventory.some(i => i && i.startsWith('municion')))) input.cycleItem = true;
    }
    world.step(1 / 60, input);

    // ── medidas ──
    for (const ev of world.events) {
      if (ev.type === 'shot' && ev.team === 'enemy') { enemyShots++; if (ev.hit === 'entity') enemyHits++; }
      if (ev.type === 'hurt') lastHit.set(ev.id, ev.attackerId);
      if (ev.type === 'death' && ev.team === 'enemy' && lastHit.get(ev.id) === p.id) playerKills++;
    }
    for (const n of world.noises) if (n.kind === 'door' && n.team === 'enemy') doorsE++;
    if (Math.floor(world.time * 4) !== Math.floor((world.time - 1 / 60) * 4)) {
      for (const e of world.entities) if (e.alive && e.team === 'enemy' && e.aiState) states[e.aiState] = (states[e.aiState] || 0) + 1;
    }
    if (world.stats.kills !== lastKills) { lastKills = world.stats.kills; lastProgress = world.time; }
    if (world.time - lastProgress > 240) break; // sin bajas en 4 minutos: algo va mal
  }
  let maxStuck = 0, unstuck = 0;
  for (const e of world.entities) { if (e.team === 'enemy') { maxStuck = Math.max(maxStuck, e.stuckMax); unstuck += e.brain?.unstuck || 0; } }
  return {
    floor: world.floor, zone: world.zone, result: world.status === 'cleared' ? 'cleared' : world.status === 'dead' ? 'dead' : 'timeout',
    time: Math.round(world.time), kills: world.stats.kills, states, maxStuck: +maxStuck.toFixed(2), unstuck,
    alliesAlive: world.entities.filter(e => e.alive && e.team === 'ally').length, hp: Math.round(p.hp), enemyHits, enemyShots, doorsOpenedByEnemies: doorsE,
    ms: Date.now() - t0, playerKills, dmgTaken: Math.round(world.stats.damageTaken),
  };
}

function fmt(r: ZoneReport): string {
  const st = Object.entries(r.states).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
  return `P${r.floor} Z${r.zone} ${r.result.toUpperCase()} t=${r.time}s bajas=${r.kills} (jugador ${r.playerKills}) daño=${r.dmgTaken} vida=${r.hp} aliados=${r.alliesAlive} ` +
    `tirosEnem=${r.enemyShots}/${r.enemyHits} atascoMáx=${r.maxStuck}s desatascos=${r.unstuck} puertasEnem=${r.doorsOpenedByEnemies} (${r.ms} ms)\n     ${st}`;
}

const isMain = process.argv[1] && process.argv[1].endsWith('partida.ts');
if (isMain) {
  const args = process.argv.slice(2);
  const campaign = createCampaign(storage);
  const cls = (process.env.CLASE as ClassId) || 'captain';
  const god = process.env.GOD === '1';
  if (args.length >= 2 && args[0] !== 'campaña') {
    const st = campaign.newQuickPlay((process.env.DIF as any) || 'normal', cls, parseInt(args[0], 10));
    const w = campaign.startZone(st, parseInt(args[1], 10)) as World;
    const r = playZone(w, 900, god);
    console.log(fmt(r));
    console.log('     enemigos creados', w.entities.filter(e => e.team === 'enemy').length, 'muertos', w.entities.filter(e => e.team === 'enemy' && !e.alive).length, 'kills', w.stats.kills);
    if (r.result !== 'cleared') {
      console.log('quedan:', w.entities.filter(e => e.alive && e.team === 'enemy').map(e => `${e.kind}#${e.id}(${e.x.toFixed(1)},${e.y.toFixed(1)}) ${e.aiState}`).join(' | '), 'pendientes', w.director.pending());
    }
  } else {
    const zone = parseInt(args[1] || '1', 10);
    let st: CampaignState = campaign.newCampaign((process.env.DIF as any) || 'normal', cls);
    let ok = true;
    while (st.floor <= 9) {
      const loaded = campaign.load();
      if (st.floor > 1 && (!loaded || loaded.floor !== st.floor)) { console.log('FALLO: no se guardó la planta', st.floor); ok = false; }
      if (loaded) st = loaded;
      const w = campaign.startZone(st, zone) as World;
      const r = playZone(w, 1200, god);
      console.log(fmt(r));
      if (r.result !== 'cleared') { ok = false; console.log('  → la campaña se para aquí'); break; }
      const sum = campaign.completeZone(st, w);
      console.log(`     recompensa ${sum.reward} → ${sum.rewarded.join(', ')}; caídos: ${sum.fallen.join(', ') || 'ninguno'}; puntos ${sum.totalScore}; ajuste ${st.adapt}` + (sum.campaignWon ? '  *** VICTORIA ***' : ''));
    }
    console.log(ok && st.floor === 10 ? 'CAMPAÑA COMPLETADA' : 'CAMPAÑA NO COMPLETADA');
    process.exitCode = ok && st.floor === 10 ? 0 : 1;
  }
}
