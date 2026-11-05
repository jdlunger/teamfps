// Level data. Pure JS with no rendering dependency, so tests can use it directly.
//
// The arena has 180-degree rotational symmetry for fair team play: anything
// authored here for team A (x < 0) is rotated to create team B's copy, unless it
// is marked `center`. Units are metres; +y is up.
//
// Height bands:
//   0m  floor          three lanes (north, mid, south) joined by connectors
//   4m  upper routes   catwalks, bridges and block tops, walkable across the map
//   7m  perch          high ground reached by a single ramp from the 4m level
//
// A jump clears about 1.9m (1.47m jump + 0.45m step), so block heights are
// chosen deliberately: 1.2 and 2.4m tiers can be climbed, 2.5m and up can't.

const collider = (x0, x1, z0, z1, bottom, top, opts = {}) => ({
  minX: x0, maxX: x1, minY: bottom, maxY: top, minZ: z0, maxZ: z1,
  kind: opts.kind ?? 'block',
  team: opts.center ? 'neutral' : 'A',
  center: !!opts.center,
  ramp: null,
});

// Solid block standing on the floor.
const block = (x0, x1, z0, z1, top, opts) => collider(x0, x1, z0, z1, 0, top, opts);

// Thin walkway: 0.6m deck, with walkable space underneath.
const deck = (x0, x1, z0, z1, top = 4, opts) =>
  collider(x0, x1, z0, z1, top - 0.6, top, { kind: 'deck', ...opts });

// Waist-high cover sitting on an upper surface.
const parapet = (x0, x1, z0, z1, base, opts) =>
  collider(x0, x1, z0, z1, base, base + 0.9, { kind: 'cover', ...opts });

// Wedge climbing from `lo` to `hi` towards `rise` ('+x', '-x', '+z' or '-z').
// The surface is stored as height = c0 + k * coord, which rotates cleanly.
function ramp(x0, x1, z0, z1, rise, lo, hi, opts = {}) {
  const c = collider(x0, x1, z0, z1, opts.bottom ?? 0, hi, { kind: 'ramp', ...opts });
  const axis = rise[1];
  const [a, b] = axis === 'x' ? [x0, x1] : [z0, z1];
  const k = ((hi - lo) / (b - a)) * (rise[0] === '+' ? 1 : -1);
  c.ramp = { axis, k, c0: rise[0] === '+' ? lo - k * a : lo - k * b };
  return c;
}

const authored = [
  // --- Boundary ---------------------------------------------------------
  block(-74, 0, 44, 46, 14, { kind: 'wall' }),
  block(-74, 0, -46, -44, 14, { kind: 'wall' }),
  block(-74, -72, -46, 46, 14, { kind: 'wall' }),

  // --- Spawn ------------------------------------------------------------
  block(-72, -60, -14, 14, 4),                        // spawn deck
  ramp(-60, -48, -14, -8, '-x', 0, 4),                // ramps down to the floor
  ramp(-60, -48, 8, 14, '-x', 0, 4),
  block(-72, -56, -44, -14, 10, { kind: 'wall' }),    // closes off the south corner

  // --- Mid-upper route: spawn -> bridge -> mid block -> north divider ---
  deck(-60, -44, -3, 3),
  block(-44, -36, -6, 6, 4),
  ramp(-36, -26, -6, -1, '-x', 0, 4),                 // access from the mid floor
  deck(-42, -38, 6, 14),

  // --- North divider and perch ------------------------------------------
  block(-50, -34, 14, 24, 4),
  parapet(-46, -42, 14, 14.4, 4),
  block(-34, -26, 14, 24, 7),                         // perch, the highest ground
  ramp(-26, -16, 20, 24, '-x', 4, 7, { bottom: 3.4 }), // floats: walk under it
  block(-16, 3, 18, 26, 4),                           // overlook above mid
  ramp(-16, -11, 26, 38, '-z', 0, 4),                 // overlook access from north lane
  deck(-10, -6, 26, 38),                              // overlook <-> catwalk

  // --- North flank: spawn -> tower -> long catwalk ----------------------
  deck(-68, -62, 14, 30),
  block(-72, -52, 30, 44, 4),
  deck(-52, -6, 38, 44),
  ramp(-6, 6, 38, 44, '-x', 0, 4),                    // catwalk's far end
  parapet(-36, -26, 38, 38.4, 4),
  parapet(-20, -12, 38, 38.4, 4),
  block(-40.5, -39.5, 40.5, 41.5, 3.4, { kind: 'pillar' }),
  block(-25.5, -24.5, 40.5, 41.5, 3.4, { kind: 'pillar' }),
  block(-12.5, -11.5, 40.5, 41.5, 3.4, { kind: 'pillar' }),
  block(-46, -40, 28, 34, 3),                         // north lane cover

  // --- South flank ------------------------------------------------------
  block(-50, -36, -24, -14, 10, { kind: 'wall' }),    // sightline blocker
  block(-28, -22, -26, -16, 1.2),                     // climbable tiers...
  block(-22, -16, -26, -16, 2.4),
  block(-16, -7, -26, -16, 3.6),                      // ...ending in a 4m gap jump
  block(-24, -12, -40, -32, 4),                       // south bunker
  ramp(-36, -24, -40, -36, '+x', 0, 4),
  deck(-16, -12, -32, -26),                           // bunker <-> tiers
  block(-44, -38, -36, -30, 3),                       // south lane cover
  block(-32, -29, -33, -30, 1.2),                     // crate stack
  block(-29, -26, -33, -30, 2.4),

  // --- Mid lane cover ---------------------------------------------------
  block(-32, -28, 6, 14, 3),                          // against the divider: keeps mid 7m wide here
  block(-26, -21, 5, 10, 2.5),
  block(-24, -20, -10, -6, 3),
  block(-16, -14, 6, 12, 1.2),                        // vault-able low walls
  block(-14, -12, -12, -6, 1.2),

  // --- Centre: raised plinth with four approaches ------------------------
  block(-7, 7, -7, 7, 4, { center: true }),
  block(-1.5, 1.5, -1.5, 1.5, 6.5, { center: true }), // blocks line of sight across the top
  ramp(-19, -7, -3, 3, '+x', 0, 4),
  deck(-3, 3, 7, 18),                                 // plinth <-> overlook
];

function rotated(c) {
  return {
    ...c,
    minX: -c.maxX, maxX: -c.minX,
    minZ: -c.maxZ, maxZ: -c.minZ,
    team: 'B',
    ramp: c.ramp && { ...c.ramp, k: -c.ramp.k },
  };
}

const floor = {
  minX: -72, maxX: 72, minY: -2, maxY: 0, minZ: -44, maxZ: 44,
  kind: 'floor', team: 'neutral', center: true, ramp: null,
};

export const colliders = [
  floor,
  ...authored,
  ...authored.filter((c) => !c.center).map(rotated),
];

export const spawns = {
  A: { x: -66, y: 4, z: 0, yaw: -Math.PI / 2 }, // facing +x
  B: { x: 66, y: 4, z: 0, yaw: Math.PI / 2 },   // facing -x
};
