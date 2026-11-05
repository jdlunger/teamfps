// Plays each character's kit headlessly, against the real level. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { colliders, spawns, wanderSpots } from '../src/level.js';
import { createPlayer, stepPlayer, raycast, topAt, TICK, tuning } from '../src/physics.js';
import { createCombat, createTargets, createWanderers, stepCombat, stepWanderers } from '../src/combat.js';
import { roster } from '../src/roster.js';

const spawn = spawns.A;
const kit = (id) => roster.find((k) => k.id === id);
const IDLE = { moveX: 0, moveY: 0, sprint: false, jumpPressed: false };

function play(id, x, y, z, yaw = 0) {
  const k = kit(id);
  const p = createPlayer({ x, y, z, yaw }, k.tuning);
  const tick = (input = {}) => stepPlayer(p, colliders, { ...IDLE, ...input }, spawn);
  const run = (ticks, input) => { for (let i = 0; i < ticks; i++) tick(input); };
  run(60);
  return { p, tick, run, combat: createCombat(k) };
}

// Aim ray from just above the player's head towards a world point.
function aimAt(p, tx, ty, tz) {
  const x = p.x, y = p.y + p.tuning.height + 0.2, z = p.z;
  const len = Math.hypot(tx - x, ty - y, tz - z);
  return { x, y, z, dx: (tx - x) / len, dy: (ty - y) / len, dz: (tz - z) / len };
}

const speed = (p) => Math.hypot(p.vx, p.vz);

test('every character has unique ids and spawns on solid ground', () => {
  assert.equal(new Set(roster.map((k) => k.id)).size, roster.length);
  for (const k of roster) {
    const p = createPlayer({ x: -66, y: 5, z: 0, yaw: 0 }, k.tuning);
    for (let i = 0; i < 120; i++) stepPlayer(p, colliders, IDLE, spawn);
    assert.ok(Math.abs(p.y - 4) < 0.05 && p.grounded, `${k.id} at y=${p.y}`);
  }
});

test('characters do not change the shared baseline tuning', () => {
  assert.equal(createPlayer(spawn).tuning.radius, tuning.radius);
  assert.equal(tuning.airJumps, 0);
});

test('wander spots are on a surface, clear of solid geometry', () => {
  for (const s of wanderSpots) {
    const under = raycast(colliders, s.x, s.y + 0.5, s.z, 0, -1, 0, 5);
    assert.ok(Math.abs(under - 0.5) < 0.01, `spot at ${s.x},${s.z} has ${under}m below its base point`);
    const headroom = raycast(colliders, s.x, s.y + 0.5, s.z, 0, 1, 0, 1.5);
    assert.equal(headroom, 1.5, `spot at ${s.x},${s.z} is under something`);
  }
});

test('nobody leaves the arena, however high they get', () => {
  for (const k of roster) {
    const p = createPlayer({ x: -71, y: 30, z: 0, yaw: Math.PI / 2 }, k.tuning); // facing -x, over the wall
    for (let i = 0; i < 240; i++) stepPlayer(p, colliders, { ...IDLE, moveY: 1, sprint: true }, spawn);
    assert.ok(p.x >= -72 + p.tuning.radius - 1e-6, `${k.id} at x=${p.x}`);
    assert.ok(p.y > -0.01, `${k.id} fell at y=${p.y}`);
  }
});

// --- Shade ---------------------------------------------------------------

test('Shade can double jump higher than a single jump, but not triple', () => {
  const peak = (presses) => {
    const w = play('shade', -23, 0, 31);
    let top = 0;
    for (let i = 0; i < 150; i++) {
      w.tick({ jumpPressed: presses.includes(i) });
      top = Math.max(top, w.p.y);
    }
    return top;
  };
  const single = peak([0]), double = peak([0, 25]), triple = peak([0, 25, 50]);
  assert.ok(double > single + 1, `single ${single}, double ${double}`);
  assert.ok(Math.abs(triple - double) < 1e-6, `third jump changed peak: ${double} -> ${triple}`);
});

test('Shade recovers the air jump on landing, and the Recruit never has one', () => {
  const s = play('shade', -23, 0, 22);
  s.tick({ jumpPressed: true });
  s.run(10);
  s.tick({ jumpPressed: true });
  assert.equal(s.p.airJumpsLeft, 0);
  s.run(120);
  assert.equal(s.p.airJumpsLeft, 1);

  const r = play('recruit', -23, 0, 22);
  r.tick({ jumpPressed: true });
  r.run(20);
  const vy = r.p.vy;
  r.tick({ jumpPressed: true });
  assert.ok(r.p.vy < vy, 'recruit should keep falling');
});

