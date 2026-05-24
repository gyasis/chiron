import { mount } from 'svelte';
import './app.css';
import Lesson from './Lesson.svelte';
import type { ChironLesson } from './lib/schema';

declare global {
  interface Window {
    __CHIRON_LESSON__?: ChironLesson;
  }
}

console.log('[chiron] lesson.ts entering');

const target = document.getElementById('lesson-root');
if (!target) {
  console.error('[chiron] FATAL: #lesson-root not found in DOM');
  document.body.innerHTML = '<div style="padding:2rem;color:red">Mount target #lesson-root missing.</div>';
  throw new Error('lesson-root not found');
}

const lesson = window.__CHIRON_LESSON__;
if (!lesson) {
  console.error('[chiron] FATAL: window.__CHIRON_LESSON__ not set — build script did not inject lesson content');
  target.innerHTML = '<div style="padding:2rem;color:red">No lesson content. window.__CHIRON_LESSON__ is missing. Run scripts/build-lesson.mjs.</div>';
  throw new Error('no lesson content');
}

console.log('[chiron] mounting lesson:', lesson.meta?.title);
try {
  mount(Lesson, { target, props: { lesson } });
  console.log('[chiron] mount complete');
} catch (e) {
  console.error('[chiron] MOUNT THREW:', e);
  console.error('[chiron] STACK:', (e as Error)?.stack);
  target.innerHTML = `<pre style="padding:2rem;color:red;white-space:pre-wrap">Mount error: ${(e as Error)?.message}\n\n${(e as Error)?.stack ?? ''}</pre>`;
}

window.addEventListener('error', (ev) => {
  console.error('[chiron] window.error:', ev.message, 'at', ev.filename, ev.lineno, ev.colno);
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error('[chiron] unhandled rejection:', ev.reason);
});
