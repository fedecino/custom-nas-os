# NAS-OS (Debian 13 Trixie)

Sistema operativo NAS leggero e headless basato su **Debian 13 (Trixie) amd64**, con interfaccia Web moderna su porta `80`, telemetria hardware, gestione stack Docker Compose e **Docker App Store dinamico** basato su Docker Hub + Registry API v2.

## Architettura

```text
├── backend/                  # API Server Node.js + TypeScript (porta 3000)
│   ├── src/routes/           # /api/hub, /api/stacks, /api/system
│   └── src/services/         # registry.ts (Docker Hub + Registry v2) & docker.ts
├── frontend/                 # Web UI Angular 19 + TailwindCSS + CodeMirror YAML
├── system/                   # Configurazioni OS (Nginx porta 80 + systemd)
└── iso-builder/              # Pipeline live-build per ISO avviabile da USB
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

Apri il browser su `http://localhost:4200`. Le richieste verso `/api/*` vengono inoltrate automaticamente al backend su `localhost:3000` tramite `proxy.conf.json`.

---

## 2. Compilazione della ISO Debian 13 (Trixie)

La pipeline `iso-builder/build-iso.sh` compila frontend e backend, configura `live-build` per Debian 13 (`trixie`, `amd64`, `--debian-installer live`), integra Docker CE + Docker Compose v2, Nginx, Node.js 22 e il servizio `nas-os.service`.

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
nas-os-debian13-amd64.iso
```

---

## 3. Scrittura su Chiavetta USB e Installazione su SSD

1. Individua il dispositivo USB (es. `/dev/sdX`, **verifica con attenzione con `lsblk` per non sovrascrivere dischi di sistema**):
   ```bash
   lsblk
   ```
2. Scrivi la ISO sulla chiavetta USB con `dd` (oppure usa **Balena Etcher** o **Ventoy**):
   ```bash
   sudo dd if=nas-os-debian13-amd64.iso of=/dev/sdX bs=4M status=progress oflag=sync
   ```
3. Avvia il server/PC target dalla chiavetta USB:
   - Seleziona **Live** per provare NAS-OS in RAM.
   - Seleziona **Install** per avviare il Debian Installer e installare NAS-OS permanentemente sull'SSD interno (con `preseed.cfg` preconfigurato).
4. Al riavvio, accedi alla Web UI da qualsiasi browser sulla rete locale all'indirizzo:
   ```text
   http://<IP-DEL-NAS>/
   ```
