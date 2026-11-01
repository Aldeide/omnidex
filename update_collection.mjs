import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPDATER_DIR = path.join(__dirname, '_updater');

// CLI options
const args = process.argv.slice(2);
const NO_PUSH = args.includes('--no-push');
const FORCE_PUSH = args.includes('--force-push');
const SILENT = args.includes('--silent');

function log(...msg) {
  console.log(...msg);
}

if (!SILENT) {
  console.log('====================================================');
  console.log('       OmniDex - Mise à jour de la collection       ');
  console.log('====================================================\n');
}

// 1. Shims for Node ESM
globalThis.document = {
  createElement: () => ({ relList: { supports: () => true } }),
  querySelectorAll: () => []
};
globalThis.window = globalThis;
globalThis.location = { protocol: 'https:', host: 'omnidex.cards' };

// 2. Load token from Environment Variable or Token Files
let token = null;
const envToken = process.env.OMNIDEX_TOKEN;

if (envToken) {
  try {
    const trimmed = envToken.trim();
    if (trimmed.startsWith('[')) {
      token = new Uint8Array(JSON.parse(trimmed));
    } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      token = new Uint8Array(Buffer.from(trimmed, 'hex'));
    } else {
      // base64 / base64url
      token = new Uint8Array(Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    }
    log(`[+] Jeton chargé depuis la variable d'environnement OMNIDEX_TOKEN (${token.length} octets).`);
  } catch (err) {
    console.warn('[-] Erreur parsing OMNIDEX_TOKEN depuis l\'environnement :', err.message);
  }
}

if (!token) {
  const tokenPath = path.join(UPDATER_DIR, 'token.json');
  const altTokenPath = path.join(UPDATER_DIR, 'aldeide_token.json');
  const targetPath = fs.existsSync(tokenPath) ? tokenPath : (fs.existsSync(altTokenPath) ? altTokenPath : null);

  if (!targetPath) {
    console.error('[-] Erreur : Jeton introuvable ! Définissez OMNIDEX_TOKEN ou placez token.json dans _updater.');
    process.exit(1);
  }

  const tokenData = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
  token = new Uint8Array(tokenData.bytes || Buffer.from(tokenData.hex, 'hex'));
  log(`[+] Jeton de session chargé depuis ${path.basename(targetPath)} (${token.length} octets).`);
}

// 3. Ensure Catalogue is available (auto-download via Python if missing)
const catCardsPath = path.join(UPDATER_DIR, 'catalogue_cards.json');
const catMetaPath = path.join(UPDATER_DIR, 'catalogue_metadata.json');

if (!fs.existsSync(catCardsPath) || !fs.existsSync(catMetaPath) || fs.statSync(catCardsPath).size < 1000000) {
  log('[+] Catalogue manquant ou incomplet. Décodage du catalogue OmniDex en cours...');
  try {
    execSync('python _updater/decode_catalogue.py', { cwd: __dirname, stdio: 'inherit' });
  } catch (err) {
    console.error('[-] Échec du décodage du catalogue avec decode_catalogue.py :', err.message);
    process.exit(1);
  }
}

// 4. Import Omnidex protocol codec
const { L: be, F: ge } = await import('./_updater/avatar-QsIDJbSu.js');

log('[+] Connexion au serveur WebSocket (wss://omnidex.cards/ws)...');
const ws = new WebSocket('wss://omnidex.cards/ws', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    'Origin': 'https://omnidex.cards'
  }
});
ws.binaryType = 'arraybuffer';

let rid = 0;
const collected = {
  account: null,
  welcome: null,
  cards: null,
  shards: 0,
  binders: [],
  tables: [],
  market: null,
  friends: [],
  home: null,
  messages: []
};

let syncTimer = null;
const globalTimeout = setTimeout(() => {
  console.error('[-] Délai d\'attente dépassé (timeout 25s) sans réponse du serveur.');
  try { ws.close(); } catch {}
  process.exit(1);
}, 25000);

