#pragma once

#include <cstdint>

namespace desk::display {

struct MessageLayout {
  static constexpr uint8_t MaxLines = 16;

  struct Line {
    const char* text;
    uint8_t length;
  };

  Line lines[MaxLines]{};
  uint8_t count = 0;
  bool truncated = false;
};

// The returned spans borrow the input. CR, LF and CRLF are line breaks.
MessageLayout wrapMessage(const char* text, uint8_t columns, uint8_t rows);

}  // namespace desk::display
