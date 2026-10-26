// An uploaded attachment is written in a card as "@/files/<ULID><ext>",
// without an origin or a pod, so the notation survives a change of origin and
// can move between pods. This is the only place that knows where such a path
// is served from (see serveAttachmentHandler in internal/serve/attachments.go).
const ATTACHMENT_PREFIX = "@/";

// Resolves an image source for use in an <img>: an attachment path becomes the
// same-origin URL "/files/<ULID><ext>"; anything else (an external URL, a
// generated render) is returned as it is.
export function resolveImageSrc(src: string): string {
  return src.startsWith(ATTACHMENT_PREFIX)
    ? `/${src.slice(ATTACHMENT_PREFIX.length)}`
    : src;
}
