# 🏆 Scavenger Royale

A bright, colourful first-person **battle royale** for up to **8 players on your local network** (LAN / home Wi-Fi), built with three.js. It runs on keyboard and mouse or on a tablet's touch screen.

- **Big procedural city**: a 360 m island with roads, parks, warehouses and towers, plus about 130 buildings with **interiors you can enter**, including small one-room hideouts packed around the central plaza and parks. Buildings have stairs, several floors, rooms, windows and roofs to camp on. Every match gets a new layout.
- **Skydive start**: everyone parachutes in and picks their own landing spot. You can't be hurt while skydiving.
- **Respawns**: when you're knocked out you skydive back into the zone after a short countdown. You can switch class and shop for upgrades while you wait. Respawns stop in the **final two circles** (adjustable), and from then on eliminations are final.
- **Slowly shrinking zone**: seven phases, about 9 minutes in total. The first circle is wide (235 m), so the map edges stay safe at the start. The next circle is shown on the minimap, and standing outside it hurts more each phase.
- **Loot**: medkits ❤, shields 🛡 and grenades 💣 are scattered through the buildings, along with coins 🪙 and gems 💎 to collect.
- **Grenades 💣**: hold **G** (or the 💣 button on a tablet) to see the throw arc and blast radius, then release to throw. They bounce off walls, explode after 2.4 s and knock players back. Walls block the blast. The server simulates every grenade, so all players see the same bounces.
- **Supply drops 📦**: about every 75 s a crate parachutes into the next safe zone, marked by a tall light beam and on the minimap. It gives full shield, +50 health, 2 grenades and 150 points, so expect a fight over it.
- **Loot bags 💰**: eliminated players drop a bag worth some of their points, plus a grenade if they had one.
- **Kill streak rewards 🔥**: these are earned by getting kills in a row without dying. Use them with the number keys **1–4**, or the ⭐ menu on a tablet:
  - **3** kills: 📡 Radar, which shows every enemy on your minimap for 30 s
  - **6** kills: 🤖 Sentry Turret, which you place on the ground. It auto-fires at enemies until someone shoots it down.
  - **8** kills: 👁️ X-Ray Vision, which shows enemies through walls for 60 s
  - **10** kills: ✈️ Airstrike, which opens a map with every player's position revealed. Click a spot and, after a warning, 14 bombs carpet the area. Being indoors gives you some cover.
- **Jetpack 🚀** (500 🪙 in the shop): double-tap jump to take off and keep shooting while you hover. Hold crouch to sink, and press jump to switch it off. A tank holds 30 s of flight.
- **Bounty 👑**: the outright kill leader (2 or more kills) wears a crown and shows on everyone's minimap. Taking them out pays +150 points, which helps players who are behind catch up.
- **Match mutators**: the host picks one, or leaves it on 🎲 Random for a surprise each round:
  - 🌙 **Moon Jump**: low gravity
  - ⏩ **Rush Hour**: the zone moves twice as fast
  - 💰 **Gold Rush**: double points
  - 💣 **Boom Town**: start with full grenades, which recharge
  - ⚡ **Speed Demons**: everyone moves faster
  - 🔥 **Glass Cannons**: +60% damage
  - 🎯 **Headhunters**: bigger headshots
- **Time of day**: each map has its own look (Sunny Noon, Golden Hour, Candy Sunset or Fresh Morning), with a gradient sky, sun, animated water and drifting clouds.
- **End-of-match awards** (Damage Dealer, Longest Shot, Scavenger King, Demolition) and a **session leaderboard** of wins and kills in the lobby.
- **Points & shop 🛒**: you earn points from **kills (+100)** and from **scavenging** (coins +20, gems +50, any other loot +10). Spend them in the shop at any time (**B** key, or the 🛒 button on a tablet), even while waiting to respawn (upgrades only). The shop **closes in the final two circles**. It sells medkits, shield cells, Mega Shield, grenades, a jetpack, Power Core (+20% damage), Turbo Shoes (+12% speed), Spring Boots (+30% jump), Extended Mag (+50% magazine) and Radar Ping (shows every enemy on your minimap for 12 s). Points and upgrades reset each match. The server checks every purchase.
- **Three classes**

