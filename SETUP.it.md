# Setup — quello che devi fare tu

Il bot è già scritto, installato e testato in dry-run su transazioni vere.
Restano tre cose che solo tu puoi fare (account e chiavi). Tempo reale: ~20 minuti.

---

## Passo 0 — provalo adesso (0 minuti, niente account)

```bash
npm run cli -- verify
```

Deve stampare `club API ok`, `rpc ok`, `contract ok`, `metadata ok`.
Poi guarda cosa scriverebbe:

```bash
npm run cli -- preview claim 1709
```

Testo e PNG finiscono in `out/`. In `DRY_RUN=true` non tocca X in nessun caso.

---

## Passo 1 — RPC dedicato (5 minuti, gratis)

I nodi pubblici funzionano per il "vivo" ma rifiutano le finestre storiche: senza
un RPC tuo, il backfill non gira e il polling è fragile.

1. <https://alchemy.com> → signup → **Create App** → Ethereum → Mainnet
2. Copia l'HTTPS URL (`https://eth-mainnet.g.alchemy.com/v2/xxxxx`)
3. Nel file `.env`:

```
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/xxxxx
RPC_URL_FALLBACK=https://ethereum-rpc.publicnode.com
MAX_BLOCK_SPAN=2000
```

Il piano gratuito basta con ampio margine: il bot fa una query di log ogni 20 secondi.

---

## Passo 2 — account X e chiavi (10 minuti)

1. Crea un account X dedicato (non il tuo personale). Bio suggerita, la stampa anche `verify`:

   > Official ship's log of Normies Yacht Club, kept by Yoko — Normie #8362. Claims, sales, watches. Every number verifiable on-chain. CC0.

2. <https://developer.x.com> → Sign up → crea un **Project** e una **App**.
3. **PRIMA** di generare i token: App → *User authentication settings* → **Read and Write**.
   Se generi i token prima, sono di sola lettura e ogni post fallisce con 403.
   In quel caso: rigenerali dopo aver cambiato il permesso.
4. Keys and tokens → copia i quattro valori in `.env`:

```
X_APP_KEY=...
X_APP_SECRET=...
X_ACCESS_TOKEN=...
X_ACCESS_SECRET=...
```

