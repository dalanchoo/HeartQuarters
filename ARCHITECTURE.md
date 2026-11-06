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
| Editing rules | `Video Projects\LONGFORM.md`, `SHORTS.md`, `CLAUDE.md` |
| Substack writing | `D:\Google Drive\HeartMind\Writing\<My Journey / My Reflections / My Wisdom>\<piece>\` with `Drafts\*.docx` and `Substack Metadata\Preview.png` |
| Downloaded Substack archive | `HMF_SYS\Generated\Substack` (made by SubstackDownloader.py; not shown in the app yet) |
| Tools (Python scripts, Longform/Shorts toolbox) | `D:\Google Drive\HeartMind\HMF_SYS\Tools\` |
| HeartQuarters code | `C:\Dev\HeartQuarters` (Git), outside Drive |
| App cache / database (later) | `C:\Dev\HeartQuarters\data\` (ignored by Git; can be deleted) |
| Per-machine settings | `C:\Dev\HeartQuarters\config.json` (made from `config.example.json`) |

**The rules and tools stay in Drive for now.** Episode `Claude\CLAUDE.md` files
and the toolbox README point at those exact paths, and the current
Claude + CapCut workflow works. Moving them into Git as formal skills is a later
decision, made one skill at a time.

## Skills

A skill is a folder with a `SKILL.md` (plain-language instructions: what the
job is, how you like it done) plus any scripts it needs.

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
