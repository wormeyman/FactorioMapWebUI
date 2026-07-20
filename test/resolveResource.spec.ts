import { describe, expect, it } from "vite-plus/test";
import { RESOURCE_CATALOG } from "../src/noise/resources/resourceCatalog";
import { makeResourceResolver, pickWinner } from "../src/noise/resources/resolveResource";

const byName = (n: string) => RESOURCE_CATALOG.find((r) => r.name === n)!;

describe("pickWinner (order-priority overlay)", () => {
  it("returns null when nothing is present", () => {
    expect(pickWinner([])).toBe(null);
  });

  it("prefers order 'b' over order 'c' regardless of listing order", () => {
    const iron = byName("iron-ore"); // order b, patchSetIndex 0
    const uranium = byName("uranium-ore"); // order c, patchSetIndex 5
    expect(pickWinner([uranium, iron])).toBe(iron);
    expect(pickWinner([iron, uranium])).toBe(iron);
  });

  it("within an order, lower patchSetIndex wins", () => {
    const copper = byName("copper-ore"); // b, index 1
    const stone = byName("stone"); // b, index 3
    expect(pickWinner([stone, copper])).toBe(copper);
  });

  it("crude-oil (c, index 4) beats uranium (c, index 5)", () => {
    expect(pickWinner([byName("uranium-ore"), byName("crude-oil")])).toBe(byName("crude-oil"));
  });
});

describe("makeResourceResolver", () => {
  const resolve = makeResourceResolver({
    seed0: 123456,
    controls: {}, // all default to freq/size/richness 1
  });

  it("returns null at spawn (no regular patches inside the fade-in radius)", () => {
    expect(resolve(0, 0)).toBe(null);
  });

  it("finds resource patches out in the world, and every winner is a catalog member", () => {
    const names = new Set(RESOURCE_CATALOG.map((r) => r.name));
    let found = 0;
    for (let y = 512; y < 1536 && found < 3; y += 16) {
      for (let x = 512; x < 1536; x += 16) {
        const w = resolve(x, y);
        if (w) {
          expect(names.has(w.name)).toBe(true);
          found++;
          break;
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("omits a resource whose size control is 0 (never wins)", () => {
    const ironOff = makeResourceResolver({
      seed0: 123456,
      controls: { "iron-ore": { frequency: 1, size: 0, richness: 1 } },
    });
    // Scan; iron must never be returned when its size is 0.
    for (let y = 512; y < 1536; y += 32) {
      for (let x = 512; x < 1536; x += 32) {
        expect(ironOff(x, y)?.name).not.toBe("iron-ore");
      }
    }
  });
});