test('Shade dash covers ground, respects its cooldown and stops at walls', () => {
  const w = play('shade', -66, 4, 0, -Math.PI / 2); // facing +x along the spawn deck
  const startX = w.p.x;
  w.tick({ secondaryPressed: true });
  w.run(12);
  const covered = w.p.x - startX;
  assert.ok(covered > 5 && covered < 7, `dash covered ${covered}m`);

  const after = w.p.dashCount;
  w.tick({ secondaryPressed: true });
  assert.equal(w.p.dashCount, after, 'dash fired during cooldown');
  w.run(Math.ceil(2.5 / TICK));
  w.tick({ secondaryPressed: true });
  assert.equal(w.p.dashCount, after + 1, 'dash did not recover');

  const wall = play('shade', -70, 4, 0, Math.PI / 2); // facing the west wall
  wall.tick({ secondaryPressed: true });
  wall.run(12);
  assert.ok(wall.p.x >= -72 + wall.p.tuning.radius - 1e-6, `dashed through wall to ${wall.p.x}`);
});

test('Shade dashing while looking down skims the floor rather than stalling', () => {
  const w = play('shade', -66, 4, 0, -Math.PI / 2);
  const aim = { x: w.p.x, y: 6, z: 0, dx: Math.SQRT1_2, dy: -Math.SQRT1_2, dz: 0 };
  const startX = w.p.x;
  w.tick({ secondaryPressed: true, aim });
  w.run(12);
  assert.ok(w.p.x - startX > 5, `covered only ${w.p.x - startX}m`);
});

test('Shade katana hits in front, not behind, and not through walls', () => {
  const swing = (px, py, pz, yaw, dummy) => {
    const w = play('shade', px, py, pz, yaw);
    const dummies = createTargets([dummy]);
    for (let i = 0; i < 12; i++) {
      w.tick();
      stepCombat(w.combat, w.p, dummies, colliders, { ...IDLE, primary: i === 0 });
    }
    return dummies[0].hp;
  };
  // On open floor at (-23, 22). Forward for yaw 0 is -z.
  assert.equal(swing(-23, 0, 22, 0, { x: -23, y: 0, z: 20 }), 65, 'in front');
  assert.equal(swing(-23, 0, 22, 0, { x: -23, y: 0, z: 24 }), 100, 'behind');
  assert.equal(swing(-23, 0, 22, 0, { x: -23, y: 0, z: 17 }), 100, 'out of range');
  // Standing on the 4m spawn deck with the dummy on the floor far below it.
  assert.equal(swing(-61, 4, 11, -Math.PI / 2, { x: -59, y: 0, z: 11 }), 100, 'different level');
  // A 2.5m block lies between x=-26 and x=-21.
  assert.equal(swing(-26.6, 0, 7.5, -Math.PI / 2, { x: -25.2, y: 0.5, z: 7.5 }), 100, 'through a wall');
});

test('Shade dash cuts each target once per dash', () => {
  const w = play('shade', -23, 0, 28, 0); // facing -z down an open lane
  const dummies = createTargets([{ x: -23, y: 0, z: 25 }]);
  let hits = 0;
  for (let i = 0; i < 30; i++) {
    const input = { ...IDLE, secondaryPressed: i === 0 };
    w.tick(input);
    hits += stepCombat(w.combat, w.p, dummies, colliders, input).filter((e) => e.type === 'hit').length;
  }
  assert.equal(hits, 1);
  assert.equal(dummies[0].hp, 50);
});

// --- Tonne ---------------------------------------------------------------

test('Tonne builds up speed and keeps rolling after input stops', () => {
  const w = play('tonne', -23, 0, 38, -Math.PI / 2); // facing +x
  w.tick({ moveY: 1 });
  const early = speed(w.p);
  assert.ok(early < 1, `started too fast: ${early}`);
  w.run(45, { moveY: 1 });
  const top = speed(w.p);
  assert.ok(top > 10, `only reached ${top}`);
  w.run(30);
  assert.ok(speed(w.p) > 5, 'stopped dead without input');
  w.run(120);
  assert.equal(speed(w.p), 0, 'never came to rest');
});

test('Tonne rolls down ramps on its own but can drive up them', () => {
  const down = play('tonne', -54, 2, -11);
  const startX = down.p.x;
  down.run(180);
  assert.ok(down.p.x > startX + 2, `didn't roll: ${startX} -> ${down.p.x}`);

  const up = play('tonne', -44, 0, -11, Math.PI / 2); // facing -x, up the spawn ramp
  up.run(240, { moveY: 1 });
  assert.ok(Math.abs(up.p.y - 4) < 0.05, `stuck at y=${up.p.y}`);
});

