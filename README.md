# Causal Inference Reading Group website

A one-page site for a paper reading group, hosted free on GitHub Pages. It has:

- **Next session**: date, time (also shown in each visitor's own time zone), papers, presenters, prep and discussion questions
- **Reading roadmap**: a small DAG of sessions showing which ones build on which
- **About**: what the group reads, how a session works, and how to take part
- **Schedule**: month calendar, upcoming and past sessions, Theory and Practice track filters, plus a calendar feed people can subscribe to
- **Shared papers**: searchable library with PDF links and status (scheduled, discussed, not yet scheduled)
- **People**: organizers and participants, with GitHub avatars
- **Surveys**: topic votes, session feedback, availability polls, presenter sign-up and join requests. Answers are saved as GitHub Issues and the results show up as charts on the page.

Everything is driven by five JSON files in `data/`. There is no build step and nothing to install. The members, sessions and papers files start empty: fill them in using the examples below.

---

## Publish it (about 5 minutes)

1. Create a new **public** repository on GitHub, for example `causal-reading-group`.
2. Upload every file in this folder, keeping the folder structure. Include `.github/` and `.nojekyll`. If you use the web uploader, drag the whole folder in.
3. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
4. Open the **Actions** tab and wait for "Deploy site" to go green (about a minute).
5. Your site is live at `https://<your-username>.github.io/causal-reading-group/`.

Every push to `main` redeploys the site and rebuilds the calendar feed.

> Prefer not to use Actions? Choose **Deploy from a branch** (`main`, `/ (root)`) instead. Everything works except the subscribable feed. Visitors can still download the `.ics` file and add single sessions to Google Calendar.

Issues must be turned on (they are by default) for surveys to work.

## Edit content

All content lives in `data/`. You can edit files directly on GitHub: open the file, click the pencil, commit. The site updates in about a minute.

| File | What it controls |
|---|---|
| `config.json` | Group name, purpose, regular meeting time, time zone, location, meeting link, lab link, contact email, tracks, scope topics, session format, participation text |
| `sessions.json` | Every session: date, track, title, papers, presenters, prep, questions, slides, recording |
| `papers.json` | The shared paper library |
| `members.json` | Organizers and participants |
| `surveys.json` | Surveys and their questions |

If the site shows a yellow "Something in the data files needs fixing" banner, a JSON file has a typo. The message names the file. Missing commas and unmatched quotes are the usual cause. The Actions run also fails with the same message, so broken data never goes live silently.

### Add a session

```json
{
  "id": "s10",
  "start": "2027-02-24 16:00",
  "track": "theory",
  "label": "IV and LATE",
  "title": "Instrumental variables and local average treatment effects",
  "papers": ["imbens-angrist-1994"],
  "presenters": ["mlin"],
  "builds_on": ["s2"],
  "prep": "Read sections 1–3.",
  "questions": ["What does monotonicity rule out?"],
  "slides": "",
  "recording": ""
}
```

- `start` is the wall-clock time in the group's `timezone` from `config.json` (default `Asia/Dubai`, which is GST, UTC+4). Daylight saving is handled for you. A full ISO time such as `2027-02-24T16:00:00+04:00` also works.
- `id` must be unique. It is used in links such as `#session-s10` and in calendar invites.
- `papers` and `presenters` refer to `id`s in `papers.json` and `members.json`. A presenter who isn't a member can be written as a plain name.
- `builds_on` draws the arrows in the roadmap. Leave it empty for a starting point. If no session uses it, the roadmap draws a simple timeline.
- `track` must match a track `id` in `config.json`. The first track is drawn as a circle and the second as a square.
- Optional: `durationMinutes`, `location`, `meetingLink` (each overrides the default for that session), `notes` (a link).
- Once the roadmap gets long, set `"roadmapFrom": "2027-01-01"` in `config.json` to show only recent sessions.

The "Next session" panel and the paper statuses update automatically by date.

### Add a paper

```json
{
  "id": "imbens-angrist-1994",
  "title": "Identification and estimation of local average treatment effects",
  "authors": "Guido W. Imbens, Joshua D. Angrist",
  "year": 1994,
  "venue": "Econometrica 62(2)",
  "url": "https://doi.org/...",
  "pdf": "papers/imbens-angrist-1994.pdf",
  "tags": ["IV", "identification"]
}
```

`pdf` can be a link (arXiv and the like open in a new tab) or a file in the `papers/` folder (opens in a viewer on the page). Only upload PDFs you're allowed to share, because anything in a public repository can be downloaded by anyone. For paywalled papers, link to the publisher or arXiv version, or keep the files in a private Google Drive or OneDrive folder and set `sharedFolderUrl` in `config.json`. A "Open shared folder" button then appears next to the papers.

### Add a member

```json
{ "id": "jdoe", "name": "Jane Doe", "role": "participant", "title": "PhD student, Statistics",
  "interests": ["Mediation"], "github": "janedoe", "website": "https://..." }
```

`role` is `organizer` or `participant`. Setting `github` shows the member's GitHub profile picture. Organizers can also have an `email`.

## Surveys

Each survey in `surveys.json` becomes a form on the page. When someone submits, a prefilled **GitHub issue** opens in a new tab. They submit it there, and the page reads those issues back through the GitHub API to show live results.

- Respondents need a GitHub account, and answers are public. For anonymous feedback, make a Google Form or Microsoft Form and set `"externalUrl"` on that survey. The page then shows an "Open the form" button instead.
- Only each person's latest answer counts. For per-session feedback, `"dedupeBy": ["session"]` keeps one answer per person per session.
- To discard a response (spam or a test), close its issue as **Not planned**.
- Turn a survey off with `"status": "closed"`, or set `"closes": "2027-01-31"`. Hide results with `"showResults": false`.
- Results load up to 500 recent issues, using GitHub's anonymous API (60 requests per hour per visitor network), which is plenty for a reading group.

Question types: `single` (radio buttons), `multi` (checkboxes, optional `max`), `rating` (1 to `scale`, optional `low` and `high` labels), `select` (dropdown), `text`, `textarea`. Set `"options": "sessions:past"` to list past sessions automatically. Mark questions `"required": true` as needed.

The **Join the group** survey creates an issue an organizer can act on: add the person to `members.json` and to your mailing list or calendar invite, then close the issue.

## Calendar

- **Subscribe in Google Calendar** and **Subscribe in Apple or Outlook** use the `calendar.ics` feed that the workflow builds on each deploy. Subscribers see new and changed sessions automatically (Google refreshes subscribed calendars every few hours).
- Each upcoming session also has **Add to Google Calendar** and **Download .ics** buttons for one-off invites.

## Preview locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
node scripts/build-ics.mjs   # optional: builds calendar.ics so the Subscribe buttons appear
```

Opening `index.html` directly from disk doesn't work, because browsers block it from reading the data files.

Survey submissions need to know the repository. On `*.github.io` it's detected automatically. When the site runs anywhere else, such as a custom domain or a local preview, set `github.owner` and `github.repo` in `config.json`.

## Files

```
index.html               page structure
assets/style.css         design (light and dark mode)
assets/app.js            renders everything from data/
assets/core.js           time zones and calendar export (shared with the build script)
data/*.json              your content
papers/                  optional PDFs
scripts/build-ics.mjs    builds calendar.ics
.github/workflows/       deploy to GitHub Pages
```
