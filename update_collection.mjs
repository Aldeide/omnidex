import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPDATER_DIR = path.join(__dirname, '_updater');

console.log('====================================================');
console.log('       OmniDex - Mise à jour de la collection       ');
console.log('====================================================\n');

// 1. Shims for Node ESM
globalThis.document = {
  createElement: () => ({ relList: { supports: () => true } }),
  querySelectorAll: () => []
};
globalThis.window = globalThis;
globalThis.location = { protocol: 'https:', host: 'omnidex.cards' };

// 2. Load token
const tokenPath = path.join(UPDATER_DIR, 'token.json');
if (!fs.existsSync(tokenPath)) {
  console.error('[-] Erreur : Fichier token.json introuvable dans _updater !');
  process.exit(1);
}

const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
const token = new Uint8Array(tokenData.bytes);
console.log(`[+] Jeton de session chargé (${token.length} octets).`);

// 3. Import Omnidex protocol codec
const { L: be, F: ge } = await import('./_updater/avatar-QsIDJbSu.js');

console.log('[+] Connexion au serveur WebSocket (wss://omnidex.cards/ws)...');
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
  messages: []
};

let syncTimer = null;

ws.onopen = () => {
  console.log('[+] WebSocket connecté ! Envoi de l\'authentification...');
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
      console.log(`[+] Authentification réussie ! Compte #${msg.account}`);
      collected.welcome = msg;
      collected.account = msg.account;

      // Demande de synchronisation des cartes, classeurs et recherche du joueur
      console.log('[+] Synchronisation de la collection et des classeurs...');
      ws.send(be({ type: 'sync', rid: ++rid, since: 0 }));
      ws.send(be({ type: 'binders', rid: ++rid, since: 0 }));
      ws.send(be({ type: 'findPlayers', rid: ++rid, text: 'Aldeide' }));

      // Planifie la finalisation 3.5 secondes après welcome
      scheduleFinish();
    } else if (msg.type === 'players') {
      const aldeide = msg.players?.find(p => p.pseudo.toLowerCase() === 'aldeide');
      if (aldeide) {
        console.log(`[+] Profil joueur trouvé (Pseudo: ${aldeide.pseudo}).`);
        ws.send(be({
          type: 'marks',
          rid: ++rid,
          friend: 0,
          handle: aldeide.handle,
          known: new Uint8Array(8)
        }));
        ws.send(be({
          type: 'playerCards',
          rid: ++rid,
          friend: 0,
          handle: aldeide.handle,
          known: []
        }));
      }
    } else if (msg.type === 'cards' && msg.entries) {
      console.log(`[+] Cartes reçues : ${msg.entries.length} entrées, ${msg.shards} éclats.`);
      collected.cards = msg.entries;
      collected.shards = msg.shards;
    } else if (msg.type === 'binder') {
      collected.binders.push(msg.binder);
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
    console.log(`[+] WebSocket fermé (${e.code}).`);
  }
};

function scheduleFinish() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try { ws.close(); } catch {}
    await processData();
  }, 4000);
}

async function processData() {
  console.log('\n[+] Traitement et assemblage des données...');

  // 1. Sauvegarde du fichier brut
  const rawPath = path.join(UPDATER_DIR, 'aldeide_collection_raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(collected, (k, v) => {
    if (v instanceof Uint8Array) return Array.from(v);
    if (typeof v === 'bigint') return v.toString();
    return v;
  }, 2), 'utf-8');

  // 2. Chargement du catalogue
  console.log('[+] Chargement du catalogue des cartes...');
  const meta = JSON.parse(fs.readFileSync(path.join(UPDATER_DIR, 'catalogue_metadata.json'), 'utf-8'));
  const catCards = JSON.parse(fs.readFileSync(path.join(UPDATER_DIR, 'catalogue_cards.json'), 'utf-8'));

  const finishesMap = {};
  for (const f of meta.finishes) {
    finishesMap[f.id] = f;
  }
  const raritiesList = meta.rarities; // ['Méconnue', 'Connue', 'Célèbre', 'Star', 'Iconique', 'Mythique', 'Ace']
  const editionsList = meta.editions;

  // Cartes
  let entries = collected.cards;
  if (!entries) {
    // Chercher dans messages
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

  // Binders
  const binders = [];
  const cardToBinders = {};
  const seenBinderIds = new Set();
  for (const b of collected.binders) {
    if (!b || seenBinderIds.has(b.id)) continue;
    seenBinderIds.add(b.id);
    const bName = (b.name || '').replace('Pdophiles', 'Pédophiles').replace('Tueurs en Srie', 'Tueurs en Série');
    const bCards = b.cards || [];
    binders.push({
      id: b.id,
      name: bName,
      count: bCards.length,
      cardIds: bCards.map(cid => `Q${cid}`)
    });
    for (const cid of bCards) {
      const qid = `Q${cid}`;
      if (!cardToBinders[qid]) cardToBinders[qid] = [];
      cardToBinders[qid].push(bName);
    }
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

  // Compiler la collection
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

  const dataset = {
    profile: {
      pseudo: 'Aldeide',
      account: collected.account || 39,
      avatarUrl: 'https://omnidex.cards/vignettes/Q22686.webp',
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

  console.log('\n====================================================');
  console.log('              MISE À JOUR RÉUSSIE !                 ');
  console.log('====================================================');
  console.log(`Cartes uniques : ${distinctQids.size}`);
  console.log(`Exemplaires totaux : ${totalCopies}`);
  console.log(`Éclats de cartes : ${collected.shards}`);
  console.log(`Classeurs : ${binders.length}`);
  console.log('\nFichiers générés avec succès :');
  console.log('  -> collection_data.js');
  console.log('  -> aldeide_cards.json');
  console.log('  -> aldeide_cards.csv');
  console.log('====================================================\n');
  process.exit(0);
}
