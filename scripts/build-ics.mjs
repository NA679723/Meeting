// Builds calendar.ics from data/sessions.json so people can subscribe to the
// group calendar. Run by the GitHub Actions deploy workflow on every push.
// Local use:  node scripts/build-ics.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Core = require(join(root, 'assets', 'core.js'));

const read = (name) => {
  const file = join(root, 'data', name + '.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${file}: ${err.message}`);
    process.exit(1);
  }
};

const config = read('config');
const papers = read('papers');
const members = read('members');
const sessions = Core.prepareSessions(read('sessions'), config);

let siteUrl = process.env.SITE_URL || '';
if (!siteUrl && process.env.GITHUB_REPOSITORY) {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
  siteUrl = repo.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? `https://${owner.toLowerCase()}.github.io/`
    : `https://${owner.toLowerCase()}.github.io/${repo}/`;
}

const ics = Core.buildICS(sessions, {
  config,
  siteUrl,
  papersById: Object.fromEntries(papers.map((p) => [p.id, p])),
  membersById: Object.fromEntries(members.map((m) => [m.id, m]))
});

writeFileSync(join(root, 'calendar.ics'), ics);
console.log(`calendar.ics: ${sessions.length} sessions${siteUrl ? ` (site: ${siteUrl})` : ''}`);
