#!/usr/bin/env bash
set -euo pipefail

echo "Building My Web Cam Android APK..."
if [ ! -f "./gradlew" ]; then
  gradle wrapper --gradle-version 8.9
fi

./gradlew assembleDebug assembleRelease
echo "Debug APK:   app/build/outputs/apk/debug/app-debug.apk"
echo "Release APK: app/build/outputs/apk/release/app-release-unsigned.apk"
