#include "display/MessageLayout.h"

namespace desk::display {
namespace {

bool isLineBreak(char value) {
  return value == '\n' || value == '\r';
}

bool isSpace(char value) {
  return value == ' ' || value == '\t';
}

}  // namespace

MessageLayout wrapMessage(const char* text, uint8_t columns, uint8_t rows) {
  MessageLayout result;
  if (!text || !*text || columns == 0 || rows == 0) {
    return result;
  }
  if (rows > MessageLayout::MaxLines) {
    rows = MessageLayout::MaxLines;
  }

  const char* next = text;
  bool pendingLine = true;
  while (pendingLine && result.count < rows) {
    while (isSpace(*next)) {
      ++next;
    }
    const char* start = next;
    const char* lastSpace = nullptr;
    while (*next && !isLineBreak(*next) && next - start < columns) {
      if (next > start && isSpace(*next) && !isSpace(next[-1])) {
        lastSpace = next;
      }
      ++next;
    }

    if (*next && !isLineBreak(*next) && !isSpace(*next) && lastSpace) {
      next = lastSpace;
    }
    const char* end = next;
    while (end > start && isSpace(end[-1])) {
      --end;
    }
    result.lines[result.count++] = {start, static_cast<uint8_t>(end - start)};

    while (isSpace(*next)) {
      ++next;
    }
    pendingLine = *next != '\0';
    if (isLineBreak(*next)) {
      if (*next++ == '\r' && *next == '\n') {
        ++next;
      }
    }
  }
  result.truncated = pendingLine;
  return result;
}

}  // namespace desk::display
