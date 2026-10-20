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
- Tapback reactions on a link are counted and shown as ♥.
- **Privacy:** the repo is public, so only the link and its public metadata are stored. Phone numbers and message text are never written. To credit people, copy `people.local.example.json` to `people.local.json` (gitignored) and map handles to first names.
- `data/recs.json` is the source of truth. Edit it by hand to fix titles, remove items, or add a `note`.

## Usage

```sh
npm install
npm run import     # merge new links from the chat into data/recs.json (--refresh re-fetches metadata)
npm run dev        # build + preview at localhost:8787
npm run deploy     # build + deploy to feed.ballot.io
```

The importer needs Full Disk Access for your terminal so it can read the Messages database.
