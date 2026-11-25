# Causal Inference Reading Group website

A members-only site for the reading group, hosted free on GitHub Pages:

- **Next session** at the top, filled in automatically from the schedule
- **Vote**: pick your name, up to three topics, and the dates and times you can make; live results show who has voted
- **Schedule**: month calendar and list of sessions, with "Add to Google Calendar"
- **Chat**: a simple group chat
- **Papers**: every reading added to a session, with links
- **Members**: the member list

## How privacy works

The public files in this repository hold no names, votes, sessions or chat. All of that lives in **your Google Sheet**, and the website gets it only after someone types a code:

- **Group code**: for members. Opens the site, lets them vote, propose a paper and chat.
- **Organizer code**: opens the site and also shows **Add a session / Edit schedule**, **Edit members**, **Manage answers** and **Delete** on chat messages.

Each device remembers the code until someone clicks **Lock this device** at the bottom of the page. Search engines are asked not to list the site. Anyone who has the group code can pass it on, so change the code in the script if it leaks.

## Set up (one time)

1. **GitHub**: upload all files to your repository. In **Settings → Pages**, choose **Deploy from a branch**, **main**, **/ (root)**, then **Save**.
2. **Google Sheet**: create a sheet and open **Extensions → Apps Script**. Delete what's there and paste the whole of `scripts/vote-backend.gs`.
3. Change the two codes near the top of the script and click **Save**:
   ```js
   const GROUP_CODE = 'your-group-code';
   const ORGANIZER_CODE = 'your-organizer-code';
   ```
4. Click **Deploy → New deployment**, choose **Web app**, set **Execute as: Me** and **Who has access: Anyone**, then click **Deploy** and allow access. "Anyone" only lets the website reach the script. Nothing comes back without a code, and the sheet stays private to you.
5. Copy the **Web app URL** (it ends in `/exec`) into `"voteUrl"` in `data/config.json` on GitHub, then commit.
6. Open the site, type the **organizer code**, click **Edit members** and enter one name per line.
7. Give the **group code** to members.

**Updating the script later:** paste the new code, save, then **Deploy → Manage deployments**, click the pencil, set **Version: New version** and **Deploy**. The web address stays the same.

## Everyday use (organizers)

- **Add or change a session:** **Add a session** in the top box, or **Edit schedule** in the Schedule section. Pick a date, tap a time, tap a topic, tap the presenter, add a reading link, then **Save session**.
- **Delete a vote or proposal:** in the Vote section, click **Manage answers**, then tap **Delete** twice.
- **Delete a chat message:** tap **Delete** twice next to it.
- **Change members:** **Edit members** in the Members section.

You can also edit or delete rows directly in the Google Sheet. The tabs are **Members**, **Sessions**, **Responses** (votes and proposals) and **Chat**.

## Settings in the repository

`data/config.json` holds the group name, purpose, time zone (`Asia/Dubai`), the quick time buttons (`sessionTimes`) and the topic list (`scope.topics`). `data/surveys.json` holds the vote and proposal forms: the topic choices, the date range (`rows.from` / `rows.to`) and the time slots (`columns`). The other data files stay empty on purpose.

## Preview locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
