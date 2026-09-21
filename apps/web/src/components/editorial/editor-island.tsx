'use client';
import dynamic from 'next/dynamic';
const Editor = dynamic(() => import('./editor'), { ssr: false });
export function EditorIsland(props: React.ComponentProps<typeof Editor>) {
  return <Editor {...props} />;
}
