# Security Policy

## Supported versions

Only the [latest release](https://github.com/knobilz1/dnd-character-manager/releases/latest) is supported. The desktop app auto-updates on startup, so please confirm a problem still exists on the current version before reporting it.

## Reporting a vulnerability

**Please don't open a public issue for a security problem.**

Report it privately through GitHub: go to the [Security tab](https://github.com/knobilz1/dnd-character-manager/security/advisories/new) and open a draft security advisory. That keeps the report private until there's a fix.

Include what you did, what happened, and what you'd expect instead. A proof of concept helps but isn't required.

This is a hobby project maintained by one person — expect a reply within about a week, not within hours.

## Areas worth looking at

If you're poking at this deliberately, these are the parts that actually touch anything sensitive:

- **Google Drive sync** — OAuth tokens are stored in the OS keychain; the OAuth flow is PKCE over a loopback redirect.
- **LAN party sync** — the desktop app opens a local network listener so players can join from their own devices.
- **Adventure module import** — parses user-supplied PDFs.
- **Local LLM and ComfyUI integration** — the app talks to user-configured local HTTP endpoints.
- **The Tauri capability allowlist** — in `src-tauri/`.

## Out of scope

- The app is not code-signed with a paid Apple or Windows certificate. The resulting OS warnings are expected and documented in the README.
- Anything requiring an attacker to already have access to the user's machine or unlocked keychain.
