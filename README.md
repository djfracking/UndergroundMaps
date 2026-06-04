# UndergroundMaps

UndergroundMaps is a publication-safe reconstruction workspace for underground
and hardened facilities. The first workspace is a Natanz schematic editor.

Reference imagery is loaded locally in the browser for QA. It is not committed,
deployed, stored by the app, or included in clean SVG/PNG exports. Final figures
include only author-drawn vector features, notes, and classifications.

## Commands

```sh
npm install
npm run start
npm run build
firebase deploy --only hosting
```

## Licensing Notes

This repository contains the editor software only. Do not commit third-party
satellite imagery, map tiles, LiDAR scans, or reference photos unless their
license explicitly permits redistribution. Use reference materials for factual
QA and export schematic layers separately.

## Figure Caption Baseline

Schematic reconstruction based on public satellite imagery, published facility
descriptions, and author analysis. Surface features and underground structures
are approximate.
