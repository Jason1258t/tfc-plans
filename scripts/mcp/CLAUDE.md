# scripts/mcp/ — pack MCP server

Full reference (tools, data sources, limits, code layout, "Adding a tool") — [docs/mcp.md](../../docs/mcp.md).

- Tools of a section — `tools/<section>.mjs` (`export const TOOLS`), shared helpers — `fmt.mjs`, server instructions —
  `INSTRUCTIONS` in `tools.mjs`.
- Tool and parameter descriptions are in English (agent-facing, fewer tokens); tool output is in Russian (the user
  reads it in transcripts).
- After editing code here the server must be restarted (`/mcp` in terminal Claude Code or a new session); data in
  `public/` is re-read automatically.
- Data merging repeats the site (`src/lib/items.ts`, `recipes.ts`, `tags.ts`, `reference.ts`, `meals.ts`): changed the
  merge on the site — change `data.mjs` too.
- Verify with a scratchpad node script that drives `server.mjs` over stdio and compares with direct file/jar/Firestore
  reads; then `npx oxlint scripts/mcp` and prettier on your files. Document a new tool in docs/mcp.md (and in
  `INSTRUCTIONS` if it changes the agent's usual path).
