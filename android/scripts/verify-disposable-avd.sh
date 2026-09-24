#!/usr/bin/env bash
set -euo pipefail

expected_avd="k3ncrypt-instrumentation-disposable"
sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
adb_bin="${ADB:-${sdk_root:+$sdk_root/platform-tools/adb}}"

if [[ -z "$adb_bin" || ! -x "$adb_bin" ]]; then
  echo "Set ANDROID_HOME or ANDROID_SDK_ROOT to an installed Android SDK." >&2
  exit 2
fi

# Refuse destructive instrumentation while the persistent emulator is running,
# regardless of which ADB serial Gradle would otherwise select.
if pgrep -f '[e]mulator.*-avd[ =]k3ncrypt-persistent-beta' >/dev/null 2>&1; then
  echo "Refusing instrumentation while k3ncrypt-persistent-beta is running." >&2
  exit 3
fi

devices="$("$adb_bin" devices | awk 'NR > 1 && $2 == "device" { print $1 }')"
count="$(printf '%s\n' "$devices" | awk 'NF { n++ } END { print n+0 }')"
if [[ "$count" -ne 1 ]]; then
  echo "Instrumentation requires exactly one attached Android device: $expected_avd." >&2
  exit 3
fi

serial="$(printf '%s\n' "$devices" | awk 'NF { print; exit }')"
avd_name="$("$adb_bin" -s "$serial" emu avd name | sed -n '1s/\r$//p')"
if [[ "$avd_name" != "$expected_avd" ]]; then
  echo "Refusing destructive instrumentation on AVD '$avd_name'; expected '$expected_avd'." >&2
  exit 3
fi

echo "Disposable instrumentation target verified: $expected_avd"
