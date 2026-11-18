# SiloOs

**SiloOs** è un sistema operativo dedicato per **NAS (Network Attached Storage)** e **Home Server**, leggero e completamente *headless*, basato su **Debian 13 (Trixie) x86_64**.

---

## Cos'è, a cosa serve e perché è stato implementato come OS per NAS

**SiloOs** nasce con l'obiettivo di offrire un sistema operativo NAS **semplice, veloce, trasparente e interamente gestibile da browser**, senza i limiti o la pesantezza delle soluzioni proprietarie o dei pannelli general-purpose.

### A cosa serve
- **Storage centralizzato e sicuro**: gestione dischi fisici, partizioni, RAID (`mdadm`), ZFS, monitoraggio SMART e spazio di archiviazione sotto `/DATA`.
- **Condivisione file in rete locale**: configurazione rapida di cartelle condivise tramite **SMB/Samba**, **NFS**, **FTP** e **SFTP/SSH**, oltre a un **File Manager Web** integrato con upload, download e menu contestuale di condivisione.
- **Esecuzione di applicazioni e servizi in container**: **Docker App Store** integrato (Docker Hub + Registry API v2), editor **Docker Compose YAML** e dashboard per gestire stack e container.
- **Gestione completa del sistema via Web**: configurazione rete (DHCP / IP statico su scheda fisica), hostname, utenti e permessi, porte e firewall (`ufw`), **reverse proxy Nginx** per accedere alle app tramite path dedicati (es. `http://<IP>/jellyfin`), log di sistema, **Terminale Web (Bash)** direttamente nel browser e **Assistente AI** opzionale (locale con Ollama/LM Studio o Cloud).

### Perché è stato progettato come OS dedicato per NAS
- **Zero overhead grafico sul server**: nessuna interfaccia desktop locale (X11/Wayland); tutta la gestione avviene tramite l'interfaccia Web su porta `80` servita da Nginx + Angular + Node.js.
- **Base solida Debian 13 (Trixie)**: stabilità, supporto hardware esteso, pacchetti aggiornati (`apt`) e piena compatibilità con Docker CE, Samba, NFS, ZFS e NetworkManager.
- **Installazione riproducibile da ISO Live/Installer**: avviabile da chiavetta USB per prova Live o installazione diretta su SSD (`nas-os-install` / Debian Installer).
- **Aggiornamenti atomici senza perdita dati**: l'aggiornamento integrato aggiorna SiloOs e i pacchetti Debian preservando `/DATA`, i container Docker e le configurazioni di rete/condivisione.

---

## Architettura

```text
├── backend/                  # API Server Node.js + TypeScript + WebSocket Terminal (porta 3000)
│   ├── src/routes/           # /api/auth, /api/hub, /api/stacks, /api/system, /api/storage, /api/shares, /api/files, /api/settings, /api/users, /api/ai
│   └── src/services/         # registry.ts, docker.ts, terminal.ts, events.ts
├── frontend/                 # Web UI Angular 19 + TailwindCSS + CodeMirror YAML + xterm.js
├── system/                   # Configurazioni OS (Nginx porta 80, systemd, script di sistema)
└── iso-builder/              # Pipeline live-build per ISO SiloOs avviabile da USB
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

La pipeline `iso-builder/build-iso.sh` compila frontend e backend, configura `live-build` per Debian 13 (`trixie`, `amd64`), integra Docker CE + Docker Compose v2, Nginx, Node.js 22, NetworkManager e il servizio backend di SiloOs.

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

## 3. Scrittura su Chiavetta USB e Installazione su SSD

1. Individua il dispositivo USB (es. `/dev/sdX`, **verifica con attenzione con `lsblk` per non sovrascrivere dischi di sistema**):
   ```bash
   lsblk
   ```
2. Scrivi la ISO sulla chiavetta USB con `dd` (oppure usa **Balena Etcher** o **Ventoy**):
   ```bash
   sudo dd if=siloos-x86_64-v<version>.iso of=/dev/sdX bs=4M status=progress oflag=sync
   ```
3. Avvia il server/PC target dalla chiavetta USB:
   - Seleziona **Live** per provare SiloOs in RAM (puoi poi installare su SSD con `sudo nas-os-install`).
   - Seleziona **Install** per avviare il Debian Installer e installare SiloOs permanentemente sull'SSD interno (con `preseed.cfg` preconfigurato).
4. Al riavvio, accedi alla Web UI da qualsiasi browser sulla rete locale all'indirizzo:
   ```text
   http://<IP-DEL-NAS>/
   ```

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
