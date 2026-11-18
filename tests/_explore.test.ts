import { it } from 'vitest';
import { clearZone, killAllies, quickWorld, DT } from './helpers';
import { emptyInput } from '../src/sim/types';
it('x', () => {
  const { world } = quickWorld(1, 1);
  clearZone(world); killAllies(world); world.cheats.god = true;
  const p = world.player, L = world.level;
  const hs: any[] = [];
  for (let gy = L.oy + 1; gy < L.oy + L.gh * 0.25 - 1 && hs.length < 6; gy += 1.5) for (let gx = L.ox + 1; gx < L.ox + L.gw * 0.25 - 1 && hs.length < 6; gx += 1.5) {
    if (!L.inside(gx, gy) || !L.walkableAt(gx, gy, false)) continue;
    const wd = world.walkDistToPlayer(gx, gy), d = Math.hypot(gx - p.x, gy - p.y);
    if (!(wd >= 10 && wd <= 26 && d >= 5 && d <= 22)) continue;
    if (hs.some(o => Math.hypot(o.x - gx, o.y - gy) < 3)) continue;
    if ([0.9, 1.7].some(z => L.clear(p.x, p.y, 1.6, gx, gy, z, 'sight'))) continue;
    hs.push(world.spawnUnit('enemy1', gx, gy, false));
  }
  const inp = emptyInput(); inp.fire = true; inp.yaw = p.yaw;
  const rec: string[] = [];
  for (let i = 0; i < 180; i++) { world.step(DT, inp); p.mag = p.magSize; if (i % 30 === 0) rec.push(`t=${(i/60).toFixed(1)} ` + hs.map(e => `${e.id}:${e.aiState}`).join(' ')); }
  console.log(hs.map(e => `#${e.id} d=${Math.hypot(e.x-p.x,e.y-p.y).toFixed(1)} wd=${world.walkDistToPlayer(e.x,e.y).toFixed(1)}`).join(' | '));
  console.log(rec.join('\n'));
  console.log('noises last', world.noises.length);
});
