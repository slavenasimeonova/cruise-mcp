import type { CruiseStore } from '../../../src/data/store.js';
import { TOOLS } from '../../../src/tools/index.js';
import { html, type SafeHtml } from '../html.js';
import type { View } from './view.js';

const REPO = 'https://github.com/slavenasimeonova/cruise-mcp';

interface Example {
  question: string;
  calls: { tool: string; args: Record<string, unknown> }[];
}

const EXAMPLES: Example[] = [
  {
    question: 'Which sailings leave in the next two weeks, and how full are they?',
    calls: [{ tool: 'list_sailings', args: { within_days: 14 } }],
  },
  {
    question: 'Run a pre-departure check on the Coral Vista sailing that leaves on 7 November. What must be fixed first?',
    calls: [
      { tool: 'list_sailings', args: { ship: 'Coral Vista' } },
      { tool: 'find_issues', args: { sailing_id: 'AH-CV-261107' } },
    ],
  },
  {
    question: "Which tours are sold out at Northern Pearl's Naples stop this week, and what's still unconfirmed there?",
    calls: [
      { tool: 'excursion_availability', args: { sailing_id: 'AH-NP-261104', port: 'Naples' } },
      { tool: 'find_unconfirmed_excursions', args: { sailing_id: 'AH-NP-261104', port: 'Naples' } },
    ],
  },
  {
    question: 'Look up booking BK-100054. What does this guest still need to sort out before sailing?',
    calls: [{ tool: 'get_booking', args: { booking_id: 'BK-100054' } }],
  },
];

/** Shortens long arrays so the JSON preview stays readable; the note says how many were cut. */
function preview(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    const keep = depth === 0 ? 4 : 3;
    const items = value.slice(0, keep).map((v) => preview(v, depth + 1));
    return value.length > keep ? [...items, `… ${value.length - keep} more`] : items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, preview(v, depth + 1)]));
  }
  return value;
}

function callBlock(store: CruiseStore, tool: string, args: Record<string, unknown>): SafeHtml {
  const def = TOOLS.find((t) => t.name === tool);
  if (!def) return html`<p class="muted">Unknown tool ${tool}</p>`;
  const output = def.run(store, def.inputSchema.parse(args)) as { summary: string };
  return html`<div class="call">
    <p class="call-sig"><span class="call-label">Tool call</span><code>${tool}(${JSON.stringify(args)})</code></p>
    <p class="call-summary"><span class="call-label">Server summary</span>${output.summary}</p>
    <details>
      <summary>Response JSON (structuredContent, shortened)</summary>
      <pre><code>${JSON.stringify(preview(output), null, 2)}</code></pre>
    </details>
  </div>`;
}

export function askView(store: CruiseStore): View {
  const body = html`
    <section class="page-head">
      <div>
        <p class="eyebrow">Ask Claude</p>
        <h1>The same data, in a conversation</h1>
        <p class="lede">This dashboard and Claude read the same data through the same code. In Claude Desktop, the
          <a href="${REPO}">cruise-mcp server</a> exposes six read-only tools over the
          <a href="https://modelcontextprotocol.io">Model Context Protocol</a>. Claude decides which tools to call,
          then answers in plain language from what they return.</p>
      </div>
    </section>

    <section class="card how">
      <h2>How it fits together</h2>
      <ol class="flow" aria-label="Data flow">
        <li><strong>Claude Desktop</strong><span>You ask a question</span></li>
        <li><strong>MCP over stdio</strong><span>Claude calls a tool, e.g. <code>find_issues</code></span></li>
        <li><strong>cruise-mcp server</strong><span>Runs the query, read-only</span></li>
        <li><strong>Seeded dataset</strong><span>data/cruise.json, fictional</span></li>
      </ol>
      <p class="muted small">This page runs those tool functions in your browser on a published copy of the dataset (passport
        numbers masked), so the responses below are exactly what the server returns to Claude. The questions are
        examples; Claude's wording varies, but the tool calls and data do not.</p>
    </section>

    ${EXAMPLES.map(
      (ex, i) => html`<section class="card example">
        <p class="eyebrow">Example ${i + 1}</p>
        <h2 class="question">“${ex.question}”</h2>
        ${ex.calls.map((c) => callBlock(store, c.tool, c.args))}
      </section>`,
    )}

    <section class="card">
      <h2>Try it yourself</h2>
      <p>Clone the repo, run <code>npm.cmd install</code> and <code>npm.cmd run build</code>, then add the server to
        <code>claude_desktop_config.json</code>. The <a href="${REPO}#readme">README</a> has the exact Windows config and
        how to explore the tools in MCP Inspector.</p>
    </section>`;

  return { title: 'Ask Claude', nav: 'ask', body };
}
