#!/usr/bin/env bash
set -euo pipefail

output_dir=${1:?usage: build-android.sh <generated-jniLibs-directory>}
sdk_root=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
ndk_root=${ANDROID_NDK_HOME:-}
if [[ -z "$ndk_root" ]]; then
  [[ -n "$sdk_root" ]] || { echo "Android SDK root is required (ANDROID_SDK_ROOT or ANDROID_HOME)." >&2; exit 2; }
  ndk_root="$sdk_root/ndk/27.2.12479018"
fi

host_tag=darwin-x86_64
case "$(uname -s)" in
  Linux) host_tag=linux-x86_64 ;;
  *) ;;
esac
toolchain_bin="$ndk_root/toolchains/llvm/prebuilt/$host_tag/bin"
[[ -x "$toolchain_bin/clang" ]] || { echo "Android NDK toolchain is missing: $toolchain_bin" >&2; exit 2; }

cargo_bin="$(command -v cargo)"
if [[ -x "$HOME/.cargo/bin/cargo" ]]; then
  cargo_bin="$HOME/.cargo/bin/cargo"
  export PATH="$HOME/.cargo/bin:$PATH"
fi
native_dir="$(cd "$(dirname "$0")" && pwd)"

build_target() {
  local target="$1"
  local abi="$2"
  local linker="$3"
  local variable
  variable="$(printf '%s' "$target" | tr '[:lower:]-' '[:upper:]_')"
  env "CARGO_TARGET_${variable}_LINKER=$toolchain_bin/$linker" \
    "$cargo_bin" build --manifest-path "$native_dir/Cargo.toml" --locked --release --target "$target"
  mkdir -p "$output_dir/$abi"
  cp "$native_dir/target/$target/release/libk3ncrypt_android_crypto.so" "$output_dir/$abi/"
}

build_target aarch64-linux-android arm64-v8a aarch64-linux-android24-clang
build_target armv7-linux-androideabi armeabi-v7a armv7a-linux-androideabi24-clang
build_target x86_64-linux-android x86_64 x86_64-linux-android24-clang
build_target i686-linux-android x86 i686-linux-android24-clang
