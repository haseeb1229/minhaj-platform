import 'server-only';
import { correspondenceRetentionDaysSchema } from '@minhaj/contracts/editorial';
/** Public rendering reads only this non-secret runtime activation setting. */
export function correspondenceEnabled(): boolean {
  return (
    correspondenceRetentionDaysSchema.parse(
      process.env['CORRESPONDENCE_RETENTION_DAYS']?.trim() || undefined,
    ) !== undefined
  );
}
