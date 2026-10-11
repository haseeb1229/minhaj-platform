export function createGalleryReferences(_port: string): {
  gallerySelectable(id: string): boolean;
} {
  return { gallerySelectable: (_id: string) => false };
}
