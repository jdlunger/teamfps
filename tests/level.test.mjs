// Plays the level headlessly with a scripted walker, to prove the routes the
// layout promises can actually be traversed. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { colliders, spawns } from '../src/level.js';
import { createPlayer, stepPlayer, raycast, topAt, TICK, tuning } from '../src/physics.js';

const spawn = spawns.A;

function walker(x, y, z) {
  const p = createPlayer({ x, y, z, yaw: 0 });
  const tick = (input = {}) =>
    stepPlayer(p, colliders, { moveX: 0, moveY: 0, sprint: false, jumpPressed: false, ...input }, spawn);
  const settle = () => { for (let i = 0; i < 120; i++) tick(); };
  // Walk in a straight line; fail if blocked. Jumps once within `jumpWithin` metres.
  const walkTo = (tx, tz, { sprint = false, jumpWithin = 0, limit = 40 } = {}) => {
    for (let t = 0; t < limit; t += TICK) {
      const dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
      if (dist < 0.4) return;
      p.yaw = Math.atan2(-dx, -dz);
      tick({ moveY: 1, sprint, jumpPressed: jumpWithin > 0 && dist < jumpWithin && p.grounded });
    }
    assert.fail(`blocked at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) heading to (${tx}, ${tz})`);
  };
  return { p, tick, settle, walkTo };
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.05, `${msg ?? 'height'}: got ${a}, want ${b}`);

test('arena is rotationally symmetric', () => {
  const key = (minX, maxX, minY, maxY, minZ, maxZ) => [minX, maxX, minY, maxY, minZ, maxZ].join();
  const keys = new Set(colliders.map((c) => key(c.minX, c.maxX, c.minY, c.maxY, c.minZ, c.maxZ)));
  for (const c of colliders) {
    assert.ok(keys.has(key(-c.maxX, -c.minX, c.minY, c.maxY, -c.maxZ, -c.minZ)), `no twin for ${JSON.stringify(c)}`);
  }
  for (const c of colliders.filter((c) => c.ramp)) {
    // Each ramp's surface must span its stated heights within its footprint.
    const coords = c.ramp.axis === 'x' ? [c.minX, c.maxX] : [c.minZ, c.maxZ];
    const heights = coords.map((v) => c.ramp.c0 + c.ramp.k * v);
    near(Math.max(...heights), c.maxY, 'ramp top');
  }
});

test('both spawns stand on solid ground', () => {
  for (const s of [spawns.A, spawns.B]) {
    const w = walker(s.x, s.y + 1, s.z);
    w.settle();
    near(w.p.y, 4);
    assert.ok(w.p.grounded);
  }
});

test('spawn ramp leads down to the floor and back up', () => {
  const w = walker(-66, 4, -11);
  w.settle();
  w.walkTo(-44, -11);
  near(w.p.y, 0);
  w.walkTo(-66, -11);
  near(w.p.y, 4);
});

test('mid-upper route stays at 4m from spawn to north divider', () => {
  const w = walker(-66, 4, 0);
  w.settle();
  for (const [x, z] of [[-40, 0], [-40, 18], [-36, 18]]) {
    w.walkTo(x, z);
    near(w.p.y, 4);
  }
});

test('north flank reaches the perch at 7m and links to the centre', () => {
  const w = walker(-66, 4, 10);
  w.settle();
  for (const [x, z] of [[-65, 36], [-30, 41], [-8, 41], [-8, 22]]) {
    w.walkTo(x, z);
    near(w.p.y, 4);
  }
  w.walkTo(-14, 22);
  w.walkTo(-30, 22);
  near(w.p.y, 7, 'perch');
  w.walkTo(-14, 22); // back down to the overlook
  near(w.p.y, 4);
  w.walkTo(0, 22);
  w.walkTo(0, 10);   // bridge to plinth
  w.walkTo(4, 0);    // around the central pillar side
  near(w.p.y, 4);
});

test('high route crosses the whole centre', () => {
  const w = walker(0, 4, 22);
  w.settle();
  w.walkTo(0, 10);
  w.walkTo(-4, 4);
  w.walkTo(-4, -4);
  w.walkTo(0, -10);
  w.walkTo(0, -22);
  near(w.p.y, 4);
});

test('south flank: tiers can be jumped, then the gap to the far overlook', () => {
  const w = walker(-32, 0, -21);
  w.settle();
  w.walkTo(-23.5, -21, { jumpWithin: 5 });
  w.settle();
  near(w.p.y, 1.2, 'tier 1');
  w.walkTo(-17.5, -21, { jumpWithin: 5 });
  w.settle();
  near(w.p.y, 2.4, 'tier 2');
  w.walkTo(-12, -21, { jumpWithin: 5 });
  w.settle();
  near(w.p.y, 3.6, 'tier 3');
  w.walkTo(0, -21, { jumpWithin: 7.5 });
  w.settle();
  near(w.p.y, 4, 'gap jump');
});

