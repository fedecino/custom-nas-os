# SiloOs — Audit di Sicurezza & Piano di Hardening (`SECURE-SYS.md`)

> **Data audit:** 20 Novembre 2026  
> **Ambito:** Backend API (`Node.js/Express`), WebSocket Terminal, Frontend (`Angular`), Nginx Reverse Proxy, Systemd, Script di sistema, Samba/NFS, Docker/App Store, Backup/WoL e ISO Builder (Debian 13 Trixie).

---

## 1. Riepilogo Esecutivo

SiloOs gestisce operazioni ad alto privilegio (dischi, utenti Linux, Samba/NFS, Docker, firewall UFW, SSL Nginx, terminale Web) tramite un backend Node.js eseguito come `root`. L'audit ha individuato **vulnerabilità critiche di privilege escalation, bypass di controllo accessi ed esposizione di rete** che vanno risolte prima di esporre il NAS anche solo su reti locali condivise (e a maggior ragione verso Internet/VPN).

### Tabella riepilogativa dei rischi

| ID | Severità | Area | File coinvolti | Sintesi del problema |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | 🔴 **Critica** | RBAC / Privilege Escalation | `backend/src/routes/stacks.ts`, `system.ts`, `storage.ts`, `hub.ts`, `ai.ts` | Mancanza di `requireAdmin` su rotte distruttive/root (deploy Docker, firewall, servizi, mount, browse FS, chat AI) |
| **SEC-02** | 🔴 **Critica** | Web Terminal / CSWSH | `backend/src/services/terminal.ts` | Bypass di `/usr/sbin/nologin` (assegna `/bin/bash`), accesso aperto a utenti non-admin e assenza di verifica `Origin` (CSWSH) |
| **SEC-03** | 🔴 **Critica** | Path / Symlink Traversal & XSS | `backend/src/routes/files.ts`, `ai.ts` | Uso di `path.resolve()` senza `fs.realpath()`, `/DATA/.nas-os` non protetta, Stored XSS su `/api/files/view` (`inline`) |
| **SEC-04** | 🔴 **Critica** | Esposizione Credenziali | `backend/src/routes/settings.ts`, `system/scripts/nas-os-install.sh` | Password passata come argomento CLI a `perl` (visibile in `ps`/`/proc`) e concatenazione shell non quotata in `chroot` |
| **SEC-05** | 🔴 **Critica** | Esposizione di Rete | `backend/src/index.ts` | Backend in ascolto su `0.0.0.0:3000` (bypassa Nginx/TLS) e `cors()` aperto a tutti gli origin (`*`) |
| **SEC-06** | 🔴 **Critica** | Samba & NFS | `backend/src/routes/shares.ts` | NFS con `no_root_squash` verso `*`, Samba con `force user = root`, config injection tramite newline in `comment`/`nfsClients` |
| **SEC-07** | 🟠 **Alta** | Auth & Sessioni | `backend/src/routes/auth.ts`, `users.ts` | Nessun rate limit sul login, cookie senza flag `secure`, nessuna revoca sessioni, password min. 4 caratteri, `SILO_DEV_NO_AUTH` attivo in prod |
| **SEC-08** | 🟠 **Alta** | SSRF & Config Injection | `backend/src/routes/hub.ts`, `ai.ts`, `settings.ts` | `fetch()` verso URL arbitrari (SSRF), injection di direttive Nginx in `PUT /ssl`, aggiornamento OS da `repoUrl` non verificato |
| **SEC-09** | 🟠 **Alta** | Protezione Segreti at-rest | `iso-builder/.../0100-setup-nas.hook.chroot`, `settings.ts`, `backups.ts` | `/DATA/.nas-os` con permessi `0755`, `settings.json` (`ai.apiKey`) non `0600`, segreti Restic/SMB salvati in chiaro |
| **SEC-10** | 🟠 **Alta** | OS, Firewall & Docker | `iso-builder/.../0100-setup-nas.hook.chroot`, `nas.list.chroot` | UFW spento di default, Docker bypassa UFW via iptables, SSH senza hardening/fail2ban, `vsftpd` installato, assenza `unattended-upgrades` |
| **SEC-11** | 🟡 **Media** | Nginx & TLS | `system/nginx/nas-os.conf`, `backend/src/routes/settings.ts` | Header di sicurezza HTTP mancanti (CSP, HSTS, X-Frame-Options, nosniff), `client_max_body_size 0` globale, TLS migliorabile |
| **SEC-12** | 🟡 **Media** | Dipendenze npm | `frontend/package.json` | 6 vulnerabilità note in Angular `<=19.2.25` (3 High, 3 Moderate); backend `npm audit` pulito (0 vulnerabilità) |
| **SEC-13** | 🟡 **Media** | App Store & Container | `backend/src/services/appstore.ts` | Vaultwarden con `SIGNUPS_ALLOWED=true`, Portainer con `docker.sock` senza warning, mancanza di `no-new-privileges` e limiti risorse |
| **SEC-14** | 🟡 **Media** | Hardening OS / USB / WoL | `system/systemd/nas-os.service`, `nas-os-usb-mount.sh`, `backups.ts` | Backend interamente `root`, USB montati senza `nosuid,nodev,noexec`, chiave SSH WoL senza restrizione `command=` consigliata |
| **SEC-15** | 🔵 **Bassa** | Audit & Osservabilità | Tutto il backend | Assenza di un audit log strutturato per eventi di sicurezza (login, cambi permessi, firewall, formattazioni) |