| Class | Speed | Weapon | Passive | Grenades (start / max) |
|---|---|---|---|---|
| 🔭 **Sniper** | Slow | Bolt-action, 95 dmg, about 2.6× on a headshot. Right-click to scope; very inaccurate unscoped. | **Spotter**: enemies you hit show on your minimap for 6 s. Your scope **glints** while aimed, so others can spot you. | 1 / 2 |
| 🔫 **Rifle** | Medium | Full-auto, 30-round mag, damage falloff past about 55 m. Spread grows during long sprays, so fire in bursts. | **Armored**: starts with 50 shield. | 2 / 3 |
| 🔪 **Melee** | Very fast | Knife, 55 dmg. **Double jump** and **dash** (E or right-click). A **backstab does double**. Moveset: slash, backhand, then a spinning **finisher** (+35%); attack right after a dash to **lunge** (+40%, longer reach); attack while falling to **ground-slam** (area damage); **F** throws the knife (40 dmg, 4 s cooldown). | **Lifesteal** of +15 HP per hit, takes 15% less damage. | **3 / 6** |

- **Bots** (optional, with Easy, Normal or Hard difficulty) fill empty slots so you can play with only 2 or 3 people, or practise alone. They fight, roam inside the zone and throw grenades.

---

## ▶ One-click start (on the laptop that hosts the game)

1. Download this repository: **Code ▸ Download ZIP** on GitHub, then unzip it. You can also `git clone` it.
2. Double-click the launcher for your system:
   - **Windows:** `start-windows.bat`
   - **macOS:** `start-mac.command` (the first time, right-click it ▸ **Open** to get past Gatekeeper)
   - **Linux:** `start-linux.sh`
3. Your browser opens the game. The lobby shows the address your friends need, for example:
   **`http://192.168.1.23:3000`**

The launchers check for **Node.js** (version 18 or newer) and try to install it if it is missing. On Windows this uses `winget`; on macOS it uses Homebrew. There is nothing else to install. The server has no npm dependencies, and three.js is bundled, so the game also works without internet.

> **Windows Firewall:** on the first run Windows asks whether Node.js may use the network. Tick **Private networks** and click **Allow access**. If you clicked Cancel by mistake, open *Windows Defender Firewall ▸ Allow an app* and enable Node.js for Private networks.

## ☁️ Deploy online with Render (play over the internet)

