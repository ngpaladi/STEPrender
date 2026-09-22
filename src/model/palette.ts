// A pleasant, distinguishable default palette used when a source file gives no
// per-face color of its own (e.g. plain STL, or STEP faces without color).
const DEFAULT_PALETTE = [
  0xb8bcc4, 0x8fb3d9, 0xd9a86c, 0x8fcf9f, 0xd98f9f, 0xc7a8e0, 0xd9c96c, 0x6cc7c2,
];

export function defaultColorFor(index: number): number {
  return DEFAULT_PALETTE[index % DEFAULT_PALETTE.length];
}
