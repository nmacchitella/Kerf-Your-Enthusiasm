# Kerf-Your-Enthusiasm

A woodworking toolkit for planning projects, optimizing lumber cuts, and performing shop math. Minimize waste, maximize efficiency.

> **kerf** /kərf/ *noun* - the slit made by a saw or cutting tool

## Features

### Cut List Optimizer

The flagship feature - an intelligent lumber cutting optimizer that minimizes material waste.

- **Stock Management** - Define available lumber with presets (4×8 Plywood, Baltic Birch, etc.) or custom dimensions
- **Parts List** - Specify pieces you need with labels, dimensions, and quantities
- **Blade Kerf Settings** - Account for material loss from saw blade width (1/16" to 5/32")
- **Material Matching** - Optionally constrain cuts to specific stock materials
- **Visual Layout** - Real-time SVG visualization of optimized cut patterns
- **Multiple Algorithms** - Guillotine, Shelf Packing, and Branch & Bound optimization
- **Export Options** - PDF, CSV, and SVG export for the shop

### Woodworking Calculators

A suite of 8 specialized calculators:

| Calculator | Purpose |
|------------|---------|
| **Board Feet** | Calculate lumber volume and cost |
| **Fraction Math** | Add, subtract, multiply, divide fractions |
| **Golden Ratio** | Apply φ (1.618) for pleasing proportions |
| **Angle & Slope** | Right triangle solver for stairs, roofs, angled cuts |
| **Shelf Spacing** | Evenly distribute shelves in cabinets |
| **Taper Jig** | Calculate angles for tapered legs |
| **Fraction Reference** | Quick lookup table (1/16" through 1") |
| **Wood Movement** | Estimate seasonal expansion/contraction |

### Tool Inventory

Track your shop tools with condition ratings, brands, models, and notes. Includes a catalog of 60+ common woodworking tools for quick addition.

## Tech Stack

- **Next.js 16** - React framework
- **React 19** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS 4** - Styling
- **jsPDF** - PDF generation

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

## Project Structure

```
src/
├── app/
│   ├── cut-list/       # Cut optimization page
│   ├── calculators/    # Woodworking calculators
│   └── tools/          # Tool inventory
├── components/
│   ├── Navigation.tsx
│   └── ui/             # Reusable UI components
├── hooks/
│   └── useLocalStorage.ts
├── lib/
│   ├── constants.ts    # Presets and configurations
│   ├── cut-optimizer.ts # Optimization algorithms
│   └── fraction-utils.ts
└── types/
    └── index.ts
```

## How It Works

### Cut Optimization Algorithms

The app implements three bin-packing algorithms and automatically selects the best result:

1. **Guillotine** - Rectangular partitioning with usability scoring
2. **Shelf Packing** - Horizontal shelf organization
3. **Branch & Bound** - Exhaustive search with pruning (time-limited)

Each algorithm accounts for blade kerf, considers rotated orientations, and tracks waste percentage.

### Data Persistence

All data (stock, cuts, tools) is stored in browser localStorage. No account required, no data leaves your device.

## License

MIT
