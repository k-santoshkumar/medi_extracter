#!/usr/bin/env bash
set -euo pipefail

# Build the Android APK for the Capacitor frontend.
# Requirements:
#   - Java JDK 17+
#   - Android SDK
#   - environment variables set by Android Studio / local sdk manager
#
# Run:
#   bash scripts/build-android-apk.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d frontend ]]; then
  echo "Frontend directory not found."
  exit 1
fi

if [[ ! -d frontend/android ]]; then
  echo "Syncing Capacitor Android project..."
  cd frontend
  npm install --legacy-peer-deps >/dev/null 2>&1 || true
  npx cap sync android
  cd "$ROOT_DIR"
fi

cd frontend

echo "==> Building production frontend bundle..."
npm run build

if [[ ! -d android ]]; then
  echo "Android project missing. Run 'npx cap add android' first."
  exit 1
fi

# Sync native project after build
npx cap sync android

# Build the APK with Gradle
cd android
./gradlew assembleDebug

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [[ -f "$APK_PATH" ]]; then
  echo "==> APK created successfully: $APK_PATH"
else
  echo "APK build failed. Expected file not found: $APK_PATH"
  exit 1
fi
