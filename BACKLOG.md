# HeartQuarters Backlog

**Core idea:** HeartQuarters is a GUI over the Google Drive folder.
Drive holds the truth. SQLite is only a cache that can be deleted and rebuilt.

**How features get built:** every job starts as a **skill** (instructions +
scripts) that works on its own, run by Claude or any other AI. A button in the
app comes later, once the skill has proven useful. Nothing waits on the app.

Automation levels:
- **Auto**: HeartQuarters does it end to end.
- **Prep**: HeartQuarters prepares everything (files + text); you drag, drop and paste.
- **Remind**: HeartQuarters tracks it and tells you when it's due.

---

## Done: Milestone 1, the project dashboard (v0.1)

- Projects: every `Video Projects` folder, with Longform, Shorts and Reels;
  exports play in the app; covers shown; `Packaging\Vxx\*.md` split into fields
  with Copy buttons; Open folder buttons. (Metadata already lives in
  `Packaging\Vxx\YouTube.md`, so no new `project.md` file was needed.)
- Guides: read the editing skills (channel-basics, longform-edit, shorts-from-longform) and the longform scripts README.
- Tools: Run buttons with live output for UpdateContentArchive,
  VideoMetaPackager, SubstackDownloader.

## Done since v0.1

- Icon (shortcut, browser tab, header) and taskbar pinning.
- Browse every packaging version (Legacy, V01, V05 Shock...).
- Collapsible packaging fields; Copy with a fallback.
- "Projects" tab renamed "Video Projects".
- Substack tab: the Writing folder by section; Word drafts readable in the
  app; preview image, photos, videos; Google Doc links.
- Auto-reload: engine restarts and screens rebuild when code changes.
- Expressions tab: category tree with definitions and reference images,
  photo grid with cached previews, tag search, full-size viewer with tags,
  Copy file path. (Browsing only; tagging/favourites still to do.)
- Security fixes from ChatGPT's review: other websites can't trigger actions
  (header + origin + host checks), Drive files served sandboxed, junction-proof
  path check, Word drafts cleaned with DOMPurify. Also: fast-click race fixed,
  en-dash project names, empty drafts, clear message if Drive is offline.
- Unit tests (Vitest): `npm test`, 35 tests.
- "+ New" buttons in Video Projects: new video, new part of a series, new
  short for a video, new standalone short. Each copies the right
  `--- ... TEMPLATE` folder with the next number filled in, and copies an empty
  CapCut draft (`--- LONGFORM TEMPLATE` / `--- SHORTS TEMPLATE` in CapCut's
  drafts folder) under the same name. A new short can instead duplicate the
  long-form's CapCut draft (picked by default). "+ New video" can also make
  a series: the series folder plus its first part (`023 - X\023A - Y\Longform`). Only ever adds folders;
  refuses names that already exist.
- Rename and Delete buttons on videos, series, parts, shorts and standalone
  shorts, each with a confirmation box. Rename also renames the matching
  CapCut drafts and fixes the file links inside every draft that uses the
  folder. Delete moves the folder (and ticked drafts) to
  `D:\HeartQuarters Trash`, outside Google Drive; nothing is really deleted. Both refuse to
  touch drafts while CapCut is open.

