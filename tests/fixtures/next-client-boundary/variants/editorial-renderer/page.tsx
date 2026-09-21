'use client';
import { renderEditorialDocument } from '../../../../../../apps/web/src/contexts/editorial/application/rich-text.ts';
export default function EditorialRendererBoundary() {
  return <main>{typeof renderEditorialDocument}</main>;
}
