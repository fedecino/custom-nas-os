# SiloOs

**SiloOs** è un sistema operativo dedicato per **NAS (Network Attached Storage)** e **Home Server**, leggero e completamente *headless*, basato su **Debian 13 (Trixie) x86_64** con supporto **Dual-Boot BIOS Legacy + UEFI**.

---

## Cos'è, a cosa serve e perché è stato implementato come OS per NAS

**SiloOs** nasce con l'obiettivo di offrire un sistema operativo NAS **semplice, veloce, trasparente e interamente gestibile da browser**, senza i limiti o la pesantezza delle soluzioni proprietarie o dei pannelli general-purpose.

### A cosa serve
- **Storage centralizzato e flessibile**: gestione dischi fisici, partizioni, **formattazione disco intero (GPT 100%)**, RAID (`mdadm`), ZFS, monitoraggio SMART, automount USB e **dischi di rete SMB/NFS** sotto `/DATA`.
- **Condivisione file in rete locale**: configurazione rapida di cartelle condivise tramite **SMB/Samba**, **NFS**, **FTP** e **SFTP/SSH**, oltre a un **File Manager Web** integrato con upload, download e menu contestuale di condivisione.
- **Backup incrementali cifrati (Restic) + Wake-on-LAN**: gestione repository locali, SFTP o S3, snapshot e ripristino, con pipeline opzionale **Wake-on-LAN → Attesa avvio → Mount automatico disco di rete → Backup incrementale → Unmount pulito → Spegnimento remoto via chiave SSH**.
- **Esecuzione di applicazioni e servizi in container**: **Docker App Store** integrato (Docker Hub + catalogo curato), editor **Docker Compose YAML + file `.env` manuale**, rilevamento automatico **HTTPS/HTTP** all'apertura delle app e dashboard completa per stack e container.
- **Gestione completa del sistema via Web**:
  - Rete fisica (DHCP / IP statico), hostname, utenti e permessi, porte e firewall (`ufw`).
  - **HTTPS / SSL su Nginx** (certificato self-signed o personalizzato) e **reverse proxy** per accedere alle app tramite path dedicati (es. `https://<IP>/jellyfin`).
  - **Controllo Ventole & Sensori di Temperatura** (`lm-sensors` + `hwmon` PWM, profili Silenzioso/Bilanciato/Performance e failsafe termico automatico).
  - Log di sistema, **Terminale Web (Bash)** nel browser e **Assistente AI** opzionale (locale con Ollama/LM Studio o Cloud).

### Perché è stato progettato come OS dedicato per NAS
- **Zero overhead grafico sul server**: nessuna interfaccia desktop locale (X11/Wayland); tutta la gestione avviene tramite l'interfaccia Web su porta `80`/`443` servita da Nginx + Angular + Node.js (gira comodamente anche su NAS datati con 2–5 GB di RAM).
- **Base solida Debian 13 (Trixie)**: stabilità, supporto hardware esteso, pacchetti aggiornati (`apt`) e piena compatibilità con Docker CE, Samba, NFS, ZFS, Restic e NetworkManager.
- **Installazione headless via browser (BIOS Legacy + UEFI)**: la ISO Live si avvia automaticamente dopo 3 secondi senza bisogno di monitor o tastiera e offre un **wizard di installazione guidata da browser** su `http://siloos.local` che prepara il disco di destinazione in **GPT Dual-Boot (BIOS + UEFI)**.
- **Aggiornamenti atomici senza perdita dati**: l'aggiornamento integrato aggiorna SiloOs e i pacchetti Debian preservando `/DATA`, i container Docker e le configurazioni di rete/condivisione.

---

## Architettura

```text
├── backend/                  # API Server Node.js + TypeScript + WebSocket Terminal (porta 3000)
│   ├── src/routes/           # /api/auth, /api/install, /api/hub, /api/stacks, /api/system,
│   │                         # /api/storage, /api/shares, /api/files, /api/backups, /api/fans,
│   │                         # /api/settings, /api/users, /api/ai
│   └── src/services/         # registry.ts, appstore.ts, docker.ts, terminal.ts, events.ts
├── frontend/                 # Web UI Angular 19 + TailwindCSS + CodeMirror YAML + xterm.js
├── system/                   # Configurazioni OS (Nginx 80/443, systemd, udev, script di sistema)
├── iso-builder/              # Pipeline live-build per ISO ibrida Dual-Boot (BIOS Legacy + UEFI)
└── SECURE-SYS.md             # Audit di sicurezza e piano di hardening del sistema
```

---

## 1. Test in Locale (Sviluppo)

### Prerequisiti
- Node.js `v20+`
- Docker Engine + `docker compose` v2 (per testare il deploy reale degli stack)

