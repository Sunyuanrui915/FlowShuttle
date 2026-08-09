export const maxAttachmentSizeBytes = 50 * 1024 * 1024;

export function assertAttachmentSizeBytes(
  sizeBytes: number,
  errorMessage = "Image exceeds the 50 MB size limit."
): void {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error("Invalid image size.");
  }
  if (sizeBytes > maxAttachmentSizeBytes) {
    throw new Error(errorMessage);
  }
}
