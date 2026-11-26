# Causal Inference Reading Group website

A members-only site for the reading group, hosted free on GitHub Pages:

- **Next session** at the top, filled in automatically from the schedule
- **Vote, in two steps**: step 1, members pick the topics they want to read (or add their own). Step 2, members pick the dates and times they can make for each chosen topic. Live results show who has voted and the best slot for each topic
- **Schedule**: month calendar and list of sessions, with "Add to Google Calendar"
- **Chat**: a simple group chat (edit your own messages)
- **Shared files**: upload slides, notes or PDFs for the group
- **Papers**: every reading added to a session, with links
- **Members**: the member list

## How privacy works

The public files in this repository hold no names, votes, sessions or chat. All of that lives in **your Google Sheet**, and the website gets it only after someone types a code:

- **Group code**: for members. Opens the site, lets them vote, propose a paper and chat.
- **Organizer code**: opens the site and also shows **Add a session / Edit schedule**, **Edit members**, **Manage answers** and **Delete** on chat messages.

The site asks for the code again after the browser tab is closed. Someone who ticks **Keep me signed in on this device** stays signed in until they click **Sign out** at the bottom of the page. Codes remembered by older versions of the site are forgotten. Search engines are asked not to list the site. Anyone who has the group code can pass it on, so change the code in the script if it leaks.

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

Open the site with the organizer code. An **Organizer tools** bar appears at the top:

- **Site info**: group name, description, lab, regular meeting time, usual place and online link, quick start-time buttons, contact email
- **Schedule**: add, edit or delete sessions (date, time, topic, presenter, reading, what to prepare, slides and recording links)
- **Topic vote** (step 1): the topic list, how many topics each person can pick, open or closed, closing date, and the wording
- **Date vote** (step 2): which topics go to step 2 ("Fill in from step 1 results" ranks them by votes), date range, time slots, one grid per topic or a shared grid, open or closed, and the wording. Step 2 stays closed until it has at least one topic
- **Proposal form**: the wording of the Volunteer to present form
- **Members**: one name per line
- **Add paper**: add papers to the library; **Edit** and **Delete** appear next to them

Next to answers, chat messages and files, **Manage answers** and **Delete** (tap twice) remove things. Members can edit their own chat messages.

You can also edit or delete rows directly in the Google Sheet. The tabs are **Members**, **Sessions**, **Responses** (votes and proposals), **Chat**, **Files** and **Settings**. Shared files are stored in a Drive folder called **Reading group shared files**, and each file can be opened by anyone who has its link.

## Settings in the repository

`data/config.json` holds the group name, purpose, time zone (`Asia/Dubai`), the quick time buttons (`sessionTimes`) and the topic list (`scope.topics`). `data/surveys.json` holds the vote and proposal forms: the topic choices, the date range (`rows.from` / `rows.to`) and the time slots (`columns`). The other data files stay empty on purpose.

## Preview locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
