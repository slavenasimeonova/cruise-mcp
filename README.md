# Azure Horizon Cruises: Operations MCP Server

A **read-only [Model Context Protocol](https://modelcontextprotocol.io) server** that lets Claude answer questions
about the operations of a fictional cruise line: sailings, bookings, passengers, shore excursions and the
problems a guest-services team needs to find before departure.

> **All data is fictional.** Azure Horizon Cruises and its ships (*Coral Vista*, *Northern Pearl*, *Solenne*,
> *Sea Lyra*) do not exist. Guest names are randomly combined from first-name and surname lists. Only the
> port names (Barcelona, Cozumel, Santorini, …) are real.

Built with the official TypeScript MCP SDK **v2** (`@modelcontextprotocol/server` 2.4), stdio transport, Zod 4 schemas.

## What's inside

| | |
|---|---|
| **Fleet** | 4 ships, 90–130 cabins each in Inside / Oceanview / Balcony / Suite |
| **Schedule** | 24 seven-night sailings, Nov 2026 to Apr 2027: Western & Eastern Caribbean, Western Mediterranean, Greek Isles |
| **Guests** | ~4,900 passengers on ~2,400 bookings (confirmed, pending payment, cancelled, waitlisted), with Blue / Silver / Gold / Platinum loyalty tiers |
| **Excursions** | 324 excursions (3 per port of call) with capacity, prices, activity level, accessibility, ~5,600 excursion bookings (confirmed / requested / waitlisted) |
| **Planted problems** | missing passports, passports expiring < 6 months after return, overdue payments, excursions overbooked after an operator cut capacity, operator confirmations still outstanding days before the tour, wheelchair users booked on inaccessible tours, dietary / mobility / medical / celebration requests |

The dataset's "today" is fixed at **2026-11-01**. Every relative value (days to departure, overdue, urgent) is
computed from that date, not your clock, so answers never drift. The first departure (`AH-NP-261104`)
leaves 3 days later.

The data is produced by a **deterministic seed script** (`scripts/generate.ts`: seeded PRNG, no wall clock, no
locale APIs). `data/cruise.json` is committed, and a test confirms that regenerating it gives a byte-identical file.

## Tools

All tools are annotated `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.
There is no write path in the code. Each returns `structuredContent` (validated against an `outputSchema`) plus the same JSON as text, including a one-line `summary`.

| Tool | Arguments | Returns |
|---|---|---|
| `list_sailings` | `ship?` (name or code), `from_date?` (YYYY-MM-DD) | Sailings with itinerary, days to departure, guests booked and occupancy |
| `get_booking` | `booking_id` (`BK-100001`) | Status, cabin, guests (loyalty, passport status with masked number, special requests), payment, excursions, and attention flags |
| `find_unconfirmed_excursions` | `sailing_id`, `port?` | Excursion requests that are `requested` (awaiting the operator) or `waitlisted`, with urgency |
| `excursion_availability` | `sailing_id`, `port` | Per excursion at a port: capacity, confirmed / requested / waitlisted guests, seats left, overbooked flag |
| `passenger_summary` | `sailing_id` | Guests by booking status, occupancy, loyalty tiers, cabins, nationalities, documents, payments, every special request |
| `find_issues` | `sailing_id` | Severity-ranked issue list: overbooked excursions, missing / expiring passports, overdue & pending payments, unconfirmed excursions ≤ 30 days out, accessibility conflicts |

**Input handling:**
- IDs and dates are validated by schema (`AH-CV-261107`, `BK-100001`, real calendar dates).
- Ship and port names ignore case and accents. `roatan`, `Grand Cayman` and `rome` all work; `rome` resolves to `Civitavecchia (Rome)`.
- Errors come back as `isError` results that say what is valid. For example: *"Port "Atlantis" is not a port of call on sailing AH-NP-261104. Its ports of call are: Marseille, La Spezia, …"*

## Setup (Windows, PowerShell)

Requires **Node.js 20+** (tested on 22).

```powershell
git clone <this repo> C:\Users\<you>\projects\cruise-mcp
cd C:\Users\<you>\projects\cruise-mcp
npm.cmd install
npm.cmd run build      # compiles src/ to dist/
npm.cmd test           # offline test suite
```

Other scripts:

```powershell
npm.cmd run seed       # regenerate data/cruise.json (identical output every time)
npm.cmd run typecheck  # type-check src, scripts and tests
```

## Use it from Claude Desktop (Windows)

1. In Claude Desktop open **Settings → Developer → Edit Config**. This opens `claude_desktop_config.json`,
   normally at `%APPDATA%\Claude\claude_desktop_config.json`.
2. Add the server, using the **absolute path** to `dist\index.js` with **doubled backslashes**:

```json
{
  "mcpServers": {
    "azure-horizon-cruises": {
      "command": "node",
      "args": ["C:\\Users\\<you>\\projects\\cruise-mcp\\dist\\index.js"]
    }
  }
}
```

If the file already has an `mcpServers` block, add the `"azure-horizon-cruises"` entry inside it.

3. Fully quit Claude Desktop (tray icon → **Quit**, not just closing the window) and start it again.
   The six tools appear under the tools (🔨) menu in a new chat.

**Troubleshooting**
- *"spawn node ENOENT"*: Claude Desktop can't find Node on your PATH. Use the full path instead:
  `"command": "C:\\Program Files\\nodejs\\node.exe"`.
- *Server fails to start*: make sure you ran `npm.cmd run build`, so that `dist\index.js` exists. Logs are in
  `%APPDATA%\Claude\logs\mcp-server-azure-horizon-cruises.log`.
- The server logs only to stderr; stdout is reserved for the MCP protocol.

## Try it with MCP Inspector

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a browser UI for calling the tools by hand.
It runs through `npx`, so nothing is added to the project:

```powershell
npm.cmd run build
npx.cmd @modelcontextprotocol/inspector node dist/index.js
```

It prints a local URL (with an auth token) and opens your browser. Click **Connect**, open **Tools → List Tools**,
pick a tool, fill in the arguments (e.g. `sailing_id` = `AH-NP-261104`) and **Run Tool**. `npm.cmd run inspect`
is a shortcut for the same command.

## 5 questions to ask Claude

1. **"Which Azure Horizon sailings leave in the next two weeks, and how full are they?"**
   Calls `list_sailings`: four departures between Nov 4 and Nov 14, all 94–102% full (above 100% means
   third and fourth berths are in use).
2. **"Run a pre-departure check on the Coral Vista sailing that leaves November 7th. What must be fixed first?"**
   Calls `list_sailings`, then `find_issues` on `AH-CV-261107`: an excursion overbooked after an operator capacity cut,
   missing passports, overdue balances and tours still awaiting operator confirmation.
3. **"Is anything still unconfirmed for the Northern Pearl's stop in Naples this week? Which tours there are sold out, and who's waitlisted?"**
   Calls `find_unconfirmed_excursions` and `excursion_availability` on `AH-NP-261104` with port `Naples`:
   the Amalfi Coast Drive is sold out with a waitlist, and Capri requests are still awaiting the operator.
4. **"Give me the passenger summary for AH-SO-261110: confirmed vs pending, loyalty mix, and every dietary and mobility request the galley and guest services need."**
   Calls `passenger_summary`.
5. **"Look up booking BK-100226. What does this guest still need to do before sailing?"**
   Calls `get_booking`: a missing passport for one guest, a coeliac dietary request, one tour awaiting confirmation and two waitlisted.

## Project layout

```
src/
  index.ts                 stdio entry (serveStdio, serves 2025- and 2026-era MCP clients)
  server.ts                createServer(store): registers the six tools
  data/types.ts            dataset types
  data/store.ts            loads data/cruise.json once, builds lookup indexes (read-only)
  lib/domain.ts            business rules: active bookings, passport validity, port/ship name matching
  lib/dates.ts             UTC calendar-date helpers
  tools/*.ts               one file per tool: input/output Zod schemas + pure run() query
scripts/
  generate.ts              deterministic dataset generator (seeded PRNG)
  seed.ts                  writes data/cruise.json
tests/
  seed.test.ts             determinism, committed-file match, referential integrity, planted problems
  tools.test.ts            each tool's query logic against the seeded data
  mcp.test.ts              real MCP client over in-memory transport + a stdio child-process test
```

## Testing

`npm.cmd test` runs fully offline (Vitest):
- Each tool's query logic is checked against the seeded data: happy paths, filters, aliases and error messages.
- Every tool is also called through a real MCP `Client` over `InMemoryTransport`. These calls cover listed tools
  and annotations, `structuredContent` matching its output schema, schema validation errors and lookup errors.
- One end-to-end test starts the server as a child process over stdio, the same way Claude Desktop does.
- The data tests check that the seed is deterministic and that `data/cruise.json` is up to date.
