import assert from "node:assert/strict";

import {
  buildDestinationImportText,
  cleanDestinationLine,
  formatClipNote,
  getImportCounts,
  normalizeClipText,
  normalizeDestinationKey,
  parseDestinationList
} from "../lib/wanderlog-utils.js";

assert.equal(cleanDestinationLine("1. Senso-ji"), "Senso-ji");
assert.equal(cleanDestinationLine("- Meiji Shrine"), "Meiji Shrine");
assert.equal(cleanDestinationLine("[ ] Tsukiji Outer Market"), "Tsukiji Outer Market");
assert.equal(normalizeDestinationKey("Senso-ji"), normalizeDestinationKey("Senso ji"));

const parsed = parseDestinationList(
  `
  1. Senso-ji
  - Meiji Shrine
  * Shibuya Sky
  2) Senso ji
  [ ] Tsukiji Outer Market
`,
  { existingDestinations: ["Shibuya Sky"] }
);

assert.equal(parsed.items.length, 5);
assert.equal(parsed.items[0].status, "ready");
assert.equal(parsed.items[2].status, "duplicate");
assert.equal(parsed.items[2].duplicateReason, "Already seen in recent imports");
assert.equal(parsed.items[3].status, "duplicate");
assert.equal(parsed.items[3].duplicateReason, "Duplicate in pasted list");

const counts = getImportCounts(
  parsed.items.map((item) => ({
    ...item,
    included: item.status !== "duplicate"
  }))
);

assert.equal(counts.usable, 3);
assert.equal(counts.duplicates, 2);

assert.equal(normalizeClipText("  Go early.\r\n\r\n\r\nBring cash.  "), "Go early.\n\nBring cash.");

const note = formatClipNote({
  selectedText: "Go before 9 AM to avoid crowds.",
  noteType: "Tip",
  destinationType: "Attach to place",
  destinationLabel: "Senso-ji",
  tripLabel: "Japan 2026",
  includeSourceUrl: true,
  sourceTitle: "Best Things to Do in Kyoto",
  sourceUrl: "https://example.com/kyoto-guide",
  capturedAt: "2026-05-02T14:00:00.000Z"
});

assert.match(note, /Tip: Go before 9 AM to avoid crowds\./);
assert.match(note, /Trip: Japan 2026/);
assert.match(note, /Attach to place: Senso-ji/);
assert.match(note, /https:\/\/example\.com\/kyoto-guide/);

const importText = buildDestinationImportText({
  tripLabel: "Japan 2026",
  targetType: "Day",
  targetLabel: "Tokyo day 1",
  sourceTitle: "Planning source",
  sourceUrl: "https://example.com",
  preparedAt: "2026-05-02T14:00:00.000Z",
  items: [
    { name: "Senso-ji", status: "matched", matchedName: "Senso-ji, Tokyo, Japan" },
    { name: "Senso ji", status: "duplicate", duplicateReason: "Duplicate in pasted list" }
  ]
});

assert.match(importText, /Wanderlog destination import/);
assert.match(importText, /1\. Senso-ji -> Senso-ji, Tokyo, Japan/);
assert.match(importText, /Skipped:/);

console.log("Wanderlog utility tests passed.");
