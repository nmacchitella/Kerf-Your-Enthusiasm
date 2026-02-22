# Kerf Your Enthusiasm

> **kerf** /kərf/ *noun* — the slit made by a saw or cutting tool.

Yes, it's a pun. No, I'm not sorry.

I like to build things — apps, but also actual things. Furniture, shelves, the occasional cutting board nobody asked for. Kerf Your Enthusiasm is a woodworking toolkit that helps with the annoying math that *should* be easy for someone with an MSc in Applied Math, but gets surprisingly complicated when you grow up metric and suddenly have to deal with imperial fractions. Also, when you're moving lumber around and covered in sawdust, you start doubting your own brain. This app is that second opinion.

## What It Does

**Cut List Optimizer** — the main thing. You tell it what lumber you have and what pieces you need, and it figures out how to cut everything with the least waste. It accounts for blade kerf (the material the saw eats), tries multiple algorithms (guillotine packing, shelf packing, branch & bound), and picks the best layout. You get a visual SVG of where every cut goes, and you can export to PDF, CSV, or SVG to bring to the shop.

**Calculators** — a suite of 8 little tools for shop math: board feet, fraction arithmetic, golden ratio, angles & slopes, shelf spacing, taper jig angles, a fraction reference chart, and wood movement estimation. Nothing fancy, but exactly the kind of thing you need mid-project when your brain stops cooperating.

**Tool Inventory** — keep track of your shop tools, their condition, brand, model, and notes. There's a catalog of 60+ common tools so you can add them quickly instead of typing everything out.

You can use everything without an account — data stays in your browser. If you sign in with Google, you can save projects to the cloud and access them from anywhere.

## Running It Yourself

You'll need Node.js installed. Then:

```bash
git clone https://github.com/nmacchitella/Kerf-Your-Enthusiasm.git
cd Kerf-Your-Enthusiasm/kerfuffle
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). That's it for the basics — the cut optimizer and all calculators work right away with browser storage.

### If You Want Accounts & Cloud Storage

Create a `.env.local` file (there's a `.env.local.example` to copy from):

```
# Database — uses SQLite locally, or Turso in production
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-auth-token

# Auth
BETTER_AUTH_SECRET=generate-a-random-32-character-string
BETTER_AUTH_URL=http://localhost:3000

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

For local development, SQLite runs out of the box — the database lives in `./data/app.db`. For Google OAuth, you'll need to set up credentials in the [Google Cloud Console](https://console.cloud.google.com/). If you don't care about sign-in, skip all of this — the app works fine without it.

### Docker

There's a Dockerfile if that's more your style:

```bash
docker build -t kerfuffle .
docker run -p 3000:3000 kerfuffle
```

## Tech Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Drizzle ORM with SQLite/Turso, Better-Auth for authentication, jsPDF for exports.

## License

MIT — do whatever you want with it.
