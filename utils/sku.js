const BASE36_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SKIP_WORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "y",
  "e",
  "a",
]);

function randomBase36(length) {
  return Array.from(
    { length },
    () => BASE36_CHARS[Math.floor(Math.random() * BASE36_CHARS.length)]
  ).join("");
}

function extractInitials(name) {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter((word) => !SKIP_WORDS.has(word.toLowerCase()) && word.length > 0)
    .map((word) => word[0].toUpperCase())
    .slice(0, 4)
    .join("");

  return initials.length >= 2 ? initials : (initials + "X").slice(0, 2);
}

export function generateSku({ productName, suffixLength = 4 }) {
  const initials = extractInitials(productName);
  const suffix = randomBase36(suffixLength);
  return `${initials}-${suffix}`;
}

export function generateSkuSequential(productName, existingCount) {
  const initials = extractInitials(productName);
  const seq = String(existingCount + 1).padStart(3, "0");
  return `${initials}-${seq}`;
}