---

## 2. Interventi Critici (Priorità Massima — Da fare subito)

### SEC-01 — Applicare `requireAdmin` su tutte le rotte amministrative
Attualmente qualsiasi utente standard autenticato (non `sudo`) può ottenere privilegi di `root` o manomettere il sistema:

- **`backend/src/routes/stacks.ts`**: aggiungere `router.use(requireAdmin)` in cima al router (o almeno su `POST /deploy`, `POST /:name/:action`, `GET /:name/compose`, `GET /:name/logs`). Un utente non-admin che può fare deploy di un `docker-compose.yml` può montare `/` con `privileged: true` e diventare `root` in 2 secondi.
- **`backend/src/routes/system.ts`**: aggiungere `requireAdmin` su:
  - `POST /services/:name/:action`
  - `POST /firewall/toggle`, `POST /firewall/rules`, `DELETE /firewall/rules/:index`
  - `GET /logs` e `GET /processes` (contengono dettagli sensibili e argomenti CLI di sistema)
  - `GET /ports`
- **`backend/src/routes/storage.ts`**: aggiungere `requireAdmin` su:
  - `POST /mount`, `POST /unmount`, `POST /mkdir`, `GET /browse`, `POST /raid/import`, `POST /usb-automount`, `GET /smart`.
- **`backend/src/routes/hub.ts`**: aggiungere `requireAdmin` su `POST /store/sync` e `POST /import-url`.
- **`backend/src/routes/ai.ts`**:
  - Aggiungere `requireAdmin` su `POST /test`.
  - Isolare la cronologia chat per utente (`/DATA/.nas-os/ai-chats/<username>.json`) invece del singolo file globale `ai-chats.json` condiviso tra admin e utenti standard.
  - Sostituire le chiamate interne `localApi('http://127.0.0.1:3000/api/...')` con chiamate dirette alle funzioni di servizio TypeScript (evitando richieste HTTP interne non autenticate).

### SEC-02 — Mettere in sicurezza il Terminale Web (`/api/terminal/ws`)
File: `backend/src/services/terminal.ts`

1. **Verificare i privilegi e la shell dell'utente**:
   - Limitare il terminale Web agli utenti admin (`isUserAdmin(session.username)`) **oppure** agli utenti che hanno una shell interattiva valida.
   - **Rimuovere il bypass di `nologin` (riga 74)**: se `userEntry.shell` è `/usr/sbin/nologin` o `/bin/false`, **rifiutare la connessione con `403 Forbidden`** invece di forzare `/bin/bash`.
