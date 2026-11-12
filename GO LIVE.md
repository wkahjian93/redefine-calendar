# Going live: what's needed from Kah Jian

Same setup as the Referrals Tracker. Claude does the clicking in your Chrome; you type the secrets yourself.

| # | What | Who | Format |
|---|------|-----|--------|
| 1 | **Team code** (6+ characters) and **leader code** (10+ characters) | You choose | Typed by you into Google Script properties, never into chat |
| 2 | **OpenAI API key** (for photo import) | Reuse your existing key | Typed by you into Script properties |
| 3 | **Firebase project** "REDEFINE Calendar" under your Gmail (free Spark plan) | Claude creates it in your Chrome, with your OK | Gives the web config + VAPID key (public, goes in `docs/config.js`) and a **service-account JSON file** (secret, you paste the whole file into the `FCM_SERVICE_ACCOUNT` Script property, then delete the download) |
| 4 | **Apps Script project** "REDEFINE Calendar" (Web app, Execute as Me, Anyone) | Claude pastes `server/Code.gs`, you run `setup()` once and approve the permissions | Creates the Sheet "REDEFINE Calendar Data" plus the 5-minute reminder, 8am and 9pm jobs |
| 5 | **Public GitHub repo** wkahjian93/redefine-calendar, served by GitHub Pages from `docs/` | Claude, on your "yes, public is fine" | The app link to share with the team |

Nothing goes live until you say so. No client data goes into the public repo: the code is public, but all data lives in your private Google Sheet.

## Updating later
- App: edit `docs/`, bump `CACHE` in `docs/sw.js`, then commit and push.
- Server: run `node build.js`, paste `server/Code.gs` into Apps Script, then Deploy → Manage deployments → edit → New version. The link stays the same.
- Tests: `node test.js`. Local preview: `node tools/serve.js` → http://localhost:5200 (team code `test-team`, leader `test-leader-code`, PIN 1234).

## Limits to know
- iPhone pop-ups need iOS 16.4+ **and** the app added to the Home Screen (Apple's rule).
- Google Apps Script is fine for a team of up to about 50 people. A comment reaches others within about 20 seconds while their app is open, or straight away as a pop-up once Firebase is on.
- Repeating events from an .ics import: only the first one is copied (flagged in the check list).
