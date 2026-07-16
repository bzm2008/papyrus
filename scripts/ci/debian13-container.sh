#!/usr/bin/env bash

set -euo pipefail

if [[ "$(id -u)" != "0" ]]; then
  echo "Debian 13 validation must run as root inside its disposable container." >&2
  exit 1
fi

if [[ ! -f package.json || ! -f src-tauri/Cargo.toml ]]; then
  echo "Run this script from the Papyrus repository root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
export CARGO_TERM_COLOR=always

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  build-essential \
  curl \
  file \
  git \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  libwebkit2gtk-4.1-dev \
  libxdo-dev \
  nodejs \
  npm \
  patchelf \
  pkg-config \
  xz-utils

if ! command -v cargo >/dev/null 2>&1; then
  curl --fail --location --proto '=https' --tlsv1.2 https://sh.rustup.rs -o /tmp/rustup-init.sh
  sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain 1.95.0
fi

export PATH="${HOME}/.cargo/bin:${PATH}"

node --version
npm --version
cargo --version

npm ci
npm run version:check
npm run build
cargo check --manifest-path src-tauri/Cargo.toml --locked
npm run tauri -- build --config src-tauri/ci/linux.json

deb_bundle="$(find src-tauri/target/release/bundle/deb -maxdepth 1 -type f -name '*.deb' -print -quit)"
appimage_bundle="$(find src-tauri/target/release/bundle/appimage -maxdepth 1 -type f -name '*.AppImage' -print -quit)"

if [[ -z "${deb_bundle}" || -z "${appimage_bundle}" ]]; then
  echo "Debian 13 bundle validation expected both a DEB and an AppImage." >&2
  exit 1
fi

echo "PASS Debian 13 container built ${deb_bundle} and ${appimage_bundle}"