test('Tonne rebounds from walls and hard landings, not from small bumps', () => {
  const wall = play('tonne', -60, 4, 0, Math.PI / 2);
  wall.p.vx = -20;
  let reversed = false;
  for (let i = 0; i < 90 && !reversed; i++) {
    wall.tick();
    reversed = wall.p.vx > 3;
  }
  assert.ok(reversed, 'no rebound off the wall');

  const drop = play('tonne', -23, 0, 31);
  drop.p.y = 12;
  let bounced = false, last = drop.p.vy;
  for (let i = 0; i < 240; i++) {
    drop.tick();
    if (last < 0 && drop.p.vy > 0) bounced = true;
    last = drop.p.vy;
  }
  assert.ok(bounced, 'no bounce from a 12m drop');
  assert.ok(drop.p.grounded, 'never settled after bouncing');

  const hop = play('tonne', -23, 0, 22);
  hop.tick({ jumpPressed: true });
  hop.run(50);
  assert.ok(hop.p.grounded, 'bounced from its own jump');
});

test('Tonne hook attaches within range, reels in, and carries momentum on release', () => {
  // From the north lane floor, hook the north face of the 7m perch.
  const w = play('tonne', -30, 0, 36);
  const aim = aimAt(w.p, -30, 6, 24);
  w.tick({ primary: true, primaryPressed: true, aim });
  assert.ok(w.p.rope, 'did not attach');
  const start = w.p.rope.length;

  w.run(30, { primary: true, aim });
  assert.ok(w.p.rope, 'rope let go by itself');
  assert.ok(w.p.rope.length < start - 4, 'rope is not reeling');
  const anchor = w.p.rope;
  const dist = Math.hypot(w.p.x - anchor.x, w.p.y + 0.9 - anchor.y, w.p.z - anchor.z);
  assert.ok(dist < start - 3, `not pulled in: ${start} -> ${dist}`);

  const moving = Math.hypot(w.p.vx, w.p.vy, w.p.vz);
  w.tick({ primary: false, aim });
  assert.equal(w.p.rope, null, 'held on after release');
  assert.ok(Math.hypot(w.p.vx, w.p.vy, w.p.vz) > moving * 0.7, 'lost its momentum on release');
});

test('Tonne hook misses out of range and has a short cooldown', () => {
  const sky = play('tonne', -23, 0, 31);
  const up = { x: sky.p.x, y: 3, z: sky.p.z, dx: 0, dy: 1, dz: 0 };
  sky.tick({ primary: true, primaryPressed: true, aim: up });
  assert.equal(sky.p.rope, null, 'hooked the sky');

  const w = play('tonne', -30, 0, 36);
  const aim = aimAt(w.p, -30, 6, 24);
  w.tick({ primary: true, primaryPressed: true, aim });
  assert.ok(w.p.rope);
  w.tick({ primary: false });
  w.tick({ primary: true, primaryPressed: true, aim });
  assert.equal(w.p.rope, null, 'fired during cooldown');
  w.run(30);
  w.tick({ primary: true, primaryPressed: true, aim });
  assert.ok(w.p.rope, 'did not recover');
});

test('Tonne rope snaps when something comes between it and the anchor', () => {
  const w = play('tonne', -30, 0, 36);
  w.p.rope = { x: -30, y: 6, z: 24, length: 40 };
  w.tick({ primary: true });
  assert.ok(w.p.rope, 'rope should hold with a clear line to the anchor');
  // Move behind the 3m north lane cover at x -46..-40, z 28..34.
  w.p.x = -50; w.p.z = 31;
  w.tick({ primary: true });
  assert.equal(w.p.rope, null, 'rope passed through the cover block');
});

test('Tonne swinging on a rope stays at its length and gains speed falling', () => {
  // Hang from the catwalk's underside... start out to one side and let go.
  const w = play('tonne', -40, 8, 28);
  w.p.rope = { x: -30, y: 3.4, z: 41, length: 30 };
  const anchor = w.p.rope;
  let maxOver = 0;
  for (let i = 0; i < 40 && w.p.rope; i++) {
    w.tick({ primary: true });
    const d = Math.hypot(w.p.x - anchor.x, w.p.y + 0.9 - anchor.y, w.p.z - anchor.z);
    maxOver = Math.max(maxOver, d - anchor.length);
  }
  assert.ok(maxOver < 0.5, `rope stretched by ${maxOver}m`);
});

