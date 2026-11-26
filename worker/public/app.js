// 画面の動き。API の JSON はすべて esc() を通してから HTML にする（CSP でインラインの script・style は禁止：_headers）。
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const EXAMPLES = ["マイナンバーカードの暗証番号を忘れた", "児童手当はいつ振り込まれる？", "高齢の親の運転が心配", "NISAはどうやって始める？"];
$("#chips").innerHTML = EXAMPLES.map((e) => `<button type="button" class="chip">${esc(e)}</button>`).join("");
$("#f").addEventListener("submit", (ev) => { ev.preventDefault(); run(); });
$("#q").addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); run(); } });
$("#q").addEventListener("input", (ev) => { const t = ev.target; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; });
$("#log").addEventListener("click", (ev) => {
  const t = ev.target;
  if (t.classList.contains("chip")) { $("#q").value = t.textContent; run(); }
  else if (t.dataset?.q) { $("#q").value = t.dataset.q.replace(/\s+/g, " "); run(); }
});

function source(f) {
  const links = (f.links || []).filter((l) => /^https?:\/\//.test(l.url));
  return `<div class="src">引用元：<b>${esc(f.question)}</b>（${esc(f.area)}・${esc(f.as_of)} 時点）
    ${links.length ? `<ul class="links">${links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || l.url)}</a></li>`).join("")}</ul>` : ""}
    <details><summary>FAQ の回答を全部見る</summary><div class="full">${esc(f.answer)}</div></details></div>`;
}
function related(cands) {
  if (!cands?.length) return "";
  return `<p class="muted rel-head">近いかもしれない FAQ：</p><ul class="rel">${cands.map((c) => `<li><button type="button" data-q="${esc(c.question)}">${esc(c.question)}</button></li>`).join("")}</ul>`;
}
function bubble(cls, html) {
  $("#empty")?.remove();
  const el = document.createElement("div");
  el.className = `msg ${cls}`;
  el.innerHTML = html;
  let node = el;
  if (cls === "bot") {
    // キャラクターが吹き出しで話す
    node = document.createElement("div");
    node.className = "row bot";
    node.innerHTML = `<img class="avatar" src="/chara-96.webp" alt="">`;
    node.append(el);
  }
  $("#log").append(node);
  node.scrollIntoView({ behavior: "smooth", block: "end" });
  return el;
}
function render(r, d) {
  if (!r.ok) return `<p>${esc(d.error || "うまくいきませんでした。")}</p>`;
  if (d.mode === "answer")
    return `<p class="summary">${esc(d.summary)}</p>` + (d.quotes || []).map((x) => `<blockquote>${esc(x)}</blockquote>`).join("") + source(d.faq);
  if (d.mode === "faq_only" && d.faq)
    return `<span class="tag warn">FAQ の原文をそのまま表示</span><blockquote>${esc(d.faq.answer)}</blockquote>` + source(d.faq);
  if (d.mode === "search_only" || d.mode === "faq_only")
    return `<span class="tag warn">いまは検索だけ</span>` + (d.candidates || []).slice(0, 3).map((c) => `<blockquote><b>${esc(c.question)}</b>
${esc(c.answer)}</blockquote>`).join("");
  if (d.mode === "unavailable") return `<p>いまは利用上限に達しています。時間をおいてお試しください。</p>`;
  return `<p>この質問に答えている FAQ は見つかりませんでした。お住まいの市区町村や担当の窓口にお問い合わせください。</p>` + related(d.candidates);
}

async function run() {
  const q = $("#q").value.trim();
  if (!q || $("#go").disabled) return;
  $("#go").disabled = true;
  $("#q").value = ""; $("#q").style.height = "auto";
  bubble("user", esc(q));
  const bot = bubble("bot", `<span class="typing" aria-label="入力中"><i></i><i></i><i></i></span>`);
  try {
    const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q }) });
    bot.innerHTML = render(r, await r.json());
  } catch (e) {
    bot.innerHTML = `<p>通信がうまくいきませんでした。もう一度お試しください。</p>`;
  } finally {
    $("#go").disabled = false;
    bot.scrollIntoView({ behavior: "smooth", block: "start" });
    $("#q").focus();
  }
}
