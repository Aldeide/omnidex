import json
import os
import csv

SCRATCH = r"C:\Users\Anthony\.gemini\antigravity\brain\f6d95827-33de-40f1-8561-cc8a30b18c92\scratch"
OUT_DIR = r"C:\Users\Anthony\Desktop\omnidex-aldeide"
os.makedirs(OUT_DIR, exist_ok=True)

print("Loading raw extracted data...")
with open(f"{SCRATCH}/aldeide_collection_raw.json", "r", encoding="utf-8") as f:
    raw = json.load(f)

print("Loading catalogue metadata...")
with open(f"{SCRATCH}/catalogue_metadata.json", "r", encoding="utf-8") as f:
    meta = json.load(f)

print("Loading catalogue cards (this may take a few seconds)...")
with open(f"{SCRATCH}/catalogue_cards.json", "r", encoding="utf-8") as f:
    cat_cards = json.load(f)

print(f"Loaded {len(cat_cards)} cards from catalogue.")

# Finishes lookup
finishes_map = {f['id']: f for f in meta['finishes']}
rarities_list = meta['rarities'] # ['Méconnue', 'Connue', 'Célèbre', 'Star', 'Iconique', 'Mythique', 'Ace']
editions_list = meta['editions']

# Find cards entries
card_entries = []
shards = 0
for m in raw.get("messages", []):
    if m.get("type") == "cards" and m.get("entries"):
        card_entries = m.get("entries")
        shards = m.get("shards", 0)
        break

print(f"Found {len(card_entries)} card entries. Shards: {shards}")

# Binders
binders = []
card_to_binders = {}
for m in raw.get("messages", []):
    if m.get("type") == "binder":
        b = m.get("binder", {})
        b_name = b.get("name", "").replace("Pdophiles", "Pédophiles").replace("Tueurs en Srie", "Tueurs en Série")
        b_id = b.get("id")
        b_cards = b.get("cards", [])
        binders.append({
            "id": b_id,
            "name": b_name,
            "count": len(b_cards),
            "cardIds": [f"Q{cid}" for cid in b_cards]
        })
        for cid in b_cards:
            qid = f"Q{cid}"
            card_to_binders.setdefault(qid, []).append(b_name)

print(f"Found {len(binders)} binders:")
for b in binders:
    print(f"  {b['name']} ({b['count']} cards)")

# Trade table cards (from active trades)
cards_on_table = set()
for m in raw.get("messages", []):
    if m.get("type") == "table":
        t = m.get("table", {})
        for g in t.get("give", []):
            cards_on_table.add((f"Q{g['card']}", g.get('finish', 0)))

# Market listings
market_history = []
for m in raw.get("messages", []):
    if m.get("type") == "marketMine":
        market_history = m.get("history", [])

# Process entries
collection_cards = []
total_copies = 0
rarity_counts = {r: 0 for r in rarities_list}
finish_counts = {}
edition_counts = {e['edition']: 0 for e in editions_list}
distinct_qids = set()

