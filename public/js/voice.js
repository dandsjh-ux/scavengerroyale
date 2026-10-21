// Recorded voice lines (files live in public/voice/). Each moment picks one of its takes at random.
import { playVoice, preloadVoices } from './audio.js';

const LINES = {
  start: ['StartGoodLuckHaveFun.mp3', 'StartLetsGo.mp3', 'StartReadyToRock.mp3'],
  respawn: ['StartLetsGo.mp3', 'StartReadyToRock.mp3'],
  firstKill: ['First Kill.mp3'],
  kill: ['Kill Sound Nice.mp3', 'Killv1 Nice Shot.mp3'],
  headshot: ['Headshot 1.mp3', 'Headshot v2.mp3'],
  grenade: ['Grenade Kill Kaboom.mp3', 'GrenadeKill Boom Sweet.mp3'],
  knife: ['Knife Kill v1 Ouch.mp3', 'Knife Kill v2 Chop.mp3'],
  sniper: ['Sniper Kill Shot v1 Bullseye.mp3', 'Sniper Kill Shot v2 Never Saw That opming.mp3'],
  eliminated: ['Eliminated - Played when you die.mp3'],
  victory: ['Victory Sound - Winner Winner.mp3', 'Victory Sound - You are the champion.mp3', 'VictorySound - Well Done.mp3'],
};
const url = (f) => 'voice/' + encodeURIComponent(f);
const last = {};

export function voice(moment) {
  const list = LINES[moment];
  if (!list) return;
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === last[moment]) i = (i + 1) % list.length; // avoid repeating the same take
  last[moment] = i;
  playVoice(url(list[i]));
}

// Which line to play when *you* get a kill.
export function killVoice({ first, weapon, headshot }) {
  if (first) return voice('firstKill');
  if (weapon === 'nade') return voice('grenade');
  if (headshot) return voice('headshot');
  if (weapon === 'melee' || weapon === 'throw') return voice('knife');
  if (weapon === 'sniper') return voice('sniper');
  voice('kill');
}

let preloaded = false;
export function preloadAllVoices() {
  if (preloaded) return;
  preloaded = true;
  preloadVoices([...new Set(Object.values(LINES).flat())].map(url));
}
