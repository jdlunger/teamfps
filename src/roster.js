// The playable characters. Pure data with no rendering dependency, so tests can
// use it directly. `tuning` overrides the defaults in physics.js, `weapon` is read
// by combat.js, `camera` overrides the third-person camera in main.js, and
// `abilities` is what the select screen and controls list display.

const degrees = (d) => (d * Math.PI) / 180;

export const roster = [
  {
    id: 'recruit',
    name: 'Recruit',
    role: 'Baseline',
    blurb: 'The standard runner, for feeling out the level. Carries no weapon yet.',
    tuning: {},
    abilities: [],
  },
  {
    id: 'shade',
    name: 'Shade',
    role: 'Melee ninja',
    blurb: 'Fast and light. Has to get close, but can reach ledges nobody else can jump to.',
    tuning: {
      radius: 0.36,
      height: 1.7,
      walkSpeed: 8.5,
      sprintSpeed: 12,
      airAccel: 26,
      jumpVelocity: 8.8,
      airJumps: 1,
      dash: { speed: 30, time: 0.2, cooldown: 2.5, damage: 50 },
    },
    weapon: { type: 'sword', damage: 35, range: 2.6, arc: degrees(110), interval: 0.42, hitDelay: 0.08 },
    camera: { eyeHeight: 1.5 },
    abilities: [
      { input: 'Left click', name: 'Katana', text: 'Wide slash in front of you. Hold to keep swinging.' },
      { input: 'Right click', name: 'Cutting dash', text: 'Dash where you aim, cutting everything you pass through.' },
      { input: 'Space ×2', name: 'Double jump', text: 'Jump again in mid-air.' },
    ],
  },
  {
    id: 'tonne',
    name: 'Tonne',
    role: 'Wrecking ball',
    blurb: 'A rolling steel sphere. Slow to get going, hard to stop, and hits harder the faster it moves.',
    tuning: {
      radius: 0.9,
      height: 1.8,
      momentum: true,
      walkSpeed: 11,
      sprintSpeed: 15,
      groundAccel: 26,
      airAccel: 9,
      rollFriction: 5,
      jumpVelocity: 7.5,
      bounce: 0.4,
      maxSpeed: 30,
      grapple: { range: 50, reel: 10, minLength: 3, maxPull: 20, cooldown: 0.4 },
    },
    weapon: { type: 'ram', minSpeed: 9, damagePerSpeed: 4, immunity: 0.6 },
    camera: { distance: 6, eyeHeight: 2.3 },
    abilities: [
      { input: 'Hold left click', name: 'Grappling hook', text: 'Hook any surface in range, then swing and reel in. Let go to fly off with your speed.' },
      { input: 'Passive', name: 'Demolition', text: 'Run into targets. Damage grows with speed.' },
    ],
  },
  {
    id: 'skylark',
    name: 'Skylark',
    role: 'Jetpack gunner',
    blurb: 'Takes the high ground and shoots down from it, but has to land to refuel.',
    tuning: {
      walkSpeed: 6.5,
      sprintSpeed: 9,
      airAccel: 24,
      jet: { thrust: 44, maxRise: 7, duration: 2.4, recharge: 3.5 },
    },
    weapon: { type: 'carbine', damage: 12, interval: 0.12, range: 120 },
    abilities: [
      { input: 'Left click', name: 'Carbine', text: 'Hold to fire. Hits instantly at any range.' },
      { input: 'Hold Space', name: 'Jetpack', text: 'Thrust upward in the air. Refuels on the ground.' },
    ],
  },
];
