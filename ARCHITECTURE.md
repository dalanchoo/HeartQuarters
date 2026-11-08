# HeartQuarters Architecture

HeartQuarters is a personal app for running Heart Mind Fusion content work:
see your projects, edit metadata, watch videos, and run jobs
("make Shorts for this long-form", "publish this") without leaving one window.

## Three layers

```
┌─────────────────────────────────────────────────────────┐
│  HeartQuarters app   (the window: view, edit, click,    │
│                       later: chat with an AI)           │
├─────────────────────────────────────────────────────────┤
│  Skills & tools      (the jobs: instructions + scripts, │
│                       runnable by any AI or by hand)    │
├─────────────────────────────────────────────────────────┤
│  Google Drive        (the truth: media, CapCut drafts,  │
│                       Packaging metadata)               │
└─────────────────────────────────────────────────────────┘
```

1. **Google Drive is the truth.** Everything that matters lives in
   `D:\Google Drive\HeartMind`. If HeartQuarters disappeared tomorrow, nothing
   would be lost.
2. **Skills and tools do the work.** The app is just a nice way to start them
   and see the results.
3. **The app is a window.** It shows what's in Drive, lets you edit it and
   starts jobs.

## Where things live

| What | Where |
|---|---|
| Video projects | `D:\Google Drive\HeartMind\Video Projects\NNN - Title\` |
| Metadata for each video | `...\Packaging\Vxx\YouTube.md` (and `TikTok.md`, `Instagram.md`, ... for Shorts). Already in use; the app reads these. |
| Editing rules (skills) | `D:\Google Drive\HeartMind\HMF_SYS\Skills\HMF_Skills\` (`channel-basics`, `longform-edit`, `shorts-from-longform`, each a `SKILL.md` + `scripts\`); other people's skills in `HMF_SYS\Skills\Downloaded\`. `Video Projects\CLAUDE.md` (and `AGENTS.md`, `GEMINI.md`) only point there. |
| An episode's own edit settings | `NNN - Title\Longform\Claude\project\episode.json` while editing; kept in `Longform\Intermediate\Edit Scripts\` afterwards |
| Substack writing | `D:\Google Drive\HeartMind\Writing\<My Journey / My Reflections / My Wisdom>\<piece>\` with `Drafts\*.docx` and `Substack Metadata\Preview.png` |
| Expressions library (thumbnail photos) | `D:\Google Drive\HeartMind\Assets\Expressions\<Category>\<Sub>\` with `<Name>.txt` (definition), `_<Name>.png` (reference), photos + `<photo>.txt` tags |
| Photo previews (cache) | `C:\Dev\HeartQuarters\data\thumbs` (made by FFmpeg; safe to delete) |
| Downloaded Substack archive | `HMF_SYS\Generated\Substack` (made by SubstackDownloader.py; not shown in the app yet) |
| Tools (standalone Python scripts the Tools tab runs) | `D:\Google Drive\HeartMind\HMF_SYS\Tools\` |
| HeartQuarters code | `C:\Dev\HeartQuarters` (Git), outside Drive |
| App cache / database (later) | `C:\Dev\HeartQuarters\data\` (ignored by Git; can be deleted) |
| Per-machine settings | `C:\Dev\HeartQuarters\config.json` (made from `config.example.json`) |

**The skills stay in Drive** (`HMF_SYS\Skills`), not in Git: they are part of
the content work, and Drive keeps them backed up with the rest.

## Skills

A skill is a folder with a `SKILL.md` (plain-language instructions: what the
job is, how you like it done, with a `name` and `description` header) plus any
scripts it needs, in the open "Agent Skills" format that Claude Code, Codex and
Gemini CLI all read. There is one real copy of each skill, in `HMF_SYS\Skills`;
each AI on this computer gets a link (a Windows junction) in its own skills
folder (Claude Code: `C:\Users\dalan\.claude\skills\<name>`), so every AI sees
the same, current version.

- **Never about one episode.** Skills and their scripts contain no episode's
  number, name, paths or settings. Those live in the episode's own files.

- **Plain files, no lock-in.** Markdown + scripts, so Claude, ChatGPT, Gemini
  or a person can follow them.
- **Scripts do the mechanical parts.** Instructions cover the judgement calls.
- **One job per skill.** Small and combinable.
- **Write about the job, not the AI tool** ("read the CapCut draft", not
  "use Claude's Read tool").

## The app

| Part | Choice |
|---|---|
| Screens | React + TypeScript (`web/`), served as a local web page |
| Engine | Node.js + TypeScript (`server/`), listening on 127.0.0.1 only |
| Cache | None yet. SQLite later if needed; always rebuildable from Drive. |
| Tools | Python scripts run as-is from the tools folder |

## AI inside the app (open decision)

A chat panel where you talk to an AI about the project you're looking at.
To decide when we get there:

- **Option A:** HeartQuarters runs the Claude Code you already use behind the scenes.
- **Option B:** HeartQuarters uses the Claude Agent SDK. More control, but
  billed separately through an API key.

## Rules

- **Nothing important lives only in the app.** Metadata stays in the Packaging
  files in Drive.
- **Never overwrite or delete originals.** The app only reads, except where a
  feature is explicitly about writing (and then it writes new files or asks).
- **Git is for code only.** Media stays in Drive.
- **Secrets** (YouTube login, API keys) go in the Windows credential store,
  never in Git, Drive or chat.
- **Carbonite** should cover `C:\Dev`.

## Parked until there's a real need

Electron wrapper · remote access · phone app · running the app on the notebook
