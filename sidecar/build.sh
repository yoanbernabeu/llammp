#!/bin/bash
# Builds the sidecar into app/bin/, where the Electron app looks for it.
#
# LLAMMP_UNIVERSAL=1 produces a universal binary (arm64 + x86_64) for release builds.
set -euo pipefail

cd "$(dirname "$0")"
OUT="../app/bin"
mkdir -p "$OUT"

SOURCES=(Emitter.swift Scripts.swift MusicBridge.swift main.swift)

# -swift-version 5: Swift 6 strict concurrency would reject the notification closures
# capturing self, with nothing to gain in a single-threaded process where everything
# converges on the main queue.
COMMON=(-O -swift-version 5)

if [[ "${LLAMMP_UNIVERSAL:-0}" == "1" ]]; then
    swiftc "${COMMON[@]}" -target arm64-apple-macos12 "${SOURCES[@]}" -o "$OUT/llammp-sidecar-arm64"
    swiftc "${COMMON[@]}" -target x86_64-apple-macos12 "${SOURCES[@]}" -o "$OUT/llammp-sidecar-x86_64"
    lipo -create -output "$OUT/llammp-sidecar" \
        "$OUT/llammp-sidecar-arm64" "$OUT/llammp-sidecar-x86_64"
    rm -f "$OUT/llammp-sidecar-arm64" "$OUT/llammp-sidecar-x86_64"
    echo "sidecar built (universal) -> $OUT/llammp-sidecar"
else
    swiftc "${COMMON[@]}" "${SOURCES[@]}" -o "$OUT/llammp-sidecar"
    echo "sidecar built -> $OUT/llammp-sidecar"
fi
