'use client';

import { notAnAction } from './action';

export default function InvalidServerActionPage() {
  void notAnAction;
  return <main>invalid server action</main>;
}
