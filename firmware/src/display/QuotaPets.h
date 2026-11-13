#pragma once

#include <stdint.h>

namespace desk::display::quotaPet {

constexpr int X = 16;
constexpr int Y = 16;
constexpr int Size = 16;
constexpr int Scale = 3;
constexpr uint32_t CycleMs = 3600;

struct Sprite {
  uint32_t shell, glow, detail;
  char rows[Size][Size + 1];
};

constexpr Sprite Codex{0x8975EB, 0x9BEAFF, 0x302458, {
    ".......g........",
    ".......s........",
    "......sss.......",
    "....ssssssss....",
    "...ssssssssss...",
    "..ssddddddddss..",
    ".sssddgddgddsss.",
    ".sssddgddgddsss.",
    "..ssddddddddss..",
    "...ssssssssss...",
    "....ssssssss....",
    ".....s...s......",
    "....sss.sss.....",
    "...ssss.ssss....",
    "................",
    "................",
}};

constexpr Sprite Claude{0xDF8054, 0xFFE2AC, 0x582C21, {
    "...s...s....s...",
    "................",
    "s.....ssss.....s",
    "....ssssssss....",
    "...ssssssssss...",
    "...ssssssssss...",
    "..ssssssssssss..",
    "s.sssdssssds.s.s",
    "..ssggssssggss..",
    "..ssssddddssss..",
    "...ssssssssss...",
    "...ssssssssss...",
    "....ssssssss....",
    "s.....ssss.....s",
    "................",
    "...s...s....s...",
}};

constexpr bool moving(uint32_t elapsedMs) {
  const uint32_t phase = elapsedMs % CycleMs;
  return phase >= 1600 && phase < 1900;
}

constexpr char pixel(bool claude, bool motion, int x, int y) {
  if (motion && !claude) {
    if (y == 0 && (x == 6 || x == 8)) return 'g';
    if (y == 6 && (x == 6 || x == 9)) return 'd';
  }
  if (motion && claude) {
    if (y == 7 && (x == 5 || x == 10)) return 's';
    if (y == 8 && (x == 5 || x == 10)) return 'd';
    if (y == 1 && (x == 2 || x == 13)) return 'g';
    if (y == 14 && (x == 2 || x == 13)) return 'g';
  }
  return (claude ? Claude : Codex).rows[y][x];
}

}  // namespace desk::display::quotaPet
