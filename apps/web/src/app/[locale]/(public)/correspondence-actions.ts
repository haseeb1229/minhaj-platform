'use server';
import { localeSchema } from '@minhaj/contracts';
import { correspondenceKindSchema } from '@minhaj/contracts/editorial';
import { correspondenceIntake } from '@/composition/correspondence-intake';
import { publicClientAddress } from '@/composition/request-address';
import { appLogger } from '@/composition/logging';
import { editorialFailure } from '@/contexts/editorial';
import type { FormActionState } from '../(identity)/form-state';
export async function sendCorrespondence(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    localeSchema.parse(form.get('locale'));
    const kind = correspondenceKindSchema.parse(form.get('kind'));
    const input =
      kind === 'contact'
        ? {
            name: form.get('name'),
            email: form.get('email'),
            subject: form.get('subject'),
            body: form.get('body'),
          }
        : { category: form.get('category'), body: form.get('body') };
    await correspondenceIntake().submit(kind, input, await publicClientAddress());
    return { status: 'success' };
  } catch (error) {
    const failure = editorialFailure(error);
    if (failure === 'unavailable')
      appLogger().error(
        { operation: 'correspondence-submission' },
        'Correspondence submission failed.',
      );
    return { status: 'error', failure };
  }
}
