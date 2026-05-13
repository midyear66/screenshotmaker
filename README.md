# ScreenshotMaker

Self-hosted web app for generating App Store Connect–ready screenshots from a reusable template.

Build a template once (background, headline copy, device frame, text positions, colors). For each app release, drop in new screenshots → download a ZIP organized by device size, ready to upload to App Store Connect.

---

## What it does

1. **Templates** define the visual recipe for an app's screenshot set:
   - Configurable number of slots (one per screenshot in the final set; up to 10)
   - Per-slot headline + subheadline copy
   - Background color (template-wide default + optional per-slot override)
   - Device tilt / scale / position
   - Headline/subhead font sizes, colors, positions
   - All coordinates are normalized 0–1 so layouts scale to multiple device sizes at export

2. **Projects** apply a template to a set of screenshots:
   - Drag-and-drop multi-file upload (auto-maps to slots in upload order)
   - Replace, remove, reorder per slot
   - Live preview of how each slot will look

3. **Export** renders every (slot × device-size) combination at native App Store pixel dimensions and bundles them into a ZIP:
   ```
   <ProjectName>/
     iPhone-6.7/   01.png 02.png 03.png ...
     iPhone-6.5/   01.png 02.png 03.png ...
     iPad-13/      01.png 02.png 03.png ...
   ```
   Each PNG is dimension-verified before being added to the zip.

---

## Stack

- **Next.js 16** (App Router, TypeScript) + **Tailwind 4**
- **React Konva** for the canvas editor; vanilla **Konva** for off-DOM export rendering
- **Prisma 6** + **SQLite** for persistence
- **JSZip** for client-side ZIP bundling
- **Docker + docker-compose** for self-hosted deploy

---

## Architecture

```
screenshotmaker/
├── app/
│   ├── page.tsx                            # Project + template list
│   ├── templates/[id]/page.tsx             # Template editor host
│   ├── projects/[id]/page.tsx              # Project editor host
│   └── api/
│       ├── templates/                      # GET, POST, PATCH, DELETE
│       ├── templates/[id]/slots/           # POST to add a slot
│       ├── slots/[id]/                     # PATCH (copy/config), DELETE
│       ├── projects/                       # GET, POST, PATCH, DELETE
│       ├── projects/[id]/screens/          # POST multipart (bulk or single-slot replace)
│       ├── screens/[id]/                   # DELETE
│       ├── screens/[id]/move/              # POST { direction: "up" | "down" }
│       └── uploads/[...path]/              # GET file (path-traversal protected)
├── components/
│   ├── NewTemplateButton / NewProjectButton / DeleteButton
│   ├── editor/
│   │   ├── TemplateEditor.tsx              # client editor shell, slot nav, autosave
│   │   ├── EditorCanvas.tsx                # react-konva Stage (dynamic, ssr:false)
│   │   ├── DeviceFrame.tsx                 # stylized iPhone bezel, optional screenshot
│   │   └── useImage.ts
│   └── project/
│       ├── ProjectEditor.tsx               # drop zone, slot grid
│       └── ExportButton.tsx                # renders all (slot × device) → ZIP
├── lib/
│   ├── db.ts                               # Prisma client singleton
│   ├── editor-types.ts                     # SlotConfig / TemplateConfig + defaults
│   ├── uploads.ts                          # safe upload-dir helpers
│   └── render.ts                           # vanilla-Konva off-DOM PNG renderer
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── data/                                   # mounted volume — SQLite + uploads/
├── Dockerfile + docker-compose.yml
├── docker-entrypoint.sh                    # runs `prisma migrate deploy` then `node server.js`
└── next.config.ts                          # output: "standalone"
```

---

## Data model (Prisma / SQLite)

```prisma
model Template {
  id        String   @id
  name      String
  slotCount Int
  config    String   // JSON: { backgroundColor, fontFamily }
  slots     Slot[]
  projects  Project[]
}

model Slot {
  id         String
  templateId String
  order      Int               // 1-based, unique per template
  headline   String
  subhead    String?
  config     String            // JSON: SlotConfig
}

model Project {
  id         String
  name       String
  templateId String
  screens    Screen[]
}

model Screen {
  id             String
  projectId      String
  slotOrder      Int            // 1-based, unique per project
  screenshotPath String         // relative to UPLOAD_DIR
}
```

`SlotConfig` (in `lib/editor-types.ts`):

```ts
{
  headlinePos: { x: 0..1, y: 0..1 };    // normalized over 1290×2796
  headlineSize: number;                  // px in base 1290-wide space
  headlineColor: string;
  subheadPos: { x: 0..1, y: 0..1 };
  subheadSize: number;
  subheadColor: string;
  devicePos: { x: 0..1, y: 0..1 };       // center of device
  deviceScale: number;                   // multiplier on bezel size
  deviceRotation: number;                // degrees
  backgroundColor?: string;              // overrides template default
}
```

---

## Development

```bash
# install
npm install

# first-time database setup
npx prisma migrate dev

# dev server (HMR)
npm run dev
# → http://localhost:3000

# type-check + production build
npm run build
```