ws.onopen = () => {
  log('[+] WebSocket connecté ! Envoi de l\'authentification...');
  ws.send(be({
    type: 'auth',
    protocol: 67,
    token: token,
    browser: 'chrome',
    os: 'autre'
  }));
};

ws.onmessage = (event) => {
  const buf = new Uint8Array(event.data);
  try {
    const msg = ge(buf);
    collected.messages.push(msg);

    if (msg.type === 'welcome') {
      log(`[+] Authentification réussie ! Compte #${msg.account}`);
      collected.welcome = msg;
      collected.account = msg.account;

      log('[+] Synchronisation de la collection et des classeurs...');
      ws.send(be({ type: 'sync', rid: ++rid, since: 0 }));
      ws.send(be({ type: 'binders', rid: ++rid, since: 0 }));
      scheduleFinish();
    } else if (msg.type === 'home') {
      collected.home = msg;
    } else if (msg.type === 'cards' && msg.entries) {
      log(`[+] Cartes reçues : ${msg.entries.length} entrées, ${msg.shards} éclats.`);
      collected.cards = msg.entries;
      collected.shards = msg.shards;
      scheduleFinish();
    } else if (msg.type === 'binder') {
      collected.binders.push(msg.binder);
      scheduleFinish();
    } else if (msg.type === 'table') {
      collected.tables.push(msg.table);
    } else if (msg.type === 'marketMine') {
      collected.market = msg;
    } else if (msg.type === 'friends') {
      collected.friends = msg.friends || [];
    }
  } catch (err) {
    console.error('[-] Erreur décodage message:', err.message);
  }
};

ws.onerror = (e) => {
  console.error('[-] Erreur WebSocket:', e.message || e);
};

ws.onclose = (e) => {
  if (e.code === 4029 || e.code === 4017) {
    console.warn(`[!] Déconnexion (${e.code}): Le jeton a expiré ou été révoqué.`);
  } else {
    log(`[+] WebSocket fermé (${e.code}).`);
  }
};

function scheduleFinish() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    clearTimeout(globalTimeout);
    try { ws.close(); } catch {}
    await processData();
  }, 3500);
}

