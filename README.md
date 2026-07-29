# Tavern Sheet

An unofficial, fan-made 5e character sheet app — and AI Dungeon Master — built with React, TypeScript, and Tauri. Runs as a native desktop app on Mac and Windows, or in the browser.

> **Disclaimer:** Tavern Sheet is an unofficial fan project not affiliated with, endorsed by, or produced by Wizards of the Coast. Dungeons & Dragons is a trademark of Wizards of the Coast LLC. Rules content included in this app is sourced from the [Systems Reference Document 5.1](https://dnd.wizards.com/resources/systems-reference-document) (CC BY 4.0) and is used in accordance with Wizards of the Coast's [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). This app is free, non-commercial, and intended for personal use.

## Features

### Character Manager

- **Character creation wizard** — race/species (2014 or 2024 rules), class, subclass, background, ability scores, skills, feats, spells, and starting equipment
- **Character sheet** — HP tracking, conditions, death saves, exhaustion, inspiration
- **3D character viewer** — customizable appearance, modular hair, equipped armor visible on the model, HP-based wound/limp/dying states
- **Combat tab** — spell slots, pact magic, class & subclass resources, hit dice, short/long rest
- **Spell management** — full spellbook, prepared spells, concentration tracking
- **Inventory & Town Store** — item database with autocomplete, weight tracking, equip/unequip, buy/sell at a generated shop
- **Your own background** — rename the background and write your own personality, ideal, bond, flaw and backstory, with the book's tables as one-click suggestions; editable later from the sheet. Proficiencies and features still come from the book
- **Traits & notes** — free-text notes and a session journal
- **Level up** — ASI / feat choices, subclass selection, multiclassing, HP rolling
- **Export / Import** — save characters as JSON, print an official WotC-style sheet or a built-in PDF, or sync across devices with Google Drive
- **Graveyard** — a record of fallen characters
- **Auto-updates** — desktop app checks for new versions automatically on startup

### DM Console — AI Dungeon Master

A voice-driven AI DM that runs a full campaign — on your Claude, Codex, or Gemini subscription, or a fully offline local LLM.

- **Talk to the DM** — mic → speech-to-text → your chosen engine → text-to-speech narration, with distinct auto-assigned voices per NPC
- **Campaign memory** — persistent lore, NPCs, locations, party backstories and session recaps the DM recalls across sessions
- **Module import** — upload an adventure PDF; it's auto-chapterized so only the current chapter loads each turn, and progress is tracked chapter by chapter
- **Standing decisions** — finds what a module decides once and depends on chapters later (a card reading that fixes where treasures are, an early choice that changes a later chapter) and keeps it in front of the DM the whole way through
- **Session Zero handout** — a spoiler-free document to give your players before the first session: what the campaign is, what to agree on together, and how to write a background that fits the setting
- **Party roster** — add a player by importing their exported character, or by hand; either way their backstory gets tied into the campaign's established lore. Remove one and the DM writes that character out of the story
- **Plan Next Session** — drafts what's coming up next from campaign memory and the current chapter, on demand
- **Recap** — reads last session's recap aloud at the top of the night
- **Battle Map Generator** — a printable, lettered/numbered tactical map per combat encounter for Grid mode, multi-floor where the fiction has levels, with an optional AI atmosphere pass (local ComfyUI or Gemini)
- **Bring your own tiles** — import a battle-map tileset and the generator matches real artwork to what each map calls for
- **Read the board** — point a camera at the table and the DM works out which printed square each mini is standing on
- **Three battle modes** — Theater of the Mind, Grid (printable maps), and Hex (physical terrain tracking)
- **LAN party sync** — players join from their own devices on the same network; narration broadcasts live to the table, and maps can be presented to a second screen or TV
- **Cross-checked ingestion** — campaign lore, arc plans and handouts are drafted by one model and reviewed by another before they're saved

## Supported Source Books

PHB (2014 & 2024) · DMG · XGtE · TCE · MMoM · VGM · FToD · EGtW · GGR · SJA · SCoC · ERLW · SCAG

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

Note: the DM Console's voice pipeline, local-LLM support, and LAN party sync require the desktop app (they rely on Tauri's Rust backend); the browser build covers character management only.

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
- [Tauri v2](https://tauri.app) — desktop app wrapper (Rust backend)
- [Zustand](https://zustand-demo.pmnd.rs) — state management (persisted to localStorage)
- [Tailwind CSS v4](https://tailwindcss.com)
- [Lucide React](https://lucide.dev) — icons
- [Three.js](https://threejs.org) — 3D character viewer
- [Claude Code](https://claude.com/claude-code), Codex or Gemini CLI on your own subscription, or a local LLM (via [vLLM](https://github.com/vllm-project/vllm) or [Ollama](https://ollama.com)) — DM narration and campaign ingestion
- [Kokoro](https://github.com/hexgrad/kokoro) / an optional local [F5-TTS](https://github.com/SWivid/F5-TTS) runtime — DM voice synthesis
- Local [ComfyUI](https://www.comfy.org) or the Gemini API — optional AI-styled battle maps
