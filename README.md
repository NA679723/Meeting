# Causal Inference Reading Group website

A one-page site for a paper reading group, hosted free on GitHub Pages. It has:

- **Next session**: date, time (also shown in each visitor's own time zone), papers, presenters, prep and discussion questions
- **Reading roadmap**: a small DAG of sessions showing which ones build on which
- **About**: what the group reads, how a session works, and how to take part
- **Schedule**: month calendar and list of upcoming and past sessions. Organizers add, change and delete sessions on the website with **Edit schedule**.
- **Shared papers**: searchable library with PDF links and status (scheduled, discussed, not yet scheduled)
- **People**: organizers and participants, with GitHub avatars
- **Vote**: one simple form for topics and meeting times, with live results, plus session feedback and presenter sign-up. Answers are saved in a Google Sheet you own.

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

Then connect voting (below) so votes are saved.

## Edit the schedule on the website

Click **Edit schedule** in the Schedule section (or **Add a session** in the top box). Pick a date, tap a time (11 AM, 2 PM or 4 PM, or type another), tap a topic, tap the presenter, and paste a link to the reading. Press **Save session**. The top box, calendar, session list and paper list update by themselves.

On GitHub Pages, sessions are saved in the same Google Sheet as votes, in a **Sessions** tab. Only people who know the organizer code can save changes:

1. Open your Google Sheet → **Extensions → Apps Script**.
2. Replace all the code with the new `scripts/vote-backend.gs`.
3. Change `ORGANIZER_CODE = 'change-me'` to your own code, for example `'cirg-2026'`. Click **Save**.
4. **Deploy → Manage deployments** → click the pencil → **Version: New version** → **Deploy**. The web address stays the same.
5. On the website, click **Edit schedule** and type the code once. The browser remembers it.

The quick time buttons come from `"sessionTimes"` in `config.json`.

## Edit content

All content lives in `data/`. You can edit files directly on GitHub: open the file, click the pencil, commit. The site updates in about a minute.

| File | What it controls |
|---|---|
| `config.json` | Group name, purpose, regular meeting time, time zone, location, meeting link, lab link, contact email, quick session times, scope topics, session format, participation text |
| `sessions.json` | Sessions written by hand (sessions added on the website are kept in the Google Sheet): date, title, papers, presenters, prep, questions, slides, recording |
| `papers.json` | The shared paper library |
| `members.json` | Organizers and participants |
| `surveys.json` | The vote and other forms |

If the site shows a yellow "Something in the data files needs fixing" banner, a JSON file has a typo. The message names the file. Missing commas and unmatched quotes are the usual cause. The Actions run also fails with the same message, so broken data never goes live silently.

### Add a session

```json
{
  "id": "s10",
  "start": "2027-02-24 16:00",
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
{ "id": "jane", "name": "Jane", "role": "member", "title": "PhD student, Statistics",
  "interests": ["Mediation"], "github": "janedoe", "website": "https://..." }
```

`role` is `organizer` or `member`. While nobody is an organizer, the page shows one Members list. Members also appear in the vote's name list. Setting `github` shows the member's GitHub profile picture. Organizers can also have an `email`.

## Vote and forms

The **Vote** form asks each member for their name, up to three topics, and the time slots that suit them. Results show live on the page: topic bars, a grid of the most popular times, and who has and hasn't voted. Voting again with the same name replaces the earlier vote. There are also forms for session feedback and for volunteering to present.

### Connect voting (one time, about 5 minutes)

On GitHub Pages, votes are saved in a Google Sheet you own. Nobody needs a GitHub or Google account to vote.

1. Create a new Google Sheet (any name).
2. In the sheet, open **Extensions → Apps Script**. Delete what is there, paste the whole of `scripts/vote-backend.gs`, and click **Save**.
3. Click **Deploy → New deployment**. Click the gear next to "Select type" and choose **Web app**. Set **Execute as: Me** and **Who has access: Anyone**, then **Deploy**. Allow access when Google asks.
4. Copy the **Web app URL** (it ends in `/exec`).
5. On GitHub, open `data/config.json`, click the pencil, paste the URL between the quotes of `"voteUrl": ""`, and commit.

Each answer becomes a row in the sheet's **Responses** tab. To remove a test or spam answer, delete its row. Until the URL is set, the form says voting isn't switched on yet.

### Edit the forms

Forms live in `data/surveys.json`. Question types: `member` (pick your name from `members.json`), `multi` (tick several; `"style": "chips"` for big buttons, `"max"` to limit), `single`, `grid` (`rows` × `columns`, for time slots), `rating`, `select`, `text`, `textarea`. `"options": "sessions:past"` lists past sessions. Close a form with `"status": "closed"` or `"closes": "2027-01-31"`; hide its results from the page with `"showResults": false` (you still see every answer in the sheet).

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


## Files

```
index.html               page structure
assets/style.css         design (light and dark mode)
assets/app.js            renders everything from data/
assets/core.js           time zones and calendar export (shared with the build script)
data/*.json              your content
papers/                  optional PDFs
scripts/build-ics.mjs    builds calendar.ics
scripts/vote-backend.gs  Google Sheet script that stores votes
.github/workflows/       deploy to GitHub Pages
```
