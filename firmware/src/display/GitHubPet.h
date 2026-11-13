#pragma once

#include <stdint.h>

namespace desk::display::pet {

constexpr int X = 21;
constexpr int Y = 24;
constexpr int Scale = 2;
constexpr int Width = 25;
constexpr int Height = 31;
constexpr uint32_t CycleMs = 4800;

constexpr uint32_t Background = 0xF8DB6A;
constexpr uint32_t Ink = 0x171913;        // K
constexpr uint32_t CapBrown = 0x422D1B;   // H
constexpr uint32_t CapSlate = 0x2F3736;   // D
constexpr uint32_t ClothShade = 0xBAAE94; // L
constexpr uint32_t Skin = 0xFCC695;       // S
constexpr uint32_t SkinShade = 0xE89D70;  // T
constexpr uint32_t Jacket = 0xEFE4C9;     // W
constexpr uint32_t Shirt = 0xF89F31;      // O
constexpr uint32_t Zipper = 0xBA4713;     // R

// Sampled at the original pixel centers of .dev/references/zahnft.jpg.
// The cap badge is simplified to three bars at this resolution.
constexpr char Pixels[Height][Width + 1] = {
    "..........KKKKKKKK.......",
    ".......KKKHHHHHHHHK......",
    "......KHHHHHHKKKKKKK.....",
    ".....KHHHHHHKLLDDDDLK....",
    ".....KHHHKKKKLLLLLLLK....",
    ".....KHHKDDDKLLDDDDLK....",
    ".....KKKDDDDKDLLLLLLK....",
    "....KDDDDDDDKLLDDDDLK....",
    "....KKKKKKKKKKKKKKKKKKK..",
    ".....KHHHKTSSSSSSSSSK....",
    ".....KKKHKSSKKKSSSKKK....",
    ".....KSSKKSSSSKSSSKSK....",
    ".....KSTSKSSSSKSSSKSK....",
    ".....KTTSSSSSSSSSSSSK....",
    "......KTTSSSSSSSSTKSK....",
    ".......KKTSSSSSSSSSSK....",
    "........KTSSSSKKKKKSK....",
    "........KSTSSSSSSSSK.....",
    ".......KKSSKKSSSSSK......",
    "......KLKKSTKKKKKK.......",
    "......KLWKKKTTTKLLK......",
    ".....KKLWWWKKKKKLLLK.....",
    "....KLWSSWWWWKRKKWWKK....",
    "...KLWWWWWWWKKRDDWKWWK...",
    "..KLLWWWWWWKKDRDDKWWWWK..",
    "..KLWWWWWWWKOORKOKWWWWK..",
    ".KWLWWWWWWWKOORKOKWWWWWK.",
    ".KLWWWWWWWWKOORKOKLWWWWK.",
    ".KSWWWWLWWKOOORKOOKWWWWK.",
    "KLLWWWWLWWKOOORKOOKWWWWWK",
    "KLWWWWSLWWKOOORKOOKWWWWWK",
};

enum class Pose : uint8_t { Idle, Blink, Smile };

constexpr Pose poseAt(uint32_t elapsedMs) {
  const uint32_t phase = elapsedMs % CycleMs;
  if (phase >= 1400 && phase < 1600) {
    return Pose::Blink;
  }
  if (phase >= 3000 && phase < 3460) {
    return Pose::Smile;
  }
  return Pose::Idle;
}

constexpr char pixel(Pose pose, int x, int y) {
  if (pose == Pose::Blink && y >= 10 && y <= 12 &&
      ((x >= 12 && x <= 14) || (x >= 18 && x <= 19))) {
    return y == 12 ? 'K' : 'S';
  }
  if (pose == Pose::Smile) {
    if (y == 16 && x >= 14 && x <= 18) {
      return x == 14 || x == 18 ? 'K' : 'S';
    }
    if (y == 17 && x >= 15 && x <= 17) {
      return 'K';
    }
  }
  return Pixels[y][x];
}

constexpr uint32_t color(char value) {
  switch (value) {
    case 'K': return Ink;
    case 'H': return CapBrown;
    case 'D': return CapSlate;
    case 'L': return ClothShade;
    case 'S': return Skin;
    case 'T': return SkinShade;
    case 'W': return Jacket;
    case 'O': return Shirt;
    case 'R': return Zipper;
    default: return Background;
  }
}

}  // namespace desk::display::pet
