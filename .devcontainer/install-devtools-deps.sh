#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -eq 0 ]]; then
  apt_get=(apt-get)
elif command -v sudo >/dev/null 2>&1; then
  apt_get=(sudo apt-get)
else
  echo "Installing DevTools libraries requires root or sudo." >&2
  exit 1
fi

"${apt_get[@]}" update

packages=(
  libnss3
  libx11-xcb1
  libxcomposite1
  libxdamage1
  libxfixes3
  libxrandr2
  libgbm1
  libxkbcommon0
)

add_package_variant() {
  local noble_package="$1"
  local standard_package="$2"

  if apt-cache show "$noble_package" 2>/dev/null | grep -Fqx "Package: $noble_package"; then
    packages+=("$noble_package")
  else
    packages+=("$standard_package")
  fi
}

add_package_variant libatk1.0-0t64 libatk1.0-0
add_package_variant libatk-bridge2.0-0t64 libatk-bridge2.0-0
add_package_variant libasound2t64 libasound2
add_package_variant libgtk-3-0t64 libgtk-3-0

"${apt_get[@]}" install -y "${packages[@]}"
