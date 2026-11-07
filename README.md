# HeartQuarters

A window onto Heart Mind Fusion's Google Drive: projects and their packaging,
the editing guides, and buttons that run the tools.

## Start it

Double-click **`start.bat`**. It builds the screens, starts the app and opens
it in your browser at http://127.0.0.1:4321. Close the black window to stop it.

The first run installs the libraries it needs (`npm install`), which takes a minute.

**Updates apply themselves.** While it runs, HeartQuarters watches its own code:
engine changes restart the engine within a few seconds, and screen changes are
rebuilt. Just refresh the browser tab. (Changes to `package.json`, like new
libraries, still need a full restart. A tool that's running when the engine
restarts loses its on-screen output, though the tool itself finishes.)

## Settings

`config.json` holds this machine's folder paths, the Python to use, the guides
and the tools list. It's created from `config.example.json` the first time the
app runs. To add a tool, add an entry to `"tools"` and restart.

## For development

```bash
npm run dev
```

Runs the server and the screens with live reload at http://127.0.0.1:5173.

```bash
npm run typecheck
```

Checks the TypeScript for mistakes.

## Layout

| Folder | What's in it |
|---|---|
| `server/` | The engine (Node.js): reads Drive folders, serves files, runs tools |
| `web/` | The screens (React) |
| `ARCHITECTURE.md` | The design and the rules |
| `BACKLOG.md` | What's done and what's next |
