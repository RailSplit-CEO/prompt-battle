const NAMES = [
  'Axe', 'Bolt', 'Claw', 'Dart', 'Edge', 'Fang', 'Grit', 'Hex',
  'Ink', 'Jade', 'Knox', 'Lux', 'Mace', 'Nyx', 'Onyx', 'Pike',
  'Quill', 'Rust', 'Scar', 'Tusk', 'Urn', 'Vex', 'Wren', 'Zap',
  'Ash', 'Blaze', 'Crow', 'Dusk', 'Echo', 'Flint',
];

let usedNames = new Set<string>();

export function generateCharacterName(): string {
  const available = NAMES.filter(n => !usedNames.has(n));
  if (available.length === 0) {
    usedNames.clear();
    return generateCharacterName();
  }
  const name = available[Math.floor(Math.random() * available.length)];
  usedNames.add(name);
  return name;
}

export function resetNames() {
  usedNames.clear();
}
