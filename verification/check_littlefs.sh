#!/usr/bin/env bash
# Verify the ESP32 no_ota.csv LittleFS image against the dashboard source.
set -euo pipefail

if [[ $# != 1 || -z "${PLATFORMIO_CORE_DIR:-}" || -z "${SMART_DESK_ROOT:-}" ]]; then
  printf 'Source .dev/env.sh, then run %s IMAGE.bin\n' "$0" >&2
  exit 2
fi

image="$1"
tool="$PLATFORMIO_CORE_DIR/packages/tool-mklittlefs/mklittlefs"
dashboard="$SMART_DESK_ROOT/web/public"
image_size=$((0x1E0000))
actual_size="$(wc -c < "$image" | tr -d '[:space:]')"
if [[ "$actual_size" != "$image_size" ]]; then
  printf 'LittleFS has %s bytes, expected %s\n' "$actual_size" "$image_size" >&2
  exit 1
fi

unpacked="$(mktemp -d "${TMPDIR%/}/smart-desk-fs.XXXXXXXX")"
trap 'rm -rf "$unpacked"' EXIT
"$tool" -u "$unpacked" -p 256 -b 4096 -s "$image_size" "$image"
for asset in index.html styles.css preview.js app.js; do
  if [[ ! -s "$unpacked/$asset" ]]; then
    printf 'Missing or empty LittleFS asset /%s\n' "$asset" >&2
    exit 1
  fi
done
diff -r -x '.DS_Store' "$dashboard" "$unpacked"
printf 'PASS LittleFS image %s bytes, assets match web/public\n' "$actual_size"
