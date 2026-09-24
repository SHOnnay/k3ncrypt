#!/usr/bin/env bash
set -euo pipefail

expected_avd="k3ncrypt-persistent-beta"
serial="${K3NCRYPT_PERSISTENT_SERIAL:-}"
sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
adb_bin="${ADB:-${sdk_root:+$sdk_root/platform-tools/adb}}"
apk="$(cd "$(dirname "$0")/.." && pwd)/app/build/outputs/apk/debug/app-debug.apk"

if [[ -z "$serial" ]]; then
  echo "Set K3NCRYPT_PERSISTENT_SERIAL to the persistent AVD's ADB serial." >&2
  exit 2
fi
if [[ -z "$adb_bin" || ! -x "$adb_bin" ]]; then
  echo "Set ANDROID_HOME or ANDROID_SDK_ROOT to an installed Android SDK." >&2
  exit 2
fi
if [[ ! -f "$apk" ]]; then
  echo "Debug APK not found. Build :app:assembleDebug first." >&2
  exit 2
fi

state="$("$adb_bin" -s "$serial" get-state 2>/dev/null || true)"
if [[ "$state" != "device" ]]; then
  echo "Persistent AVD serial is not connected: $serial" >&2
  exit 3
fi
avd_name="$("$adb_bin" -s "$serial" emu avd name | sed -n '1s/\r$//p')"
if [[ "$avd_name" != "$expected_avd" ]]; then
  echo "Refusing persistent update on AVD '$avd_name'; expected '$expected_avd'." >&2
  exit 3
fi

# Intentionally use only in-place replacement. Never clear or uninstall.
"$adb_bin" -s "$serial" install -r "$apk"