test('south bunker links to the tiers', () => {
  const w = walker(-38, 0, -38);
  w.settle();
  w.walkTo(-20, -38);
  near(w.p.y, 4);
  w.walkTo(-14, -34);
  w.walkTo(-14, -21);
  w.settle();
  near(w.p.y, 3.6);
});

test('walkways can be walked under on the floor', () => {
  for (const [from, to] of [
    [[-52, -7], [-52, 7]],   // spawn bridge
    [[-40, 8], [-40, 12]],   // mid block bridge
    [[-21, 10], [-21, 32]],  // under the perch ramp, mid to north lane
    [[-30, 39.5], [-20, 39.5]],  // under the catwalk, beside its pillars
    [[0, 12], [0, 15]],      // under the plinth bridge
  ]) {
    const w = walker(from[0], 0, from[1]);
    w.settle();
    w.walkTo(to[0], to[1], { limit: 15 });
    near(w.p.y, 0, 'stayed on floor');
  }
});

test('jumping under a walkway stops at the ceiling and lands', () => {
  const low = colliders.find((c) => c.kind === 'ramp' && c.minY > 3);
  const w = walker(-21, 0, 22);
  w.settle();
  assert.ok(low.minX < -21 && low.maxX > -21);
  w.tick({ jumpPressed: true });
  let peak = 0;
  for (let i = 0; i < 90; i++) { w.tick(); peak = Math.max(peak, w.p.y); }
  assert.ok(peak + tuning.height <= low.minY + 1e-6, `head reached ${peak + tuning.height}`);
  near(w.p.y, 0);
});

test('tall blocks cannot be climbed and walls stop the player', () => {
  const w = walker(-68, 4, 0);
  w.settle();
  // West wall.
  w.p.yaw = Math.PI / 2;
  for (let i = 0; i < 120; i++) w.tick({ moveY: 1 });
  assert.ok(w.p.x >= -72 + tuning.radius - 1e-6);
  // A 2.5m cover block, jumping continually.
  const j = walker(-27, 0, 7.5);
  j.settle();
  j.p.yaw = -Math.PI / 2;
  for (let i = 0; i < 180; i++) j.tick({ moveY: 1, jumpPressed: j.p.grounded });
  assert.ok(j.p.x <= -26 - tuning.radius + 1e-6 && j.p.y < 2.5, `got over at ${j.p.x}, ${j.p.y}`);
});

test('players never stick inside colliders during a random walk', () => {
  let seed = 12345;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const w = walker(-66, 4, 0);
  for (let i = 0; i < 60 * 240; i++) {
    if (i % 45 === 0) w.p.yaw = rand() * Math.PI * 2;
    w.tick({ moveY: 1, sprint: rand() < 0.5, jumpPressed: rand() < 0.04 });
    assert.ok(Math.abs(w.p.x) < 72 && Math.abs(w.p.z) < 44, `escaped at ${w.p.x}, ${w.p.z}`);
    assert.ok(w.p.y > -0.01, `fell through at ${w.p.y}`);
    // Centre of the body must never be inside solid geometry.
    const cy = w.p.y + tuning.height / 2;
    for (const c of colliders) {
      const inside = w.p.x > c.minX + 1e-3 && w.p.x < c.maxX - 1e-3 && w.p.z > c.minZ + 1e-3 && w.p.z < c.maxZ - 1e-3;
      if (inside && cy > c.minY + 1e-3 && cy < topAt(c, w.p.x, w.p.z) - 1e-3) {
        assert.fail(`inside ${c.kind} at ${w.p.x}, ${w.p.y}, ${w.p.z}`);
      }
    }
  }
});

test('raycast hits boxes and ramp slopes, and misses over them', () => {
  // Straight down onto a box top.
  near(raycast(colliders, -66, 10, 0, 0, -1, 0, 50), 6);
  // Straight down onto the middle of the plinth ramp (x=-13 is 2m high).
  near(raycast(colliders, -13, 10, 0, 0, -1, 0, 50), 8);
  // Horizontal ray passes above the low end of that ramp and stops at its slope.
  near(raycast(colliders, -25, 1, 0, 1, 0, 0, 50), 9);
  // Nothing in range returns maxDist.
  near(raycast(colliders, 0, 30, 0, 0, 1, 0, 5), 5);
});