- Skills tab: every skill in `HMF_SYS\Skills` (`HMF_Skills\` and `Downloaded\`),
  with a checkbox per AI (Claude Code, Codex, Gemini CLI; listed in
  `skillTargets` in config.json). A tick creates a link (Windows junction) in
  that AI's skills folder; unticking removes only the link. Things installed in
  those folders some other way are listed and left alone.

- "Edit with Claude" on a longform video's page: runs Claude Code in the
  background on the longform-edit skill, writing into the video's CapCut
  project, and shows the conversation; John's notes go to the same
  conversation (kept in memory only; a page reload clears it). Tools are allowed up front
  (acceptEdits, plus the skills and CapCut drafts folders).

- "Propose shorts" on a longform video's page: Claude chooses clips with the
  shorts skill, looking at the pictures as well as the words, and writes
  `Shorts\Shorts Plan.json`. Each short and near miss is a collapsible row: edit
  it, read all its words, play it from the export, move it between the two
  lists. A retention graph pasted with Ctrl+V is saved beside the plan for
  Claude to use. Proposing again keeps the old list as a separate file.
- Setting a clip's range: a trim bar under the video with two drag handles (they
  snap to word edges, and the arrow keys move them a tenth of a second), or select
  words in the transcript and click the button to make them the clip. A button
  goes back to the times Claude proposed, which the plan file keeps.
- After each turn on a short, HeartQuarters runs `check_short.py` itself and shows
  the result in the conversation, not relying on the AI's report of it.
- "Open CapCut" on a longform and each short: starts CapCut and copies the
  project's name. CapCut can't be told which project to open.
- A video's page runs: the longform (with Edit and its YouTube URL), the existing
  shorts, then making more. Each part folds away and stays as you left it.
- "Write YouTube metadata" on each short's card, beside its fields: the picked AI
  fills in its YouTube.md from the short's words, with no export needed. The
  longform's URL box keeps it in `Shorts\Longform URL.txt`.
- An AI selector at the top of the app: Claude, ChatGPT (OpenAI's Codex) or Gemini
  (Antigravity CLI, limited: no CapCut builds) does the jobs the buttons start. Picking the other AI and sending a note hands over
  a conversation. Tried on small jobs, not yet on a whole CapCut project.
- Packaging fields are edited where they're shown, for every platform: a field
  saves when you leave it and only that field changes in the `.md` file. YouTube
  comes first, other platforms under its Description, blank ones on one line.
- Two checkboxes on a YouTube.md (the music is AI-generated, some B-roll is
  AI-generated) that add or remove those lines in its Description. A line like
  "Full video:" inside a Description no longer splits it into two fields.
- "Make this short" on a row: makes the short's folder and a copy of the
  longform's CapCut project, then Claude cuts it to the clip and turns it 9:16,
  with its own conversation for John's notes. "Regenerate" moves that short to
  the trash and makes it again from a fresh copy, to try changed instructions.

## Later (from code review)

- Large-folder scans run on the engine's main thread, so a slow Drive scan can
  pause other requests. Fine at today's sizes (~0.3 s); move to background
  work with a cache if folders grow a lot.

## Now

| # | Item | Level | Notes |
|---|---|---|---|
| 2 | Project status (idea / editing / packaged / published) | Auto | Decide where it's stored: in Drive, not only in the app. |

## Next

| # | Item | Level | Notes |
|---|---|---|---|
| 5 | Publish long-form to YouTube: upload video, fill metadata from `project.md`, upload thumbnail, schedule | Auto | YouTube API supports all of this. Start as a script. |
| 6 | Pinned comment at go-live | Remind | The API can't pin comments. HQ can post the comment and remind you to pin it, or just remind you. |
| 7 | "Make first cut": the `longform-edit` skill run on prepared takes, ending in a CapCut project; then a button that runs it | Auto (Claude-assisted) | The skill folders exist (`HMF_SYS\Skills\HMF_Skills\`). Next: the first-cut steps in the skill, tested on short test takes in 023; then the button. |
| 7a | "Prepare Video" button (sync, pop repair, Adobe Enhance when needed) into `Longform\Intermediate\Takes\` | Prep | Placeholder button first. Raw\ stays untouched originals. |
| 7c | AI chat panel inside the app, aware of the open project | n/a | Pick Option A or B from ARCHITECTURE.md first. |
| 8 | Expressions library: browse thumbnail photos of you, tag them by emotion, mark favourites | Auto | Pure GUI over one folder. Tags stored in a file in Drive. |
| 20 | Thumbnail and title generator, for longform and Shorts | Auto (AI-assisted) | Plan below. |

### Plan for #20: thumbnail and title generator

**Tested on 2026-11-13:** ChatGPT (through Codex) and Gemini (through Antigravity), run by HeartQuarters on John's
subscriptions with no API keys, both made a thumbnail with John's real face from an expressions-library photo.
ChatGPT stays closer to the photo; Gemini changes the pose more. Codex saves the image where it's asked to. Gemini
keeps it in its own folder (`.gemini\antigravity-cli\brain\<conversation>\`), and HeartQuarters copies it from
there. Only Claude has vidIQ connected today.

**Where it lives:** in each video's Packaging section, not a new tab. Shorts get the same thing in their own
Packaging section, with 9:16 covers.

**Drafts are not versions.** A version is something worth trying on YouTube. Everything made along the way is a
draft, kept in `Packaging\Drafts\` (a scratchpad):
- `Brief.md`: what this thumbnail and title should be (the idea, the text on the image, the expression photo,
  the title ideas). John can edit it.
- One folder per AI conversation (for example `ChatGPT 01\`, `Gemini 01\`), holding every image it made in order
  and the change requests John sent it.

**How a round goes:**
1. HeartQuarters sends the same request to ChatGPT and Gemini: the channel's thumbnail rules (a skill, the same for
   every video) plus this video's `Brief.md` and the chosen photo.
2. Each sends back an image. John asks each one for specific changes ("bigger text", "less clutter"), as many
   times as he likes. Each answer is a new draft image; nothing is thrown away.
3. When John likes one, **Make Version** turns it into the next version (below).

**How a version is made (one way for every button):**
- The next number, `Vxx`. Its `YouTube.md` is a copy of the latest version's, or of the template if there is no
  version yet, so description, tags and settings carry over.
- If the draft came with a title, it replaces the Title in the copy. The thumbnail text and idea go in their fields.
- The image goes in `Thumbnail\Thumbnail.png`; the photo, the brief and the prompts go in `Thumbnail\Source\`.
- `Notes.md` says which draft and which AI it came from, and **On YouTube: not yet**.

**On YouTube, in Notes.md:** whenever HeartQuarters pushes a version's title or thumbnail to YouTube, it writes
the date in that version's `Notes.md` ("On YouTube: from 2026-11-20"), and when another version replaces it, the
end date. Versions from before this can be marked by hand.

**How the existing buttons fit:**
- **+ New Version** stays: a copy of a version, for changing a title or a thumbnail by hand.
- **Write YouTube Metadata** fills description and tags into the latest version that isn't on YouTube yet, and
  leaves a title that's already there alone. If every version is on YouTube already, it makes a new one.
- **Add Thumbnail Planning Fields** goes away: the template gets the Thumbnail text and Thumbnail idea fields, and
  Make Version fills them.

**Before recording:** the thumbnail and title often come first. Then the brief is made from the video's idea or
script instead of the transcript, and V01 holds just the title and thumbnail. Write YouTube Metadata fills in the
rest into that same V01 later, once there's a transcript.

**Steps.** Each one is a skill first, then a button, as with every other job:
1. **Thumbnail rules skill:** the channel's rules for thumbnails and titles, written with John, nothing about one
   episode.
2. **Brief, by three AIs in turn:** Claude writes `Brief.md` from the source (the transcript after recording, John's
   script or bullet points before) plus vidIQ research; then ChatGPT and Gemini each read the source and the brief
   and add a review under their own name, with their ranking and at least one title and thumbnail idea of their
   own. A paste box takes Ask Studio or vidIQ text. A checkbox, off by default, also lets an AI watch the video
   (Gemini can). Format in the `thumbnails-and-titles` skill; tried by hand on 022 (Claude's part only so far).
   To check: whether Codex can connect to vidIQ too.
3. **Expression:** the AI names expressions that fit, such as Surprise or Doubt. HeartQuarters shows those photos
   from the library, and John clicks one.
4. **Drafts:** send to ChatGPT and Gemini together, show both results side by side, and a change box under each.
5. **Make Version**, the On YouTube notes, and the button changes above.
6. **Shorts:** the same steps with a 9:16 cover and Shorts-style titles.

## Later

| # | Item | Level | Notes |
|---|---|---|---|
| 9 | "Make Shorts for this long-form" skill: use YouTube retention data to pick moments, create portrait CapCut drafts, adapt motion graphics and B-roll | Auto (Claude-assisted) | Hardest item. Builds on #7. Retention comes from the YouTube Analytics API; no need to scrape Studio. |
| 10 | Cross-post pack for each Short: video + caption file per platform in one folder | Prep | For TikTok, Instagram, LinkedIn. |
| 11 | Publish Shorts to YouTube | Auto | Same as #5. |
| 12 | "Posted where" tracker for each Short | Auto | Recorded in `project.md`. Required for #13. |
| 13 | Find standalone Shorts not yet on TikTok / Instagram and build packs for them | Prep | Uses #10 and #12. |
| 14 | YouTube stats: pull analytics, show insights | Auto | YouTube Analytics API. |
| 15 | Stats from other platforms | Prep | Probably by importing CSV exports. Their APIs are limited. |
| 16 | Substack backups (posts + subscriber list) | Auto/Prep | Bring in the existing ChatGPT-written tools. The subscriber export may stay manual. |
| 17 | Substack Notes queue: write ahead, get reminded on the day, copy with one click | Remind | No scheduling API exists. |
| 18 | SDAM support group checklist: draft Reddit reminder posts, check Eventbrite and Zoom links work | Prep/Remind | You post to Reddit yourself. Reddit is strict about automated self-promotion. |
| 19 | Notebook: make CapCut projects open there (path fix-up script) | n/a | Only if needed. The `H:` mapping didn't work; CapCut saved real `D:` paths. |

## Parked (not until there's a real need)

- Remote access to the desktop (Tailscale)
- Phone or tablet app
- Desktop wrapper (Electron)
- Running HeartQuarters on the notebook
