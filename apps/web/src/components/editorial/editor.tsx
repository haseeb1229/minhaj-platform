'use client';
import { useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { editorialExtensions } from '@minhaj/contracts/editorial/editor';
import { Button, TextInput } from '@/components/ui';

export default function RichTextEditor({
  name,
  initial,
  label,
  labels,
  language,
}: {
  name: string;
  initial: string;
  label: string;
  labels: Readonly<Record<string, string>>;
  language: string;
}) {
  const [document, setDocument] = useState(initial);
  const [url, setUrl] = useState('');
  const editor = useEditor({
    injectCSS: false,
    extensions: editorialExtensions(),
    immediatelyRender: false,
    content: JSON.parse(initial),
    onUpdate: ({ editor }) => setDocument(JSON.stringify(editor.getJSON())),
    editorProps: {
      attributes: {
        id: name,
        role: 'textbox',
        'aria-label': label,
        'aria-multiline': 'true',
        lang: language,
        dir: language === 'en' ? 'ltr' : 'rtl',
        class: 'editorial-prose min-h-48 rounded border p-3 focus-visible:outline-2',
      },
    },
  });
  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name={name} value={document} />
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        <Button
          type="button"
          tone="secondary"
          disabled={!editor}
          aria-pressed={editor?.isActive('bold') ?? false}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          {labels['bold']}
        </Button>
        <Button
          type="button"
          tone="secondary"
          disabled={!editor}
          aria-pressed={editor?.isActive('italic') ?? false}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          {labels['italic']}
        </Button>
        <Button
          type="button"
          tone="secondary"
          disabled={!editor}
          aria-pressed={editor?.isActive('heading', { level: 2 }) ?? false}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          {labels['heading']}
        </Button>
        <Button
          type="button"
          tone="secondary"
          disabled={!editor}
          aria-pressed={editor?.isActive('paragraph') ?? false}
          onClick={() => editor?.chain().focus().setParagraph().run()}
        >
          {labels['paragraph']}
        </Button>
        <Button
          type="button"
          tone="secondary"
          disabled={!editor}
          aria-pressed={editor?.isActive('bulletList') ?? false}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          {labels['bulletList']}
        </Button>
        <Button
          type="button"
          tone="secondary"
          disabled={!editor}
          aria-pressed={editor?.isActive('orderedList') ?? false}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          {labels['orderedList']}
        </Button>
        <Button
          type="button"
          tone="secondary"
          disabled={!editor}
          aria-pressed={editor?.isActive('blockquote') ?? false}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          {labels['blockquote']}
        </Button>
        <Button
          type="button"
          tone="secondary"
          disabled={!editor}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          {labels['undo']}
        </Button>
        <Button
          type="button"
          tone="secondary"
          disabled={!editor}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          {labels['redo']}
        </Button>
      </div>
      <label htmlFor={`${name}-link`}>{labels['linkUrl']}</label>
      <TextInput
        id={`${name}-link`}
        type="url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        maxLength={2048}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          tone="secondary"
          disabled={!editor || !url}
          onClick={() =>
            editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
          }
        >
          {labels['link']}
        </Button>
        <Button
          type="button"
          tone="secondary"
          disabled={!editor}
          onClick={() => editor?.chain().focus().unsetLink().run()}
        >
          {labels['clear']}
        </Button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
