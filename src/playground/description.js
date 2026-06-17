import DEFAULT_DESCRIPTION from '../docs/default-description.md?raw';

// A description = a title (the first markdown heading) + a body (the rest). We
// edit them separately (title in the header, body in the WYSIWYG) and recombine
// to one markdown string for storage. These helpers convert between the two.

// The first markdown heading in a description becomes the sketch's title.
export function titleFromDescription(md) {
  const m = (md || '').match(/^\s*#{1,6}\s+(.+?)\s*$/m);
  return m ? m[1].trim() : '';
}

export function bodyFromDescription(md) {
  const lines = (md || '').split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i < lines.length && /^#{1,6}\s+/.test(lines[i].trim())) i++; // drop heading
  while (i < lines.length && lines[i].trim() === '') i++;
  return lines.slice(i).join('\n');
}

export function composeDescription(title, body) {
  const t = (title || '').trim();
  const b = (body || '').trim();
  return (t ? `# ${t}\n\n` : '') + b;
}

export const DEFAULT_TITLE = titleFromDescription(DEFAULT_DESCRIPTION);
export const DEFAULT_BODY = bodyFromDescription(DEFAULT_DESCRIPTION);
export { DEFAULT_DESCRIPTION };
