# Aion 2 Companion

An English-language Electron desktop toolkit for Aion2, built around a
translated port of StepTube's Korean stat-efficiency calculator (originally
at https://kjymm2.github.io/aion2damage/) plus original tools compiled from
Korean and Taiwanese community research.

**[⬇ Download the latest Windows build](../../releases/latest)** — portable
`.exe`, no installer needed.

## Features

### Combat Power Breakdown
Aion2 has two different "power" numbers — the official, server-computed
Combat Power, and 아툴/Atool, a community DPS-estimate score — and they can
diverge. This tab compiles what's actually confirmed: exact Arcana grade
values, an Attribute/Pantheon planner, Independent Proc mechanics (Smite,
Perfect, Multi-Hit), Accuracy/Hit mechanics with a live calculator, Soul
Engraving priority by gear slot, and Pet Understanding priority — plus two
stat-priority lists that deliberately disagree (official CP weight vs. real
DPS impact) and say why.

![Combat Power Breakdown](screenshots/01-combat-power.png)

### Damage Efficiency
The original calculator, fully translated: enter your stats to see the real
damage increase from raising each stat by 1 percentage point, which flat
attack-power sources are worth the most, and a Manastone/Gear option
simulator that recomputes your exact total damage change.

![Damage Efficiency](screenshots/02-damage-efficiency.png)

### Arcana Deck Simulator
Plan an Arcana loadout without guessing at a slot count the game itself
keeps changing — set it yourself (1–12) and the deck summary tracks Combat
Power plus which of the 7 known sets have hit their 2-piece/4-piece bonus
threshold, backed by a sourced set-effects reference.

![Arcana Deck Simulator](screenshots/03-arcana-deck-simulator.png)

### Guides
A searchable index of 17 instances across Transcendence, Expedition, Raid
and Solo — filter by category or search any dungeon, boss or mechanic
("orb", "Kromede", "wipe") and expand the one you need, with original
diagrams for the mechanics that are easier to see than to read. Entries
where no reliable write-up could be found are marked and say so, rather
than carrying invented mechanics. Alongside it: Classes, Progression, PvP,
Patch History, and a Korean/Chinese ↔ English term glossary for everything
in the app that has no official English name yet.

![Guides](screenshots/04-guides-dungeons.png)

### Other
Daily/weekly quest checklist with real reset timing, a Field/World Boss and
Taiwan-server Time Rift event timer, a best-effort Patch Notes fetcher with
guaranteed fallback links to official sources, and general-purpose
Enhancement Cost and Crafting Profit calculators.

Everything you type is saved locally between sessions — stat inputs, Arcana
deck, checklist progress, timers and calculator rows — and "Reset saved
data" in the tab bar clears it. Ctrl/Cmd+1–5 switch tabs; Ctrl/Cmd+F jumps
straight to dungeon search.

![Daily/Weekly Checklist](screenshots/05-other-checklist.png)
![Boss/Event Timer](screenshots/06-other-bosstimer.png)

## Honesty by design

Aion2 has no public API and most of its systems (Combat Power's real
formula, current Arcana slot count, exact enhancement success rates) are
either undocumented or actively changing between patches. Rather than
present guessed numbers as fact, this app is explicit throughout about
what's confirmed vs. directional, cites its Korean/Taiwanese community
sources, and gives you inputs to fill in with your own in-game values where
no reliable number exists.

## Run in development

```bash
npm install
npm start
```

## Build a distributable

```bash
npm install
npm run dist
```

This uses `electron-builder` to produce a platform-native package (`.dmg` on
macOS, `.exe`/NSIS installer or portable on Windows, `.AppImage` on Linux)
under `release/`.

## License

**Public domain — no rights reserved** ([Unlicense](LICENSE)). Copy it, fork
it, modify it, ship it, sell it; no attribution required.

That dedication covers the code in this repository only. AION and AION 2,
and all in-game names, terminology and systems referenced by this tool, are
property of NCSOFT Corporation — this is an unofficial, non-commercial fan
tool with no affiliation with or endorsement by NCSOFT. The damage model in
the Damage Efficiency tab is an English translation of a calculator
originally published by [StepTube](https://kjymm2.github.io/aion2damage/),
and guide content is compiled from community sources cited in-app.
