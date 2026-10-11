// An uploaded attachment is written in a card as "@/<recordId>/<filename>",
// without an origin, so the notation survives a change of origin. This is the
// only place that knows where such a path is served from.
const ATTACHMENT_PREFIX = "@/";

// Resolves an image source for use in an <img>: an attachment path becomes the
// same-origin URL PocketBase serves the file under; anything else (an external
// URL, a generated render) is returned as it is.
export function resolveImageSrc(src: string): string {
  return src.startsWith(ATTACHMENT_PREFIX)
    ? `/api/files/attachments/${src.slice(ATTACHMENT_PREFIX.length)}`
    : src;
}
