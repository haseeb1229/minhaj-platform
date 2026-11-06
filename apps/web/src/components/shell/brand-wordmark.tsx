import { PRODUCT_NAME } from '@/shell/product';

/**
 * THE ONE MINHAJ WORDMARK — the product's interim identity (Rebaseline R1).
 *
 * TYPOGRAPHIC, NOT A LOGO. The product name in the display serif beside a small
 * eight-point star drawn as two interlaced squares — a neutral geometric form of
 * the tradition, never an organisational emblem. It identifies THIS PRODUCT; the
 * organisation's official logo is a separate, unmodified mark shown in the
 * footer. Replaceable with the organisation's brand pack (OPEN_DECISIONS.md §6.4).
 *
 * The name is a proper noun written in Latin script in every locale, so it
 * carries `lang="en"` and `dir="ltr"` and keeps its form inside an RTL page.
 * The star is decorative; the enclosing link supplies the accessible name.
 */
export function BrandWordmark({ tone = 'light' }: { readonly tone?: 'light' | 'ink' }) {
  return (
    <span lang="en" dir="ltr" className="inline-flex items-center gap-2.5">
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 32 32"
        className={`size-6 shrink-0 sm:size-7 ${tone === 'ink' ? 'text-ink-accent' : 'text-accent'}`}
      >
        <path
          d="M16 2.5 L19.95 6.45 L25.55 6.45 L25.55 12.05 L29.5 16 L25.55 19.95 L25.55 25.55 L19.95 25.55 L16 29.5 L12.05 25.55 L6.45 25.55 L6.45 19.95 L2.5 16 L6.45 12.05 L6.45 6.45 L12.05 6.45 Z"
          fill="currentColor"
          fillOpacity="0.14"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M17.99 11.2 L18.81 13.19 L20.8 14.01 L19.98 16 L20.8 17.99 L18.81 18.81 L17.99 20.8 L16 19.98 L14.01 20.8 L13.19 18.81 L11.2 17.99 L12.02 16 L11.2 14.01 L13.19 13.19 L14.01 11.2 L16 12.02 Z"
          fill="currentColor"
        />
      </svg>
      <span
        className={`font-serif text-[1.25rem] sm:text-[1.375rem] leading-none font-semibold tracking-[-0.02em] ${
          tone === 'ink' ? 'text-ink-foreground' : 'text-foreground'
        }`}
      >
        {PRODUCT_NAME}
      </span>
    </span>
  );
}
