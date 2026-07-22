#!/usr/bin/env python3
"""Extract the tree_* noise-expression strings from a factorio-data trees.lua.

Applies Lua's `\\z` escape semantics (skip the escape and all following
whitespace, newlines included) so each expression becomes the single-line string
the game actually parses. Output is JSON: {name: expression}.
"""
import json
import re
import sys

src = open(sys.argv[1]).read()

# Each block looks like:
#   {
#     type = "noise-expression",
#     name = "tree_01",
#     expression = "...."
#   },
# NOTE: `tree_dry` carries a trailing `-- stumpy` comment after its name, so the
# gap between fields must tolerate Lua line comments. An earlier version of this
# regex did not, and silently extracted 19 of 20 - hence the count check below.
GAP = r"(?:\s|--[^\n]*\n)*"
block = re.compile(
    r'type\s*=\s*"noise-expression"\s*,' + GAP +
    r'name\s*=\s*"(?P<name>[^"]+)"\s*,' + GAP +
    r'expression\s*=\s*"(?P<expr>(?:[^"\\]|\\.)*)"',
    re.S,
)

out = {}
for m in block.finditer(src):
    name = m.group("name")
    if not name.startswith("tree_"):
        continue
    expr = m.group("expr")
    # Lua \z: drop the escape and every whitespace char that follows it.
    expr = re.sub(r"\\z\s*", "", expr)
    # No other escapes are expected in these strings; fail loudly if that changes.
    leftover = re.findall(r"\\.", expr)
    if leftover:
        raise SystemExit(f"{name}: unhandled Lua escape(s) {sorted(set(leftover))}")
    out[name] = expr

# Guard against silently dropping a block: every `name = "tree_..."` in the file
# must have been captured.
declared = set(re.findall(r'name\s*=\s*"(tree_[A-Za-z0-9_]*)"', src))
missing = declared - set(out)
if missing:
    raise SystemExit(f"extractor dropped {sorted(missing)} - {len(out)}/{len(declared)} captured")

json.dump(out, sys.stdout, indent=2, sort_keys=True)
print()
