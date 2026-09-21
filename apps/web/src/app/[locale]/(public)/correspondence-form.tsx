import { getMessages, getTranslations } from 'next-intl/server';
import type { Locale } from '@minhaj/contracts';
import type { CorrespondenceKind } from '@minhaj/contracts/editorial';
import { correspondenceEnabled } from '@/config/correspondence';
import {
  Alert,
  Field,
  Panel,
  Select,
  TextArea,
  TextInput,
  SectionHeading,
} from '@/components/ui';
import { ActionForm } from '../(identity)/form-state';
import { sendCorrespondence } from './correspondence-actions';
export async function CorrespondenceForm({
  locale,
  kind,
}: {
  locale: Locale;
  kind: CorrespondenceKind;
}) {
  const t = await getTranslations({ locale, namespace: 'editorial' });
  if (!correspondenceEnabled()) return <Alert tone="info">{t('unavailable')}</Alert>;
  const messages = (await getMessages({ locale })).editorial;
  return (
    <Panel>
      <SectionHeading>{t(kind)}</SectionHeading>
      <p>{t('notice')}</p>
      <ActionForm
        action={sendCorrespondence}
        submitLabel={t('send')}
        pendingLabel={t('pending')}
        messages={{ ...messages, success: t('received') }}
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="kind" value={kind} />
        {kind === 'contact' ? (
          <>
            <Field id="name" label={t('name')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="name"
                  autoComplete="name"
                  maxLength={120}
                  required
                />
              )}
            </Field>
            <Field id="email" label={t('email')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={320}
                  required
                />
              )}
            </Field>
            <Field id="subject" label={t('subject')}>
              {(props) => (
                <TextInput {...props} name="subject" maxLength={200} required />
              )}
            </Field>
          </>
        ) : (
          <Field id="category" label={t('category')}>
            {(props) => (
              <Select {...props} name="category">
                {['suggestion', 'problem', 'accessibility'].map((category) => (
                  <option key={category} value={category}>
                    {t(category as 'suggestion')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field id="body" label={t('body')}>
          {(props) => (
            <TextArea {...props} name="body" maxLength={8000} rows={8} required />
          )}
        </Field>
      </ActionForm>
    </Panel>
  );
}
