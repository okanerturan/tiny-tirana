// Regenerate the landmark index on viewer/app/how.html (between <!-- lm-list --> markers) from viewer/app/landmarks.js.
//   node deploy/how_landmarks.mjs
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = fs.readFileSync(path.join(ROOT, 'viewer/app/landmarks.js'), 'utf8');
const { LANDMARKS } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const items = LANDMARKS.map(p => `  <li><a href="./?lm=${p.id}&amp;lang=en"><strong>${esc(p.name.en)}</strong></a>${p.name.sq !== p.name.en ? ` <span lang="sq">(${esc(p.name.sq)})</span>` : ''}: ${esc(p.kind.en)}</li>`).join('\n');
const block = `<!-- lm-list -->
<h2 id="landmarks">18. The landmarks</h2>
<p>Every landmark has a card with its story, a diorama and a poster drawn for this map, a photo where a freely licensed one exists, and its place on the painting. Each link below opens the map with that card, and it is also the link to share.</p>
<ul class="lm-index">
${items}
</ul>
<!-- /lm-list -->`;
const p = path.join(ROOT, 'viewer/app/how.html'); let s = fs.readFileSync(p, 'utf8');
if (s.includes('<!-- lm-list -->')) s = s.replace(/<!-- lm-list -->[\s\S]*?<!-- \/lm-list -->/, block);
else s = s.replace('<footer>Tiny Tirana is a personal', block + '\n\n<footer>Tiny Tirana is a personal');
if (!s.includes('href="#landmarks"')) s = s.replace('  <li><a href="#who">Who made this, and more maps</a></li>', '  <li><a href="#who">Who made this, and more maps</a></li>\n  <li><a href="#landmarks">The landmarks</a></li>');
fs.writeFileSync(p, s); console.log('how.html: landmark index with', LANDMARKS.length, 'entries');
