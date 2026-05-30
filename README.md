# AI Kanban

Multi-agent AI workflow board powered by [KaibanJS](https://kaibanjs.com) and [BitNet](https://github.com/microsoft/BitNet).

## What it does

Describe any task in plain English. AI Kanban automatically:

1. **Plans** a team of specialized agents suited to the goal (2–6 agents)
2. **Runs** each agent sequentially with real back-and-forth reasoning — each agent asks a clarifying question before producing its output
3. **Passes context** between agents so each one builds on the previous agent's work
4. **Visualizes** everything in real time on a Kanban board (Todo → Doing → Done)

## How it works

- **Frontend** — single HTML file, no build step, no dependencies to install
- **KaibanJS** — provides the Agent/Task/Team orchestration and ReAct reasoning loop
- **BitNet** — 1-bit LLM running on CPU, handles all inference (planning + agent reasoning)
- **Cloudflare Worker** — proxies requests to BitNet with CORS headers and adapts responses to OpenAI format so KaibanJS can consume them

## Stack

| Layer | Technology |
|---|---|
| Agent framework | KaibanJS |
| LLM | BitNet (CPU inference) |
| Proxy | Cloudflare Workers |
| Frontend | Vanilla HTML/JS |

## Usage

Open `index.html` in a browser (or serve from any static host). No API keys required — BitNet is free and open.

## Worker

The Cloudflare Worker source is in `worker/index.js`. It handles:
- CORS for browser requests
- SSE → JSON translation (BitNet streams SSE, KaibanJS expects OpenAI JSON)
- Skeleton extraction — strips KaibanJS's ReAct prompt scaffolding and replaces with targeted calls so BitNet produces clean structured output
