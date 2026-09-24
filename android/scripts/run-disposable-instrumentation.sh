#!/usr/bin/env bash
set -euo pipefail

expected_avd="k3ncrypt-instrumentation-disposable"
sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
adb_bin="${ADB:-${sdk_root:+$sdk_root/platform-tools/adb}}"

if [[ -z "$adb_bin" || ! -x "$adb_bin" ]]; then
  echo "Set ANDROID_HOME or ANDROID_SDK_ROOT to an installed Android SDK." >&2
  exit 2
fi
if ! command -v gradle >/dev/null 2>&1; then
  echo "Gradle is required to run connected Android tests." >&2
  exit 2
fi

# Never run connected instrumentation while the persistent device is booting
# or attached. The Android Gradle/UTP test runner uninstalls the target APK.
if pgrep -f '[e]mulator.*-avd[ =]k3ncrypt-persistent-beta' >/dev/null 2>&1; then
  echo "Stop k3ncrypt-persistent-beta before running instrumentation tests." >&2
  exit 3
fi

mapfile_compat() {
  "$adb_bin" devices | awk 'NR > 1 && $2 == "device" { print $1 }'
}
devices="$(mapfile_compat)"
device_count="$(printf '%s\n' "$devices" | awk 'NF { count++ } END { print count+0 }')"
if [[ "$device_count" -ne 1 ]]; then
  echo "Instrumentation requires exactly one attached Android device: $expected_avd." >&2
  exit 3
fi

serial="$(printf '%s\n' "$devices" | awk 'NF { print; exit }')"
avd_name="$("$adb_bin" -s "$serial" emu avd name | sed -n '1s/\r$//p')"
if [[ "$avd_name" != "$expected_avd" ]]; then
  echo "Refusing destructive instrumentation on AVD '$avd_name'; expected '$expected_avd'." >&2
  exit 3
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
gradle -p "$(cd "$script_dir/.." && pwd)" :app:connectedDebugAndroidTest
