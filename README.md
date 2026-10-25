# GameHub

Steam-szerű helyi játéklauncher Windowsra. A beállított könyvtárakból (alapból `D:\Games`) automatikusan felismeri a játékokat, borítókkal jeleníti meg őket, és egy kattintással indítja – játékidőt és utolsó indítást is mér.

## Funkciók

- **Automatikus felismerés** – a mappákból kitalálja az indítót (`Run Me!.bat`, `!start*.bat`, Unreal `-Shipping.exe`, egyéb exe-ek), kiszűri az installereket, crash handlereket, redisteket.
- **Automatikus borítófelismerés** – az újonnan discoveryelt játék mappájában keresi a `folder.jpg`, `cover.jpg`, `poster.jpg` és `banner.jpg` fájlokat (ezen prioritás szerint), és ha nincs még felhasználói borító, az elsőt beállítja borítónak. Ha egyik sem található, bármely képfájl (`png`, `jpg`, `jpeg`, `webp`, `gif`, `bmp`) használható fallback-ként.
- **Borító újrakikeresés** – a szerkesztőben új gomb („Borító keresése a mappában”) lehetővé teszi, hogy bármikor újra keressünk borítót a játék saját mappájában. Kézzel kiválasztott borítót soha nem ír felül.
- **Steam-hangulatú könyvtár** – borítórács, hover-re megjelenő *Játszás* gomb, kereső, rendezés (név, utolsó játék, játékidő, hozzáadás), kedvencek.
- **Steam-könyvtár import** – a topbarban lévő „Steam import” gombbal felkeresni lehet a telepített Steam játékokat a `libraryfolders.vdf` és az `appmanifest_*.acf` fájlokból. A játékokat csak javaslattul listázza, a felhasználó kijelöli, melyeket vegye fel a könyvtárba. Ha a Steam nem az alapértelmezett helyen van, fájlválasztóval választható a `steamapps` mappa, és az útvonalat elmentjük a beállításokban (`steamImportPath`).
- **Játékidő** – a futó folyamatot figyeli, és elmenti a játékidőt valamint az utolsó indítás idejét.
- **Kézi szerkesztés** – indító, argumentumok, munkakönyvtár, folyamatnév, rendszergazdai indítás, saját borítókép.
- **Könyvtárak kezelése** – több gyökér is megadható, launcher-mappák (Epic/Steam/GOG) kihagyhatók.

## Követelmények

- Windows 10/11
- Node.js 20+ (fejlesztéshez)
- Az első `npm install` letölti az Elektront (~100 MB)

## Fejlesztői indítás

```powershell
npm install
npm start
```

Hasznos scriptek:

```powershell
npm run test:scan     # csak a könyvtárfelismerést írja ki, Electron nélkül
npm run dist          # portable .exe készítése a dist\ mappába
```

## Használat

1. Indítsd el az appot – a `D:\Games` mappát alapból figyeli.
2. Ha a játékod máshol van: **Beállítások → Könyvtár hozzáadása**.
3. A borító fölé víve az egeret **▶ Játszás**; a szív ikon a kedvencekhez adja.
4. A kártyára kattintva részletek, játékidő, szerkesztés és mappa megnyitása.
5. **Steam import**: kattints a „Steam import” gombra a tetején – az app felkeresi a Steam könyvtárait, listázza a talált játékokat, és a kijelölteket felviheti a könyvtárba. Az indítót később a szerkesztőben állíthatod be.

## Adatok helye

Minden helyi adat ide kerül, a játékmappákhoz nem nyúlunk:

```
%APPDATA%\GameHub\
├─ library.json   # játéklista, beállítások, játékidők
└─ covers\        # bemásolt borítóképek
```

## Két speciális eset, amit kezel

- **`D:\Games\Hacker Sim.`** – a mappanév pontra végződik, amit a Windows minden normál útvonalból lecsipked. Emiatt a játék nem tud a saját mappájába írni (mentés, log), és el sem indul. Az app felismeri ezt, és a részletek panelen egy **„Mappa átnevezése”** gombot kínál: ilyenkor csak a mappanévből tűnik el a záró pont (a játékfájlokhoz nem nyúlunk). Átnevezés után minden a szokásos módon működik.
- **Call of Duty (AnkerGames)** – az `!start_sp26.bat` anti-cheat kerneldrivert tölt be, ezért rendszergazdai indítás kell. Az app ilyenkor egy UAC ablakot nyit; ha megszakítod, magyar hibaüzenetet kapsz.

## Projekt felépítés

```
src/
├─ main/
│  ├─ main.js         # Electron életciklus, ablak, cover:// protokoll
│  ├─ paths.js        # extended path kezelés (záró pontos mappák)
│  ├─ library.js      # library.json tároló, atomikus mentés
│  ├─ scanner.js      # játék- és indítófelismerés, automatikus borítófelismerés
│  ├─ launcher.js     # exe/bat/admin indítás
│  ├─ rename.js       # záró pontos mappanév javítása
│  ├─ tracker.js      # folyamatfigyelés, játékidő
│  ├─ steam-import.js # Steam VDF/ACF parsing, könyvtárfelismerés
│  └─ ipc.js          # IPC végpontok, állapot-küldés, Steam import handler
├─ preload/preload.js
└─ renderer/          # HTML/CSS/JS felület (Steam import dialógus, borító rescan)
scripts/
├─ test-scan.js              # könyvtárfelismerés önteszt
├─ test-steam-import.js      # Steam VDF/ACF parsing önteszt
├─ test-steam-import-ipc.js  # Steam import IPC önteszt
└─ make-icon.ps1             # ikon generálás (PowerShell + System.Drawing)
```

## Licenc

MIT