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
import { GUN_FEEL, PISTOL_FEEL } from '../src/sim/data';
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
  if (process.env.VERBOSE) world.onUnstuck = u => {
    let near = 0; for (const e of world.entities) if (e !== u && e.alive && Math.hypot(e.x - u.x, e.y - u.y) < 1.1) near++;
    const w = u.path && u.path[u.pathI];
    console.log(`     ATASCO t=${world.time.toFixed(1)} ${u.kind}#${u.id} ${u.aiState} (${u.x.toFixed(2)},${u.y.toFixed(2)}) vecinos=${near} celdaOk=${world.level.walkableAt(u.x, u.y, true)} wp=${w ? w[0].toFixed(2) + ',' + w[1].toFixed(2) + ' ' + u.pathI + '/' + u.path!.length : '-'} meta=(${u.goalX.toFixed(2)},${u.goalY.toFixed(2)}) v=(${u.vx.toFixed(2)},${u.vy.toFixed(2)}) quiere=(${u.wishX.toFixed(1)},${u.wishY.toFixed(1)})`);
  };
  let lastProgress = 0, lastKills = 0, playerKills = 0;
  const lastHit = new Map<number, number>();
  const dmgLog: Record<string, number> = {};
  const pDmg: Record<string, number> = {};
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
    // v1.2: sin balas del arma principal cambia a la pistola (reserva infinita); al recuperar munición vuelve a la principal
    const pistola = total === 0;
    if (pistola && p.weapon !== 'secondary') input.weaponSlot = 'secondary';
    else if (!pistola && p.weapon === 'secondary') input.weaponSlot = 'primary';
    if (tgt) {
      const wantYaw = Math.atan2(tgt.y - p.y, tgt.x - p.x);
      // v1.2: la mira lleva el retroceso de cámara; el bot lo compensa como lo haría una persona (tirando hacia abajo)
      const dy = angDiff(wantYaw, input.yaw + world.recoil.yaw);
      input.yaw += Math.max(-0.12, Math.min(0.12, dy)); // gira como una persona rápida, no al instante
      // apunta al pecho desde la cámara
      const dz = world.height(tgt) * 0.6 - world.cam.z, dh = Math.hypot(tgt.x - world.cam.x, tgt.y - world.cam.y);
      input.pitch += (Math.atan2(dz, dh) - (input.pitch + world.recoil.pitch)) * 0.3;
      if (Math.abs(dy) < 0.06) {
        if (p.cls === 'explosives' && td < 4) input.moveF = -1;
        else if ((total > 0 || pistola) && !pasivo) input.fire = true;
      }
      // v1.2: ráfagas. Con el arma «caliente» y el blanco lejos suelta el gatillo hasta que la dispersión baja
      const base = (p.weapon === 'secondary' ? PISTOL_FEEL : GUN_FEEL[p.cls ?? 'captain']).baseSpread;
      if (input.fire && p.spread > 2.2 * base && td > 12) input.fire = false;
      if (td < 1.6) input.knife = true;
      // se mueve de lado para no ser un blanco quieto
      input.moveR = Math.sin(world.time * 1.3) > 0 ? 0.7 : -0.7;
      if (p.cls === 'especialist' && p.abilityCd <= 0) input.ability = true;
    } else {
      // ir hacia el enemigo vivo más cercano (el bot «sabe» dónde están: es un bot de pruebas)
      let goal: Unit | null = null, gd = Infinity;
      for (const e of world.entities) { if (e.alive && e.team === 'enemy') { const d = Math.hypot(e.x - p.x, e.y - p.y) + (e.shielded ? 1000 : 0); if (d < gd) { gd = d; goal = e; } } }
      if (goal && goal.shielded) goal = null; // con el escudo puesto no tiene sentido acercarse al jefe
      // como haría una persona: si va tocado o seco y hay botín, primero a por él
      let gx = goal ? goal.x : p.x, gy = goal ? goal.y : p.y;
      const needHp = p.hp < p.maxHp * 0.75, needAmmo = total < 40;
      if (needHp || needAmmo) {
        let bd = 30;
        for (const pk of world.pickups) {
          if (pk.taken) continue;
          const med = pk.type.startsWith('vida');
          if ((med && !needHp) || (!med && !needAmmo)) continue;
          const d = Math.hypot(pk.x - p.x, pk.y - p.y);
          if (d < bd) { bd = d; gx = pk.x; gy = pk.y; goal = goal ?? p; }
        }
      }
      if (goal) {
        if (!path || world.time - pathAt > 1) { path = world.nav.path(p.x, p.y, gx, gy, { doors: true }); pathAt = world.time; }
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
    // esquiva cohetes y granadas que van a caerle cerca
    for (const pr of world.projectiles) {
      const tt = Math.max(0, Math.min(pr.fuse, 1.5));
      const ix = pr.x + pr.vx * tt, iy = pr.y + pr.vy * tt;
      if (pr.team === 'enemy' && Math.hypot(ix - p.x, iy - p.y) < 4.5) { input.moveR = (Math.floor(world.time / 3) % 2 ? 1 : -1); input.moveF = 0; input.fire = false; break; }
    }
    // a un jefe no se le pelea a quemarropa: si está a menos de 9 m, retrocede sin dejar de mirarle
    for (const e of world.entities) {
      if (e.alive && e.kind === 'megaboss' && Math.hypot(e.x - p.x, e.y - p.y) < 9) {
        const away = Math.atan2(p.y - e.y, p.x - e.x) - input.yaw;
        input.moveF = Math.cos(away); input.moveR = Math.sin(away);
      }
    }
    world.step(1 / 60, input);

    // ── medidas ──
    for (const ev of world.events) {
      if (ev.type === 'shot' && ev.team === 'enemy') { enemyShots++; if (ev.hit === 'entity') enemyHits++; }
      if (ev.type === 'hurt') lastHit.set(ev.id, ev.attackerId);
      if (ev.type === 'hurt' && ev.id === p.id) { const k = (world.entityById(ev.attackerId)?.kind ?? '?') + ':' + ev.zone; pDmg[k] = (pDmg[k] || 0) + ev.amount; }
      if (ev.type === 'hurt' && process.env.VERBOSE) { const v = world.entityById(ev.id); if (v && v.team === 'ally' && !v.isPlayer) { const k = v.kind + '<' + (world.entityById(ev.attackerId)?.kind ?? '?') + ':' + ev.zone; dmgLog[k] = (dmgLog[k] || 0) + ev.amount; } }
      if (ev.type === 'death' && ev.team === 'ally' && process.env.VERBOSE) console.log(`     t=${world.time.toFixed(0)} cae ${ev.kind}; último golpe de ${world.entityById(lastHit.get(ev.id) ?? -1)?.kind}`);
      if (ev.type === 'death' && ev.team === 'enemy' && lastHit.get(ev.id) === p.id) playerKills++;
    }
    for (const n of world.noises) if (n.kind === 'door' && n.team === 'enemy') doorsE++;
    if (Math.floor(world.time * 4) !== Math.floor((world.time - 1 / 60) * 4)) {
      for (const e of world.entities) if (e.alive && e.team === 'enemy' && e.aiState) states[e.aiState] = (states[e.aiState] || 0) + 1;
    }
    if (world.stats.kills !== lastKills) { lastKills = world.stats.kills; lastProgress = world.time; }
    if (world.time - lastProgress > 240) break; // sin bajas en 4 minutos: algo va mal
  }
  if (process.env.VERBOSE) console.log('     daño a compañeros:', Object.entries(dmgLog).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + '=' + Math.round(v)).join(' '));
  if (process.env.VERBOSE) console.log('     daño al jugador:', Object.entries(pDmg).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + '=' + Math.round(v)).join(' '));
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
    let ok = true, retries = 0;
    while (st.floor <= 9) {
      const loaded = campaign.load();
      if (st.floor > 1 && (!loaded || loaded.floor !== st.floor)) { console.log('FALLO: no se guardó la planta', st.floor); ok = false; }
      if (loaded) st = loaded;
      // elige como una persona: si va tocado, la zona que da vida; si no, la de munición
      const me = st.members[st.controlled];
      const hurt = me.hp < 0.7 * 160 || Object.values(st.members).some(m => m.hp > 0 && m.hp < 50);
      const base = zone % 2 === 1 ? zone : zone - 1;
      const z = st.floor === 9 ? 1 : hurt ? base + 1 : base;
      const w = campaign.startZone(st, z) as World;
      const r = playZone(w, 1200, god);
      console.log(fmt(r));
      if (r.result === 'dead' && retries < 5) { retries++; campaign.failZone(st); console.log(`  → muerto; reintenta la planta (intento ${retries + 1}, ajuste ${st.adapt})`); continue; }
      if (r.result !== 'cleared') { ok = false; console.log('  → la campaña se para aquí'); break; }
      retries = 0;
      const sum = campaign.completeZone(st, w);
      console.log(`     recompensa ${sum.reward} → ${sum.rewarded.join(', ')}; caídos: ${sum.fallen.join(', ') || 'ninguno'}; puntos ${sum.totalScore}; ajuste ${st.adapt}` + (sum.campaignWon ? '  *** VICTORIA ***' : ''));
    }
    console.log(ok && st.floor === 10 ? 'CAMPAÑA COMPLETADA' : 'CAMPAÑA NO COMPLETADA');
    process.exitCode = ok && st.floor === 10 ? 0 : 1;
  }
}
