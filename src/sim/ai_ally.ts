// IA de los tres compañeros (§6): formación en V, atacan lo que ven, se giran hacia quien les dispara,
// vuelven si se alejan, se repliegan hacia el Capitán / Especialista, obedecen las cuatro órdenes y,
// con la moral baja, priorizan sobrevivir.

import { FORMATION_BY_CONTROLLED, FORMATION_SLOTS, ITEM_EFFECT } from './data';
import type { ClassId, Vec2 } from './types';
import { angDiff, type Unit, type World } from './world';

interface AllyBrain {
  targetId: number;
  senseAt: number;
  visible: number; // enemigos a la vista
  bossVisible: boolean;
  reactAt: number;
  burstUntil: number;
  restUntil: number;
  hurtAt: number;
  hurtBy: number;
  faceYaw: number;
  slot: Vec2;
  slotAt: number;
  extra: boolean;
  unstuck: number;
}

function brainOf(w: World, u: Unit): AllyBrain {
  if (!u.brain) {
    u.brain = {
      targetId: -1, senseAt: w.time + w.rng() * 0.15, visible: 0, bossVisible: false, reactAt: 0, burstUntil: 0, restUntil: 0,
      hurtAt: -99, hurtBy: -1, faceYaw: u.yaw, slot: [u.x, u.y], slotAt: -1, extra: false, unstuck: 0,
    } as AllyBrain;
  }
  return u.brain as AllyBrain;
}

function slotOffset(w: World, u: Unit): [number, number] {
  const p = w.player;
  if (p.cls && u.cls && !(u.brain as AllyBrain).extra) {
    const f = FORMATION_BY_CONTROLLED[p.cls];
    if (f.left === u.cls) return [FORMATION_SLOTS.left[0], FORMATION_SLOTS.left[1]];
    if (f.right === u.cls) return [FORMATION_SLOTS.right[0], FORMATION_SLOTS.right[1]];
    if (f.center === u.cls) return [FORMATION_SLOTS.center[0], FORMATION_SLOTS.center[1]];
  }
  // aliados extra (consola): detrás, repartidos
  const k = u.id % 5;
  return [(k - 2) * 1.1, 2.6];
}

