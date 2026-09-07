# Aion 2 Companion

An English-language Electron desktop toolkit for Aion2, built around a
translated port of StepTube's Korean stat-efficiency calculator (originally
at https://kjymm2.github.io/aion2damage/) plus original tools compiled from
Korean and Taiwanese community research: a Combat Power breakdown, an
Arcana deck simulator, dungeon-mechanics guides, and a set of daily-use
utilities (checklist, boss/event timers, enhancement and crafting
calculators, patch notes).

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
macOS, `.exe`/NSIS installer on Windows, `.AppImage` on Linux) under
`release/`.
