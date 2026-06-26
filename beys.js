// beys.js — Bey roster data.
// Stats are 1-10. "type" drives AI movement personality (attack/defense/stamina/balance),
// mirroring how the series usually characterizes each bey. Colors/shapes in game.js are
// abstract placeholders meant to be swapped for your own art/models later. Move names are
// original, anime-flavored re-imaginings rather than exact lines from the show.

const BEY_ROSTER = [
  {
    id: 'dragoon',
    name: 'Dragoon',
    element: 'Wind',
    type: 'attack',
    colors: { primary: '#e8ecf0', secondary: '#c3c9d2', bit: '#f2c829' },
    emblem: 'spiral',
    stats: { attack: 9, defense: 3, stamina: 5, speed: 9 },
    moves: {
      base: { name: 'Quick Gust', power: 1.3, charge: 5, cooldown: 8, duration: 0.6 },
      special: { name: 'Hurricane Fury', power: 2.2, charge: 11, cooldown: 13, duration: 0.9 }
    }
  },
  {
    id: 'dranzer',
    name: 'Dranzer',
    element: 'Fire',
    type: 'attack',
    colors: { primary: '#2563c4', secondary: '#173f86', bit: '#f2c829' },
    emblem: 'flame',
    stats: { attack: 8, defense: 4, stamina: 6, speed: 8 },
    moves: {
      base: { name: 'Flame Beak', power: 1.3, charge: 5, cooldown: 8, duration: 0.6 },
      special: { name: 'Blazing Phoenix Wings', power: 2.0, charge: 11, cooldown: 13, duration: 0.9 }
    }
  },
  {
    id: 'blackdranzer',
    name: 'Black Dranzer',
    element: 'Dark Fire',
    type: 'attack',
    colors: { primary: '#1a1a1d', secondary: '#0c0c0e', bit: '#d4322a' },
    emblem: 'flame-dark',
    stats: { attack: 10, defense: 3, stamina: 4, speed: 8 },
    moves: {
      base: { name: 'Dark Claw', power: 1.4, charge: 5, cooldown: 8, duration: 0.6 },
      special: { name: 'Black Phoenix Eclipse', power: 2.4, charge: 11, cooldown: 13, duration: 0.9 }
    }
  },
  {
    id: 'driger',
    name: 'Driger',
    element: 'Wind',
    type: 'balance',
    colors: { primary: '#9aa0a8', secondary: '#6e747c', bit: '#2a7fd4' },
    emblem: 'stripes',
    stats: { attack: 6, defense: 6, stamina: 6, speed: 7 },
    moves: {
      base: { name: 'Lightning Paw', power: 1.3, charge: 5, cooldown: 8, duration: 0.6 },
      special: { name: 'White Tiger Roar', power: 2.0, charge: 11, cooldown: 13, duration: 0.9 }
    }
  },
  {
    id: 'draciel',
    name: 'Draciel',
    element: 'Water',
    type: 'defense',
    colors: { primary: '#3a9d4e', secondary: '#22692f', bit: '#e08a2a' },
    emblem: 'hex',
    stats: { attack: 3, defense: 10, stamina: 8, speed: 3 },
    moves: {
      base: { name: 'Iron Shell', power: 1.15, charge: 5, cooldown: 8, duration: 0.6 },
      special: { name: 'Abyssal Wall', power: 1.8, charge: 11, cooldown: 13, duration: 0.9 }
    }
  },
  {
    id: 'wolborg',
    name: 'Wolborg',
    element: 'Ice',
    type: 'stamina',
    colors: { primary: '#5a6068', secondary: '#3e434a', bit: '#f2c829' },
    emblem: 'snowflake',
    stats: { attack: 4, defense: 6, stamina: 10, speed: 5 },
    moves: {
      base: { name: 'Glacial Bite', power: 1.3, charge: 5, cooldown: 8, duration: 0.6 },
      special: { name: 'Pack Blizzard', power: 2.0, charge: 11, cooldown: 13, duration: 0.9 }
    }
  },
  {
    id: 'zeus',
    name: 'Zeus',
    element: 'Light',
    type: 'balance',
    colors: { primary: '#1a1a1d', secondary: '#0c0c0e', bit: '#f2c829' },
    emblem: 'sunburst',
    stats: { attack: 6, defense: 7, stamina: 7, speed: 5 },
    moves: {
      base: { name: 'Golden Bolt', power: 1.3, charge: 5, cooldown: 8, duration: 0.6 },
      special: { name: 'Olympus Judgment', power: 2.3, charge: 11, cooldown: 13, duration: 0.9 }
    }
  }
];

// Overall "power score" used only for the instant CPU-vs-CPU simulation
// (the player's own matches are resolved live by the physics/3D engine instead).
function beyPowerScore(bey) {
  const s = bey.stats;
  return s.attack * 1.1 + s.defense * 0.9 + s.stamina * 0.8 + s.speed * 1.0;
}
