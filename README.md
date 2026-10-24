# SOLAR CHESS

A browser-based almost fully vibecoded chess game with classic rules, variants, and original "Chess with Abilities" mode.

## Features

### Classic Rules 
- Standard chess with all FIDE rules
- Chess 960 (Fisher random chess) WIP

### Variants WIP
- King of the Hill
- Three-check
- Atomic
- Antichess
- Horde
- Racing Kings
- Crazyhouse
- Fog of War
- Mini 5×5 / 6×6
- Capablanca
- Big Board 12×12
- Custom position editor

### Chess with Abilities WIP
- Energy system
- 12+ abilities with cooldowns
- Draft or fixed ability sets

### Game Modes WIP
- Play against AI with different skill levels
- Local two-player mode
- Online multiplayer (optional)

### UI/UX
- Modern, responsive design
- Drag & drop or click-to-move
- Move history and navigation
- Local archive of the latest 100 completed games at `#/history`, with result filters and PGN copying
- Full game review from the archive without changing the current game
- Timers (bullet, blitz, rapid, etc.)
- Hints and position evaluation WIP
- Themes and customization WIP
- Accessibility features WIP

## Getting Started

### Prerequisites
- Node.js (v20+)
- npm or yarn or pnpm

### Installation
```bash
npm install
```

### Running the Development Server
```bash
npm run dev
```

### Building for Production
```bash
npm run build
```

### Running Tests
```bash
npm test
```

## Project Structure
See `docs/ARCHITECTURE.md` for detailed project structure.

The archive persists `GameRecord` entries through `src/storage/history.ts` under the
`solar_chess_game_history` localStorage key. `src/state/game-history.ts` tracks completed
games and adds review accuracy when available. The archive screen in `src/ui/history.ts`
opens `src/ui/history-review.ts`, which uses a separate `ChessStore` and restores the
live review shell on close. History stays on the current browser and device; deleting
browser storage also deletes the archive.

## Contributing
See `docs/CONTRIBUTING.md` for contribution guidelines.

## License
This project is licensed under the MIT License - see the `LICENSE` file for details.
Game analysis uses [Stockfish.js](https://github.com/nmrugg/stockfish.js) (Stockfish chess engine), which is distributed under the GNU General Public License v3 (GPLv3) — see [`node_modules/stockfish/Copying.txt`](node_modules/stockfish/Copying.txt) for the full license text.
