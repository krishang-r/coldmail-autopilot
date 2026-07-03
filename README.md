# Cold Mail Autopilot

A self-hosted Node.js tool for sending personalized job-application emails to hiring teams — one relevant, tailored message per company, entirely from your own machine. It is built for individual outreach about opportunities, **not** bulk/unsolicited marketing, and its guardrails exist to keep those genuine applications out of the spam folder.

## Features

- **Email guessing** — infers likely recipient email addresses from a list of company names (across `.com`, `.in`, `.co.in`, `.co`, `.ai`, `.io`), checking each candidate domain's mail server (MX records)
- **Bounce-based verification with automatic fallback** — instead of pre-probing mailboxes (impossible on most home networks and annoying for recipients), each company gets one email; if it bounces, the next guessed address is tried automatically and the dead address is remembered (see [Mailbox verification](#mailbox-verification-bounce-based-fallback) below)
- **Templates** — save reusable subject/body/attachment bundles (with `{{company}}` placeholders) for different outreach styles
- **Randomized scheduling** — spreads sends across a time window instead of blasting them all at once, with a capacity check to confirm your batch fits before you commit
- **Deliverability guardrails** — global send pacing, business-hours-only sending, a warm-up ramp for new senders, spam-trigger content linting, and a daily send cap (see [Staying out of spam](#staying-out-of-spam) below)
- **Local dashboard** — a lightweight web UI (Express + vanilla JS) for managing templates, uploads, and send jobs
- **Send logging** — tracks what was sent, when, and to whom, stored locally in a JSON file (no external database)

Built with Express, Nodemailer, and Multer. Sends via your own Gmail account (SMTP) — no third-party email service required.

## Requirements

- [Node.js](https://nodejs.org/) 18 or later (includes npm)
- A Gmail account with **2-Step Verification** enabled and an **App Password** generated for it (regular Gmail passwords will not work)

## Setup

### 1. Get the code

```bash
git clone https://github.com/<your-username>/coldmail-autopilot.git
cd coldmail-autopilot
```

### 2. Install Node.js (if you don't have it)

<details>
<summary><strong>macOS</strong></summary>

Using [Homebrew](https://brew.sh/) (recommended):

```bash
brew install node
```

Or download the macOS installer from [nodejs.org](https://nodejs.org/).

Verify:

```bash
node -v
npm -v
```

</details>

<details>
<summary><strong>Linux</strong></summary>

Debian/Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Fedora:

```bash
sudo dnf install nodejs
```

Arch:

```bash
sudo pacman -S nodejs npm
```

Or use [nvm](https://github.com/nvm-sh/nvm) on any distro:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install --lts
```

Verify:

```bash
node -v
npm -v
```

</details>

<details>
<summary><strong>Windows</strong></summary>

Download and run the Windows installer (.msi) from [nodejs.org](https://nodejs.org/) — choose the **LTS** version and accept the default options.

Alternatively, with [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/):

```powershell
winget install OpenJS.NodeJS.LTS
```

Or with [Chocolatey](https://chocolatey.org/):

```powershell
choco install nodejs-lts
```

Verify in a new PowerShell or Command Prompt window:

```powershell
node -v
npm -v
```

> All commands below work the same in PowerShell, Command Prompt, or Git Bash on Windows unless noted otherwise.

</details>

### 3. Install project dependencies

From the project root, on any platform:

```bash
npm install
```

### 4. Create a Gmail App Password

1. Turn on [2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification) on the Google account you'll send from.
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
3. Generate a new app password (name it something like "Cold Mail Autopilot").
4. Copy the 16-character password — you'll paste it into `.env` next.

### 5. Configure environment variables

Copy the example env file:

**macOS / Linux:**

```bash
cp .env.example .env
```

**Windows (PowerShell):**

```powershell
Copy-Item .env.example .env
```

**Windows (Command Prompt):**

```cmd
copy .env.example .env
```

Then open `.env` in any text editor and fill in your details:

```dotenv
GMAIL_USER=your.email@gmail.com
GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
SENDER_NAME=Your Name
PORT=47281
```

| Variable              | Description                                                              |
| ---------------------- | ------------------------------------------------------------------------- |
| `GMAIL_USER`           | The Gmail address you're sending from                                    |
| `GMAIL_APP_PASSWORD`   | The 16-character App Password generated in step 4 (not your login password) |
| `SENDER_NAME`          | Display name used in the "From" field                                    |
| `PORT`                 | Port the local web app runs on                                           |

Also **enable IMAP** on the account (Gmail → Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP). The app watches your inbox for bounce reports after each send so it can automatically retry the next guessed address for a company — see [bounce-based fallback](#mailbox-verification-bounce-based-fallback).

Send pacing is not configurable by design: every outgoing email — whichever scheduling mode you pick — is spaced at least 4 minutes from the previous one, with at most 5 sends in any 20-minute span, shared across all jobs.

`.env` is gitignored — never commit it.

### 6. Run the app

```bash
npm start
```

For auto-restart on file changes during development:

```bash
npm run dev
```

Then open your browser to `http://localhost:47281` (or whatever `PORT` you set).

> **Note:** `npm start` only keeps the app alive as long as that terminal window/tab stays open. See the next section before you rely on scheduling.

## Keeping it running in the background

**This matters more than it sounds like.** "Schedule for later" and "randomize within a window" don't queue anything with Gmail or any outside service — they just save a job with a future timestamp in `data/db.json`. The actual sending is done by a poller in [lib/scheduler.js](lib/scheduler.js) that wakes up every 15 seconds, checks whether any job's send time has arrived, and fires it off. That poller only exists while the `node server.js` process is alive.

So if you run `npm start` in a terminal, schedule some emails for tomorrow at 9am, then close the terminal (or the laptop lid puts the process to sleep, or you log out) — the Node process is killed, the scheduler stops ticking, and **those emails simply never get sent**. There's no cron job or external worker backing this; it's all in-process. Nothing will error or warn you — the job will just sit at `pending` in the Jobs list forever, past its scheduled time, until you manually start the server again (at which point the scheduler's first tick will immediately fire anything that's overdue).

To make scheduled and randomized sends actually reliable, run the server as a background service that starts automatically and restarts itself if it crashes, independent of any terminal session.

<details>
<summary><strong>macOS — launchd (LaunchAgent)</strong></summary>

Create `~/Library/LaunchAgents/com.yourname.coldmailautopilot.plist` (swap in your own paths):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.yourname.coldmailautopilot</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/coldmail-autopilot/server.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/path/to/coldmail-autopilot</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/path/to/coldmail-autopilot/logs/out.log</string>

  <key>StandardErrorPath</key>
  <string>/path/to/coldmail-autopilot/logs/error.log</string>
</dict>
</plist>
```

Find your Node path with `which node` and use that instead of `/usr/local/bin/node` if it differs (Homebrew on Apple Silicon installs to `/opt/homebrew/bin/node`).

Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.yourname.coldmailautopilot.plist
```

`RunAtLoad` starts it at login; `KeepAlive` restarts it if it ever exits/crashes. It now runs regardless of whether any terminal is open.

If you use a label other than `com.yourname.coldmailautopilot`, set `LAUNCH_AGENT_LABEL` in `.env` to the same value — it's only used so the app's "port already in use" message points at the right plist filename.

To restart it after changing `.env` or the code (needed for those to take effect — UI changes are read live and don't need a restart):

```bash
launchctl unload ~/Library/LaunchAgents/com.yourname.coldmailautopilot.plist
launchctl load   ~/Library/LaunchAgents/com.yourname.coldmailautopilot.plist
launchctl list | grep coldmail   # a "0" in the second column means a clean start
```

**Sleep still stops sends.** Running as a LaunchAgent keeps the app alive across terminal/login sessions, but when the Mac *sleeps* the Node process is suspended and its 15-second poller freezes — so a scheduled send won't fire until the machine wakes. Two layers handle this:

- **Automatic (built in):** while sends are actively happening or imminently due, the app holds a `caffeinate` assertion so the Mac won't *idle*-sleep mid-campaign, and releases it once the queue is idle. On by default on macOS; disable with `PREVENT_SLEEP_WHILE_PENDING=false`. It does **not** hold the Mac awake for jobs scheduled far in the future (that would pin it on for no reason).
- **For a closed lid / overnight schedules:** `caffeinate` can't beat clamshell sleep, so tell the Mac to *wake itself* before the sending window. One-time setup (needs your password), waking every weekday at 08:55:

  ```bash
  sudo pmset repeat wake MTWRF 08:55:00   # check with: pmset -g sched
  ```

  Keep the Mac plugged in — scheduled wake is unreliable on battery. Once it wakes, the built-in `caffeinate` keeps it up long enough to finish the paced sends.

</details>

<details>
<summary><strong>Linux — systemd (user service)</strong></summary>

Create `~/.config/systemd/user/coldmailautopilot.service`:

```ini
[Unit]
Description=Cold Mail Autopilot

[Service]
ExecStart=/usr/bin/node /path/to/coldmail-autopilot/server.js
WorkingDirectory=/path/to/coldmail-autopilot
Restart=on-failure

[Install]
WantedBy=default.target
```

Enable and start it:

```bash
systemctl --user daemon-reload
systemctl --user enable --now coldmailautopilot.service
```

So it also survives logout, enable lingering for your user:

```bash
sudo loginctl enable-linger $USER
```

Check status/logs:

```bash
systemctl --user status coldmailautopilot.service
journalctl --user -u coldmailautopilot.service -f
```

</details>

<details>
<summary><strong>Windows — Task Scheduler</strong></summary>

1. Open **Task Scheduler** → **Create Task** (not "Basic Task", so you get more options).
2. **General** tab: name it "Cold Mail Autopilot", select **Run whether user is logged on or not**, and check **Run with highest privileges** if needed.
3. **Triggers** tab: **New** → **At log on** (and optionally **At startup**).
4. **Actions** tab: **New** → **Start a program**:
   - Program/script: path to `node.exe` (find it with `where node` in PowerShell, typically `C:\Program Files\nodejs\node.exe`)
   - Add arguments: `server.js`
   - Start in: the full path to your `coldmail-autopilot` folder
5. **Settings** tab: check **If the task fails, restart every** and set it to something like 1 minute, with a high restart limit.
6. Save (you'll be prompted for your Windows password since it runs whether logged in or not).

The task now starts the server at login/startup and restarts it if it crashes, independent of any open terminal.

**Simpler cross-platform alternative:** install [pm2](https://pm2.keymetrics.io/), which handles process supervision + auto-restart-on-boot on macOS, Linux, and Windows with the same commands:

```powershell
npm install -g pm2
pm2 start server.js --name coldmail-autopilot
pm2 save
pm2-startup install   # or: npm install -g pm2-windows-startup && pm2-startup install
```

</details>

## Templates and the `{{company}}` placeholder

A template's **subject** and **body** can contain the placeholder `{{company}}`, which is replaced per recipient when the email is sent. It's the one built-in personalization token — nothing else is substituted.

**What fills it depends on how you added the recipient:**

| How the recipient was added | What `{{company}}` becomes |
| --- | --- |
| **By company name** tab (guessed address) | The company name you typed (e.g. `Acme`) |
| **Exact email addresses** tab, as `hr@acme.com, Acme` | The text after the comma (`Acme`) |
| **Exact email addresses** tab, as just `hr@acme.com` | An **empty string** — the placeholder collapses to nothing |

So the placeholder is *always* replaced — it's never left as literal `{{company}}`. But when there's no company, it becomes empty, which can leave awkward spacing or grammar:

```
Template:  Hi {{company}} team,
With Acme: Hi Acme team,
No company: Hi  team,          ← note the double space where the name would go
```

**Tips:**
- In the *Exact email addresses* tab, put the company after a comma (`hr@acme.com, Acme`) so personalization works.
- If you'll send to addresses without a company, write the template so it still reads correctly when the placeholder is empty (e.g. `Hi there,` instead of `Hi {{company}} team,`).
- The placeholder works in **both** the subject and the body, and is case-sensitive: use exactly `{{company}}` (spaces inside the braces are fine, e.g. `{{ company }}`).

## Mailbox verification: bounce-based fallback

The "Guess emails" step checks whether a **domain** has a mail server (an MX record) — it can't tell whether `hr@company.com` specifically exists, so every prefix guess for a live domain (`hr@`, `careers@`, `jobs@`, ...) is an unverified guess. Guessed domains now include startup-typical TLDs too (`.com`, `.in`, `.co.in`, `.co`, `.ai`, `.io`), each individually MX-checked.

There is deliberately **no pre-verification step**. Probing mailboxes over SMTP doesn't work from home/mobile networks (outbound port 25 is blocked, so every probe returns "no answer"), and sending "is this the right address?" test emails puts a junk email in a real recruiter's inbox before your actual one. Instead, the cold email itself is the test:

1. With **"One email per company"** checked (the default, in the Recipients section), a job only emails the *first* selected address per company — `hr@dhan.com`, say. The other selected candidates (`careers@`, `jobs@`, ...) are stored in the job with a `fallback` status and are **not** sent.
2. After every send, a background watcher ([lib/bounceWatcher.js](lib/bounceWatcher.js)) polls your own inbox over IMAP (every 60s, for `BOUNCE_WATCH_MS` ≈ 45 min per send) for bounce reports from mailer-daemon/postmaster. Instant rejections (Gmail's synchronous 5xx) are caught at send time without waiting.
3. When a send bounces, the address is marked **bounced**, removed from the sent-emails sheet, cached as invalid for 30 days, and **the next fallback candidate for that company is promoted and sent automatically** (under the normal 4-min/5-per-20-min pacing).

4. Addresses that bounced before show up as **"❌ bounced before — auto-unticked"** in future guess results, because re-sending to a known-dead address is the single strongest "this sender is a spammer scraping addresses" signal a mailbox provider can see.

Why this beats pre-verification: no extra email ever lands in a real person's inbox, it works on any network, and each company still ends up with at most one delivered email. The trade-offs: bounces land on your sending account (a handful is normal and harmless — keep guess lists sensible), and a very slow receiving server can bounce after the watch window, in which case the fallback isn't tried automatically.

Uncheck "One email per company" to email every selected address instead; bounce detection still runs, there's just nothing to fall back to.

## Staying out of spam

Unsolicited email from an unknown sender is exactly the kind of traffic spam filters scrutinize hardest — even when it's a genuine, personalized job application. The tool builds in the technical hygiene that keeps legitimate outreach in the inbox. Some of it is automatic; some depends on you configuring it and writing good content.

### What the tool does for you automatically

- **Sent exactly as written** — no unsubscribe footer, postal address, or `List-Unsubscribe` header is ever added. Those are bulk-mail conventions; this tool sends personal 1:1 job applications, so anything appended would only make a human email read as mass marketing (to the recipient and to spam filters alike).
- **Daily send cap** — sending stops at `DAILY_SEND_LIMIT` (default 450) messages per day and resumes automatically the next day. Going over your provider's limit (~500/day for a free `gmail.com` account, 2000 for Workspace) gets the account temporarily blocked and damages sender reputation. A job that hits the cap shows a `paused_daily_limit` status and picks up where it left off. Set `DAILY_SEND_LIMIT=0` to disable.
- **Global send pacing** — every outgoing email, in *all three* scheduling modes ("send now", fixed time, randomized window), passes through one shared gate: at least 4 minutes between sends and at most 5 sends in any rolling 20-minute span, across all jobs at once, with random jitter on top so the cadence doesn't look robotic. *Why:* bursts of identical mail from one account are the most basic bulk-sender signature there is. A "send now" job with 20 recipients therefore drips out over ~1.5 hours by design.
- **Business-hours sending** — sends only go out between `SEND_HOURS_START` and `SEND_HOURS_END` (default 09:00–18:00), Monday–Friday (`SEND_ON_WEEKENDS=false`); anything that comes due outside that window is held, not dropped, until it reopens. *Why:* a 3 a.m. or Sunday timestamp is a classic automation fingerprint — real applicants email recruiters during working hours, and off-hours mail goes unread anyway. Randomized windows placed entirely outside these hours are rejected at creation so the schedule you see is the schedule that happens.
- **Warm-up ramp** — the enforced daily cap starts at `WARMUP_START_LIMIT` (default 20) in the week of your first-ever send and roughly doubles each week until it reaches `DAILY_SEND_LIMIT`. *Why:* providers score senders on history; an account that suddenly goes from a handful of emails a day to hundreds looks exactly like a compromised or freshly-bought spam account, even when every message is legitimate. The dashboard shows which warm-up week you're in.
- **One recipient per message** — every email is sent individually with a single `To:`, never a giant `To`/`CC`/`BCC` blast.
- **Authenticated Gmail SMTP** — because mail is sent through Gmail's own servers with your credentials, SPF, DKIM, and DMARC all pass for `gmail.com` with no DNS setup on your part.
- **Content linter** — when you pick or edit a template, the UI flags common spam triggers (ALL-CAPS subjects, `!!!`, phrases like "act now"/"100% free"/"guarantee", URL shorteners, too many links, non-personalized mass copy). These are advisory warnings — they never block a send, they just tell you what to rephrase.
- **Low bounce rate** — [bounce-based fallback](#mailbox-verification-bounce-based-fallback) sends only one address per company, detects bounces via IMAP, marks bounced addresses invalid for 30 days so they're never retried, and keeps your "sent" records honest. *Why:* bounce rate is the metric receivers punish hardest — repeatedly mailing dead addresses is how address-scraping spammers behave.

### What still depends on you

No tool can make spammy sending look legitimate. To actually stay in the inbox:

- **Personalize.** Use the `{{company}}` placeholder (and write genuinely relevant copy). Identical mass copy is the easiest thing for filters to catch.
- **Keep volume modest and steady.** The warm-up ramp enforces a gradual start, but even at full cap, blasting the maximum every single day from a personal Gmail is risky. Fewer, better-targeted emails outperform volume.
- **Write to get replies.** A reply is the strongest positive reputation signal Gmail has. End with a short, specific question ("Is your team hiring backend interns this quarter?").
- **Use an aged account.** A long-lived account with normal activity gets far more benefit of the doubt than one created last week.
- **Honor replies asking you to stop.** If someone replies asking not to be contacted, don't email them or their company again — a spam complaint hurts you far more than one lost lead.
- **Watch your content.** Avoid attachments where you can (a resume link often beats a PDF attachment for deliverability), skip image-heavy HTML, and keep links to one or two.
- **One touch per company.** The duplicate warning only matches exact addresses — emailing `careers@x.com` a week after `hr@x.com` still lands with the same team. One email (plus at most one follow-up) per company per few weeks.

The relevant `.env` knobs: `DAILY_SEND_LIMIT`, `WARMUP_START_LIMIT`, `SEND_HOURS_START`/`SEND_HOURS_END`, `SEND_ON_WEEKENDS`, and `REPLY_TO`. (Send pacing is deliberately not configurable.)

## Data storage

- Templates, jobs, and send history are stored locally in `data/db.json`.
- Addresses that bounced (known-invalid for 30 days) are cached locally in `data/mailbox-verify-cache.json`.
- Uploaded attachments are stored in `uploads/`.
- Logs are written to `logs/`.

No data leaves your machine except the emails themselves (sent directly via Gmail's SMTP servers); bounce detection only reads your own inbox over IMAP.

## Disclaimer

Use this tool responsibly and in accordance with Gmail's sending limits and anti-spam policies, and applicable laws (e.g. CAN-SPAM). This project is intended for legitimate, personalized outreach — not bulk/unsolicited spam.

## License

[MIT](LICENSE)
