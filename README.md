# mello
![](https://img.shields.io/github/repo-size/timburr1/mello)
![](https://img.shields.io/github/contributors/timburr1/mello)
![](https://img.shields.io/github/last-commit/timburr1/mello)

A Trello-shaped todo board without the nonsense. Lists, cards, descriptions, subtasks, and
cards that come back daily, weekly, monthly or yearly. No analytics, no third-party scripts,
nothing phoning home.

It runs as a static site with one small API in front of your own Azure Cosmos DB account, and
installs to a phone home screen as a PWA.

## How it works

The board lives in your browser's `localStorage`. Every tap reads and writes there, so the app
is instant and works with no signal at all. Changes flush to Cosmos DB a couple of seconds
after you stop editing, and pull back when you open the app, so your phone and desktop
converge without either of them ever waiting on the network to render.

Recurring cards reset in place rather than spawning copies: ticking one records the date and
the card returns when its next period starts, so a daily habit stays one card forever and
keeps a completion history you can see a streak in.

## Running it locally

Requires Node 22 or newer.

```bash
npm install
npm run dev
```

That gets you the full board against `localStorage`. Sync will report an error because there
is no API in front of the Vite dev server, which is harmless — everything else works.

To run the API too, you need the [Static Web Apps CLI][swa-cli] and
[Azure Functions Core Tools][func-tools]:

```bash
cp api/local.settings.sample.json api/local.settings.json
# fill in COSMOS_CONNECTION_STRING, then:
npm run build
cd api && npm install && npm run build && cd ..
npx @azure/static-web-apps-cli start dist --api-location api
```

Other commands:

```bash
npm run lint      # eslint
npm test          # vitest: recurrence maths and sync merging
npm run build     # type-check (tsc -b) then build to dist/
npm run preview   # serve the built output
```

## Deploying it

### 1. Create the Cosmos DB account

In the Azure portal, create an **Azure Cosmos DB for NoSQL** account.

> **Set "Apply Free Tier Discount" to _Apply_ on the creation screen.** It cannot be turned on
> afterwards, and you only get **one free-tier account per subscription**. If the option is
> greyed out, another account in that subscription has already claimed it.

The free tier covers the first **1000 RU/s and 25 GB, for the lifetime of the account**. This
app uses on the order of 200 RU a day, so you will not come close. To be certain a stray
container can never start billing, set **Limit total account throughput** to 1000 RU/s on the
account.

You do not need to create the database or container by hand — the API creates them on first
use, with 400 RU/s provisioned on the database and shared across containers. Then copy a
connection string from **Keys**.

### 2. Create the Static Web App

Create an **Azure Static Web App** on the **Free** plan and point it at this GitHub repo. Use:

| Setting | Value |
| --- | --- |
| App location | `/` |
| Api location | `api` |
| Output location | `dist` |

Azure will commit its own workflow file. This repo already has one at
`.github/workflows/azure-static-web-apps.yml` that additionally runs lint, tests, and the type
check before deploying, so delete whichever of the two you do not want and make sure the
remaining one's `azure_static_web_apps_api_token` secret name matches the one Azure created.

Then add the connection string under **Settings → Environment variables**:

| Name | Value |
| --- | --- |
| `COSMOS_CONNECTION_STRING` | the string from step 1 |
| `COSMOS_DATABASE` | `mello` (optional) |
| `COSMOS_CONTAINER` | `items` (optional) |

### 3. Sign in

`staticwebapp.config.json` restricts `/api/*` to signed-in users and uses the built-in GitHub
provider, so there is no auth code and no passwords anywhere. The first time you open the
deployed site, hit **Sign in**. Until you do, the board still works locally; it just will not
sync.

This matters more than it sounds: without it, anyone who found the URL could read and rewrite
your board.

### 4. Install it on your phone

Open the deployed URL in the browser and use **Add to Home Screen**. It then launches
fullscreen and opens offline, because the app shell is cached and the data is local anyway.

## Backups

**Settings → Export JSON** writes out everything, completion history included. Import reads it
back. It is a plain, boring JSON file on purpose: it is a backup, and it is also the way out of
this app if you ever want one.

## Things worth knowing

- **Conflicts resolve last-write-wins, per card.** Editing the same card on two devices while
  one is offline keeps whichever edit happened later. Editing *different* cards always keeps
  both.
- **Deleted cards leave a tombstone** for 90 days so the delete propagates instead of being
  undone by the other device. They are invisible in the UI.
- **The free Cosmos tier has no SLA.** Microsoft positions it for development and small
  workloads. For a personal todo list that is fine; keep the exports if you would miss it.
- **Recurrence is computed in your local timezone**, so a daily card resets at local midnight,
  including across daylight-saving changes.

[swa-cli]: https://azure.github.io/static-web-apps-cli/
[func-tools]: https://learn.microsoft.com/azure/azure-functions/functions-run-local
