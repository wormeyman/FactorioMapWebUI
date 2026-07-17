# String length prefix - oracle capture notes

Source: Factorio 2.1.11 (build 86962), captured headless via a probe mod that
sets long `property_expression_names` values and dumps
`surface.get_map_exchange_string()`. Raw capture:
`string-length-prefix-probe.txt`.

## The finding

Strings in the map-exchange payload use Factorio's **space-optimized uint**
length prefix, not a bare `uint8`:

| Byte length | Prefix                          |
| ----------- | ------------------------------- |
| 0-254       | bare `u8`                       |
| 255+        | `0xff` escape, then a `u32` LE  |

Measured directly, one map, four values in `property_expression_names`:

| Value length | Prefix bytes emitted   |
| ------------ | ---------------------- |
| 254          | `fe`                   |
| 255          | `ff ff 00 00 00`       |
| 256          | `ff 00 01 00 00`       |
| 300          | `ff 2c 01 00 00`       |

The 9-byte dict *key* `elevation` in the same payload carries a bare `09`, so
short strings are unaffected - which is why all 9 read-only fixtures in
`test/fixtures/builtin-presets.json` stayed byte-exact through the fix.

This matches `readPackedUInt_8_32` in justarandomgeek's
[vscode-factoriomod-debug](https://github.com/justarandomgeek/vscode-factoriomod-debug)
(`src/Util/BufferStream.ts`), which uses the same encoding for `mod-settings.dat`
and `script.dat` - it is the game's general serializer primitive, not something
specific to map-exchange strings.

Before this was verified, `binaryReader.readString` read a bare `u8` and
`binaryWriter.writeString` wrote one, so a 1000-byte string silently truncated
to `1000 & 0xff = 232` bytes rather than throwing.

## Why the long value is reachable at all

Two constraints found while probing, which together pin down *which* strings can
exceed 254 bytes:

- **Prototype names are hard-capped at 200 characters.** Registering a
  `noise-expression` with a 300-char name fails at load with "Name field is too
  large. Max allowed size is: 200." So every string in the payload that is a
  prototype name - autoplace control names, the cliff name - can never reach the
  escape. Those were never at risk.
- **`property_expression_names` values are NOT validated.** A 300-char value that
  names no expression at all is accepted at `--create`, survives into
  `surface.map_gen_settings`, and is re-emitted in the exchange string.
  Unrecognized *keys* (`probe254`, `probe255`, `probe256` above) are likewise
  preserved rather than dropped.

So the escape is reachable in practice only through `property_expression_names`
- exactly the dict this app round-trips opaquely, and the one a modded preset is
most likely to fill with a long literal expression.

## Note on the capture file

`string-length-prefix-probe.txt` is from 2.1.11, while the codec pins
`SUPPORTED_VERSION = [2, 1, 9, 3]` (`src/codec/mapExchangeString.ts`). It will
therefore be *rejected* by `decodeExchangeString` on the version check - it is
kept as raw evidence for this note, not as a decodable fixture. Inspect it with
base64 + zlib directly. The behaviour it documents is covered by unit tests in
`test/binaryReader.spec.ts` / `test/binaryWriter.spec.ts`, which encode the
captured prefix bytes as literals.
