import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Guards the macOS bundle's capability declarations.
 *
 * These live in a file nothing imports, so nothing else would notice if they
 * were dropped — and their absence doesn't fail a build or throw a permission
 * error. macOS just removes `navigator.mediaDevices` from the webview, and the
 * feature dies with a message that looks like a frontend bug. That is exactly
 * how the mic shipped broken on Mac while working on Windows.
 */

const PLIST = path.resolve(__dirname, '../../src-tauri/Info.plist');

describe('macOS Info.plist', () => {
  const xml = fs.readFileSync(PLIST, 'utf8');

  it.each([
    ['NSMicrophoneUsageDescription', 'Talk to the DM'],
    ['NSCameraUsageDescription', 'the table-board read'],
  ])('declares %s (needed by %s)', (key) => {
    expect(xml).toContain(`<key>${key}</key>`);
    // A key with an empty string still fails at runtime, and macOS won't say so.
    const value = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`).exec(xml);
    expect(value?.[1].trim().length ?? 0).toBeGreaterThan(10);
  });
});