The local `.env` points the database at `./data/screenshotmaker.db` and uploads at `./data/uploads/`. Both directories are created automatically.

### Useful Prisma commands

```bash
npx prisma studio        # browse the DB at localhost:5555
npx prisma migrate dev --name <change_name>
```

---

## Deployment (Docker)

```bash
docker compose up -d --build
# → http://localhost:3000
# Data persists in ./data/ on the host (mounted at /data inside the container)
```

The container runs `prisma migrate deploy` on startup, then `node server.js` from the Next.js standalone build.

### Volume layout

```
./data/
├── screenshotmaker.db        # SQLite (back this up to back up everything)
├── screenshotmaker.db-journal
└── uploads/
    └── <projectId>/
        └── <screenId>.png
```

To back up: stop the container, copy `./data/`. To wipe: delete the directory and restart.

### Migrating to another host

Everything stateful lives in `./data/` (the SQLite file + every uploaded screenshot). The Docker image is fully rebuildable from the source tree. So a move is two copies:

```bash
# --- on the old host ---
docker compose down                    # quiesce writes
tar czf screenshotmaker-backup.tgz \
    --exclude='node_modules' \
    --exclude='.next' \
    .                                  # source + data + migrations
scp screenshotmaker-backup.tgz user@newhost:/srv/

# --- on the new host ---
cd /srv && tar xzf screenshotmaker-backup.tgz -C screenshotmaker
cd screenshotmaker
docker compose up -d --build
```

Minimal alternative if the source is already on the new host (e.g. via git):

```bash
# old host
docker compose down
rsync -avz ./data/ user@newhost:/srv/screenshotmaker/data/

# new host
cd /srv/screenshotmaker
docker compose up -d --build           # entrypoint runs `prisma migrate deploy`
```

The entrypoint applies any pending Prisma migrations against the copied SQLite file on first boot, so going from an older to a newer schema across hosts is automatic — no manual migration step needed.

Sanity checks after move:
- Visit `http://<newhost>:3000` and confirm your templates/projects appear.
- Open any project and verify the screenshot previews load (proves `/api/uploads/` is reading from the migrated `data/uploads/`).
- Export a ZIP and spot-check one PNG opens at the expected dimensions.

### Environment variables

| Variable | Default (dev) | Default (container) | Purpose |
|---|---|---|---|
| `DATABASE_URL` | `file:../data/screenshotmaker.db` | `file:/data/screenshotmaker.db` | Prisma SQLite location |
| `UPLOAD_DIR` | `./data/uploads` | `/data/uploads` | Where uploaded screenshots are written |
| `PORT` | — | `3000` | HTTP port |

---

## End-to-end workflow

1. **Create a template:** name + slot count → opens the editor
2. **In the editor:** edit headline/subhead for each slot, drag text/device on the canvas, set background color, tilt, scale. Changes autosave every 600ms.
3. **Create a project** using that template.
4. **Drop screenshots** into the drop zone. They fill empty slots in upload order.
5. **Tweak:** replace one screenshot, reorder with ↑/↓, remove with ✕.
6. **Export ZIP** — disabled until every slot has a screenshot. Click → renders all `(slot × device-size)` combinations, packs into ZIP, downloads.

---

## Known limits / v1 trade-offs

- **iPad layout is naive.** Normalized coords are referenced to the iPhone 6.7 aspect (≈0.46). The iPad 13" canvas (≈0.75) renders the same layout, leaving large empty bands. Either tweak each slot's device/text positions with iPad in mind, or skip iPad for now.
- **Stylized device frame**, not real Apple bezel PNGs. Looks reasonable but isn't pixel-accurate. To swap in real frames, drop Apple Design Resources PNGs into `public/frames/` and replace the `Konva.Rect` bezel calls in `components/editor/DeviceFrame.tsx` + `lib/render.ts` with `Konva.Image`.
- **Geist font** is whatever the browser provides at canvas render time. The Next.js Geist webfont isn't injected into the Konva canvas; for exact font rendering, add `@font-face` to a global stylesheet and `await document.fonts.ready` before exporting.
- **No undo/redo** in the editor — changes are autosaved live.
- **No auth.** Anyone with network access to the port can use the app. Intended for LAN / Tailscale. Add basic auth middleware if exposing publicly.
- **No 3D perspective tilt** — the editor uses 2D rotation only. The classic "tilted hero device" look is achievable, but not the perspective-foreshortened look from real App Store screenshots.

---

## Build history

Built in four focused sittings, each ending at a working state:

1. **Skeleton** — Next.js + Prisma + SQLite scaffold, project/template list pages, CRUD API, Docker.
2. **Template editor** — Konva canvas, slot navigation (← Slot N of M →, add/remove), background/font/tilt/scale controls, debounced autosave.
3. **Project flow** — drag-and-drop multi-file upload, slot grid with real screenshot previews, replace/remove/reorder.
4. **Export** — vanilla-Konva off-DOM rendering at native device pixel sizes, multi-size ZIP packaging via JSZip, progress indicator.

---

## License

Personal project. No license declared.