async function processData() {
  log('\n[+] Traitement et assemblage des données...');

  // 1. Sauvegarde du fichier brut
  const rawPath = path.join(UPDATER_DIR, 'aldeide_collection_raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(collected, (k, v) => {
    if (v instanceof Uint8Array) return Array.from(v);
    if (typeof v === 'bigint') return v.toString();
    return v;
  }, 2), 'utf-8');

  // 2. Chargement du catalogue
  log('[+] Chargement du catalogue des cartes...');
  const meta = JSON.parse(fs.readFileSync(catMetaPath, 'utf-8'));
  const catCards = JSON.parse(fs.readFileSync(catCardsPath, 'utf-8'));

  const finishesMap = {};
  for (const f of meta.finishes) {
    finishesMap[f.id] = f;
  }
  const raritiesList = meta.rarities; // ['Méconnue', 'Connue', 'Célèbre', 'Star', 'Iconique', 'Mythique', 'Ace']
  const editionsList = meta.editions;

  // Cartes
  let entries = collected.cards;
  if (!entries) {
    for (const m of collected.messages) {
      if (m.type === 'cards' && m.entries) {
        entries = m.entries;
        collected.shards = m.shards || 0;
        break;
      }
    }
  }

  if (!entries || entries.length === 0) {
    console.error('[-] Aucune carte trouvée dans la réponse !');
    process.exit(1);
  }

  // Set of owned card IDs
  const ownedCidsMap = new Map();
  for (const entry of entries) {
    ownedCidsMap.set(entry.card, entry);
  }

  // Trade tables
  const cardsOnTable = new Set();
  for (const t of collected.tables) {
    if (t && t.give) {
      for (const g of t.give) {
        cardsOnTable.add(`Q${g.card}_${g.finish || 0}`);
      }
    }
  }

  // Binders with owned AND missing cards
  const binders = [];
  const cardToBinders = {};
  const seenBinderIds = new Set();

  for (const b of collected.binders) {
    if (!b || seenBinderIds.has(b.id)) continue;
    seenBinderIds.add(b.id);
    const bName = (b.name || '').replace('Pdophiles', 'Pédophiles').replace('Tueurs en Srie', 'Tueurs en Série');
    const bCards = b.cards || [];

    const binderCardDetails = [];
    let ownedInBinder = 0;
    let missingInBinder = 0;

    for (const cid of bCards) {
      const qid = `Q${cid}`;
      const isOwned = ownedCidsMap.has(cid);
      const entry = ownedCidsMap.get(cid);
      const cat = catCards[qid] || {};

      if (isOwned) {
        ownedInBinder++;
        if (!cardToBinders[qid]) cardToBinders[qid] = [];
        cardToBinders[qid].push(bName);
      } else {
        missingInBinder++;
      }

      const rarityId = cat.rarity ?? 0;
      const rarityName = cat.rarityName || raritiesList[rarityId] || 'Inconnue';
      const finishId = entry ? (entry.finish || 0) : 0;
      const finishInfo = finishesMap[finishId] || { label: finishId === 0 ? 'Standard' : `Finition #${finishId}` };

      binderCardDetails.push({
        qid,
        cid,
        name: cat.name || `Carte #${cid}`,
        description: cat.description || '',
        edition: cat.edition || 0,
        editionLabel: cat.editionLabel || String(cat.edition || 0),
        number: cat.number || 0,
        rarity: rarityId,
        rarityName,
        finishId,
        finishLabel: isOwned ? (finishInfo.label || 'Standard') : 'Non possédée',
        count: isOwned ? (entry.count || 1) : 0,
        isOwned,
        isKept: bName === 'Keep',
        vignetteUrl: cat.vignetteUrl || `https://omnidex.cards/vignettes/${qid}.webp`,
        imageUrl: cat.imageUrl || `https://omnidex.cards/cartes/${qid}.avif`,
        wikidataUrl: `https://www.wikidata.org/wiki/${qid}`,
        occupations: cat.occupations || [],
        categories: cat.categories || [],
        countries: cat.countries || [],
        birth: cat.birth,
        death: cat.death,
        gender: cat.gender,
        birthplace: cat.birthplace,
        score: cat.score || 0,
        notoriety: cat.notoriety || 0,
        face: cat.face
      });
    }

    // Sort binder cards: owned first, then rarity desc, then name
    binderCardDetails.sort((a, b) => {
      if (a.isOwned !== b.isOwned) return a.isOwned ? -1 : 1;
      if (b.rarity !== a.rarity) return b.rarity - a.rarity;
      return a.name.localeCompare(b.name, 'fr');
    });

    binders.push({
      id: b.id,
      name: bName,
      totalCount: bCards.length,
      ownedCount: ownedInBinder,
      missingCount: missingInBinder,
      pct: bCards.length > 0 ? ((ownedInBinder / bCards.length) * 100).toFixed(1) : 0,
      cardIds: bCards.map(cid => `Q${cid}`),
      cards: binderCardDetails
    });
  }

  // Compiler la collection des cartes possédées
  const collectionCards = [];
  let totalCopies = 0;
  const rarityCounts = {};
  for (const r of raritiesList) rarityCounts[r] = 0;
  const finishCounts = {};
  const editionCounts = {};
  for (const e of editionsList) editionCounts[e.edition] = 0;
  const distinctQids = new Set();

  for (const entry of entries) {
    const cid = entry.card;
    const qid = `Q${cid}`;
    const finishId = entry.finish || 0;
    const count = entry.count || 1;
    const acquiredAt = entry.at || 0;

    totalCopies += count;
    distinctQids.add(qid);

    const cat = catCards[qid] || {};
    const name = cat.name || `Carte #${cid}`;
    const description = cat.description || '';
    const rarityId = cat.rarity ?? 0;
    const rarityName = cat.rarityName || raritiesList[rarityId] || 'Inconnue';
    const editionId = cat.edition ?? 0;
    const editionLabel = cat.editionLabel || String(editionId);

    rarityCounts[rarityName] = (rarityCounts[rarityName] || 0) + count;
    editionCounts[editionId] = (editionCounts[editionId] || 0) + count;

    const finishInfo = finishesMap[finishId] || {
      id: finishId,
      code: finishId === 0 ? 'none' : `finish-${finishId}`,
      label: finishId === 0 ? 'Standard' : `Finition #${finishId}`,
      short: '',
      zone: 'none',
      effect: 'none'
    };
    const finishLabel = finishInfo.label || 'Standard';
    finishCounts[finishLabel] = (finishCounts[finishLabel] || 0) + count;

    const inBinders = cardToBinders[qid] || [];
    const isKept = inBinders.includes('Keep');
    const isOnTable = cardsOnTable.has(`${qid}_${finishId}`);
    const isDouble = count > 1;

    let mark = 'Collection';
    if (isKept) mark = 'À garder';
    else if (isOnTable) mark = 'Sur la table';
    else if (isDouble) mark = 'À échanger (Double)';

    collectionCards.push({
      qid,
      cid,
      name,
      description,
      edition: editionId,
      editionLabel,
      number: cat.number || 0,
      rarity: rarityId,
      rarityName,
      finishId,
      finishLabel,
      finishCode: finishInfo.code || 'none',
      finishZone: finishInfo.zone || 'none',
      finishEffect: finishInfo.effect || 'none',
      count,
      isOwned: true,
      acquiredAt,
      occupations: cat.occupations || [],
      categories: cat.categories || [],
      countries: cat.countries || [],
      birth: cat.birth,
      death: cat.death,
      gender: cat.gender,
      birthplace: cat.birthplace,
      vignetteUrl: cat.vignetteUrl || `https://omnidex.cards/vignettes/${qid}.webp`,
      imageUrl: cat.imageUrl || `https://omnidex.cards/cartes/${qid}.avif`,
      wikidataUrl: `https://www.wikidata.org/wiki/${qid}`,
      binders: inBinders,
      mark,
      isDouble,
      isKept,
      isOnTable,
      score: cat.score || 0,
      notoriety: cat.notoriety || 0,
      face: cat.face
    });
  }

  // Tri par rareté décroissante, puis nom alphabétique
  collectionCards.sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name, 'fr'));

  // Avatar URL resolution (Donald Trump #22686 with valid hash)
  const trumpCat = catCards['Q22686'] || {};
  const validAvatarUrl = trumpCat.vignetteUrl || 'https://omnidex.cards/vignettes/Q22686-783472d2.webp';

  const dataset = {
    profile: {
      pseudo: 'Aldeide',
      account: collected.account || 39,
      avatarUrl: validAvatarUrl,
      totalUnique: distinctQids.size,
      totalCopies,
      shards: collected.shards || 0,
      privacy: 'tous',
      friendsCount: collected.friends?.length || 22
    },
    stats: {
      rarityCounts,
      finishCounts,
      editionCounts,
      editionsMetadata: editionsList
    },
    binders,
    cards: collectionCards
  };

  // 1. Sauvegarder collection_data.js
  const jsContent = `window.OMNIDEX_DATA = ${JSON.stringify(dataset, null, 2)};`;
  fs.writeFileSync(path.join(__dirname, 'collection_data.js'), jsContent, 'utf-8');

  // 2. Sauvegarder aldeide_cards.json
  fs.writeFileSync(path.join(__dirname, 'aldeide_cards.json'), JSON.stringify(dataset, null, 2), 'utf-8');

  // 3. Sauvegarder aldeide_cards.csv
  const csvHeaders = [
    'QID', 'Nom', 'Description', 'Edition', 'Numero', 'Rarete', 'Finition',
    'Exemplaires', 'Marque', 'Classeurs', 'Categories', 'Pays', 'Lien_Wikidata', 'Image_URL'
  ];
  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const csvRows = [csvHeaders.join(',')];
  for (const c of collectionCards) {
    csvRows.push([
      escapeCsv(c.qid),
      escapeCsv(c.name),
      escapeCsv(c.description),
      escapeCsv(c.editionLabel),
      escapeCsv(c.number),
      escapeCsv(c.rarityName),
      escapeCsv(c.finishLabel),
      escapeCsv(c.count),
      escapeCsv(c.mark),
      escapeCsv(c.binders.join('; ')),
      escapeCsv(c.categories.join('; ')),
      escapeCsv(c.countries.join('; ')),
      escapeCsv(c.wikidataUrl),
      escapeCsv(c.imageUrl)
    ].join(','));
  }
  fs.writeFileSync(path.join(__dirname, 'aldeide_cards.csv'), '\uFEFF' + csvRows.join('\r\n'), 'utf-8');

  log('\n====================================================');
  log('              MISE À JOUR RÉUSSIE !                 ');
  log('====================================================');
  log(`Cartes uniques : ${distinctQids.size}`);
  log(`Exemplaires totaux : ${totalCopies}`);
  log(`Éclats de cartes : ${collected.shards}`);
  log(`Classeurs enrichis : ${binders.length}`);
  for (const b of binders) {
    log(`  - ${b.name}: ${b.ownedCount} / ${b.totalCount} possédées (${b.missingCount} manquantes, ${b.pct}%)`);
  }
  log('\nFichiers générés avec succès :');
  log('  -> collection_data.js');
  log('  -> aldeide_cards.json');
  log('  -> aldeide_cards.csv');
  log('====================================================\n');

  // 4. Git Synchronisation (Commit & Push to GitHub Pages)
  syncGit({ forcePush: FORCE_PUSH, noPush: NO_PUSH });

  process.exit(0);
}

