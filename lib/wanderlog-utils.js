export const MAX_CLIP_TEXT_LENGTH = 2000;
export const MAX_IMPORT_DESTINATIONS = 50;

export function normalizeSearch(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

export function normalizeClipText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanDestinationLine(value) {
  return String(value || "")
    .replace(/^\s*(?:[-*+]|\u2022|\u25E6|\u2043)\s*/, "")
    .replace(/^\s*(?:\[[ xX]\]|\([ xX]\))\s*/, "")
    .replace(/^\s*(?:\d{1,3}|[A-Za-z])(?:[.)]| -|:)\s*/, "")
    .replace(/^[\u201C\u201D"']+|[\u201C\u201D"']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDestinationKey(value) {
  return cleanDestinationLine(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

export function parseDestinationList(value, options = {}) {
  const existingDestinations = options.existingDestinations || [];
  const maxItems = options.maxItems || MAX_IMPORT_DESTINATIONS;
  const existingKeys = new Set(existingDestinations.map((item) => normalizeDestinationKey(item)));
  const seenKeys = new Set();
  const parsed = [];
  let cleanLineCount = 0;

  String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line, index) => {
      const name = cleanDestinationLine(line);
      const key = normalizeDestinationKey(name);

      if (!key) {
        return;
      }

      cleanLineCount += 1;

      if (parsed.length >= maxItems) {
        return;
      }

      const duplicateInPaste = seenKeys.has(key);
      const duplicateFromHistory = existingKeys.has(key);
      const duplicateReason = duplicateInPaste
        ? "Duplicate in pasted list"
        : duplicateFromHistory
          ? "Already seen in recent imports"
          : "";

      parsed.push({
        lineNumber: index + 1,
        name,
        key,
        status: duplicateReason ? "duplicate" : "ready",
        duplicateReason
      });

      seenKeys.add(key);
    });

  return {
    items: parsed,
    cleanLineCount,
    truncatedCount: Math.max(0, cleanLineCount - parsed.length)
  };
}

export function getImportCounts(items) {
  const activeItems = items.filter((item) => item.included !== false);
  const usableItems = activeItems.filter((item) => item.status !== "duplicate");

  return {
    total: items.length,
    active: activeItems.length,
    usable: usableItems.length,
    duplicates: items.filter((item) => item.status === "duplicate").length,
    matched: usableItems.filter((item) => item.status === "matched").length,
    unmatched: usableItems.filter((item) => item.status === "unmatched").length,
    failed: usableItems.filter((item) => item.status === "failed").length,
    checking: usableItems.filter((item) => item.status === "checking").length,
    excluded: items.filter((item) => item.included === false).length
  };
}

export function formatClipNote(clip) {
  const noteText = clip.selectedText.includes("\n")
    ? `${clip.noteType}:\n${clip.selectedText}`
    : `${clip.noteType}: ${clip.selectedText}`;
  const metadata = [];

  if (clip.tripLabel) {
    metadata.push(`Trip: ${clip.tripLabel}`);
  }

  metadata.push(
    clip.destinationLabel
      ? `${clip.destinationType}: ${clip.destinationLabel}`
      : `Destination: ${clip.destinationType}`
  );

  if (clip.sourceTitle) {
    metadata.push(`Source: ${clip.sourceTitle}`);
  }

  if (clip.includeSourceUrl && clip.sourceUrl) {
    metadata.push(clip.sourceUrl);
  }

  metadata.push(`Captured: ${formatDateTime(clip.capturedAt)}`);
  return `${noteText}\n\n${metadata.join("\n")}`;
}

export function buildDestinationImportText(session) {
  const usableItems = session.items.filter(
    (item) => item.included !== false && item.status !== "duplicate"
  );
  const skippedItems = session.items.filter(
    (item) => item.included === false || item.status === "duplicate"
  );
  const target = session.targetLabel
    ? `${session.targetType}: ${session.targetLabel}`
    : session.targetType;
  const lines = ["Wanderlog destination import"];

  if (session.tripLabel) {
    lines.push(`Trip: ${session.tripLabel}`);
  }

  lines.push(`Target: ${target}`);

  if (session.sourceTitle) {
    lines.push(`Source: ${session.sourceTitle}`);
  }

  if (session.sourceUrl) {
    lines.push(session.sourceUrl);
  }

  lines.push("", "Destinations:");
  usableItems.forEach((item, index) => {
    const match = item.matchedName ? ` -> ${item.matchedName}` : "";
    lines.push(`${index + 1}. ${item.name}${match}`);
  });

  if (skippedItems.length) {
    lines.push("", "Skipped:");
    skippedItems.forEach((item) => {
      const reason = item.duplicateReason || "Removed from preview";
      lines.push(`- ${item.name} (${reason})`);
    });
  }

  lines.push("", `Prepared: ${formatDateTime(session.preparedAt)}`);
  return lines.join("\n");
}

export function truncate(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleString();
  }

  return date.toLocaleString();
}
