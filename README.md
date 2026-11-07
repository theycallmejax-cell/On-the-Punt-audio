# On the Punt!™ — the pub in your pocket

The full multiplayer build of On the Punt!, implementing the Design Bible v5.7 and matching the look and feel of the original prototype.

© 2026 Cheyne Mitchell / Authored Intent. All rights reserved. AWG Reg 11803.

## Run it

```bash
npm install
npm start            # http://localhost:3000
npm run dev          # same, with every ritual timing at 1/4 speed for playtesting
npm test             # plays whole sessions against a real server at 50x speed
```

Open it on a phone (or a 390px-wide browser window). Tap **Begin** first: that tap unlocks audio on iOS, same as the prototype.

| Env var | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `TIME_SCALE` | `1` | Multiplies every timing. `0.25` = four times faster. Testing only. |
| `BOTS` | on | `off` stops the regulars filling quiet public tables |
| `FILL_WAIT` | `20` | Seconds a public table waits for real punters before regulars pull up a stool |
| `DATA_FILE` | `data/store.json` | Where punters, mates, rooms and balances are saved |

## What's in it

The session follows the bible's sequence exactly:

1. **Arrival** (§12.4): punters enter one at a time, each with their arrival art, voice line (where recorded) and authored line in the Banter channel. Mully never arrives first.
2. **Ensemble** (§12.5), then **"Round begins in 00:45"** (§12.6).
3. **Cheryl's opening** (§12.7), typed out, calling out a random punter at the table.
4. **The wheel** (§12.8) spins over the punters' heads with the table-slap drum roll, then **"X'S UP"** and the 20-second till-first-bet counter (§12.9). Turns then go clockwise (§12.10).
5. **Out the back** (§7): the bettor leaves the table for a private race card, with 5 minutes to bet and a reminder at 4 (§6.3). Only races jumping within 10 minutes are offered. The rest of the table sees an empty seat and keeps the banter going.
6. **The reveal** (§8): the bettor returns with 15 seconds for comment, then a 5-second drum roll, then a betting slip over three-quarters of the screen for 9 seconds, with the banter in the bottom quarter. It can't be skipped, and the slip stays up until the race finishes.
7. **The race** plays on the TV behind the table, with a live call and the result paid back into the pool.
8. **Missed turns** pass to the next punter; two missed turns cash that punter out (§6.3).

The rest of the bible is built in too:

- **Buy-ins** of $10, $20, $50 or $100. The maximum bet is half the buy-in and rises as the pool passes $120, $300, $600 and $1,200 (§6.1).
- **Sneaky side bets** (§10) come from your own account. The bell rings and Cheryl posts "Someone's placed a sneaky." (or "Sneaky on Table N." in multi-table rooms). Nobody learns who, how much or on what. A sneaky placed during a reveal holds its bell until the reveal ends.
- **Cheryl** speaks at exactly four points (§12.13–12.17): the opening, sneaky bells, the silence lines after 60 quiet seconds, and "Good session people. Bar's still open."
- **Cash out** (§9) works two ways. Anyone can leave at any time with their share of the pool, and the table carries on. Anyone can also call a table vote, where 50% or more cashes the whole table out.
- **Tables and rooms** (§4): public tables seat 6. Private rooms seat up to 24, as connected tables of 6 sharing one Banter channel.
- **Your Punters** (§11): mates are mutual, by username or from the table after a session. Rooms are named, reopenable and bookable for later, with invites. There are no follower counts or rankings.
- **The regulars** are the house characters who fill quiet public tables, banter in voice (Uncle Tom, the gnome puns, the Bin Chicken confusion), take turns and occasionally slip a sneaky on.

## Simulated for now

- **Racing and wagering.** `server/races.js` generates a continuous card across real meeting names, with odds, results and place dividends. Balances are play money (each punter starts with $1,000 and can top up in the lobby). To go live, replace `races.js` with a licensed wagering provider; the tables only call `upcoming()`, `get()`, `settle()` and listen for the `jump` and `final` events.
- **Race video.** One race video (the V1.0 release, Race 3 Belmont) plays for every race.
- **Accounts.** A punter is a username plus a device token stored in the browser. There are no passwords yet.

## Art and audio

- `art/source/` holds the original artwork: the roster sheets and Cheryl from the Design Bible, plus the arrival art. Run `npm run art` to recut every character into `public/assets/characters/<id>/` as `card.jpg`, `avatar.jpg` and `arrival.jpg`.
- Aerobics Queen and Borbie have no arrival art yet, so they arrive as their roster card in the pub. Drop their art into `tools/slice-art.js` (`STANDALONE`) and rerun.
- Arrivals cut from the big grid are small (about 250px cells, upscaled). They're the first candidates for proper upscaling.
- The `.m4a` files in the repo root are served at `/audio/…` and keep their original names, because the prototype links to them there. Voice lines exist for Banana, Mankini Maverick, Bin Chicken, Tyler, Grant and Mully. To add one, put the file in the root and set `voice_file` in `shared/characters.json`.
- Cheryl's recorded opening names Mully, so the audio plays only when Mully is the punter she calls out. Otherwise her opening is text only.

## Deploy

The app needs a long-running Node server with WebSockets, so it can't run on Netlify's static hosting. Use any Node host (Render, Fly.io, Railway, a VPS). A `Dockerfile` is included. Mount a volume at `/app/data` so punters and rooms survive restarts.

```bash
docker build -t on-the-punt .
docker run -p 3000:3000 -v punt-data:/app/data on-the-punt
```

## Layout

```
server/   index.js (sockets, lobby, mates, rooms) · room.js (table state machine) · races.js · bots.js · content.js (Cheryl + banter) · config.js (timings) · store.js
public/   index.html · css/app.css · js/app.js (screens) · js/racecard.js · js/audio.js · js/ui.js · assets/
shared/   characters.json (the roster: names, categories, arrival lines, descriptions, voice files, Mully's rule)
tools/    slice-art.js
test/     session.test.js
```
