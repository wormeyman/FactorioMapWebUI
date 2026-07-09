# Cracking `opaqueRestA` (the 24-byte mid-block span)

Date: 2026-07-08
Status: approved, in progress

## Problem

The map-exchange mid-block still carries one opaque span: `opaqueRestA`, 24 bytes
between `height` and `starting_area`. It is byte-identical across all 17 samples
we hold (9 builtins + 8 `.txt` fixtures), including fixtures that vary width,
height, seed, starting_area, peaceful_mode, no_enemies_mode and starting_points.
Because there is zero variation, it cannot be cracked by diffing existing data.

## What the bytes already tell us

Raw (identical everywhere):

```
ff 7f | 00 20 ff ff | 00 20 ff ff | ff 7f | 00 e0 00 00 | 00 e0 00 00 | 00 00 01 80
sent. |   int32 x    |   int32 y    | sent. |   int32 x    |   int32 y    |  trailer(4)
└──────── position 1 (10 bytes) ─────┘└──────── position 2 (10 bytes) ─────┘
```

- Position 1: int32 x = `0xffff2000` = -57344 → -224 tiles; y = same → -224.
- Position 2: int32 x = `0x0000e000` = +57344 → +224 tiles; y = same → +224.
- Trailer: `00 00 01 80` (unknown - orientation or a flag).

So `opaqueRestA` decodes as a BoundingBox from (-224, -224) to (+224, +224): a
symmetric 448-tile (14-chunk) box centred on the origin. This sits exactly where
flameSla's 1.x parser placed `area_to_generate_at_start`. Each position uses the
same `0x7fff` sentinel + absolute-int32 encoding already validated for
`starting_points` (x=450 → `0x0001C200`), so the two positions can be decoded
with high confidence.

## Hypothesis

`opaqueRestA` = `area_to_generate_at_start` and its box scales
(chunk-quantized) with `starting_area`. The `starting-area-diff.txt` fixture used
`1.333` and did not move it, but ±224 tiles is exactly 7 chunks, so a small
multiplier plausibly rounds to the same chunk count. A large multiplier should
move the box.

## Method

Reusable headless-fixture harness (from the cracked-layout memory recipe), so it
runs alongside Eric's live game without touching lock-held userdata:

1. Temp `--config` INI: `[path] write-data` → temp dir; `read-data` → absolute
   path to the game's `Contents/data`.
2. Temp mod dir: `mod-list.json` enabling `base` + a tiny `sp-dumper` mod whose
   `control.lua` writes `get_map_exchange_string()` to `script-output/sp_out.txt`
   on `on_init` (and `on_nth_tick(1)`).
3. Generate: `factorio --config <cfg> --create <save.zip>
   --map-gen-settings <mgs.json> --map-gen-seed 123456 --mod-directory <mods>`.
   `map-gen-settings.json` may be partial (merges with defaults).

## Experiment sequence

1. Baseline `starting_area = 1.0` → must reproduce the corpus's ±224 box
   (validates the harness end-to-end).
2. `starting_area = 5.0` → does the box grow?
   - If yes: sweep `{2, 3, 4}`, derive the tiles ↔ starting_area formula, capture
     fixtures, then type `opaqueRestA` and add TDD tests pinning the int32 offsets.
   - If no: secondary test - a small finite map (e.g. `200 x 200`) to see whether
     the box clamps to map size.
3. If nothing moves it: conclude it is a hardcoded constant and fall back to
   structural typing anyway (the encoding is already validated), documented as
   corpus-constant.

## Deliverable (either branch)

- `opaqueRestA` replaced by typed fields (`areaToGenerateAtStart` with
  `leftTop` / `rightBottom` MapPositions in tile units, plus the 4-byte trailer
  as a minimal typed/opaque span until identified).
- Byte-exact round-trip preserved for all 9 builtins and every fixture.
- Signed int32 already exists on the reader/writer (added for starting_points);
  reuse it.
- Any new fixtures committed and documented in `test/fixtures/README.md`.
- Memory (`mid-block-prior-art`) and README updated.

## Notes / risks

- If the CLI hangs headless, hand Eric the exact commands to run instead.
- The field may have no map-gen-settings.json knob at all (it is absent from the
  public 2.x MapGenSettings type); the structural-typing fallback covers that.
- The 4-byte trailer may stay opaque if no fixture disambiguates it.
