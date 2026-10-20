# 🏆 Scavenger Royale

A bright, colourful first-person **battle royale** for up to **8 players on your local network** (LAN / home Wi-Fi), built with three.js. It runs on keyboard and mouse or on a tablet's touch screen.

- **Big procedural city**: a 360 m island with roads, parks, warehouses and towers, plus about 90 buildings with **interiors you can enter**. Buildings have stairs, several floors, rooms, windows and roofs to camp on. Every match gets a new layout.
- **Skydive start**: everyone parachutes in and picks their own landing spot.
- **Slowly shrinking zone**: six phases, about 10 minutes in total. The next circle is shown on the minimap, and standing outside it hurts more each phase.
- **Loot**: medkits ❤ and shields 🛡 are scattered through the buildings, along with coins 🪙 and gems 💎 to collect.
- **Points & shop 🛒**: you earn points from **kills (+100)** and from **scavenging** (coins +20, gems +50, any other loot +10). Spend them at any time in the shop (**B** key, or the 🛒 button on a tablet). It sells medkits, shield cells, Mega Shield, Power Core (+20% damage), Turbo Shoes (+12% speed), Spring Boots (+30% jump), Extended Mag (+50% magazine) and Radar Ping (shows every enemy on your minimap for 12 s). Points and upgrades reset each match. The server checks every purchase.
- **Three classes**

| Class | Speed | Weapon | Notes |
|---|---|---|---|
| 🔭 **Sniper** | Slow | Bolt-action, 95 dmg, about 2.6× on a headshot | Right-click to scope. Very inaccurate when not scoped. |
| 🔫 **Rifle** | Medium | Full-auto, 30-round mag | Best at medium range, with damage falloff past about 55 m. Right-click to aim. |
| 🔪 **Melee** | Very fast | Knife, 55 dmg | **Double jump** plus a **dash** (E or right-click). A **backstab does double damage**. |

- **Bots** (optional) fill empty slots so you can play with only 2 or 3 people, or practise alone.

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

## 👥 Friends joining

Friends connect to the same Wi-Fi or LAN and open the address shown in the lobby (for example `http://192.168.1.23:3000`) in **Chrome, Edge, Firefox or Safari**. On a tablet, touch controls turn on by themselves. The first person to join (normally the host laptop) is the **host 👑**. The host picks the number of bots and presses **START MATCH**. Anyone who joins during a match watches as a spectator and plays in the next round.

## 🎮 Controls

| | Keyboard + mouse | Tablet |
|---|---|---|
| Move | WASD | Left thumb stick (push it all the way to sprint) |
| Look | Mouse (click the game to capture the mouse, Esc to release it) | Drag on the right half of the screen |
| Shoot / stab | Left click | Hold **FIRE** (you can drag while holding it to aim) |
| Aim / scope | Right click (hold) | **AIM** (toggle) |
| Melee dash | E or right click | **DASH** |
| Jump / double jump | Space | **JUMP** |
| Crouch | C or Ctrl | **CROUCH** (toggle) |
| Sprint | Shift | Push the stick fully |
| Reload | R | **RELOAD** |
| Shop | B (1–8 to buy) | 🛒 |
| Scoreboard | Tab | ☰ |

When you're eliminated you spectate the other players. Click or tap to switch who you're watching.

## ⚙ Options

- Use a different port: `PORT=4000 node server.js` (on Windows: `set PORT=4000 && node server.js`). If port 3000 is busy, the server tries the next free port by itself.
- Don't open a browser on start: `node server.js --no-open`
- Force touch controls on or off: add `?touch=1` or `?touch=0` to the URL.
- Zone timings, class stats, damage, point rewards and shop prices are all in [`public/shared/config.js`](public/shared/config.js).

## 🗂 Project layout

```
server.js              Zero-dependency Node server: static files + WebSocket + authoritative match logic + bots
public/index.html      Page, lobby and HUD markup
public/style.css       UI styling
public/js/main.js      Client: networking, lobby, local player, weapons, HUD, minimap, spectating
public/js/render.js    three.js rendering: merged city meshes, avatars, effects, zone, viewmodels
public/js/input.js     Keyboard/mouse (pointer lock) and touch controls
public/js/audio.js     Synthesised sound effects (WebAudio, no audio files)
public/shared/         Code shared by server and client: config, map generator, physics
public/vendor/         three.js r160 (MIT)
```

The server and every client generate the city from the same random seed, so only the seed goes over the network. Each client simulates its own movement and reports hits. The server checks fire rate and range, applies damage, runs the zone, pickups and bots, and decides the winner. This is a good fit for a trusted LAN with friends.
