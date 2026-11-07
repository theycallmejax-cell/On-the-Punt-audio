// Cuts the source artwork in art/source into per-character assets in public/assets.
// Run with `npm run art` after replacing or adding source art.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'art/source');
const OUT = path.join(ROOT, 'public/assets');
const characters = require(path.join(ROOT, 'shared/characters.json')).characters;
const byId = Object.fromEntries(characters.map((c) => [c.id, c]));

const ROSTER = {
  'roster-lads.jpg': {
    ids: [
      'banana', 'rock_bloke', 'pirate', 'traffic_cone', 'mankini_maverick', 'bin_chicken', '80s_gym_junkie', 'out_of_work_jockey',
      'spartan_warrior', 'tyler_the_tradie', 'swinger', 'bondi', 'kango', 'safari_guide', 'disco', 'stubby',
      'big_baby', 'diy_lawn_bowler', 'mad_scientist', 'super_villain', 'indy', 'scuba', 'mully', 'grant_the_gnome',
    ],
    cols: [[30, 172], [198, 340], [367, 508], [535, 677], [705, 850], [886, 1026], [1056, 1196], [1221, 1364]],
    rows: [[26, 228], [284, 470], [526, 728]],
  },
  'roster-ladies.jpg': {
    ids: ['shaz', 'narelle', 'aerobics_queen', 'the_hen', 'roller_girl', 'daisy_mae', 'bachie', 'scout', 'borbie', 'annie'],
    cols: [[50, 274], [314, 538], [578, 802], [843, 1067], [1107, 1331]],
    rows: [[28, 330], [405, 700]],
  },
  'roster-neither.jpg': {
    ids: ['astro', 'tubby', 'a_fat_cat', 'yella', 'arien', 'ninja', 'pickles_the_clown', 'silly_goose', 'emu', 'oak'],
    cols: [[30, 250], [283, 500], [535, 765], [801, 1082], [1126, 1347]],
    rows: [[26, 345], [412, 728]],
  },
};

// Arrival scenes in the pub. Grid rows 1-3 have 8 cells of 250px, row 4 has 10 cells of 200px;
// the bottom 44px of each cell is a baked-in name label that is trimmed off.
const GRID_IDS = [
  ['banana', 'rock_bloke', 'pirate', 'traffic_cone', 'mankini_maverick', 'bin_chicken', '80s_gym_junkie', 'out_of_work_jockey'],
  ['spartan_warrior', 'tyler_the_tradie', 'swinger', 'bondi', 'kango', 'safari_guide', 'disco', 'stubby'],
  ['big_baby', 'diy_lawn_bowler', 'mad_scientist', 'super_villain', 'indy', 'scuba', 'mully', 'grant_the_gnome'],
  ['shaz', 'narelle', 'bachie', 'scout', 'roller_girl', 'annie', 'astro', 'tubby', 'a_fat_cat', 'yella'],
];
const NEITHER_3X3 = {
  ids: ['astro', 'a_fat_cat', 'arien', 'ninja', 'pickles_the_clown', 'silly_goose', 'emu', 'oak', 'yella'],
  cols: [[0, 663], [671, 1329], [1337, 2000]],
  rows: [[0, 493], [501, 993], [1001, 1493]],
};
// Standalone arrival art wins over grid cells for the same character.
const STANDALONE = {
  mully: 'arrival-mully.jpg',
  daisy_mae: 'arrival-daisy-mae.jpg',
  the_hen: 'arrival-the-hen.jpg',
  roller_girl: 'arrival-roller-girl.jpg',
};

// Face position inside the roster card portrait, as fractions [centreX, top, size-of-width].
const FACE_DEFAULT = [0.5, 0.03, 0.6];
const FACE = {
  rock_bloke: [0.52, 0.12, 0.55], mankini_maverick: [0.5, 0.04, 0.55], kango: [0.52, 0.0, 0.6],
  big_baby: [0.42, 0.04, 0.6], scuba: [0.55, 0.0, 0.55], grant_the_gnome: [0.55, 0.05, 0.6],
  bin_chicken: [0.5, 0.0, 0.6], stubby: [0.5, 0.0, 0.5], traffic_cone: [0.5, 0.06, 0.5],
  roller_girl: [0.48, 0.02, 0.5], the_hen: [0.5, 0.02, 0.55], annie: [0.42, 0.04, 0.6],
  aerobics_queen: [0.38, 0.03, 0.5], daisy_mae: [0.45, 0.05, 0.5], emu: [0.68, 0.0, 0.55],
  oak: [0.5, 0.05, 0.75], silly_goose: [0.55, 0.0, 0.6], pickles_the_clown: [0.4, 0.05, 0.6],
  arien: [0.58, 0.0, 0.62], yella: [0.5, 0.0, 0.5], tubby: [0.5, 0.0, 0.62], a_fat_cat: [0.5, 0.03, 0.62],
};

const jpg = (img, q = 84) => img.jpeg({ quality: q, mozjpeg: true });

