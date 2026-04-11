# Kerf Your Enthusiasm

> **kerf** /kərf/ *noun* — the slit made by a saw or cutting tool.

Yes, it's a pun. No, I'm not sorry.

I like to build things — apps, but also actual things. Furniture, shelves, the occasional cutting board nobody asked for. Kerf Your Enthusiasm is a woodworking toolkit that helps with the annoying math that *should* be easy for someone with an MSc in Applied Math, but gets surprisingly complicated when you grow up metric and suddenly have to deal with imperial fractions. Also, when you're moving lumber around and covered in sawdust, you start doubting your own brain. This app is that second opinion.

---

## What It Does

### Cut List Optimizer
The main thing. Tell it what sheets you have and what pieces you need — it figures out how to cut everything with the least waste.

- Tries multiple algorithms (guillotine packing, shelf packing, branch & bound) and picks the best layout
- Accounts for blade kerf and sheet padding
- Material matching: constrain parts to specific stock materials (Plywood, MDF, Baltic Birch, etc.)
- Thickness matching: parts snap to stock of the right thickness, or leave it as "any"
- Groups: bundle related parts together with a quantity multiplier (e.g. "make 4 of this cabinet carcass")
- Visual SVG layout showing every cut placement, with colour-coded parts and optional labels
- Export to PDF, CSV, or SVG to bring to the shop

### STEP File Import
For when your project started in CAD. Upload a `.step` file, pick which faces you want to cut from which bodies, and they land in your cut list as properly dimensioned parts with DXF outlines ready for a CNC router or VCarve Pro.

### Calculators
Eight shop-math tools for mid-project moments:

| Calculator | What it does |
|---|---|
| Board Feet | Volume → price estimator |
| Fraction Arithmetic | Add/subtract/multiply imperial fractions |
| Golden Ratio | Find the harmonious dimension given one side |
| Angles & Slopes | Rise/run/angle conversion |
| Shelf Spacing | Optimal shelf spacing for a given height and item count |
| Taper Jig | Calculate taper jig offset angle |
| Fraction Reference | Quick decimal ↔ fraction chart |
| Wood Movement | Seasonal expansion/contraction estimate by species |

### Tool Inventory
Keep track of your shop tools — condition, brand, model, notes. Pre-populated catalog of 60+ common tools so you're not typing everything from scratch.

---

## Running It Yourself

You'll need Node.js 20+. Then:

```bash
git clone https://github.com/nmacchitella/Kerf-Your-Enthusiasm.git
cd "Kerf-Your-Enthusiasm/kerfuffle"
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The cut optimizer and all calculators work immediately with local browser storage — no account needed.

### If You Want Accounts & Cloud Projects

Copy the example env file and fill it in:

```bash
cp .env.local.example .env.local
```

```env
BETTER_AUTH_SECRET=generate-a-random-32-character-string
BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

The SQLite database lives at `./data/app.db` and is created automatically on first run. For Google OAuth, set up credentials in the [Google Cloud Console](https://console.cloud.google.com/) with `http://localhost:3000/api/auth/callback/google` as the redirect URI.

If you don't care about sign-in, skip all of this.

### With the STEP/CNC Backend

The STEP-to-DXF workflow requires the Python backend (FastAPI + CadQuery + OpenCASCADE). You'll need Python 3.11+:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Then run both together:

```bash
npm run dev:all
```

Or separately:

```bash
npm run dev          # Next.js on :3000
npm run dev:backend  # FastAPI on :8000
```

---

## Docker

The easiest way to run the full stack (Next.js + Python backend + persistent database):

```bash
cp .env.local.example .env
# fill in BETTER_AUTH_SECRET and, optionally, Google OAuth credentials

docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). The SQLite database persists in a Docker volume so it survives container restarts.

To run only the Next.js app without the STEP backend:

```bash
docker build -t kerfuffle .
docker run -p 3000:3000 \
  -e BETTER_AUTH_SECRET=your-secret \
  -v kerfuffle-data:/data \
  kerfuffle
```

> **Note:** the Python backend image is large (~1 GB) because CadQuery requires OpenCASCADE native binaries. If you don't need STEP file import, you can omit the `backend` service and the image stays small.

---

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS 4
- **Database:** SQLite via Drizzle ORM (local) 
- **Auth:** Better-Auth with Google OAuth
- **STEP/CAD:** FastAPI, CadQuery, ezdxf (Python)
- **Exports:** jsPDF, JSZip

---

## License

MIT — do whatever you want with it.
