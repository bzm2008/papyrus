# Papyrus on Debian 13

This directory contains the system integration files for Papyrus 1.0.0 on
Debian 13 and compatible Debian-based distributions. Windows and macOS use
their native Tauri installers; this integration is intentionally Linux-only.

## Install

Copy the release asset and this directory to a temporary folder, then run one
of the following commands:

```sh
chmod +x install-papyrus.sh
./install-papyrus.sh Papyrus_1.0.0_amd64.deb
```

or:

```sh
./install-papyrus.sh Papyrus_1.0.0_amd64.AppImage
```

The script asks for `sudo` when needed. It installs the application under
`/opt/papyrus`, creates `/usr/bin/papyrus`, and installs the desktop menu entry
at `/usr/share/applications/papyrus.desktop`. A desktop environment can then
launch Papyrus from the application menu or with `papyrus` in a terminal.

The `.deb` is extracted into the private application directory instead of
being registered with `dpkg`. This keeps the application layout consistent
with the AppImage path and avoids an upgrade removing files owned by another
package. The extracted Tauri binary and resources remain under
`/opt/papyrus/usr/`.

## Upgrades and rollback

Run the same command with the new release asset. Files are copied over the
existing application only; the installer never removes the user data or
configuration directories. If a previous `/usr/bin/papyrus` command existed,
it is moved to `/usr/bin/papyrus.papyrus-backup` once for recovery.

For a manual rollback, install the earlier asset again. The Papyrus updater
may also update the application when a signed Linux update is published by
the server.

## User data

Papyrus stores per-user data using the XDG layout:

* `~/.local/share/uno.scallion.papyrus` contains the SQLite secretary ledger,
  checkpoints, and other durable application data.
* `~/.config/uno.scallion.papyrus` contains user preferences and configuration.

Do not run the application with `sudo`; doing so can create root-owned data
and make the normal user's history appear to be missing. The installation
script only writes system locations and does not touch these directories.

## Uninstall

Remove the system files as root:

```sh
sudo rm -rf /opt/papyrus
sudo rm -f /usr/bin/papyrus /usr/share/applications/papyrus.desktop
sudo rm -f /usr/share/icons/hicolor/128x128/apps/papyrus.png
```

The user data directories are deliberately not removed. Delete them manually
only when a complete data reset is intended.

## Requirements

* Debian 13 (amd64) or a compatible Debian-based system.
* `dpkg-deb` for `.deb` assets, or FUSE/AppImage support for AppImage assets.
* A graphical session for the desktop entry.