### Avvio Backend
Per testare in locale senza scrivere su `/DATA` (che richiede permessi root), puoi impostare `NAS_DATA_DIR` verso una cartella locale:

```bash
cd backend
npm install
npm run build
NAS_DATA_DIR=/tmp/nas-data npm run dev
```

Il backend sarà attivo su `http://localhost:3000`.

### Avvio Frontend
In un secondo terminale:

```bash
cd frontend
npm install
npm start
```

Apri il browser su `http://localhost:4200`. Le richieste verso `/api/*` (incluso il terminale WebSocket `/api/terminal/ws`) vengono inoltrate automaticamente al backend su `localhost:3000` tramite `proxy.conf.json`.

---

## 2. Compilazione della ISO SiloOs (Debian 13 Trixie x86_64)

La pipeline `iso-builder/build-iso.sh` compila frontend e backend, configura `live-build` per Debian 13 (`trixie`, `amd64`) con bootloader ibridi **BIOS Legacy (`syslinux`) + UEFI (`grub-efi`)** e timeout automatico di 3 secondi, integrando Docker CE + Docker Compose v2, Nginx, Node.js, Restic, `lm-sensors`, NetworkManager e il servizio backend di SiloOs.

### Opzione A: Build tramite Docker Container (consigliata su qualsiasi distro Linux)
Non richiede `live-build` sull'host né di modificare il sistema locale:

```bash
./iso-builder/build-iso-docker.sh
```

### Opzione B: Build diretta su Host Debian / Ubuntu
Esegui su un sistema **Debian / Ubuntu** con privilegi `root`:

```bash
sudo ./iso-builder/build-iso.sh
```

Al termine della build verrà generato nella root del progetto il file:

```text
siloos-x86_64-v<version>.iso
```

---

## 3. Scrittura su Chiavetta USB e Installazione Headless (BIOS & UEFI)

1. Individua il dispositivo USB (es. `/dev/sdX`, **verifica con attenzione con `lsblk` per non sovrascrivere dischi di sistema**):
   ```bash
   lsblk
   ```
2. Scrivi la ISO sulla chiavetta USB con `dd` (oppure usa **Balena Etcher** o **Ventoy**):
   ```bash
   sudo dd if=siloos-x86_64-v<version>.iso of=/dev/sdX bs=4M status=progress oflag=sync
   ```
3. **Installazione guidata da browser (senza monitor né tastiera)**:
   - Collega il NAS alla rete tramite cavo Ethernet, inserisci la chiavetta Live USB (e, se vuoi installare su USB invece che su SSD/HDD interno, una **seconda chiavetta USB** di destinazione) e accendi il NAS.
   - Dopo 3 secondi la ISO si avvia automaticamente in modalità **Live** sia su schede madri **BIOS Legacy** sia **UEFI**.
   - Da un qualsiasi altro PC o smartphone sulla stessa rete, apri nel browser:
     ```text
     http://siloos.local/
     ```
     *(in alternativa usa l'IP assegnato dal router al dispositivo `siloos`)*.
   - Segui il **Wizard di Installazione Web**: scegli il disco di destinazione (la chiavetta Live in uso è protetta automaticamente), imposta hostname, utente amministratore e password, e avvia l'installazione.
   - Il disco viene partizionato automaticamente in **GPT Dual-Boot** (`bios_grub` + `EFI` + `ext4`) con entrambi i bootloader GRUB (`i386-pc` + `x86_64-efi`), così si avvia sia su sistemi BIOS Legacy sia su UEFI.
   - Al termine clicca **Spegni NAS**, rimuovi la chiavetta Live USB e riaccendi il NAS.
4. *(In alternativa, con monitor/SSH)* puoi sempre eseguire l'installer testuale da console con `sudo nas-os-install`.

---

## 4. Aggiornamento di un NAS SiloOs già installato

Puoi aggiornare **SiloOs** e i pacchetti Debian direttamente dalla Web UI in **Impostazioni → Aggiornamenti**, oppure da terminale senza toccare `/DATA`, i container Docker o le condivisioni:

- **Prima volta** (passando l'URL del tuo repository GitHub):
  ```bash
  sudo apt-get update && sudo apt-get install -y git
  sudo nas-os-update https://github.com/<tuo-utente>/<tua-repo>.git
  ```
- **Aggiornamenti successivi** (usa già il repository clonato in `/opt/nas-os/src`):
  ```bash
  sudo nas-os-update
  ```

---

## 5. Sicurezza

L'audit completo di sicurezza e la checklist di hardening del sistema (RBAC, WebSocket Terminal, File Manager, Nginx/TLS, Samba/NFS, UFW + Docker, ISO) sono documentati in [`SECURE-SYS.md`](./SECURE-SYS.md).
