// LocalAvatarStorageRepository needs a real file extension in the on-disk
// filename -- nginx serves /storage/ as static files and infers
// Content-Type from the extension, unlike Supabase Storage (which remembers
// whatever Content-Type was given at upload time regardless of the object
// key). Callers already validate contentType.startsWith("image/") before
// calling upload(), so this only has to cover the shapes that are actually
// produced (browser file uploads, Telegram's CDN) -- anything else falls
// back to jpg rather than failing the upload.
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function contentTypeToExtension(contentType: string): string {
  return EXTENSIONS[contentType] ?? "jpg";
}