2. **Protezione contro Cross-Site WebSocket Hijacking (CSWSH)**:
   - Nell'evento `server.on('upgrade', ...)`, validare l'header `req.headers.origin` confrontandolo con l'host atteso (`req.headers.host`) e rifiutare origini esterne con `403 Forbidden`.
3. **Pulire le variabili d'ambiente passate al processo figlio**:
   - Non passare `...process.env` intero alla shell dell'utente (potrebbe esporre variabili sensibili del daemon). Passare una whitelist minima (`TERM`, `COLORTERM`, `LANG`, `PATH`, `HOME`, `USER`, `LOGNAME`).

### SEC-03 — Risolvere Symlink Traversal e Stored XSS nel File Manager
File: `backend/src/routes/files.ts`, `backend/src/routes/ai.ts`

1. **Usare `fs.realpath()` dopo `path.resolve()`**:
   - Prima di ogni operazione di lettura, scrittura, copia, spostamento, download o eliminazione, risolvere i link simbolici reali con `fs.realpath()` (o `fs.realpath(path.dirname(target))` per nuovi file) e verificare che il percorso *canonico* rientri nei `allowedRoots` dell'utente.
   - Rifiutare esplicitamente l'accesso se il percorso risolto cade in `/DATA/.nas-os` per qualsiasi utente (e per `files.ts` aggiungere `path.join(DATA_DIR, '.nas-os')` a `isProtectedPath()`).
2. **Bloccare Stored XSS su `/api/files/view`**:
   - Aggiungere sempre `res.setHeader('X-Content-Type-Options', 'nosniff')`.
   - Aggiungere `res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox")` su `/api/files/view`.
   - Per estensioni eseguibili nel browser (`.html`, `.htm`, `.svg`, `.xhtml`, `.xml`, `.js`), forzare `Content-Disposition: attachment` invece di `inline`.
3. **Limiti dimensione upload**:
   - Impostare un limite configurabile o controllare lo spazio disco disponibile su `/api/files/upload` e `/api/settings/wallpaper` (max es. 10 MB per gli sfondi, verificando magic bytes PNG/JPEG/WebP).

### SEC-04 — Eliminare password da CLI args e command injection nell'installer
File: `backend/src/routes/settings.ts`, `system/scripts/nas-os-install.sh`

1. **`verifyLinuxUserPassword` (`settings.ts` righe 287-291)**:
   - **Non passare mai `password` o `hash` in `execFileAsync('perl', [..., password, hash])`**.
   - Usare `spawn('perl', ['-e', '...'])` passando `password` e `hash` tramite **`stdin`** (e chiudendo subito lo stream), oppure usare un modulo PAM nativo / `unix-crypt-td-js`.
2. **`nas-os-install.sh` (righe 97-112)**:
   - Validare `NEW_USER` con regex `^[a-z_][a-z0-9_-]{1,30}$`.
   - Non interpolare `${NEW_PASS}` dentro `chroot ... /bin/bash -c "..."`. Passare le credenziali via pipe stdin:
     ```bash
     printf '%s:%s\n' "$NEW_USER" "$NEW_PASS" | chroot "$TARGET_MNT" chpasswd
     ```

### SEC-05 — Isolare il Backend su `127.0.0.1` e restringere CORS
File: `backend/src/index.ts`

1. **Bind solo su loopback**:
   - Cambiare `server.listen(PORT, '0.0.0.0', ...)` in:
     ```ts
     const HOST = process.env.BIND_HOST || '127.0.0.1';
     server.listen(PORT, HOST, ...);
     ```
   - Tutto il traffico esterno deve passare esclusivamente da Nginx (`:80` / `:443`).