async function main() {
  const made = { card: new Set(), arrival: new Set() };
  for (const c of characters) fs.mkdirSync(path.join(OUT, 'characters', c.id), { recursive: true });

  for (const [file, g] of Object.entries(ROSTER)) {
    let i = 0;
    for (const [y0, y1] of g.rows) {
      for (const [x0, x1] of g.cols) {
        const id = g.ids[i++];
        if (!byId[id]) throw new Error(`Unknown character ${id}`);
        const w = x1 - x0, h = y1 - y0;
        const dir = path.join(OUT, 'characters', id);
        const card = sharp(path.join(SRC, file)).extract({ left: x0, top: y0, width: w, height: h });
        await jpg(card.clone().resize({ width: 360, kernel: 'lanczos3' }).sharpen()).toFile(path.join(dir, 'card.jpg'));
        const [cx, top, frac] = FACE[id] || FACE_DEFAULT;
        const side = Math.round(w * frac);
        const left = Math.max(0, Math.min(w - side, Math.round(cx * w - side / 2)));
        await jpg(sharp(path.join(SRC, file)).extract({ left: x0 + left, top: y0 + Math.round(top * h), width: side, height: side })
          .resize(192, 192, { kernel: 'lanczos3' }).sharpen()).toFile(path.join(dir, 'avatar.jpg'));
        made.card.add(id);
      }
    }
  }

  const arrival = async (id, input, extract) => {
    let img = sharp(input).extract(extract);
    const width = extract.width < 700 ? 780 : Math.min(extract.width, 1200);
    img = img.resize({ width, kernel: 'lanczos3' });
    if (extract.width < 700) img = img.sharpen({ sigma: 1.1 });
    await jpg(img, 86).toFile(path.join(OUT, 'characters', id, 'arrival.jpg'));
    made.arrival.add(id);
  };

  const grid = path.join(SRC, 'arrivals-grid.jpg');
  for (let r = 0; r < GRID_IDS.length; r++) {
    const ids = GRID_IDS[r], cw = 2000 / ids.length;
    for (let c = 0; c < ids.length; c++) {
      if (STANDALONE[ids[c]]) continue;
      await arrival(ids[c], grid, { left: Math.round(c * cw) + 3, top: r * 277 + 3, width: Math.round(cw) - 6, height: 277 - 44 - 3 });
    }
  }
  const n3 = path.join(SRC, 'arrivals-neither-3x3.jpg');
  let k = 0;
  for (const [y0, y1] of NEITHER_3X3.rows) {
    for (const [x0, x1] of NEITHER_3X3.cols) {
      await arrival(NEITHER_3X3.ids[k++], n3, { left: x0, top: y0, width: x1 - x0, height: y1 - y0 });
    }
  }
  for (const [id, file] of Object.entries(STANDALONE)) {
    const m = await sharp(path.join(SRC, file)).metadata();
    await arrival(id, path.join(SRC, file), { left: 0, top: 0, width: m.width, height: m.height });
  }

  // Characters without arrival art get their roster card standing in the pub.
  const pub = await sharp(path.join(SRC, 'hero.jpg')).extract({ left: 0, top: 330, width: 1379, height: 424 })
    .resize(780, 900, { fit: 'cover' }).blur(6).modulate({ brightness: 0.55 }).toBuffer();
  for (const c of characters) {
    if (made.arrival.has(c.id)) continue;
    const card = await sharp(path.join(OUT, 'characters', c.id, 'card.jpg')).resize({ height: 760 }).toBuffer();
    const meta = await sharp(card).metadata();
    await jpg(sharp(pub).composite([{ input: card, top: 120, left: Math.round((780 - meta.width) / 2) }]), 86)
      .toFile(path.join(OUT, 'characters', c.id, 'arrival.jpg'));
    console.log(`arrival fallback (roster card): ${c.id}`);
  }

  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  await jpg(sharp(path.join(SRC, 'hero.jpg')).resize({ width: 1379 })).toFile(path.join(OUT, 'img/hero.jpg'));
  await jpg(sharp(path.join(SRC, 'hero.jpg')).extract({ left: 0, top: 250, width: 1379, height: 504 }).resize({ width: 1000 })).toFile(path.join(OUT, 'img/pub.jpg'));
  await jpg(sharp(path.join(SRC, 'cheryl.jpg')).resize({ width: 476, kernel: 'lanczos3' }).sharpen()).toFile(path.join(OUT, 'img/cheryl.jpg'));
  await jpg(sharp(path.join(SRC, 'cheryl.jpg')).extract({ left: 70, top: 14, width: 84, height: 84 }).resize(160, 160)).toFile(path.join(OUT, 'img/cheryl-avatar.jpg'));
  await sharp(path.join(ROOT, 'On the Punt black screen fixed.png')).png().toFile(path.join(OUT, 'img/splash.png'));

  const missing = characters.filter((c) => !made.card.has(c.id)).map((c) => c.id);
  if (missing.length) throw new Error(`No roster card for: ${missing.join(', ')}`);
  console.log(`Done: ${made.card.size} cards/avatars, ${made.arrival.size} arrival scenes + fallbacks.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
