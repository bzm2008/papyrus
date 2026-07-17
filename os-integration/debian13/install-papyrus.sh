#!/bin/sh
# Install Papyrus 1.0.0 on Debian 13 (and compatible Debian-based systems).
# The application is kept under /opt/papyrus. User data remains in the
# standard per-user XDG directories and is never removed by this script.

set -eu

APP_ROOT=${PAPYRUS_INSTALL_ROOT:-/opt/papyrus}
BIN_LINK=${PAPYRUS_BIN_LINK:-/usr/bin/papyrus}
DESKTOP_DIR=${PAPYRUS_DESKTOP_DIR:-/usr/share/applications}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

usage() {
    cat <<'EOF'
Usage: install-papyrus.sh [Papyrus_1.0.0_amd64.deb|Papyrus_1.0.0_amd64.AppImage]

Install Papyrus into /opt/papyrus and create /usr/bin/papyrus.
When no file is supplied, the script searches its directory and the current
directory for a Papyrus .deb or .AppImage asset.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
fi

# /opt and /usr require elevated privileges. Re-enter through sudo while
# retaining the original argument path; no user files are written as root.
if [ "$(id -u)" -ne 0 ]; then
    if ! command -v sudo >/dev/null 2>&1; then
        echo "Papyrus installation requires root or sudo." >&2
        exit 1
    fi
    exec sudo -E "$0" "$@"
fi

source_file=${1:-}
if [ -z "$source_file" ]; then
    for candidate in \
        "$SCRIPT_DIR"/Papyrus_*.deb \
        "$SCRIPT_DIR"/Papyrus_*.AppImage \
        "$SCRIPT_DIR"/papyrus_*.deb \
        "$SCRIPT_DIR"/papyrus_*.AppImage \
        "$(pwd)"/Papyrus_*.deb \
        "$(pwd)"/Papyrus_*.AppImage \
        "$(pwd)"/papyrus_*.deb \
        "$(pwd)"/papyrus_*.AppImage; do
        if [ -f "$candidate" ]; then
            source_file=$candidate
            break
        fi
    done
fi

if [ -z "$source_file" ] || [ ! -f "$source_file" ]; then
    echo "No Papyrus .deb or .AppImage was found." >&2
    usage >&2
    exit 1
fi

case "$source_file" in
    *.deb|*.DEB)
        package_type=deb
        if ! command -v dpkg-deb >/dev/null 2>&1; then
            echo "dpkg-deb is required to install a Debian package." >&2
            exit 1
        fi
        ;;
    *.AppImage|*.appimage)
        package_type=appimage
        ;;
    *)
        echo "Unsupported Papyrus asset: $source_file" >&2
        echo "Expected a .deb or .AppImage file." >&2
        exit 1
        ;;
esac

source_file=$(readlink -f -- "$source_file")
mkdir -p "$APP_ROOT"

stage=$(mktemp -d "${TMPDIR:-/tmp}/papyrus-install.XXXXXX")
cleanup() {
    rm -rf -- "$stage"
}
trap cleanup EXIT INT TERM

if [ "$package_type" = "deb" ]; then
    # Extract into Papyrus' private root. This avoids letting dpkg place files
    # outside /opt and makes upgrades independent of the system package DB.
    dpkg-deb -x "$source_file" "$stage"
else
    install -Dm755 "$source_file" "$stage/Papyrus.AppImage"
fi

# Copy only the staged application. Existing files are left in place when not
# present in the new asset, and no user data directory is removed.
cp -a "$stage/." "$APP_ROOT/"

cat >"$APP_ROOT/launch-papyrus" <<'EOF'
#!/bin/sh
set -eu
APP_ROOT=/opt/papyrus

if [ -x "$APP_ROOT/Papyrus.AppImage" ]; then
    exec "$APP_ROOT/Papyrus.AppImage" "$@"
fi

# Tauri .deb assets normally contain one of these paths after extraction.
for candidate in \
    "$APP_ROOT/usr/bin/papyrus" \
    "$APP_ROOT/usr/lib/papyrus/papyrus" \
    "$APP_ROOT/usr/lib/papyrus/papyrus-bin" \
    "$APP_ROOT/usr/bin/Papyrus" \
    "$APP_ROOT/Papyrus"; do
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then
        # Avoid following a package symlink back to this launcher.
        resolved=$(readlink -f -- "$candidate" 2>/dev/null || true)
        if [ "$resolved" = "/usr/bin/papyrus" ] || [ "$resolved" = "$APP_ROOT/launch-papyrus" ]; then
            continue
        fi
        cd "$APP_ROOT"
        exec "$candidate" "$@"
    fi
done

echo "Papyrus executable was not found under $APP_ROOT." >&2
exit 1
EOF
chmod 0755 "$APP_ROOT/launch-papyrus"

# Keep a pre-existing command available for recovery instead of deleting it.
if [ -e "$BIN_LINK" ] || [ -L "$BIN_LINK" ]; then
    current_target=$(readlink -f -- "$BIN_LINK" 2>/dev/null || true)
    if [ "$current_target" != "$APP_ROOT/launch-papyrus" ]; then
        backup="$BIN_LINK.papyrus-backup"
        if [ ! -e "$backup" ] && [ ! -L "$backup" ]; then
            mv -- "$BIN_LINK" "$backup"
        else
            rm -f -- "$BIN_LINK"
        fi
    fi
fi
if [ ! -e "$BIN_LINK" ] && [ ! -L "$BIN_LINK" ]; then
    ln -s "$APP_ROOT/launch-papyrus" "$BIN_LINK"
fi

install -Dm644 "$SCRIPT_DIR/papyrus.desktop" "$DESKTOP_DIR/papyrus.desktop"

# If the extracted DEB contains a Papyrus icon, expose one standard icon path
# so desktop environments can display it. AppImage installs simply use the
# desktop environment's generic application icon when no icon is available.
icon_source=
for candidate in \
    "$APP_ROOT/usr/share/icons/hicolor/128x128/apps/papyrus.png" \
    "$APP_ROOT/usr/share/icons/hicolor/256x256/apps/papyrus.png" \
    "$APP_ROOT/usr/share/icons/hicolor/128x128@2x/apps/papyrus.png" \
    "$APP_ROOT/usr/share/pixmaps/papyrus.png"; do
    if [ -f "$candidate" ]; then
        icon_source=$candidate
        break
    fi
done
if [ -n "$icon_source" ]; then
    install -Dm644 "$icon_source" /usr/share/icons/hicolor/128x128/apps/papyrus.png
fi
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

echo "Papyrus installed at $APP_ROOT."
echo "Launch with: papyrus"
echo "User data is preserved in ~/.local/share/uno.scallion.papyrus"
echo "Configuration is preserved in ~/.config/uno.scallion.papyrus"