2. **Disabilitare CORS wildcard**:
   - Poiché frontend e backend sono serviti dallo stesso origin tramite Nginx, rimuovere `app.use(cors())` in produzione (o limitarlo rigorosamente a `process.env.CORS_ORIGIN` solo in sviluppo con `credentials: true`).

### SEC-06 — Hardening di Samba e NFS + prevenzione Config Injection
File: `backend/src/routes/shares.ts`

1. **NFS (`riga 164`)**:
   - Sostituire `no_root_squash` con **`root_squash`** di default (rendere `no_root_squash` solo un'opzione avanzata esplicita con avviso di sicurezza).
   - Evitare `*` come client predefinito: suggerire la subnet LAN locale (es. `192.168.1.0/24`).
   - Validare `nfsClients` con una regex stretta (solo IP, CIDR, hostname, `*`, separati da spazi, **zero** newline, parentesi o caratteri di controllo).
2. **Samba (`righe 76, 86`)**:
   - Rimuovere `force user = root`! Creare invece un gruppo dedicato (es. `silo-shares`), assegnare `chgrp -R silo-shares <sharePath>` + bit SGID `chmod 2775` e aggiungere gli utenti autorizzati al gruppo, lasciando che Samba operi con l'UID reale dell'utente autenticato.
   - Sanitizzare `comment` e `path` rimuovendo `\r`, `\n` e verificando che `path` non contenga caratteri di controllo (previene iniezione di direttive Samba come `root preexec`).
   - Impostare `server min protocol = SMB2` e `smb encrypt = desired` in `/etc/samba/smb.conf`.

---

## 3. Interventi ad Alta Priorità

### SEC-07 — Rafforzamento Autenticazione, Sessioni e Password
File: `backend/src/routes/auth.ts`, `backend/src/routes/users.ts`

1. **Rate Limiting & Anti Brute-Force**:
   - Aggiungere un rate limiter (es. `express-rate-limit` o mappa in-memory per IP + username) su `POST /api/auth/login` e `POST /api/settings/updates/apply`: max **5 tentativi ogni 15 minuti** per IP, con backoff progressivo e risposta `429 Too Many Requests`.
2. **Sicurezza Cookie `silo_session`**:
   - Impostare `app.set('trust proxy', 1)` in Express (poiché dietro Nginx su `127.0.0.1`).
   - Impostare dinamicamente `secure: req.secure || req.headers['x-forwarded-proto'] === 'https'` sul cookie `silo_session`.
   - Ridurre `SESSION_TTL_MS` (es. 12–24 ore, o opzione "Ricordami") e cambiare `sameSite` a `'strict'` dove compatibile.
3. **Revoca delle sessioni**:
   - Includere un `jti` (token ID) e un `sessionVersion` nel payload firmato; mantenere una blacklist/store di sessioni attive per invalidare immediatamente i token al **logout**, al **cambio password** e all'**eliminazione utente**.
4. **Disabilitare `SILO_DEV_NO_AUTH` in produzione**:
   - Consentire `SILO_DEV_NO_AUTH === '1'` **solo** se `process.env.NODE_ENV !== 'production'`.
5. **Policy Password (`users.ts`)**:
   - Aumentare la lunghezza minima da 4 a **almeno 10–12 caratteri** (con avviso di complessità nell'UI).

### SEC-08 — Prevenzione SSRF, Nginx Injection e Supply Chain Update
File: `backend/src/routes/hub.ts`, `backend/src/routes/ai.ts`, `backend/src/routes/settings.ts`

1. **Protezione SSRF (`hub.ts`, `ai.ts`)**:
   - Creare un helper `assertSafeExternalUrl(rawUrl, { allowPrivate })` che risolva il DNS prima della `fetch()` e blocchi IP loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16`, `fe80::/10`) e RFC1918 per `/api/hub/import-url` e `/api/hub/store/sync`.
   - Limitare la dimensione massima del body scaricato (es. max 512 KB per un `docker-compose.yml`).
2. **Validazione percorsi SSL (`settings.ts` righe 1312-1330)**:
   - Validare `certPath` e `keyPath` con regex stretta `^\/[a-zA-Z0-9._\/-]+$` (nessuno spazio, `;`, `\n`, `{`, `}`) e verificare che il file sia leggibile come certificato/chiave PEM valida (`openssl x509 -noout` / `openssl pkey -noout`) **prima** di scriverlo in `ssl.conf`.
3. **Sicurezza Updater (`settings.ts` + `nas-os-update.sh`)**:
   - Validare `repoUrl` contro una whitelist (es. solo `https://github.com/fedecino/...`) o richiedere conferma esplicita e verifica di tag firmati GPG prima di eseguire `npm ci` e sovrascrivere script in `/usr/local/sbin/` come `root`.

### SEC-09 — Protezione della directory segreti `/DATA/.nas-os`
File: `iso-builder/config/hooks/normal/0100-setup-nas.hook.chroot`, `backend/src/routes/settings.ts`, `backups.ts`

1. **Permessi restrittivi sulla directory**:
   - Impostare `chmod 700 /DATA/.nas-os` (sia nell'hook ISO sia in `ensureBaseDirectories()` nel backend all'avvio).
2. **Permessi `0o600` su tutti i file sensibili**:
   - Scrivere `settings.json` (che contiene `ai.apiKey`), `proxy-routes.json`, `shares.json`, `ai-chats.json` sempre con `{ mode: 0o600 }`.
3. **Cifratura at-rest dei segreti applicativi**:
   - Valutare di cifrare `ai.apiKey`, `backups.json` (`password`, `s3SecretKey`) e le credenziali usando AES-256-GCM con una master key dedicata in `/etc/siloos/master.key` (`root:root`, `0600`), separata da `/DATA` (così un backup o uno snapshot di `/DATA` non espone le chiavi in chiaro).

### SEC-10 — Hardening OS, Firewall UFW, SSH, FTP e Docker (ISO Builder)
File: `iso-builder/config/hooks/normal/0100-setup-nas.hook.chroot`, `iso-builder/config/package-lists/nas.list.chroot`

1. **Abilitare UFW di default** al provisioning:
   ```bash
   ufw default deny incoming
   ufw default allow outgoing
   ufw allow 22/tcp    # SSH (meglio: ufw limit 22/tcp)
   ufw allow 80/tcp    # Web UI HTTP
   ufw allow 443/tcp   # Web UI HTTPS
   ufw --force enable
   ```
2. **Risolvere il bypass di UFW da parte di Docker**:
   - Di default Docker manipola `iptables` prima di UFW, esponendo le porte dei container anche se UFW le blocca.
   - Soluzioni consigliate:
     - Installare e configurare **`ufw-docker`** (regole `DOCKER-USER` in `/etc/ufw/after.rules`), **oppure**
     - Esporre i container solo su `127.0.0.1:<porta>` quando pubblicati dietro Nginx Reverse Proxy.
3. **Hardening OpenSSH (`/etc/ssh/sshd_config.d/99-siloos-hardening.conf`)**:
   ```sshconfig
   PermitRootLogin no
   MaxAuthTries 3
   LoginGraceTime 30
   X11Forwarding no
   AllowTcpForwarding no
   ClientAliveInterval 300
   ClientAliveCountMax 2
   ```
   - Aggiungere **`fail2ban`** in `nas.list.chroot` per proteggere SSH (e opzionalmente i log di Nginx `/api/auth/login`).
4. **Disabilitare FTP (`vsftpd`) di default**:
   - FTP trasmette credenziali e file in chiaro. Disabilitare `vsftpd.service` di default e consigliare SFTP (già attivo su SSH) o abilitare `ssl_enable=YES` obbligatorio in `/etc/vsftpd.conf`.
5. **Aggiornamenti automatici di sicurezza Debian**:
   - Aggiungere `unattended-upgrades` e `apt-listchanges` in `nas.list.chroot` per applicare automaticamente le patch di sicurezza Debian Trixie.

---

## 4. Interventi di Media Priorità & Hardening Continuo

### SEC-11 — Header di Sicurezza Nginx e Configurazione TLS
File: `system/nginx/nas-os.conf`, `backend/src/routes/settings.ts`

1. **Aggiungere header di sicurezza in `nas-os.conf`**:
   ```nginx
   server_tokens off;
   add_header X-Frame-Options "SAMEORIGIN" always;
   add_header X-Content-Type-Options "nosniff" always;
   add_header Referrer-Policy "strict-origin-when-cross-origin" always;
   add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
   ```
   - Quando `forceHttps` è attivo in `ssl.conf`, aggiungere:
     ```nginx
     add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
     ```
2. **Limitare `client_max_body_size`**:
   - Rimuovere `client_max_body_size 0;` dal blocco globale `server {}` e applicarlo **solo** a `location /api/files/upload { client_max_body_size 0; ... }`. Sul resto di `/api/` impostare `client_max_body_size 10m;`.
3. **TLS moderno (`settings.ts`)**:
   - Usare certificati self-signed con chiave ECDSA P-256 (`-newkey ec -pkeyopt ec_paramgen_curve:prime256v1`) o RSA 4096 e durata 825 giorni, più `ssl_session_tickets off;` e `ssl_prefer_server_ciphers off;`.

### SEC-12 — Aggiornamento Dipendenze Vulnerabili (`npm audit`)
- **Backend**: `npm audit --omit=dev` → **0 vulnerabilità**.
- **Frontend**: `npm audit --omit=dev` → **6 vulnerabilità (3 High, 3 Moderate)** su `@angular/core`, `@angular/common`, `@angular/compiler`, `@angular/forms`, `@angular/platform-browser` (`<=19.2.25`, inclusi sanitization bypass XSS e XSRF token leakage).
- **Azione**: pianificare l'aggiornamento di Angular a una versione patchata (v20+/v21+ o latest LTS supportata) e aggiungere `npm audit --audit-level=high` nella pipeline GitHub Actions (`.github/workflows/pr-check.yml`).

### SEC-13 — Hardening dei Template App Store Docker
File: `backend/src/services/appstore.ts`

- **Vaultwarden**: cambiare `SIGNUPS_ALLOWED=true` in `SIGNUPS_ALLOWED=false` (o avvisare di disabilitarlo dopo la creazione del primo account).
- **Portainer**: mostrare un badge/avviso esplicito che il mount `/var/run/docker.sock` equivale a pieno accesso `root` sull'host.
- **Best practice sui template**: aggiungere `security_opt: ["no-new-privileges:true"]` e preferire tag di versione pinnati invece di `:latest` dove possibile.

### SEC-14 — Hardening Systemd, USB Automount e Chiave SSH WoL
1. **USB Automount (`system/scripts/nas-os-usb-mount.sh`)**:
   - Montare i dispositivi USB rimovibili con opzioni restrittive:
     ```bash
     systemd-mount --no-block --automount=no -o nodev,nosuid,noexec "/dev/${DEVNAME_SHORT}" "$MOUNT_DIR" || true
     ```
2. **Chiave SSH di spegnimento remoto (`backups.ts`)**:
   - Nella UI del Backup Manager, consigliare di incollare la chiave pubblica nel `~/.ssh/authorized_keys` del PC/NAS remoto **con restrizione di comando**:
     ```text
     command="sudo -n poweroff",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... siloos-backup-wol
     ```
     In questo modo, anche se la chiave privata `/DATA/.nas-os/backup-wol.key` venisse compromessa, potrebbe **solo** spegnere il target e mai aprire una shell remota.
3. **Separazione privilegi Backend (`system/systemd/nas-os.service`)**:
   - A medio termine, valutare di eseguire il backend Node.js come utente dedicato non privilegiato (`siloos`) e delegare le sole operazioni root a un piccolo helper privilegiato o a regole `sudoers` granulari (`/etc/sudoers.d/siloos`), abilitando le direttive systemd (`ProtectSystem=strict`, `PrivateTmp=true`, `ProtectKernelTunables=true`).

### SEC-15 — Audit Logging degli Eventi di Sicurezza
- Creare un logger dedicato `/var/log/siloos-audit.log` (o su `journald` con tag `siloos-audit`) che registri in formato JSON:
  - Login riusciti e falliti (username, IP client reale da `X-Real-IP`, user-agent)
  - Creazione/eliminazione utenti e cambi password
  - Modifiche regole firewall UFW e servizi di sistema
  - Deploy/rimozione stack Docker e formattazione dischi
  - Aperture/chiusure sessioni Web Terminal

---

## 5. Checklist Operativa Consigliata

### Fase 1 — Fix Bloccanti (Completata)
- [x] **SEC-01**: Aggiungere `requireAdmin` su `stacks.ts`, `system.ts`, `storage.ts`, `hub.ts` e isolare chat per utente in `ai.ts`.
- [x] **SEC-02**: Bloccare `nologin`/non-admin, pulire env e validare `Origin` (CSWSH) in `terminal.ts`.
- [x] **SEC-03**: Usare `fs.realpath()` in `files.ts` e `ai.ts`, proteggere `/DATA/.nas-os`, aggiungere CSP/nosniff/attachment su `/api/files/view`.
- [x] **SEC-04**: Passare password via `stdin` in `verifyLinuxUserPassword` (`settings.ts`) e sistemare `chpasswd` in `nas-os-install.sh`.
- [x] **SEC-05**: Bind backend su `127.0.0.1:3000` e rimuovere `cors()` aperto in `index.ts`.
- [x] **SEC-06**: Sostituire `no_root_squash` con `root_squash` (NFS) e `force user = root` con gruppo `silo-shares` (Samba) + validare `comment`/`nfsClients` in `shares.ts`.

### Fase 2 — Hardening Autenticazione, Rete e Segreti (Completata)
- [x] **SEC-07**: Rate limiting login (5 tentativi / 15 min), cookie `secure` dinamico, revoca sessioni (`jti` + cambio password/delete), password min. 8 caratteri, bloccare `SILO_DEV_NO_AUTH` in prod.
- [x] **SEC-08**: Protezione SSRF su `appstore.ts`/`hub.ts`, validazione rigida `certPath`/`keyPath` SSL.
- [x] **SEC-09**: `chmod 700 /DATA/.nas-os` e `0600` su file di configurazione con segreti (`settings.json`, `ai-chats`, `audit.log`).
- [x] **SEC-11**: Header di sicurezza Nginx (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `HSTS`, `server_tokens off`) e limiti `client_max_body_size` (illimitato solo su `/api/files/upload`).

### Fase 3 — Hardening OS, ISO e Dipendenze
- [x] **SEC-10 (parziale)**: Aggiunti `fail2ban`, `unattended-upgrades`, hardening `sshd_config`, disabilitato `vsftpd` di default nell'ISO. *(Resta da valutare `ufw-docker` se si espongono porte container).*
- [ ] **SEC-12**: Aggiornare Angular (major upgrade) per risolvere le 6 vulnerabilità `npm audit` e integrare `npm audit` in CI.
- [x] **SEC-13 (parziale)**: `SIGNUPS_ALLOWED=false` su Vaultwarden in `appstore.ts`.
- [x] **SEC-14 & SEC-15**: Opzioni `nodev,nosuid,noexec` su USB automount (`nas-os-usb-mount.sh`), audit log sicurezza (`/DATA/.nas-os/audit.log` + `journald`), rilevamento `/var/run/reboot-required` con pulsante riavvio in UI.
