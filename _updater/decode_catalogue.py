import urllib.request
import json
import os
import sys
import time

UPDATER_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(UPDATER_DIR, '.cache')
os.makedirs(CACHE_DIR, exist_ok=True)

CARDS_JSON = os.path.join(UPDATER_DIR, 'catalogue_cards.json')
META_JSON = os.path.join(UPDATER_DIR, 'catalogue_metadata.json')

def ensure_file(url, target_path):
    if os.path.exists(target_path) and os.path.getsize(target_path) > 0:
        return
    print(f"    Téléchargement de {os.path.basename(target_path)}...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        content = resp.read()
    with open(target_path, 'wb') as f:
        f.write(content)

class Reader:
    def __init__(self, buf, pos=0):
        self.buf = buf
        self.pos = pos
    def u8(self):
        v = self.buf[self.pos]
        self.pos += 1
        return v
    def uint(self):
        v = 0
        s = 1
        for _ in range(8):
            b = self.u8()
            v += (b & 127) * s
            if not (b & 128):
                return v
            s *= 128
        raise ValueError('Integer too long')
    def skip(self, c):
        self.pos += c
    def str(self):
        l = self.uint()
        s = self.buf[self.pos:self.pos+l].decode('utf-8')
        self.pos += l
        return s
    def hex(self, c):
        s = ''.join(f'{b:02x}' for b in self.buf[self.pos:self.pos+c])
        self.pos += c
        return s

def de(e):
    if e == 0:
        return None
    t = e - 1
    n = t // 32 // 13
    year = n // 2 if n % 2 == 0 else -(n + 1) // 2
    month = (t // 32) % 13
    day = t % 32
    return {'year': year, 'month': month, 'day': day}

def format_date(e):
    t = de(e)
    if not t:
        return None
    y = t['year']
    m = t['month']
    d = t['day']
    sign = '-' if y < 0 else ''
    a = f"{sign}{abs(y):04d}"
    if m:
        if d:
            return f"{a}-{m:02d}-{d:02d}"
        return f"{a}-{m:02d}"
    return a

def main():
    if '--check-only' in sys.argv:
        if os.path.exists(CARDS_JSON) and os.path.getsize(CARDS_JSON) > 1000000:
            print("[+] Catalogue cards déjà présent et valide.")
            sys.exit(0)
        else:
            print("[-] Catalogue cards manquant.")
            sys.exit(1)

    print("[+] Téléchargement et décodage du catalogue OmniDex...")
    manifest_url = 'https://omnidex.cards/catalogue/manifest.json'
    manifest_path = os.path.join(CACHE_DIR, 'manifest.json')
    req = urllib.request.Request(manifest_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        manifest = json.loads(resp.read().decode('utf-8'))
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)

    # 1. Countries
    pays_file = manifest['paysApp']['file']
    pays_path = os.path.join(CACHE_DIR, pays_file)
    ensure_file(f'https://omnidex.cards/catalogue/{pays_file}', pays_path)
    with open(pays_path, 'r', encoding='utf-8') as f:
        pays_json = json.load(f)
    pays_by_cat_id = {1000000 + p['id']: p for p in pays_json['pays']}

    # 2. Categories
    cat_file = manifest['categoriesApp']['file']
    cat_bin_path = os.path.join(CACHE_DIR, cat_file)
    ensure_file(f'https://omnidex.cards/catalogue/{cat_file}', cat_bin_path)
    with open(cat_bin_path, 'rb') as f:
        cat_buf = f.read()

    cr = Reader(cat_buf)
    cat_magic = [cr.u8() for _ in range(4)]
    assert cat_magic == [79, 88, 67, 84]
    cat_fmt = cr.u8()
    cat_ed_count = cr.uint()
    total_cards_expected = 0
    for _ in range(cat_ed_count):
        ed_num = cr.uint()
        count = cr.uint()
        cr.skip(4) # hash
        total_cards_expected += count

    card_categories = [[] for _ in range(total_cards_expected)]
    card_countries = [[] for _ in range(total_cards_expected)]

    cat_count = cr.uint()
    all_categories_meta = []
    for _ in range(cat_count):
        cid = cr.uint()
        cname = cr.str()
        cfamily = cr.str()
        cmembers_len = cr.uint()
        all_categories_meta.append({
            'id': cid,
            'name': cname,
            'family': cfamily,
            'count': cmembers_len
        })
        
        is_pays = (cfamily == 'pays')
        pays_info = pays_by_cat_id.get(cid)
        
        u = -1
        for m_i in range(cmembers_len):
            delta = cr.uint()
            u = delta if m_i == 0 else u + delta
            if is_pays:
                card_countries[u].append({
                    'id': pays_info['id'] if pays_info else cid - 1000000,
                    'name': cname,
                    'iso3': pays_info['iso3'] if pays_info else '',
                    'continent': pays_info['continent'] if pays_info else ''
                })
            else:
                card_categories[u].append({
                    'id': cid,
                    'name': cname,
                    'family': cfamily
                })

    # 3. Editions
    rarity_names = ['Méconnue', 'Connue', 'Célèbre', 'Star', 'Iconique', 'Mythique', 'Ace']
    all_cards_dict = {}
    all_cards_list = []
    global_card_idx = 0

    for ed_info in manifest['editions']:
        fname = ed_info['file']
        fpath = os.path.join(CACHE_DIR, fname)
        ensure_file(f'https://omnidex.cards/catalogue/{fname}', fpath)
        with open(fpath, 'rb') as f:
            buf = f.read()

        r = Reader(buf)
        magic = [r.u8() for _ in range(4)]
        assert magic == [79, 77, 68, 88]
        fmt = r.u8()
        edition = r.uint()
        size = r.uint()
        r_text = r.uint()
        text_starts = [0] * r_text
        for i in range(r_text):
            text_starts[i] = r.pos
            r.skip(r.uint())

        texts = [None] * r_text
        def get_text(idx):
            if idx == 0:
                return None
            t_idx = idx - 1
            if texts[t_idx] is None:
                reader = Reader(buf, text_starts[t_idx])
                texts[t_idx] = reader.str()
            return texts[t_idx]

        card_count = r.uint()
        starts = [0] * card_count
        ends = [0] * card_count
        qnums = [0] * card_count
        o = 0
        for i in range(card_count):
            o += r.uint()
            clen = r.uint()
            qnums[i] = o
            starts[i] = r.pos
            ends[i] = r.pos + clen
            r.pos = r.pos + clen

        edition_label = 'avant 1900' if edition == 0 else str(edition)

        for i in range(card_count):
            r_card = Reader(buf, starts[i])
            flags = r_card.u8()
            gender_raw = (flags >> 4) & 3
            gender = 'f' if gender_raw == 1 else ('m' if gender_raw == 2 else None)
            number = r_card.uint()
            name = r_card.str()
            desc = get_text(r_card.uint())
            occ_len = r_card.uint()
            occs = [get_text(r_card.uint()) for _ in range(occ_len)]
            birth = format_date(r_card.uint())
            death = format_date(r_card.uint())
            birthplace = get_text(r_card.uint())
            notoriety = r_card.uint()
            fr_views = r_card.uint()
            score = round(r_card.uint() / 1e5, 5)
            credit_author = get_text(r_card.uint()) or ''
            credit_license = get_text(r_card.uint()) or ''
            qid = f'Q{qnums[i]}'
            art_hash = r_card.hex(4)
            vignette = r_card.hex(4) if fmt >= 2 else '00000000'
            face = [r_card.u8(), r_card.u8(), r_card.u8()] if fmt >= 3 else [0, 0, 0]

            retouches = []
            if flags & 64: retouches.append('defloutee')
            if flags & 128: retouches.append('completee')

            has_vignette = (vignette != '00000000')
            vignette_url = f'https://omnidex.cards/vignettes/{qid}-{vignette}.webp' if has_vignette else None

            cats = [c['name'] for c in card_categories[global_card_idx]]
            cat_ids = [c['id'] for c in card_categories[global_card_idx]]
            countries = [c['name'] for c in card_countries[global_card_idx]]
            country_data = card_countries[global_card_idx]

            rarity_num = flags & 7
            rarity_name = rarity_names[rarity_num] if rarity_num < len(rarity_names) else f'Rareté {rarity_num}'

            card = {
                'qid': qid,
                'name': name,
                'number': number,
                'edition': edition,
                'editionLabel': edition_label,
                'editionSize': size,
                'rarity': rarity_num,
                'rarityName': rarity_name,
                'description': desc,
                'occupations': occs,
                'categories': cats,
                'categoryIds': cat_ids,
                'countries': countries,
                'countryData': country_data,
                'birth': birth,
                'death': death,
                'gender': gender,
                'birthplace': birthplace,
                'notoriety': notoriety,
                'frViews': fr_views,
                'score': score,
                'credit': {
                    'author': credit_author,
                    'license': credit_license
                },
                'artHash': art_hash,
                'image': f'/cartes/{qid}-{art_hash}.avif',
                'imageUrl': f'https://omnidex.cards/cartes/{qid}-{art_hash}.avif',
                'maskUrl': f'https://omnidex.cards/cartes/{qid}-{art_hash}-fond.webp',
                'thumbUrl': f'https://omnidex.cards/cartes/{qid}-{art_hash}-vignette.avif',
                'thumbMaskUrl': f'https://omnidex.cards/cartes/{qid}-{art_hash}-fond-vignette.webp',
                'vignetteHash': vignette if has_vignette else None,
                'vignette': f'/vignettes/{qid}-{vignette}.webp' if has_vignette else None,
                'vignetteUrl': vignette_url
            }

            if face[2] > 0:
                card['face'] = {
                    'x': round(face[0] / 255, 4),
                    'y': round(face[1] / 255, 4),
                    'd': round(face[2] / 255, 4)
                }
            if flags & 8:
                card['archive'] = True
            if retouches:
                card['retouches'] = retouches

            all_cards_list.append(card)
            all_cards_dict[qid] = card
            global_card_idx += 1

    finishes_meta = [
        {'id': 0, 'code': 'none', 'label': 'Sans finition', 'short': '', 'zone': 'none', 'effect': 'none'},
        {'id': 1, 'code': 'normale-classic', 'label': 'Holo', 'short': 'H', 'zone': 'normale', 'effect': 'classic'},
        {'id': 2, 'code': 'normale-starlight', 'label': 'Starlight', 'short': 'S', 'zone': 'normale', 'effect': 'starlight'},
        {'id': 3, 'code': 'normale-fireworks', 'label': 'Fireworks', 'short': 'F', 'zone': 'normale', 'effect': 'fireworks'},
        {'id': 4, 'code': 'normale-negative', 'label': 'Négative', 'short': 'N', 'zone': 'normale', 'effect': 'negative'},
        {'id': 5, 'code': 'reverse-classic', 'label': 'Holo inversée', 'short': 'HI', 'zone': 'reverse', 'effect': 'classic'},
        {'id': 6, 'code': 'reverse-starlight', 'label': 'Starlight inversée', 'short': 'SI', 'zone': 'reverse', 'effect': 'starlight'},
        {'id': 7, 'code': 'reverse-fireworks', 'label': 'Fireworks inversée', 'short': 'FI', 'zone': 'reverse', 'effect': 'fireworks'},
        {'id': 8, 'code': 'reverse-negative', 'label': 'Négative inversée', 'short': 'NI', 'zone': 'reverse', 'effect': 'negative'},
        {'id': 9, 'code': 'full-classic', 'label': 'Full Holo', 'short': 'HF', 'zone': 'full', 'effect': 'classic'},
        {'id': 10, 'code': 'full-starlight', 'label': 'Full Starlight', 'short': 'SF', 'zone': 'full', 'effect': 'starlight'},
        {'id': 11, 'code': 'full-fireworks', 'label': 'Full Fireworks', 'short': 'FF', 'zone': 'full', 'effect': 'fireworks'},
        {'id': 12, 'code': 'full-negative', 'label': 'Full Négative', 'short': 'NF', 'zone': 'full', 'effect': 'negative'}
    ]

    metadata = {
        'totalCards': len(all_cards_list),
        'editions': [
            {
                'edition': e['edition'],
                'label': 'avant 1900' if e['edition'] == 0 else str(e['edition']),
                'count': e['count'],
                'size': e['size'],
                'file': e['file']
            } for e in manifest['editions']
        ],
        'rarities': rarity_names,
        'finishes': finishes_meta,
        'imageUrlPatterns': {
            'vignette': 'https://omnidex.cards/vignettes/{qid}-{vignetteHash}.webp',
            'vignetteWithFinish': 'https://omnidex.cards/vignettes/{qid}-{vignetteHash}-{finishId}.webp (if generated)',
            'cardImage': 'https://omnidex.cards/cartes/{qid}-{artHash}.avif',
            'cardMask': 'https://omnidex.cards/cartes/{qid}-{artHash}-fond.webp',
            'cardThumb': 'https://omnidex.cards/cartes/{qid}-{artHash}-vignette.avif',
            'cardThumbMask': 'https://omnidex.cards/cartes/{qid}-{artHash}-fond-vignette.webp'
        },
        'categoriesCount': len(all_categories_meta),
        'countriesCount': len(pays_json['pays'])
    }

    print(f"[+] Écriture de {CARDS_JSON} ({len(all_cards_dict)} cartes)...")
    with open(CARDS_JSON, 'w', encoding='utf-8') as f:
        json.dump(all_cards_dict, f, ensure_ascii=False, indent=2)

    with open(META_JSON, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print(f"[+] Catalogue décodé avec succès : {len(all_cards_dict)} cartes.")

if __name__ == '__main__':
    main()
