// Generates a short random lowercase-alphanumeric string, safe to use
// as a placeholder value for uniqueness-constrained fields before a
// record's real value is known -- e.g. pods' pattern-constrained
// "slug" (see createPod in api/pods.ts) or cards' temporary "title" (see
// CardForm.tsx's createDraftRecord), both of which get overwritten
// with a real value moments later. Not cryptographically secure:
// collisions are only a problem if two placeholders land on the exact
// same key within the same uniqueness scope before either is
// overwritten, which this key space makes negligible.
const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomKey(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return out;
}