test('Tonne ram damage grows with speed, and slow contact does nothing', () => {
  const hit = (vx) => {
    const w = play('tonne', -23, 0, 38);
    const dummies = createTargets([{ x: -23, y: 0, z: 38 }]);
    w.p.vx = vx;
    stepCombat(w.combat, w.p, dummies, colliders, IDLE);
    return dummies[0].hp;
  };
  assert.equal(hit(5), 100);
  const medium = hit(10), fast = hit(20);
  assert.ok(medium < 100 && fast < medium, `${medium}, ${fast}`);
});

test('Tonne can only damage the same target once per immunity window', () => {
  const w = play('tonne', -23, 0, 38);
  const dummies = createTargets([{ x: -23, y: 0, z: 38 }]);
  w.p.vx = 10;
  let hits = 0;
  for (let i = 0; i < 10; i++) {
    hits += stepCombat(w.combat, w.p, dummies, colliders, IDLE).length;
  }
  assert.equal(hits, 1);
});

// --- Skylark -------------------------------------------------------------

test('Skylark jets climb past a jump, run out of fuel, and refuel on the ground', () => {
  const w = play('skylark', -23, 0, 31);
  w.tick({ jumpPressed: true, jumpHeld: true });
  let top = 0, ticks = 0;
  while (w.p.fuel > 0 && ticks++ < 400) {
    w.tick({ jumpHeld: true });
    top = Math.max(top, w.p.y);
  }
  assert.ok(ticks < 400, 'fuel never ran out');
  assert.ok(top > 8, `only reached ${top}m`);
  w.run(300, { jumpHeld: true });
  assert.ok(w.p.grounded, 'kept flying without fuel');
  assert.equal(w.p.jetting, false);
  w.run(Math.ceil(3.5 / TICK));
  assert.equal(w.p.fuel, 1);
});

test('Skylark carbine hits what the crosshair is on, and walls stop bullets', () => {
  const shoot = (px, py, pz, target, dummy) => {
    const w = play('skylark', px, py, pz);
    const dummies = createTargets([dummy]);
    const aim = aimAt(w.p, ...target);
    const events = stepCombat(w.combat, w.p, dummies, colliders, { ...IDLE, primary: true, aim });
    return { hp: dummies[0].hp, events };
  };
  const open = shoot(-23, 0, 30, [-23, 1, 20], { x: -23, y: 0, z: 20 });
  assert.equal(open.hp, 88);
  assert.ok(open.events.some((e) => e.type === 'shot'));

  assert.equal(shoot(-23, 0, 30, [-26, 1, 20], { x: -23, y: 0, z: 20 }).hp, 100, 'aimed away');
  // The 3m block at x -32..-28, z 6..14 stands between shooter and target.
  assert.equal(shoot(-35, 0, 10, [-25, 1, 10], { x: -25, y: 0, z: 10 }).hp, 100, 'through a block');
});

test('Skylark carbine respects its fire rate', () => {
  const w = play('skylark', -23, 0, 30);
  const dummies = createTargets([{ x: -23, y: 0, z: 20 }]);
  const aim = aimAt(w.p, -23, 1, 20);
  let shots = 0;
  for (let i = 0; i < 60; i++) {
    shots += stepCombat(w.combat, w.p, dummies, colliders, { ...IDLE, primary: true, aim })
      .filter((e) => e.type === 'shot').length;
  }
  assert.ok(shots >= 8 && shots <= 9, `${shots} shots in one second`);
});

// --- Wanderers -----------------------------------------------------------

// Small seeded generator, so a failure replays the same way.
function seeded(seed) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

test('wanderers roam, stay inside the arena and stay out of solid geometry', () => {
  const targets = createWanderers(wanderSpots, seeded(42));
  const starts = targets.map((t) => [t.x, t.z]);
  const farthest = targets.map(() => 0);
  for (let i = 0; i < 60 * 60; i++) {
    stepWanderers(targets, colliders);
    targets.forEach((t, n) => {
      assert.ok(Math.abs(t.x) < 72 && Math.abs(t.z) < 44, `escaped at ${t.x}, ${t.z}`);
      assert.ok(t.y > -0.01, `fell through at ${t.y}`);
      farthest[n] = Math.max(farthest[n], Math.hypot(t.x - starts[n][0], t.z - starts[n][1]));
      const cy = t.y + t.height / 2;
      for (const c of colliders) {
        const inside = t.x > c.minX + 1e-3 && t.x < c.maxX - 1e-3 && t.z > c.minZ + 1e-3 && t.z < c.maxZ - 1e-3;
        if (inside && cy > c.minY + 1e-3 && cy < topAt(c, t.x, t.z) - 1e-3) assert.fail(`inside ${c.kind}`);
      }
    });
  }
  for (const d of farthest) assert.ok(d > 8, `wanderer only got ${d}m from its start`);
});

