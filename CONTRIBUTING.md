# Contributing to Tavern Sheet

Tavern Sheet is a personal fan project, but bug reports and fixes are welcome.

## Reporting bugs and requesting features

Open an [issue](https://github.com/knobilz1/dnd-character-manager/issues). For bugs, include your app version (shown in the app) and your OS.

**Rules and data errors are the most useful reports.** If a class feature, spell, item, or race is wrong, say what the app shows, what it should be, and which source book and page it comes from. Those get fixed fast.

## Pull requests

For anything beyond a small fix, open an issue first so we can agree on the approach before you spend time on it.

Before opening a PR:

```bash
npm run lint
npx tsc -b
```

Both must be clean. Keep the diff focused on one thing.

## Working on the code

Setup, dev server, and desktop build instructions are in the [README](README.md).

A few things worth knowing:

- **Rules data** lives in `src/data/`. Every entry is tagged with the source book it came from — keep that accurate, and don't add content from books the app doesn't already support.
- **Only SRD 5.1 content and mechanical references** belong in this repo. Don't paste verbatim text from non-SRD books; describe mechanics instead. See the disclaimer in the README.
- **3D assets** are side-loaded as Tauri bundle resources, not embedded in the binary. Don't move them into the bundle — it overflows the linker.
- **State** is Zustand persisted to localStorage. If you change a persisted shape, make sure existing saved characters still load.

## License

By contributing, you agree that your contributions are licensed under the [GPL-3.0](LICENSE), the same license as the project.