function syncGit({ forcePush = false, noPush = false } = {}) {
  if (noPush) {
    log('[+] Git sync désactivé via l\'option --no-push.');
    return;
  }

  log('[+] Synchronisation Git vers GitHub Pages...');
  try {
    const filesToStage = ['collection_data.js', 'aldeide_cards.json', 'aldeide_cards.csv'];
    execSync(`git add ${filesToStage.join(' ')}`, { cwd: __dirname, stdio: SILENT ? 'ignore' : 'inherit' });

    let hasChanges = false;
    try {
      execSync('git diff --cached --quiet', { cwd: __dirname });
      hasChanges = false;
    } catch {
      hasChanges = true;
    }

    if (!hasChanges && !forcePush) {
      log('[+] Aucune modification détectée dans les fichiers de collection. Dépôt à jour !');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const commitMsg = `chore: auto-update collection (${today})`;
    log(`[+] Création du commit : "${commitMsg}"...`);

    const commitCmd = (forcePush && !hasChanges)
      ? `git commit --allow-empty -m "${commitMsg}"`
      : `git commit -m "${commitMsg}"`;
    execSync(commitCmd, { cwd: __dirname, stdio: SILENT ? 'ignore' : 'inherit' });

    log('[+] Envoi des modifications vers origin main (git push)...');
    execSync('git push origin main', { cwd: __dirname, stdio: SILENT ? 'ignore' : 'inherit' });
    log('[+] GitHub Pages synchronisé avec succès ! (https://aldeide.github.io/omnidex/)');
  } catch (err) {
    console.error('[-] Erreur lors de la synchronisation Git :', err.message);
  }
}
