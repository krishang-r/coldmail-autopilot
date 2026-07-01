# Cold Mail Autopilot

A self-hosted Node.js tool for running cold email outreach campaigns to hiring teams, entirely from your own machine.

## Features

- **Email guessing** — infers likely recipient email addresses from a list of company names
- **Templates** — save reusable subject/body/attachment bundles (with `{{company}}` placeholders) for different outreach styles
- **Randomized scheduling** — spreads sends across a time window instead of blasting them all at once, with a capacity check to confirm your batch fits before you commit
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
SEND_DELAY_MS=4000
```

| Variable              | Description                                                              |
| ---------------------- | ------------------------------------------------------------------------- |
| `GMAIL_USER`           | The Gmail address you're sending from                                    |
| `GMAIL_APP_PASSWORD`   | The 16-character App Password generated in step 4 (not your login password) |
| `SENDER_NAME`          | Display name used in the "From" field                                    |
| `PORT`                 | Port the local web app runs on                                           |
| `SEND_DELAY_MS`        | Delay between outgoing emails, in milliseconds, to avoid rate limits/spam flags |

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

To stop it:

```bash
launchctl unload ~/Library/LaunchAgents/com.yourname.coldmailautopilot.plist
```

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

## Data storage

- Templates, jobs, and send history are stored locally in `data/db.json`.
- Uploaded attachments are stored in `uploads/`.
- Logs are written to `logs/`.

No data leaves your machine except the emails themselves, sent directly via Gmail's SMTP servers.

## Disclaimer

Use this tool responsibly and in accordance with Gmail's sending limits and anti-spam policies, and applicable laws (e.g. CAN-SPAM). This project is intended for legitimate, personalized outreach — not bulk/unsolicited spam.
