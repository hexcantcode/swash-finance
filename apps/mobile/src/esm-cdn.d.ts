// Runtime CDN imports (the /avatars design playground pulls avatar libs from
// esm.sh with @vite-ignore). TS can't resolve URL modules — type them as any.
// Must live in a script (non-module) .d.ts: inside a module file this would
// be treated as an augmentation instead of an ambient declaration.
declare module 'https://esm.sh/*';