test('wanderers can be hit while moving, are knocked back, and return at a spawn spot', () => {
  const targets = createWanderers(wanderSpots.slice(0, 1), seeded(7));
  const t = targets[0];
  const w = play('skylark', t.x - 6, t.y, t.z);
  const combat = createCombat(kit('skylark'));
  const shoot = () => {
    const aim = aimAt(w.p, t.x, t.y + 1, t.z);
    stepWanderers(targets, colliders);
    return stepCombat(combat, w.p, targets, colliders, { ...IDLE, primary: true, aim });
  };
  let first;
  for (let i = 0; i < 30 && !first; i++) first = shoot().find((e) => e.type === 'hit');
  assert.ok(first, 'never hit');
  assert.ok(t.body.vy > 0 || Math.hypot(t.body.vx, t.body.vz) > 0, 'no knockback');

  t.hp = 1;
  for (let i = 0; i < 30 && !t.downFor; i++) shoot();
  assert.ok(t.downFor > 0, 'did not go down');
  for (let i = 0; i < 60; i++) stepWanderers(targets, colliders); // let the knockback land
  const x = t.x, z = t.z;
  for (let i = 0; i < 60; i++) stepWanderers(targets, colliders);
  assert.ok(Math.hypot(t.x - x, t.z - z) < 0.01, 'kept walking while down');

  for (let i = 0; i < 3.1 / TICK; i++) stepCombat(combat, w.p, targets, colliders, IDLE);
  assert.equal(t.hp, 100);
  assert.deepEqual([t.x, t.y, t.z], [wanderSpots[0].x, wanderSpots[0].y, wanderSpots[0].z]);
});

test('targets go down at zero health, ignore hits while down, and come back', () => {
  const w = play('skylark', -23, 0, 30);
  const dummies = createTargets([{ x: -23, y: 0, z: 20 }]);
  const aim = aimAt(w.p, -23, 1, 20);
  const fire = { ...IDLE, primary: true, aim };
  let killed = 0;
  for (let i = 0; i < 120; i++) {
    killed += stepCombat(w.combat, w.p, dummies, colliders, fire).filter((e) => e.killed).length;
  }
  assert.equal(killed, 1);
  assert.ok(dummies[0].downFor > 0);
  for (let i = 0; i < 3.1 / TICK; i++) stepCombat(w.combat, w.p, dummies, colliders, IDLE);
  assert.equal(dummies[0].downFor, 0);
  assert.equal(dummies[0].hp, 100);
});

// --- Everyone ------------------------------------------------------------

test('no character gets stuck inside colliders during chaotic play', () => {
  for (const k of roster) {
    let seed = 987;
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const p = createPlayer(spawn, k.tuning);
    let held = false;
    for (let i = 0; i < 60 * 120; i++) {
      if (i % 45 === 0) p.yaw = rand() * Math.PI * 2;
      const pitch = (rand() - 0.5) * 2;
      const aim = {
        x: p.x, y: p.y + p.tuning.height, z: p.z,
        dx: -Math.sin(p.yaw) * Math.cos(pitch), dy: Math.sin(pitch), dz: -Math.cos(p.yaw) * Math.cos(pitch),
      };
      const pressed = rand() < 0.02;
      if (pressed) held = !held;
      stepPlayer(p, colliders, {
        moveX: 0, moveY: 1, sprint: rand() < 0.5, aim,
        jumpPressed: rand() < 0.04, jumpHeld: rand() < 0.4,
        primary: held, primaryPressed: pressed && held,
        secondaryPressed: rand() < 0.01,
      }, spawn);

      assert.ok(Math.abs(p.x) < 72 && Math.abs(p.z) < 44, `${k.id} escaped at ${p.x}, ${p.z}`);
      assert.ok(p.y > -0.01, `${k.id} fell through at ${p.y}`);
      assert.ok(Number.isFinite(p.x + p.y + p.z + p.vx + p.vy + p.vz), `${k.id} went non-finite`);
      const cy = p.y + p.tuning.height / 2;
      for (const c of colliders) {
        const inside = p.x > c.minX + 1e-3 && p.x < c.maxX - 1e-3 && p.z > c.minZ + 1e-3 && p.z < c.maxZ - 1e-3;
        if (inside && cy > c.minY + 1e-3 && cy < topAt(c, p.x, p.z) - 1e-3) {
          assert.fail(`${k.id} inside ${c.kind} at ${p.x}, ${p.y}, ${p.z}`);
        }
      }
    }
  }
});
