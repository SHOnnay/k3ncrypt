#!/usr/bin/env bash
set -euo pipefail

sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"

if ! command -v gradle >/dev/null 2>&1; then
  echo "Gradle is required to run connected Android tests." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
"$script_dir/verify-disposable-avd.sh"
gradle -p "$(cd "$script_dir/.." && pwd)" :app:connectedDebugAndroidTest
