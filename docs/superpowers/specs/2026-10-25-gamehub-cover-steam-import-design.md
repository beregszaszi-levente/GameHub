# Tervezési dokumentum: GameHub – Borító-automatikus felismerés + Steam-könyvtár import

**Dátum:** 2026-10-25  
**Projekt:** GameHub (Electron, magyar UI)  
**Repo:** https://github.com/beregszaszi-levente/GameHub.git  
**Állapot:** Jóváhagyva, implementálásra vár

---

## 1. Cél és indok

A felhasználó 2 játékot használ az appban. A könyvtár növekedésével két fájdalompont jelentkezik:

1. Sok játéknál nincs borító, és a felhasználó kézzel kellene kiválasztania mindenhez egy képet.
2. Ha a gépén van Steam, azok a játékok nem jelennek meg automatikusan a GameHub-ban — manuálisan kellene felvenni őket egy-egyet.

A cél: **kötelező Tän handbuch nélkül** (automatikusan) feltölteni a hiányzó borítókat a játék mappáiból, és **Steam játékokat importálni** minimal klikkeléssel, csak a felhasználó kijelölésével.

---

## 2. Ziele (célok), nem-célok, anti-célok

### Célok
- A scan során, ha egy új játéknak még nincs felhasználó által beállított borítója, a program keresi a mappában a `folder.jpg`, `cover.jpg`, `poster.jpg`, `banner.jpg` fájlokat, és az elsőt beállítja borítóként.
- A szerkesztőben „Borító keresése a mappában” gomb: igény szerint újra futtatható egy adott játékra, felülírva a régebbi automatikus beállítást.
- Steam-könyvtár import: beolvassa a Steam `libraryfolders.vdf`-t az alapértelmezett útvonalról (`C:\Program Files (x86)\Steam\`), összesíti a telepített játékokat az `appmanifest_*.acf` fájlokból, és egy import dialógusban felajánlja őket a kiválasztásra.
- Ha a Steam nem az alapértelmezett helyen van, fájlválasztóval választható a `steamapps` mappa. A sikeres útvonalat elmentjük a beállításokban, hogy később újra használható legyen.
- Importált játékok `source: 'steam-import'` jelölésével kerülnek a könyvtárba.

### Nem-célok
- SteamGridDB vagy bármilyen online borítóforrás használata (a projekt döntése szerint nincs).
- Automatikus indítóbeállítás Steam játékokhoz (a felhasználó kézzel állítja be az exe/bat indítót a szerkesztőben).
- Steam felügyelete (frissítés, eltávolítás Steam oldalon) — csak egyszeri import.

### Anti-célok (hiba, ha megtörténik)
- A felhasználó kézzel beállított borítója felülíródik automatikus felismeréssel.
- A Steam import minden játékot hozzáadja a könyvtárhoz kérdés nélkül.
- Az app összeomlik, ha a Steam nincs telepítve.

---

## 3. Korlátozások

- Csak Windows (Electron, `\\?\` extended path prefix, `CreateProcessW` indítás).
- Adat tárolása `%APPDATA%\GameHub\library.json` + `covers\`, soha a repóban.
- Vanilla HTML/CSS/JS renderer, nincs bundler.
- Electron 45, electron-builder 26.
- Git identity: Beregszászi Levente <beregszaszi.levi@gmail.com>
- Hungarian Conventional Commits minden változáson.

---

## 4. Megvalósítási útvonalak

### Funkció 1: Borító-automatikus felismerés

| Útvonal | Leírás | Trade-off |
|---------|--------|-----------|
| A) Csak a scan során automatikus | Az újonnan discoveryelt játék mappájában keres képeket, beállítja az elsőt. | Teljes automatizmus, de a felhasználó nem választ ki képre, ha több van. |
| B) Csak manuális gomb | „Borító keresése” gomb a szerkesztőben, igény szerint fut le. | Felhasználó diktálja, de nem történik automatikusan. |
| **C) KIVÁLASZTVA: A + B kombinált** | Scankor automatikusan beállítja (ha nincs még felhasználói borító), PLUSZ a szerkesztőben van „Újrakeresés a mappában” gomb, amely felülírja a régebbi automatikusat. | Légális automatizmus + felhasználói ellenőrzés. Kicsit több kód, de legjobb UX. |

### Funkció 2: Steam-könyvtár import

| Útvonal | Leírás | Trade-off |
|---------|--------|-----------|
| **A) KIVÁLASZTVA: Automatikus útvonalfelismerés** | `libraryfolders.vdf` olvasása `C:\Program Files (x86)\Steam\`-ről, végigmegy minden Steam könyvtáron, összegyűjti az `appmanifest_*.acf`-ből a neveket és útvonalakat. Import dialógusban a felhasználó kijelöli a kívakat. | Teljes Steam-szerű érzés, de csak akkor működik, ha a Steam az alapértelmezett helyen van. |
| **B) Fájlválasztó** | A felhasználó manuálisan kijelöli a `steamapps` mappát. | Megbízható bárhol, de több klikkelés. |
| C) Registry + A | Először a Windows Registry-ből kiszedi a Steam telepítési útvonalat, aztán folytatja A módon. | Megbízhatóbb, de Windows-specifikus és komplexebb. |

**Végleges döntés:** A (automatikus), és ha az nem sikerül (Steam nem az alapértelmezett helyen, vagy nem található könyvtár), visszautalunk B-re (fájlválasztó). A sikeres `steamapps` útvonalat elmentjük a beállításokban (`steamImportPath`), hogy később kérdés nélkül onnan importálhassunk.

---

## 5. Megvalósítási terv (részletek)

### 5.1 Borító-automatikus felismerés (`scanner.js`)

`detectGame()` végén, ha a detektált játék `cover === null`:

```javascript
const coverCandidates = ['folder.jpg', 'cover.jpg', 'poster.jpg', 'banner.jpg'];
for (const candidate of coverCandidates) {
  const coverPath = joinExtended(folderExt, candidate);
  if (exists(coverPath)) {
    game.cover = displayPath(coverPath);
    break;
  }
}
```

Ha nincs egyike a prioritált listának, de vannak más képek (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`), az elsőt használja.