The same code runs as a web service on [Render](https://render.com), so friends anywhere can join from a link without being on your Wi-Fi.

1. Make sure the code you want is on the branch Render will use. Either merge this branch into `main`, or pick this branch in step 3.
2. Sign in at [dashboard.render.com](https://dashboard.render.com) and connect your GitHub account.
3. Choose **New ▸ Blueprint**, select this repository (and branch), and click **Apply**. Render reads [`render.yaml`](render.yaml) and creates a **web service** named `scavenger-royale`.
   - To do it by hand instead, choose **New ▸ Web Service** with runtime **Node**, build command `npm install --omit=dev`, start command `npm start` and health check path `/healthz`.
4. When the deploy finishes, open the `https://scavenger-royale-xxxx.onrender.com` link Render shows. The lobby displays that link for your friends to join.

Notes:
- **Free plan:** the service sleeps after about 15 minutes with nobody connected. The next visit takes about a minute to wake it up. A paid instance stays awake.
- **Settings:** host settings are saved to `settings.json` on the server. Render's disk is wiped on every deploy or restart, so settings go back to the defaults then.
- **Anyone with the link can join:** there's one room for up to 8 players. Only share the link with people you want in your game.
- **Hosting setup:** the server detects Render automatically (`RENDER`/`PORT` environment variables), so it skips opening a browser. It answers health checks on `/healthz` and pings every 25 seconds so idle lobby connections stay open. To use another host, set `HOSTED=1` and `PORT`.
- **Lag:** online play adds internet latency, so a nearby Render region (set in the dashboard) feels best. LAN play with the start-file launchers still works exactly as before.

## 👥 Friends joining

Friends connect to the same Wi-Fi or LAN and open the address shown in the lobby (for example `http://192.168.1.23:3000`) in **Chrome, Edge, Firefox or Safari**. On a tablet, touch controls turn on by themselves. The first person to join (normally the host laptop) is the **host 👑**. The host picks the number of bots, the bot difficulty and the mutator, then presses **START MATCH**. Anyone who joins during a match watches as a spectator and plays in the next round.

## ⚙ Host settings

The host (👑, the first person in the lobby) sets up each match from the lobby. Everyone else sees the settings, but only the host can change them. They're saved to `settings.json` next to the server, so they stay the same next time.

| Group | Settings |
|---|---|
| Players | Number of bots, bot difficulty, mutator |
| Respawns | On/off, respawn delay (3–15 s), respawns per player (unlimited or 1–5), how many final circles have no respawns or shop (1–3) |
| Shop | On/off, prices (half to ×2), points earned (×0.5 to ×3) |
| Combat | Weapon damage, bonus starting shield, grenades (off / normal / double), kill streak rewards on/off |
| Classes | Allow or ban Sniper, Rifle or Melee |
| Zone | Zone speed, zone damage |
| World | Loot amount, supply drop frequency (or off), bounty on/off |

## 🔊 Voice lines

The recorded lines in [`public/voice/`](public/voice) play for:
- the match start and respawns
- your first kill
- headshots, grenade kills, knife kills, sniper kills and ordinary kills
- your own elimination
- a victory

Each moment picks one of its takes at random. A **🔊 Voice** volume slider is in the lobby next to your name. To add or swap takes, put the files in `public/voice/` and list them in [`public/js/voice.js`](public/js/voice.js).

## 🎮 Controls

| | Keyboard + mouse | Tablet |
|---|---|---|
| Move | WASD | Left thumb stick (push it all the way to sprint) |
| Look | Mouse (click the game to capture the mouse, Esc to release it) | Drag on the right half of the screen |
| Shoot / stab | Left click | Hold **FIRE** (you can drag while holding it to aim) |
| Aim / scope | Right click (hold) | **AIM** (toggle) |
| Melee dash | E or right click | **DASH** |
| Knife throw (Melee) | F | **🗡️** |
| Jump / double jump | Space | **JUMP** |
| Crouch | C or Ctrl | **CROUCH** (toggle) |
| Sprint | Shift | Push the stick fully |
| Reload | R | **RELOAD** |
| Grenade | Hold **G** to aim, release to throw | Hold **💣** (drag to aim), release to throw |
| Kill streak rewards | 1 / 2 / 3 / 4 | ⭐ menu |
| Jetpack | Double-tap Space (Space again to land, C to sink) | Double-tap **JUMP** |
| Shop | B (1–0 to buy) | 🛒 |
| Scoreboard | Tab | ☰ |

When you're eliminated you spectate the other players. Click or tap to switch who you're watching.

### 📶 Dropped out? Just rejoin

If you close the window by accident or your internet drops, **open the game link again in the same browser** to jump straight back into the match:
- **What's kept:** your health, shield, points, upgrades, grenades, kills and respawn timer.
- **While you're away:** your character stays where you left it, and other players see a 📶 icon over it. It can still be hit, and the zone still hurts it, so nobody can disconnect to escape a fight.
- **If you were waiting to respawn:** the respawn is held until you're back.
- **If everyone disconnects:** the match waits 2 minutes before returning to the lobby.

This works because each browser keeps a private player token. A different browser or device joins as a new player.

## ⚙ Options

- Use a different port: `PORT=4000 node server.js` (on Windows: `set PORT=4000 && node server.js`). If port 3000 is busy, the server tries the next free port by itself.
- Don't open a browser on start: `node server.js --no-open`
- Force touch controls on or off: add `?touch=1` or `?touch=0` to the URL.
- Zone timings, class stats, passives, grenades, mutators, bot difficulty, point rewards and shop prices are all in [`public/shared/config.js`](public/shared/config.js).

## 🗂 Project layout

```
server.js              Zero-dependency Node server: static files + WebSocket + authoritative match logic + bots
render.yaml            Render Blueprint for one-click cloud deployment
public/index.html      Page, lobby and HUD markup
public/style.css       UI styling
public/js/main.js      Client: networking, lobby, local player, weapons, HUD, minimap, spectating
public/js/render.js    three.js rendering: sky and themes, water, merged city meshes, avatars, grenades, effects, zone, viewmodels
public/js/input.js     Keyboard/mouse (pointer lock) and touch controls
public/js/audio.js     Synthesised sound effects (WebAudio, no audio files)
public/shared/         Code shared by server and client: config, map generator, physics
public/vendor/         three.js r160 (MIT)
```

The server and every client generate the city from the same random seed, so only the seed goes over the network. Each client simulates its own movement and reports hits. The server checks fire rate and range, applies damage, runs the zone, pickups and bots, and decides the winner. This is a good fit for a trusted LAN with friends.