for entry in card_entries:
    cid = entry['card']
    qid = f"Q{cid}"
    finish_id = entry.get('finish', 0)
    count = entry.get('count', 1)
    acquired_at = entry.get('at', 0)
    origins = entry.get('origins', 0)
    born = entry.get('born', 0)
    
    total_copies += count
    distinct_qids.add(qid)
    
    cat = cat_cards.get(qid, {})
    name = cat.get("name", f"Carte #{cid}")
    description = cat.get("description", "")
    rarity_id = cat.get("rarity", 0)
    rarity_name = cat.get("rarityName", rarities_list[rarity_id] if rarity_id < len(rarities_list) else "Inconnue")
    edition_id = cat.get("edition", 0)
    edition_label = cat.get("editionLabel", str(edition_id))
    
    rarity_counts[rarity_name] = rarity_counts.get(rarity_name, 0) + count
    edition_counts[edition_id] = edition_counts.get(edition_id, 0) + count
    
    finish_info = finishes_map.get(finish_id, {
        "id": finish_id,
        "code": "none" if finish_id == 0 else f"finish-{finish_id}",
        "label": "Standard" if finish_id == 0 else f"Finition #{finish_id}",
        "short": "",
        "zone": "none",
        "effect": "none"
    })
    finish_label = finish_info.get("label", "Standard")
    finish_counts[finish_label] = finish_counts.get(finish_label, 0) + count
    
    vignette_url = cat.get("vignetteUrl", f"https://omnidex.cards/vignettes/{qid}.webp")
    image_url = cat.get("imageUrl", f"https://omnidex.cards/cartes/{qid}.avif")
    
    in_binders = card_to_binders.get(qid, [])
    
    # Determine trade/keep mark
    is_kept = "Keep" in in_binders
    is_on_table = (qid, finish_id) in cards_on_table
    is_double = count > 1
    
    if is_kept:
        mark = "À garder"
    elif is_on_table:
        mark = "Sur la table"
    elif is_double:
        mark = "À échanger (Double)"
    else:
        mark = "Collection"
        
    card_obj = {
        "qid": qid,
        "cid": cid,
        "name": name,
        "description": description,
        "edition": edition_id,
        "editionLabel": edition_label,
        "number": cat.get("number", 0),
        "rarity": rarity_id,
        "rarityName": rarity_name,
        "finishId": finish_id,
        "finishLabel": finish_label,
        "finishCode": finish_info.get("code", "none"),
        "finishZone": finish_info.get("zone", "none"),
        "finishEffect": finish_info.get("effect", "none"),
        "count": count,
        "acquiredAt": acquired_at,
        "occupations": cat.get("occupations", []),
        "categories": cat.get("categories", []),
        "countries": cat.get("countries", []),
        "birth": cat.get("birth"),
        "death": cat.get("death"),
        "gender": cat.get("gender"),
        "birthplace": cat.get("birthplace"),
        "vignetteUrl": vignette_url,
        "imageUrl": image_url,
        "wikidataUrl": f"https://www.wikidata.org/wiki/{qid}",
        "binders": in_binders,
        "mark": mark,
        "isDouble": is_double,
        "isKept": is_kept,
        "isOnTable": is_on_table,
        "score": cat.get("score", 0),
        "notoriety": cat.get("notoriety", 0),
        "face": cat.get("face")
    }
    collection_cards.append(card_obj)

# Sort by rarity desc, then name asc
collection_cards.sort(key=lambda c: (-c["rarity"], c["name"]))

print(f"\nCollection Stats:")
print(f"  Total Unique Cards: {len(distinct_qids)}")
print(f"  Total Copies: {total_copies}")
print(f"  Total Shards: {shards}")
print(f"  Rarity Breakdown: {rarity_counts}")
print(f"  Finishes Breakdown: {finish_counts}")

# Export dataset structure
dataset = {
    "profile": {
        "pseudo": "Aldeide",
        "account": 39,
        "avatarUrl": "https://omnidex.cards/vignettes/Q22686.webp",
        "totalUnique": len(distinct_qids),
        "totalCopies": total_copies,
        "shards": shards,
        "privacy": "tous",
        "friendsCount": 22
    },
    "stats": {
        "rarityCounts": rarity_counts,
        "finishCounts": finish_counts,
        "editionCounts": edition_counts,
        "editionsMetadata": editions_list
    },
    "binders": binders,
    "cards": collection_cards
}

# 1. Save collection_data.js
js_content = f"window.OMNIDEX_DATA = {json.dumps(dataset, ensure_ascii=False, indent=2)};"
with open(f"{OUT_DIR}/collection_data.js", "w", encoding="utf-8") as f:
    f.write(js_content)
print(f"Saved {OUT_DIR}/collection_data.js ({len(js_content)} chars)")

# 2. Save aldeide_cards.json
with open(f"{OUT_DIR}/aldeide_cards.json", "w", encoding="utf-8") as f:
    json.dump(dataset, f, ensure_ascii=False, indent=2)
print(f"Saved {OUT_DIR}/aldeide_cards.json")

# 3. Save aldeide_cards.csv
csv_fields = [
    "QID", "Nom", "Description", "Edition", "Numero", "Rarete", "Finition",
    "Exemplaires", "Marque", "Classeurs", "Categories", "Pays", "Lien_Wikidata", "Image_URL"
]
with open(f"{OUT_DIR}/aldeide_cards.csv", "w", encoding="utf-8", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(csv_fields)
    for c in collection_cards:
        writer.writerow([
            c["qid"],
            c["name"],
            c["description"],
            c["editionLabel"],
            c["number"],
            c["rarityName"],
            c["finishLabel"],
            c["count"],
            c["mark"],
            "; ".join(c["binders"]),
            "; ".join(c["categories"]),
            "; ".join(c["countries"]),
            c["wikidataUrl"],
            c["imageUrl"]
        ])
print(f"Saved {OUT_DIR}/aldeide_cards.csv")
