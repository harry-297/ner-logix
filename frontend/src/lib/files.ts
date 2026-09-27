/**
 * Turns a File (from an <input type="file">) into the base64 payload the
 * backend expects on FieldReportInput.photo_data, plus its mime type.
 *
 * Mirrors the backend's limit in routers/field_reports.py (MAX_PHOTO_BASE64_CHARS)
 * so an oversized photo is rejected instantly client-side instead of after a
 * full upload round-trip.
 */

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // ~5 MB, matches the backend limit

export class PhotoTooLargeError extends Error {
  constructor() {
    super("Photo is too large. Please choose an image under 5 MB.");
    this.name = "PhotoTooLargeError";
  }
}

export interface EncodedPhoto {
  /** Bare base64 payload -- no "data:image/...;base64," prefix. */
  data: string;
  mime: string;
  name: string;
}

/**
 * Reads a File as a data: URL via FileReader, then strips the prefix so the
 * caller gets plain base64 plus the mime type separately -- the shape
 * FieldReportInput.photo_data / photo_mime expects.
 */
export function fileToBase64(file: File): Promise<EncodedPhoto> {
  if (file.size > MAX_PHOTO_BYTES) {
    return Promise.reject(new PhotoTooLargeError());
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read the selected file."));
        return;
      }

      const commaIndex = result.indexOf(",");
      const data = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;

      resolve({
        data,
        mime: file.type || "image/jpeg",
        name: file.name,
      });
    };

    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}
