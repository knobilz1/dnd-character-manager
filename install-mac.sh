#!/bin/bash
# Removes macOS quarantine flag from Tavern Sheet after installing from DMG.
# Run this once if macOS blocks the app from opening.

APP="/Applications/Tavern Sheet.app"

if [ ! -d "$APP" ]; then
  echo "Tavern Sheet not found in /Applications."
  echo "Please install it from the DMG first, then run this script."
  exit 1
fi

xattr -dr com.apple.quarantine "$APP"
echo "Done. You can now open Tavern Sheet normally."
