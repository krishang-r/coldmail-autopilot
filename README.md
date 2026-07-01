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

## Data storage

- Templates, jobs, and send history are stored locally in `data/db.json`.
- Uploaded attachments are stored in `uploads/`.
- Logs are written to `logs/`.

No data leaves your machine except the emails themselves, sent directly via Gmail's SMTP servers.

## Disclaimer

Use this tool responsibly and in accordance with Gmail's sending limits and anti-spam policies, and applicable laws (e.g. CAN-SPAM). This project is intended for legitimate, personalized outreach — not bulk/unsolicited spam.
