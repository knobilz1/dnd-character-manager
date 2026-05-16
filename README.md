# Tavern Sheet

An unofficial, fan-made 5e character sheet app built with React, TypeScript, and Tauri. Runs as a native desktop app on Mac and Windows, or in the browser.

> **Disclaimer:** Tavern Sheet is an unofficial fan project not affiliated with, endorsed by, or produced by Wizards of the Coast. Dungeons & Dragons is a trademark of Wizards of the Coast LLC. Rules content included in this app is sourced from the [Systems Reference Document 5.1](https://dnd.wizards.com/resources/systems-reference-document) (CC BY 4.0) and is used in accordance with Wizards of the Coast's [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). This app is free, non-commercial, and intended for personal use.

## Features

- **Character creation wizard** — race, class, subclass, background, ability scores, skills, feats, spells, and starting equipment
- **Character sheet** — HP tracking, conditions, death saves, exhaustion, inspiration
- **Combat tab** — spell slots, pact magic, class resources, hit dice, short/long rest
- **Spell management** — full spellbook, prepared spells, concentration tracking
- **Inventory** — item database with autocomplete (PHB, DMG, XGtE, TCE, EGtW, FToD), weight tracking, equip/unequip
- **Traits & notes** — personality, ideals, bonds, flaws, free-text notes
- **Level up** — ASI / feat choices, subclass selection, HP rolling
- **Export / Import** — save characters as JSON files and load them on any device
- **Auto-updates** — desktop app checks for new versions automatically on startup
- **Multiclass support** — spell slot merging, per-class hit dice, resource tracking

## Supported Source Books

PHB · DMG · XGtE · TCE · EGtW · FToD

## Installing the Desktop App

### macOS
1. Download the `.dmg` for your Mac from the [latest release](https://github.com/knobilz1/dnd-character-manager/releases/latest)
   - Apple Silicon (M1/M2/M3): `aarch64.dmg`
   - Intel Mac: `x64.dmg`
2. Open the DMG and drag **Tavern Sheet** into Applications
3. macOS will block the app on first launch because it isn't signed with a paid Apple certificate. Fix it with one of these:
   - **Option A** — Open Terminal and run:
     ```bash
     xattr -dr com.apple.quarantine "/Applications/Tavern Sheet.app"
     ```
   - **Option B** — Go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**

### Windows
1. Download the `x64-setup.exe` from the [latest release](https://github.com/knobilz1/dnd-character-manager/releases/latest)
2. Run the installer — Windows SmartScreen may warn you since the app isn't commercially signed; click **More info → Run anyway**

## Running Locally (browser)

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Running as Desktop App (dev mode)

Requires Node.js and [Rust](https://rustup.rs).

```bash
npm install
npm run tauri:dev
```

## Building Desktop Installers

```bash
npm run tauri:build
```

Output:
- **macOS**: `src-tauri/target/release/bundle/dmg/DnD Sheet_x.x.x_x64.dmg`
- **Windows**: `src-tauri/target/release/bundle/nsis/DnD Sheet_x.x.x_x64-setup.exe`

## Releasing a New Version

Releases are built automatically by GitHub Actions for Mac (Intel + Apple Silicon) and Windows.

1. Bump the version in `src-tauri/tauri.conf.json` (`"version": "x.x.x"`)
2. Tag and push:

```bash
git add src-tauri/tauri.conf.json
git commit -m "Bump version to x.x.x"
git tag vx.x.x
git push && git push --tags
```

GitHub Actions builds the installers and publishes a release. Installed copies of the app will show an update prompt automatically within a few seconds of opening.

## Tech Stack

- [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org)
- [Vite](https://vite.dev) — build tool
- [Tauri v2](https://tauri.app) — desktop app wrapper
- [Zustand](https://zustand-demo.pmnd.rs) — state management (persisted to localStorage)
- [Tailwind CSS v4](https://tailwindcss.com)
- [Lucide React](https://lucide.dev) — icons
