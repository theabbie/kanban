const BITNET = "https://demo-bitnet-h0h8hcfqeqhrf5gf.canadacentral-01.azurewebsites.net";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

async function callBitNet(messages) {
  const upstream = await fetch(`${BITNET}/completion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, userId: "worker_" + Date.now(), chatId: "chat_" + Date.now(), device: "cpu" }),
  });
  const raw = await upstream.text();
  let text = "", tokens = 0, speed = 0, totalTime = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;
    let d; try { d = JSON.parse(trimmed.slice(6)); } catch { continue; }
    if (d.finished && d.content === "[DONE]") {
      tokens = d.generated_tokens || 0;
      speed = d.speed || 0;
      totalTime = d.total_time || 0;
    } else if (d.content && !d.finished) {
      text += d.content;
    }
  }
  return { text, tokens, speed, totalTime };
}

function wrapAnswer(answer, thought = "done") {
  const safeA = answer.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "");
  const safeT = thought.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "");
  return `{"thought":"${safeT}","finalAnswer":"${safeA}"}`;
}

function wrapQuestion(question, thought = "I need to clarify before answering.") {
  const safeQ = question.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "");
  const safeT = thought.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "");
  return `{"thought":"${safeT}","action":"self_question","actionInput":{"query":"${safeQ}"}}`;
}

async function handleKaibanCall(messages, systemMsg) {
  const sys = systemMsg.content;
  const nameMatch = sys.match(/You are (.+?)\./);
  const roleMatch = sys.match(/Your role is:\s*(.+)/);
  const goalMatch = sys.match(/Your main goal is:\s*(.+)/);
  const bgMatch   = sys.match(/Your background is:\s*(.+)/);

  const name = nameMatch?.[1] || "Agent";
  const role = roleMatch?.[1] || name;
  const goal = goalMatch?.[1] || `Complete the ${role} work`;
  const bg   = bgMatch?.[1]   || `Experienced ${role}`;
  const identity = `You are ${name}, a ${role}. Background: ${bg}. Your goal: ${goal}.`;

  const history = messages.filter(m => m.role !== "system");
  const userTurns = history.filter(m => m.role === "user").length;
  const lastUserMsg = history.at(-1)?.content || "";
  const hasObservation = lastUserMsg.includes("Observation:") || userTurns > 1;

  if (!hasObservation) {
    const decisionRes = await callBitNet([
      { role: "system", content: `${identity} You have a web_search tool available. For the given task, reply with exactly one word: SEARCH (if you need to look up current information), QUESTION (if you need clarification), or ANSWER (if you can respond from knowledge).` },
      ...history,
    ]);
    const decision = decisionRes.text.trim().toUpperCase();

    if (decision.includes("SEARCH")) {
      const qRes = await callBitNet([
        { role: "system", content: `${identity} Write a specific web search query to find information needed for the task. Write only the search query, nothing else.` },
        ...history,
      ]);
      const safe = qRes.text.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
      return `{"thought":"I need to search for current information.","action":"web_search","actionInput":{"query":"${safe}"}}`;
    }

    if (decision.includes("QUESTION")) {
      const qRes = await callBitNet([
        { role: "system", content: `${identity} Ask one specific clarifying question. Write only the question, nothing else.` },
        ...history,
      ]);
      return wrapQuestion(qRes.text.trim());
    }
  }

  const res = await callBitNet([
    { role: "system", content: `${identity} Using all context from the conversation, write a thorough response fulfilling your specific role as ${role}. Write only your answer, no JSON, no preamble.` },
    ...history,
  ]);
  return wrapAnswer(res.text.trim(), "Gathered context and prepared complete response.");
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if ((url.pathname === "/completion" || url.pathname === "/v1/chat/completions") && (request.method === "POST" || request.method === "GET")) {
      if (request.method === "GET") {
        return new Response(JSON.stringify({ object: "list", data: [] }), {
          status: 200, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      let body;
      try { body = await request.json(); } catch (e) {
        return new Response(JSON.stringify({ error: "bad json: " + e.message }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const messages = body.messages || [];
      const systemMsg = messages.find(m => m.role === "system");
      const isKaiban = systemMsg?.content?.includes("finalAnswer");

      let text, tokens = 0, speed = 0, totalTime = 0;

      if (isKaiban) {
        text = await handleKaibanCall(messages, systemMsg);
      } else {
        const result = await callBitNet(messages);
        text = result.text;
        tokens = result.tokens;
        speed = result.speed;
        totalTime = result.totalTime;
      }

      return new Response(JSON.stringify({
        id: "bitnet-" + Date.now(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "bitnet",
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: tokens, total_tokens: tokens },
        _meta: { speed, totalTime },
      }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/search" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch {
        return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
      }

      const upstream = await fetch("https://demo.exa.ai/chatbot-demo/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: body.query || body.message || "",
          history: body.history || [],
          exaEnabled: true,
          model: "google/gemini-2.5-flash",
          searchType: body.searchType || "instant",
        }),
      });

      const raw = await upstream.text();
      let sources = [], content = "";

      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (t.startsWith("data:")) {
          try {
            const d = JSON.parse(t.slice(5).trim());
            if (d.searches) sources = d.searches.flatMap(s => s.sources || []);
            if (d.content) content += d.content;
          } catch {}
        }
      }

      return new Response(JSON.stringify({ sources, content }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response("not found", { status: 404, headers: CORS });
  },
};
