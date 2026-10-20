# friendcast

An RSS feed + landing page of podcast, video, and clip recommendations from friends. Live at **https://feed.ballot.io**.

| Feed | URL |
| --- | --- |
| Everything | https://feed.ballot.io/feed.xml |
| Podcasts (with audio enclosures, so they play in podcast apps) | https://feed.ballot.io/podcasts.xml |
| Videos | https://feed.ballot.io/videos.xml |
| Clips | https://feed.ballot.io/clips.xml |

## How it works

```
iMessage group chat ──► scripts/import-imessage.mjs ──► data/recs.json ──► scripts/build.mjs ──► dist/ ──► Cloudflare (Workers static assets)
```

- **Import** reads `~/Library/Messages/chat.db` (read-only, via `sqlite3`), pulls links out of the chat, and keeps the ones that are podcasts, videos, or clips:
  - Podcasts: Apple Podcasts episodes (via the iTunes lookup API, including the audio URL), Spotify, Overcast, Pocket Casts
  - Videos: YouTube, Vimeo
  - Clips: YouTube Shorts, TikTok, Instagram reels, and X posts that contain video (checked via fxtwitter)
- **Other chats (Signal, WhatsApp, Slack…)**: paste or export the messages as text and run `pbpaste | npm run import:text -- --source "Group name"`. Lines starting with a date (`2026-10-14 09:30`) date the links that follow.
- **Signal**: the desktop database is encrypted, so export it yourself (macOS asks for Keychain access), import, then delete the plaintext export:
  ```sh
  uvx --from signal-export sigexport ~/signal-export --chats "Gotham AI Nerds (GAIN)"
  npm run import:text -- --source "Gotham AI Nerds (GAIN)" --file ~/signal-export/GothamAINerdsGAIN/chat.md
  ```
- **Themes** live in `data/themes.json`; each rec has a `theme` slug. New recs show up under "Just in" until you give them one.
- Tapback reactions on a link are counted and shown as ♥.
- **Privacy:** the repo is public, so only the link and its public metadata are stored. Phone numbers and message text are never written. To credit people, copy `people.local.example.json` to `people.local.json` (gitignored) and map handles to first names.
- `data/recs.json` is the source of truth. Edit it by hand to fix titles, remove items, or add a `note`.

## Usage

```sh
npm install
npm run import     # merge iMessage new links from the chat into data/recs.json (--refresh re-fetches metadata)
npm run dev        # build + preview at localhost:8787
npm run deploy     # build + deploy to feed.ballot.io
```

The importer needs Full Disk Access for your terminal so it can read the Messages database.