export function allyThink(w: World, u: Unit, dt: number): void {
  const b = brainOf(w, u);
  const p = w.player;
  const L = w.level;
  const lowMorale = w.morale < 30;
  u.wishX = 0; u.wishY = 0;
  u.crouch = false;

  // ── percepción: enemigos con línea de visión real (sin cono: se cantan los blancos entre ellos) ──
  if (w.time >= b.senseAt) {
    b.senseAt = w.time + 0.15;
    let best: Unit | null = null, bs = Infinity, n = 0;
    b.bossVisible = false;
    for (const e of w.entities) {
      if (!e.alive || e.team !== 'enemy') continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (d > 24 || !w.canSee(u, e)) continue;
      n++;
      if (e.kind === 'miniboss' || e.kind === 'megaboss') b.bossVisible = true;
      let s = d;
      if (w.order.kind === 'focus' && e.id === w.order.targetId) s -= 100; // orden: enfocar eso
      if (e.id === b.hurtBy && w.time - b.hurtAt < 3) s -= 8;                // se gira hacia quien le dispara
      if (e.shielded) s += 50;
      if (s < bs) { bs = s; best = e; }
    }
    b.visible = n;
    const prev = b.targetId;
    b.targetId = best ? best.id : -1;
    if (best && best.id !== prev) b.reactAt = w.time + 0.45 + w.rng() * 0.5;
  }
  const tgt = b.targetId >= 0 ? w.entityById(b.targetId) : undefined;
  const hasT = !!tgt && tgt.alive;

  // ── destino ──
  const sp = u.stats.speed;
  let gx = u.x, gy = u.y, want = false, arriveR = 0.5;
  let label = 'formación';
  const total = u.mag + u.ammo;

  // esquivar granadas y cohetes
  let dodge = false;
  for (const pr of w.projectiles) {
    if (pr.dead) continue;
    const t = Math.max(0, Math.min(pr.fuse, 1.5));
    const ix = pr.x + pr.vx * t, iy = pr.y + pr.vy * t;
    const d = Math.hypot(ix - u.x, iy - u.y);
    if (d < 3.2) {
      const ax = d > 0.1 ? (u.x - ix) / d : Math.cos(u.yaw + 1.5), ay = d > 0.1 ? (u.y - iy) / d : Math.sin(u.yaw + 1.5);
      const tx = u.x + ax * 3, ty = u.y + ay * 3;
      if (L.walkLine(u.x, u.y, tx, ty, false)) { u.wishX = ax * sp; u.wishY = ay * sp; }
      else { u.wishX = -ay * sp; u.wishY = ax * sp; }
      dodge = true; label = 'esquiva';
      break;
    }
  }

  const captain = w.entities.find(e => e.alive && e.cls === 'captain' && e.team === 'ally');
  const spec = w.entities.find(e => e.alive && e.cls === 'especialist' && e.team === 'ally');
  const order = w.order;
  const hurtBad = u.hp < u.maxHp * (lowMorale ? 0.6 : 0.35);
  const obey = !lowMorale; // con la moral baja priorizan sobrevivir: no van a puntos lejanos ni persiguen

  if (!dodge) {
    // posición de formación respecto a la espalda del jugador (se recalcula cada poco)
    if (w.time - b.slotAt > 0.25) {
      b.slotAt = w.time;
      const [ox, oy] = slotOffset(w, u);
      const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
      let sx = p.x - sy * ox - cy * oy, syy = p.y + cy * ox - sy * oy;
      if (!L.walkableAt(sx, syy, false) || !L.walkLine(p.x, p.y, sx, syy, false)) {
        // el hueco no existe (pared, mueble): pegarse al jugador por detrás
        sx = p.x - cy * 0.9 - sy * ox * 0.4; syy = p.y - sy * 0.9 + cy * ox * 0.4;
        const c = L.nearestFree(sx, syy, false, 6);
        if (c >= 0) { sx = L.cellX(c); syy = L.cellY(c); }
      }
      b.slot = [sx, syy];
    }
    const dPlayer = Math.hypot(p.x - u.x, p.y - u.y);
    const [ox, oy] = slotOffset(w, u);

    if (hurtBad && captain && captain !== u && Math.hypot(captain.x - u.x, captain.y - u.y) > 3.5) {
      gx = captain.x; gy = captain.y; want = true; arriveR = 2.5; label = 'al Capitán';
    } else if (total < 12 && spec && spec !== u && Math.hypot(spec.x - u.x, spec.y - u.y) > 3.5) {
      gx = spec.x; gy = spec.y; want = true; arriveR = 2.5; label = 'al Especialista';
    } else if (order.kind === 'hold' && (obey || dPlayer < 10)) {
      gx = order.x + ox * 0.8; gy = order.y + oy * 0.8; want = true; label = 'mantiene';
      if (!L.walkableAt(gx, gy, false)) { gx = order.x; gy = order.y; arriveR = 1.2; }
    } else if (order.kind === 'goto' && obey) {
      gx = order.x + ox * 0.8; gy = order.y + (oy - 1) * 0.8; want = true; label = 'va al punto';
      if (!L.walkableAt(gx, gy, false)) { gx = order.x; gy = order.y; arriveR = 1.4; }
    } else if (order.kind === 'focus' && obey && w.entityById(order.targetId)?.alive && b.targetId !== order.targetId && dPlayer < 16) {
      const ft = w.entityById(order.targetId)!;
      gx = ft.x; gy = ft.y; want = true; arriveR = 6; label = 'enfoca';
    } else {
      gx = b.slot[0]; gy = b.slot[1]; label = 'formación';
      const dSlot = Math.hypot(gx - u.x, gy - u.y);
      // si está disparando y cerca de su sitio, aguanta; si se aleja más de ~6 m del jugador, vuelve sí o sí
      want = dPlayer > 6 || dSlot > (hasT ? 2.5 : 0.6);
      if (dPlayer > 6) label = 'vuelve';
    }
    // sin munición y con un enemigo cerca: a cuchillo
    if (hasT && total <= 0 && Math.hypot(tgt!.x - u.x, tgt!.y - u.y) < 7) { gx = tgt!.x; gy = tgt!.y; want = true; arriveR = 1.2; label = 'cuchillo'; }

    // recoger algo que le haga falta si pilla al lado
    if (!hasT || label === 'formación') {
      for (const pk of w.pickups) {
        if (pk.taken) continue;
        const d = Math.hypot(pk.x - u.x, pk.y - u.y);
        if (d > 4 || Math.hypot(pk.x - p.x, pk.y - p.y) > 7) continue;
        const e = ITEM_EFFECT[pk.type];
        const need = u.inventory.includes(null) && ((e.hp > 0 && u.hp < u.maxHp * 0.8) || (e.ammo > 0 && total < 60));
        if (need && L.walkLine(u.x, u.y, pk.x, pk.y, false)) { gx = pk.x; gy = pk.y; want = true; arriveR = 0.3; label = 'recoge'; break; }
      }
    }
    if (want) w.navigate(u, gx, gy, sp, null, arriveR);
  }

  // ── combate ──
  const suppressing = u.cls === 'especialist' && u.abilityActive > 0;
  if (hasT) {
    const t = tgt!;
    const d = Math.hypot(t.x - u.x, t.y - u.y);
    b.faceYaw = Math.atan2(t.y - u.y, t.x - u.x);
    const facing = Math.abs(angDiff(b.faceYaw, u.yaw)) < 0.25;
    if (d < u.radius + 1.0 + t.radius * 0.5 && u.knifeCd <= 0 && facing && (total <= 0 || u.reloading > 0 || u.cls === 'explosives')) {
      w.knife(u);
    } else if (facing && w.time >= b.reactAt && u.reloading <= 0 && u.fireCd <= 0 && (u.mag > 0 || suppressing)) {
      let ok = w.time >= b.restUntil || suppressing;
      if (ok && !suppressing && w.time > b.burstUntil) {
        // Los compañeros apoyan, no ganan la partida solos: ráfagas cortas y pausas largas. El Explosivo, tiro a tiro.
        const slow = u.cls === 'explosives' ? 2.4 : 0;
        if (b.burstUntil > 0 && w.time - b.burstUntil < 0.05) { b.restUntil = w.time + 0.5 + slow + w.rng() * (0.6 + slow * 0.6); b.burstUntil = 0; ok = false; }
        else b.burstUntil = w.time + (u.cls === 'explosives' ? 0.05 : 0.35 + w.rng() * 0.45);
      }
      if (ok && u.cls === 'explosives') {
        // el Explosivo no dispara si la explosión alcanzaría a un compañero o a sí mismo
        // Se comprueba el punto donde REALMENTE estallaría (puede dar antes en un mueble o una pared).
        if (d < 5) ok = false;
        else {
          const mz = w.muzzleZ(u);
          const tt = L.ray(u.x, u.y, mz, t.x, t.y, 0.3, 'bullet');
          const ix = u.x + (t.x - u.x) * tt, iy = u.y + (t.y - u.y) * tt;
          if (tt < 0.85) ok = false; // algo en medio: no arriesga
          else for (const a of w.entities) {
            if (!a.alive || a.team !== 'ally') continue;
            if (Math.hypot(a.x - ix, a.y - iy) < 3.6 || Math.hypot(a.x - t.x, a.y - t.y) < 3.6) { ok = false; break; }
            // nadie cruzando la línea de tiro
            if (a !== u) { const ex = t.x - u.x, ey = t.y - u.y; const k = Math.max(0, Math.min(1, ((a.x - u.x) * ex + (a.y - u.y) * ey) / (ex * ex + ey * ey))); if (Math.hypot(a.x - u.x - ex * k, a.y - u.y - ey * k) < 1.2) { ok = false; break; } }
          }
        }
      }
      const az = ok ? w.shotLine(u, t) : -1;
      if (ok && az >= 0) {
        const moving = Math.hypot(u.vx, u.vy) > 0.5 ? 0.025 : 0;
        w.fire(u, t.x, t.y, u.cls === 'explosives' ? 0.3 : az, u.cls === 'explosives' ? 0.02 : 0.07 + moving, suppressing);
        u.fireCd = 1 / (u.stats.rof * (suppressing ? 2 : 1));
      }
    }
    if (u.mag <= 0 && u.ammo > 0) w.startReload(u);
    if (label === 'formación' || label === 'mantiene') label = 'dispara';
    // quieto y bajo fuego: se agacha (menos blanco, y aprovecha los muebles)
    if (Math.hypot(u.wishX, u.wishY) < 0.3 && (w.order.kind === 'hold' || w.time - b.hurtAt < 2.5)) u.crouch = true;
    // habilidades
    if (u.abilityCd <= 0) {
      if (u.cls === 'captain' && (b.bossVisible || b.visible >= 4)) w.useAbility(u);
      else if (u.cls === 'especialist' && b.visible >= 3) w.useAbility(u);
    }
  } else {
    if (Math.hypot(u.wishX, u.wishY) > 0.3) b.faceYaw = Math.atan2(u.wishY, u.wishX);
    else if (w.time - b.hurtAt < 2) { const a = w.entityById(b.hurtBy); if (a) b.faceYaw = Math.atan2(a.y - u.y, a.x - u.x); }
    else if (!want) b.faceYaw = p.yaw;
    if (u.mag < u.magSize * 0.5 && u.ammo > 0) w.startReload(u);
  }
  if (suppressing) w.applySuppression(u);

  const rate = 9 * dt;
  const dy = angDiff(b.faceYaw, u.yaw);
  u.yaw += Math.abs(dy) < rate ? dy : Math.sign(dy) * rate;
  u.aiState = label;
}

export type { ClassId };