### 5.2 Borító újrakikeresés gomb a szerkesztőben (`ipc.js` + `renderer/app.js`)

Új IPC handler: `cover:rescan(id)` — futtatja ugyanazon logikát `detectGame`-ben a konkrét játék mappájára, és ha talál, beállítja a `game.cover` mezőt (felülírva a régebbi).

Renderer oldalon a szerkesztő panelbe kerül egy „Borító keresése a mappában” gomb a „Borító kiválasztása” gomb mellett.

### 5.3 Steam import (`src/main/steam-import.js` új fájl)

Függvények:
- `findSteamLibraryFolders()` — olvassa `C:\Program Files (x86)\Steam\libraryfolders.vdf`, visszaadja a könyvtárakat; ha nem sikerül, `null`.
- `scanSteamApps(libraryFolder)` — egy adott Steam könyvtár `steamapps` mappájában olvassa az `appmanifest_*.acf` fájlokat, visszaadja a `{ appid, name, installDir }` listát.
- `resolveSteamPath()` — első、`libraryfolders.vdf` alapján; ha nem sikerül, `null` (frontend B opciót kínál).

IPC handler: `steam:import()` — visszaadja a talált játékok listáját (javaslat), a felhasználó kijelöli, melyiket vegye fel.

Importált játék struktúra (`library.js` `normalizeGame`-ként):
- `source: 'steam-import'`
- `title`: az ACF-ből származó név
- `folder`: a Steam telepítési útvonal (`steamapps\common\<instdir>`)
- `launch`: üres exe indító (a felhasználó kézzel állítja be a szerkesztőben)
- `cover`: null

Beállítás: `libraryRoots`-hoz hozzáadható Steam gyökér, de külön `steamImportPath` beállításként is tároljuk az utóbb sikeres `steamapps` mappát.

### 5.4 UI változások (`renderer/app.js`, `index.html`, `styles.css`)

- Szerkesztő panel: új gomb „Borító keresése a mappában” (`btn-cover-rescan`).
- Beállítások: új opció vagy infó a Steam import útvonalról (opcionális, csak ha van elmentett út).
- Import dialógus: új overlay vagy már meglévő dialógus használata a Steam játékok listázására és kiválasztására.

---

## 6. Még oldandó kérdések (a buildernek)

1. **Steam ACF parsing:** Az `appmanifest_*.acf` fájlok formátuma Key-Value (Valve VDF). Melyik mezőből vesszük a nevet (`name`) és a telepítési útvonalat (`installdir`)? Van-e benomásbeli eltérés különböző Steam verziók között?
2. **Import dialógus hol jelenjen meg?** Egyedi overlay (új ablak/modal), vagy felhasználjuk a már létező Editor/Settings keretet?
3. **Steam jogos könyvtár detektálása:** Ha több Steam könyvtár van (pl. `libraryfolders.vdf` több `path`-et tartalmaz), melyiket preferáljuk az importnál? Az összeset, vagy csak az elsőt?
4. **Borító prioritás:** Ha a scan már beállított egy `folder.jpg`-t, és a felhasználó később a szerkesztőben „Újrakeresésre” kattint, felülírjuk-e a meglévőt, vagy csak ha nincs borító?

---

## 7. Jóváhagyás

Ez a dokumentum a teljes tervezés mindkét funkcióhoz. Jóváhagyva a felhasználó által („mehet” válaszon 2026-10-25-én).

Következő lépés: a tervezési dokumentum alapján íródó implementálási terv (writing-plans), majd a kód megírása.