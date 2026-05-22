// Render icon.svg → icon.png at 1024×1024 with true alpha transparency.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, 'icon.svg'));
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1024 },
  background: 'rgba(0,0,0,0)',
  font: { loadSystemFonts: true },
});
const png = resvg.render().asPng();
const out = join(here, 'icon.png');
writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length.toLocaleString()} bytes)`);
