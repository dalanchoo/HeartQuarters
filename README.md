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

## Upload to YouTube

In Google Cloud, enable the YouTube Data API v3 and create an OAuth client of type **Desktop app**. Configure the OAuth consent screen and add your Google account as a test user if your app is in testing. In HeartQuarters, open a video or Short with an export and YouTube packaging, choose **Upload to YouTube**, and enter that client's ID and secret on your own PC. Sign in with Google and select the intended channel. The credentials and Google refresh token are stored in Windows Credential Manager, not in Drive or Git.

Review the export, title, description, tags, optional thumbnail, audience, altered-content answer and visibility before uploading. Private is selected initially; Public publishes to your channel. The app never changes the export or packaging when uploading. A record of uploads is kept locally in `data/youtube-uploads`; if an upload is interrupted, check YouTube Studio before trying again so you don't accidentally make a duplicate. Google may require you to reconnect if its authorization expires.

Timed `.vtt`, `.srt`, or `.sbv` files in the video's `Subtitles` folder can be sent as English captions along with an upload or added afterwards to an upload recorded in HeartQuarters. If there is exactly one file it is selected automatically; if there are several, choose one. Google requires a broader permission for captions, including editing and deleting YouTube content, so reconnect and review Google's consent screen before using this feature. Check YouTube Studio if caption upload is uncertain. YouTube does not expose a related-Shorts-video setting in its public API; select the long-form video in Studio after upload.

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

```bash
npm test
```

Runs the automated tests (a few seconds). They use small fake folders, never your real Drive.

## Layout

| Folder | What's in it |
|---|---|
| `server/` | The engine (Node.js): reads Drive folders, serves files, runs tools |
| `web/` | The screens (React) |
| `ARCHITECTURE.md` | The design and the rules |
| `BACKLOG.md` | What's done and what's next |
