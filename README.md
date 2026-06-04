# UndergroundMaps

UndergroundMaps is a publication-safe reconstruction workspace for underground
and hardened facilities. The first workspace is a Natanz schematic and 3D model
editor.

Reference imagery is loaded locally in the browser for QA. It is not committed,
deployed, stored by the app, or included in clean SVG/PNG exports. Final figures
include only author-drawn vector features, notes, and classifications.

## Current Features

- 2D QA drawing tools for boxes, ovals, lines, polygons, labels, and entrances.
- Photoshop-style placement stamp for pre-sized building, underground hall, and
  entrance objects.
- Live placement preview with rotation before committing a feature.
- Selected-object transform controls for move, nudge, center coordinates, and
  rotation.
- Per-feature classifications for surface buildings, underground volumes, roads,
  fences, entrances, and labels.
- Certainty tagging: confirmed, inferred, or speculative.
- Per-feature height and depth controls for 3D reconstruction.
- Three.js orbit model view with terrain, extruded structures, roads, and
  underground volumes.
- Local reference image loading for QA.
- Direct imagery URL loading for open or licensed image sources.
- Export to JSON, clean schematic SVG/PNG, and 3D PNG.

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

Google Earth, commercial satellite imagery, and web basemap screenshots should
be treated as reference-only unless you have explicit publication rights. Open
imagery can be used in final work only when its license allows publication and
the source is credited in the figure metadata/caption.

## Figure Caption Baseline

Schematic reconstruction based on public satellite imagery, published facility
descriptions, and author analysis. Surface features and underground structures
are approximate.
