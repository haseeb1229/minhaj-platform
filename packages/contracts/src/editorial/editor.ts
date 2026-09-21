import StarterKit from '@tiptap/starter-kit';

// Shared schema for the client editor and the authoritative server renderer.
export function editorialExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      codeBlock: false,
      dropcursor: false,
      gapcursor: false,
      code: false,
      horizontalRule: false,
      underline: false,
      link: { openOnClick: false, autolink: false, protocols: ['http', 'https'] },
    }),
  ];
}