5. **Etichetta "account automatico"** (obbligatoria per le regole X sull'automazione).
   Si fa dall'app o dal sito X, **loggato con l'account del bot**, non dal developer portal:

   Settings and privacy → Your account → Account information → **Automation** →
   *Manage your automated account* → indica il tuo account personale come **managing account**
   → conferma con la password di quell'account.

   Da quel momento il profilo mostra il badge "Automated by @tuoaccount". Serve anche a
   dire una cosa che questo bot dichiara comunque in bio: non è il club, è un log.

6. Verifica senza pubblicare nulla:

```bash
npm run cli -- verify
```

Deve comparire `x account ok @iltuohandle` e l'`X_USER_ID` da incollare in `.env`.

**Sui costi X.** Non esiste più un piano gratuito: l'API si paga a consumo, con crediti
acquistati in anticipo. I prezzi che contano per questo bot:

| Operazione | Costo |
|---|---|
| Un post | **$0,015** |
| Un post **con un link dentro** | **$0,200** — tredici volte tanto |
| Leggere le proprie menzioni | $0,001 a menzione, zero quando non ce ne sono |

Due watch al giorno sono $0,90 al mese. Con claim, vendite, sweep e Tide di una flotta
tranquilla, l'account costa **circa $2 al mese**.

Il bot **si rifiuta di pubblicare un post che contenga un link**: non gli servono (stampa
numeri di blocco, non URL) e costerebbero tredici volte tanto. Ha anche un tetto di spesa
suo, `MONTHLY_BUDGET_USD`, oltre al quale smette da solo tenendo gli ultimi crediti per
claim, sweep e Tide chiusi.

Il modulo D (lookup su menzione) ora è economico — le menzioni del proprio account costano
$0,001 l'una — quindi si può accendere quando vuoi.

---

## Passo 3 — accendilo

Prima in locale, ancora in dry-run, per una giornata se vuoi:

```bash
npm start
```

Quando ti fidi, in `.env`:

```
DRY_RUN=false
```

e riavvia. Da quel momento pubblica.

---

## Passo 4 — hosting (5 minuti)

È un **worker**, non un sito: non serve una porta pubblica.

**Railway** (più semplice)

1. Metti la cartella su GitHub (repo pubblico va benissimo: è CC0).
2. railway.app → New Project → Deploy from GitHub → scegli il repo.
   Il `Dockerfile` viene usato in automatico.
3. Variables → incolla il contenuto del tuo `.env`.
4. **Importante**: Settings → Volumes → monta un volume su `/data`.
   Senza volume, a ogni redeploy il bot perde cursore e memoria dei post già
   fatti, e ripubblica. Con il volume, `STATE_DIR=/data/state` fa il resto.

**Alternative**: Fly.io (`fly launch`, stesso Dockerfile, volume su `/data`) oppure un
VPS con `pm2 start "npx tsx src/index.ts" --name nyc-log`.

---

## Manutenzione

| Quando | Cosa |
|---|---|
| Un post sbagliato | `DRY_RUN=true`, riavvia, indaga con `npm run cli -- tx 0x...` |
| 14 set 2026, 12:00 UTC | **niente da fare**: `MODULE_FORGE=auto` legge la fase dal relay del club e si arma da solo |
| Se il club espone gli acquisti Chandlery per scafo (non per wallet) | si accende anche H: dimmelo e lo collego |
| Passaggio a X Basic | `MODULE_LOOKUP=true` e alza `MAX_POSTS_PER_MONTH` |
| Una frase del diario non ti piace | cambiala in `data/yoko.json`, poi `npm run tools:soul` |

## Il diario di Capitan Yoko (modulo J)

Tutto il resto che pubblica l'account è **il registro del club**: numeri, blocchi, scafi.
Una volta al giorno, alle **21:45 UTC**, chi tiene quel registro scrive la sua pagina.

Chi è: **Yoko**, agente ERC-8004 **#32683**, legato al Normie **#8362**
(<https://www.normies.art/lab/agentic/agents/32683>). Livello 8, 73 action points, cinque
passaggi di canvas, netto −67 pixel. Il ritratto sulla card è la sua arte on-chain vera.

Come funziona, in breve:

- **Nessun modello di linguaggio nel giro.** Le frasi che Yoko può dire sono tutte scritte in
  [`data/yoko.json`](data/yoko.json), nel repo. I numeri della giornata scelgono da quale gruppo
  pescare — giornata muta, claim, mercato, Tide, giornata piena — e lo stato ricorda le ultime
  otto frasi usate, così non apre due pagine di fila allo stesso modo.
  Costo: **un post, 0,015 $**. Circa **0,45 $ al mese**. Nient'altro.
- **La persona invece è viva.** Livello, action points, passaggi e differenza di pixel vengono
  letti dal suo record su `api.normies.art` a ogni pagina. Se bruci un Normie o modifichi i
  pixel, il diario lo dice da solo, senza toccare il codice.
- **Quel servizio non è nostro**, quindi può spostare numeri e nient'altro: `backstory`,
  `greeting` e `systemPrompt` non li legge nessuno. Sulla timeline finisce solo prosa che è
  passata da questo repo.

Per vederla:

```bash
npm run soul               # chi tiene il log, con che numeri, e la pagina di oggi
npm run preview:journal    # scrive la pagina di oggi adesso (in DRY_RUN va in out/)
npm run tools:soul         # 280 pagine composte e controllate: lunghezza, voce, segnaposto
```

Se una frase non ti convince, cambiala in `data/yoko.json` e basta: è un file di testo, non
codice. `npm run tools:soul` ricontrolla tutto prima che vada online.

Per spegnere il diario: `MODULE_JOURNAL=false`. Per farla scrivere solo nei giorni in cui è
successo qualcosa: `JOURNAL_ON_QUIET_DAYS=false`. Su Railway non serve aggiungere nulla —
il modulo è acceso di default.

## Il relay del club

Il bot legge anche `https://nyc-realtime.fly.dev`, il servizio pubblico che alimenta la marina 3D.
Da lì arrivano il round della Tide (con blocco di settle e hash del sorteggio), la fase del forge
e il conteggio dei captain. Non serve nessuna chiave.

Tre rotte di quel relay sono per wallet — `/regatta/leaderboard`, `/chandlery/{wallet}`,
`/logbook/captain/{wallet}` — e il bot **si rifiuta di chiamarle**: c'è un controllo nel codice,
non solo una buona intenzione. È anche il motivo per cui il modulo Chandlery resta spento: gli
acquisti sono visibili solo per wallet, e questo log non passa in rassegna i portafogli di nessuno.

## Cosa NON fa, di proposito

Non inventa premi, gradi o classifiche. Non pubblica liste di wallet. Non fa listing
o delisting. Non pubblica un numero che tu non possa ricontrollare da solo sulla chain.

Essere l'account ufficiale non cambia nessuna di queste regole: è anzi il motivo
per cui contano. Un log ufficiale che chiede di essere creduto sulla parola vale
meno di uno che chiunque può ricontrollare riga per riga.
