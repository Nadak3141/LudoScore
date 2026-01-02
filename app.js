/* ScorePad - SPA minimaliste pour GitHub Pages
   - Configs JSON (site.config.json + games.config.json)
   - Historique localStorage avec TTL 24h (sauf épinglées)
   - Partie: manches dynamiques, valider manche, annuler dernière, fin, dupliquer
   - Export PDF multi-parties avec option "inclure détail des manches"
   - PWA installable (manifest + service worker)
*/

const LS_KEY = "scorepad.sessions.v1";
const LS_KEY_ACTIVE = "scorepad.activeSessionId.v1";

let SITE = null;
let GAMES = [];
let GAME_MAP = new Map();

let currentGame = null;
let activeSession = null;

// ---------- Utils ----------
const $ = (sel) => document.querySelector(sel);

function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function nowISO() { return new Date().toISOString(); }

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function clamp(n, a, b){ return Math.min(b, Math.max(a, n)); }

function setAccent(hex) {
  document.documentElement.style.setProperty("--accent", hex || SITE?.ui?.defaultAccent || "#6ee7ff");
}

function safeInt(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// ---------- Storage ----------
function loadSessionsRaw() {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (!s) return [];
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveSessionsRaw(arr) {
  localStorage.setItem(LS_KEY, JSON.stringify(arr));
}

function cleanupSessionsTTL() {
  const ttlHours = SITE?.storage?.ttlHours ?? 24;
  const ttlMs = ttlHours * 3600 * 1000;
  const now = Date.now();

  const sessions = loadSessionsRaw();
  const kept = sessions.filter(s => {
    if (s?.pinned) return true;
    const last = Date.parse(s?.updatedAt || s?.startedAt || nowISO());
    return (now - last) <= ttlMs;
  });

  if (kept.length !== sessions.length) saveSessionsRaw(kept);
}

function getSessionById(id) {
  return loadSessionsRaw().find(s => s.id === id) || null;
}

function upsertSession(session) {
  const all = loadSessionsRaw();
  const idx = all.findIndex(s => s.id === session.id);
  const copy = { ...session, updatedAt: nowISO() };
  if (idx >= 0) all[idx] = copy;
  else all.unshift(copy);
  saveSessionsRaw(all);
  return copy;
}

function deleteSession(id) {
  const all = loadSessionsRaw().filter(s => s.id !== id);
  saveSessionsRaw(all);
}

// ---------- Routing ----------
function showView(name) {
  ["Home","Game","History"].forEach(v => {
    const el = $("#view" + v);
    el.classList.toggle("view--active", v.toLowerCase() === name);
  });
}

function route() {
  cleanupSessionsTTL();

  const hash = location.hash || "#/";
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);

  if (parts.length === 0) {
    showHome();
    return;
  }

  if (parts[0] === "game" && parts[1]) {
    showGame(parts[1]);
    return;
  }

  if (parts[0] === "history") {
    showHistory();
    return;
  }

  showHome();
}

// ---------- Init ----------
async function init() {
  SITE = await fetch("site.config.json").then(r => r.json());
  const gamesCfg = await fetch("games.config.json").then(r => r.json());
  GAMES = gamesCfg.games || [];
  GAME_MAP = new Map(GAMES.map(g => [g.id, g]));

  $("#siteName").textContent = SITE.siteName || "ScorePad";
  $("#siteTagline").textContent = SITE.tagline || "";
  $("#footerText").textContent = SITE.footerText || "";

  document.title = SITE.siteName || "ScorePad";

  // events
  $("#btnHistory").addEventListener("click", () => (location.hash = "#/history"));
  $("#btnBack").addEventListener("click", () => (location.hash = "#/"));
  $("#btnGoHistory").addEventListener("click", () => (location.hash = "#/history"));
  $("#btnBackFromHistory").addEventListener("click", () => history.back());

  $(".brand").addEventListener("click", () => (location.hash = "#/"));
  $(".brand").addEventListener("keydown", (e) => { if (e.key === "Enter") location.hash = "#/"; });

  // Home grid
  renderHomeTiles();

  // Game actions
  $("#btnOpenRules").addEventListener("click", () => openRules());
  $("#fabRules").addEventListener("click", () => openRules());
  $("#btnStart").addEventListener("click", () => startSession());

  $("#btnAddRound").addEventListener("click", () => addRoundUI());
  $("#btnUndoRound").addEventListener("click", () => undoLastRound());
  $("#btnEndSession").addEventListener("click", () => endSession());
  $("#btnPinSession").addEventListener("click", () => togglePinActive());
  $("#btnDuplicate").addEventListener("click", () => duplicateSession());

  // History actions
  $("#btnSelectAll").addEventListener("click", () => selectAllHistory(true));
  $("#btnClearSelection").addEventListener("click", () => selectAllHistory(false));
  $("#btnExportPdf").addEventListener("click", () => exportSelectedPdf());

  // Restore active session if exists
  const maybeActiveId = localStorage.getItem(LS_KEY_ACTIVE);
  if (maybeActiveId) {
    const s = getSessionById(maybeActiveId);
    if (s && !s.endedAt) {
      activeSession = s;
    } else {
      localStorage.removeItem(LS_KEY_ACTIVE);
    }
  }

  // PWA service worker
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("sw.js"); } catch {}
  }

  window.addEventListener("hashchange", route);
  route();
}

// ---------- Home ----------
function renderHomeTiles() {
  const grid = $("#gamesGrid");
  grid.innerHTML = "";

  GAMES.forEach(g => {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.style.setProperty("--accent", g.accent || SITE?.ui?.defaultAccent || "#6ee7ff");
    tile.innerHTML = `
      <div class="tile__row">
        <img class="tile__logo" src="${g.logo}" alt="${g.name} logo" />
        <div>
          <div class="tile__name">${g.name}</div>
          <div class="tile__meta">${g.minPlayers}–${g.maxPlayers} joueurs</div>
        </div>
      </div>
    `;
    tile.addEventListener("click", () => (location.hash = `#/game/${g.id}`));
    grid.appendChild(tile);
  });
}

function showHome() {
  setAccent(SITE?.ui?.defaultAccent || "#6ee7ff");
  showView("home");
}

// ---------- Game ----------
function showGame(gameId) {
  const g = GAME_MAP.get(gameId);
  if (!g) { location.hash = "#/"; return; }

  currentGame = g;
  setAccent(g.accent);

  $("#gameLogo").src = g.logo;
  $("#gameLogo").alt = `${g.name} logo`;
  $("#gameName").textContent = g.name;
  $("#gameMeta").textContent = `${g.minPlayers}–${g.maxPlayers} joueurs`;
  $("#gameHelp").textContent = g.scoringHelp || "";

  // players count selector
  const sel = $("#playersCount");
  sel.innerHTML = "";
  for (let n = g.minPlayers; n <= g.maxPlayers; n++) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = String(n);
    sel.appendChild(opt);
  }
  sel.value = String(clamp(4, g.minPlayers, g.maxPlayers));
  sel.onchange = () => renderPlayerInputs();

  renderPlayerInputs();

  // show active session if matches this game
  const live = $("#liveSession");
  live.classList.add("hidden");

  if (activeSession && activeSession.gameId === g.id) {
    renderLiveSession(activeSession);
    live.classList.remove("hidden");
  } else {
    // if active session exists but other game, hide (on peut la retrouver dans Historique)
  }

  showView("game");
}

function renderPlayerInputs() {
  const n = safeInt($("#playersCount").value);
  const wrap = $("#playersInputs");
  wrap.innerHTML = "";

  for (let i = 1; i <= n; i++) {
    const lab = document.createElement("label");
    lab.className = "field";
    lab.innerHTML = `
      <span class="field__label">Pseudo joueur ${i}</span>
      <input class="input" type="text" maxlength="12" placeholder="ex: JKA" data-player="${i}" />
    `;
    wrap.appendChild(lab);
  }
}

function openRules() {
  if (!currentGame?.rulesPdf) return;
  window.open(currentGame.rulesPdf, "_blank", "noopener,noreferrer");
}

function startSession() {
  if (!currentGame) return;

  const n = safeInt($("#playersCount").value);
  const inputs = [...$("#playersInputs").querySelectorAll("input")];

  const players = inputs.slice(0, n).map((inp, idx) => {
    const raw = (inp.value || "").trim();
    const pseudo = raw || `J${idx+1}`;
    return { id: `p${idx+1}`, pseudo };
  });

  const label = ($("#sessionLabel").value || "").trim();

  const session = {
    id: uid(),
    gameId: currentGame.id,
    gameName: currentGame.name,
    accent: currentGame.accent,
    startedAt: nowISO(),
    updatedAt: nowISO(),
    endedAt: null,
    pinned: false,
    label,
    players,
    rounds: []
  };

  activeSession = upsertSession(session);
  localStorage.setItem(LS_KEY_ACTIVE, activeSession.id);

  renderLiveSession(activeSession);
  $("#liveSession").classList.remove("hidden");
  // Direct: proposer 1ère manche
  addRoundUI();
}

function renderLiveSession(session) {
  const g = GAME_MAP.get(session.gameId);
  setAccent(g?.accent || SITE?.ui?.defaultAccent || "#6ee7ff");

  // status + info
  $("#sessionStatus").textContent = session.endedAt ? "Terminée" : "En cours";
  const pinChar = session.pinned ? "★" : "☆";
  $("#btnPinSession").textContent = `${pinChar} Favori`;

  $("#btnDuplicate").classList.toggle("hidden", !session.endedAt);

  const label = session.label ? ` — ${session.label}` : "";
  $("#sessionInfo").textContent =
    `Démarrée le ${fmtDateTime(session.startedAt)}${label} · Manches: ${session.rounds.length}`;

  // build table
  const head = $("#scoreHead");
  const body = $("#scoreBody");
  const foot = $("#scoreFoot");
  head.innerHTML = "";
  body.innerHTML = "";
  foot.innerHTML = "";

  const trh = document.createElement("tr");
  trh.innerHTML = `<th>Manche</th>` + session.players.map(p => `<th>${escapeHtml(p.pseudo)}</th>`).join("");
  head.appendChild(trh);

  // rows for validated rounds
  session.rounds.forEach((r, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>#${idx+1}</td>` + session.players.map(p => `<td>${safeInt(r.scores[p.id])}</td>`).join("");
    body.appendChild(tr);
  });

  // totals
  const totals = computeTotals(session);
  const trf = document.createElement("tr");
  trf.innerHTML = `<td>Total</td>` + session.players.map(p => `<td>${totals[p.id] ?? 0}</td>`).join("");
  foot.appendChild(trf);
}

function computeTotals(session) {
  const totals = {};
  session.players.forEach(p => totals[p.id] = 0);
  session.rounds.forEach(r => {
    session.players.forEach(p => {
      totals[p.id] += safeInt(r.scores[p.id]);
    });
  });
  return totals;
}

function addRoundUI() {
  if (!activeSession || activeSession.endedAt) return;

  // Build an input row "draft" at bottom, then validate
  const body = $("#scoreBody");

  // Remove any existing draft row
  const existing = body.querySelector("tr[data-draft='1']");
  if (existing) existing.remove();

  const roundIndex = activeSession.rounds.length + 1;

  const tr = document.createElement("tr");
  tr.dataset.draft = "1";
  tr.innerHTML = `
    <td>
      #${roundIndex}<div class="muted tiny">à valider</div>
    </td>
    ${activeSession.players.map(p => `
      <td>
        <input class="cellInput" type="number" inputmode="numeric" pattern="[0-9]*"
          placeholder="0" data-pid="${p.id}" />
      </td>
    `).join("")}
  `;

  body.appendChild(tr);

  // Add validate button row (simple)
  const btnRow = document.createElement("tr");
  btnRow.dataset.draft = "1";
  btnRow.innerHTML = `
    <td colspan="${activeSession.players.length + 1}" style="text-align:right;">
      <button class="btn" id="btnValidateRound">Valider la manche</button>
    </td>
  `;
  body.appendChild(btnRow);

  // focus first input
  const firstInput = tr.querySelector("input");
  if (firstInput) firstInput.focus();

  $("#btnValidateRound").addEventListener("click", validateDraftRound, { once:true });
}

function validateDraftRound() {
  if (!activeSession || activeSession.endedAt) return;

  const body = $("#scoreBody");
  const draftInputs = [...body.querySelectorAll("tr[data-draft='1'] input")];
  if (draftInputs.length === 0) return;

  const scores = {};
  draftInputs.forEach(inp => {
    const pid = inp.dataset.pid;
    scores[pid] = safeInt(inp.value);
  });

  // Remove draft rows
  [...body.querySelectorAll("tr[data-draft='1']")].forEach(r => r.remove());

  // Push round
  activeSession.rounds.push({ ts: nowISO(), scores });
  activeSession = upsertSession(activeSession);
  localStorage.setItem(LS_KEY_ACTIVE, activeSession.id);

  renderLiveSession(activeSession);
}

function undoLastRound() {
  if (!activeSession || activeSession.endedAt) return;

  // If draft exists, remove draft first
  const body = $("#scoreBody");
  const drafts = [...body.querySelectorAll("tr[data-draft='1']")];
  if (drafts.length) {
    drafts.forEach(r => r.remove());
    return;
  }

  if (activeSession.rounds.length === 0) return;

  activeSession.rounds.pop();
  activeSession = upsertSession(activeSession);
  renderLiveSession(activeSession);
}

function endSession() {
  if (!activeSession || activeSession.endedAt) return;

  // If draft rows exist, remove them (on force un état propre)
  const body = $("#scoreBody");
  [...body.querySelectorAll("tr[data-draft='1']")].forEach(r => r.remove());

  activeSession.endedAt = nowISO();
  activeSession = upsertSession(activeSession);

  // after end: allow duplicate, but keep in storage
  localStorage.removeItem(LS_KEY_ACTIVE);
  $("#sessionStatus").textContent = "Terminée";
  $("#btnDuplicate").classList.remove("hidden");

  renderLiveSession(activeSession);
}

function togglePinActive() {
  if (!activeSession) return;
  activeSession.pinned = !activeSession.pinned;
  activeSession = upsertSession(activeSession);
  renderLiveSession(activeSession);
}

function duplicateSession() {
  if (!activeSession) return;
  const g = GAME_MAP.get(activeSession.gameId);
  if (!g) return;

  const copy = {
    id: uid(),
    gameId: activeSession.gameId,
    gameName: activeSession.gameName,
    accent: activeSession.accent,
    startedAt: nowISO(),
    updatedAt: nowISO(),
    endedAt: null,
    pinned: false,
    label: activeSession.label || "",
    players: activeSession.players.map(p => ({...p})),
    rounds: []
  };

  activeSession = upsertSession(copy);
  localStorage.setItem(LS_KEY_ACTIVE, activeSession.id);

  renderLiveSession(activeSession);
  $("#liveSession").classList.remove("hidden");
  addRoundUI();
}

// ---------- History ----------
function showHistory() {
  showView("history");
  setAccent(SITE?.ui?.defaultAccent || "#6ee7ff");
  renderHistoryList();
}

function renderHistoryList() {
  cleanupSessionsTTL();
  const list = $("#historyList");
  list.innerHTML = "";

  const sessions = loadSessionsRaw();

  if (sessions.length === 0) {
    list.innerHTML = `<div class="muted">Aucune partie enregistrée (ou elles ont expiré).</div>`;
    return;
  }

  sessions.forEach(s => {
    const g = GAME_MAP.get(s.gameId);
    const logo = g?.logo || "assets/logo-site.svg";
    const accent = g?.accent || s.accent || SITE?.ui?.defaultAccent || "#6ee7ff";
    const ended = s.endedAt ? `Terminée: ${fmtDateTime(s.endedAt)}` : "En cours (ré-ouvrable)";
    const label = s.label ? ` — ${escapeHtml(s.label)}` : "";
    const players = (s.players || []).map(p => p.pseudo).join(", ");
    const roundsCount = (s.rounds || []).length;

    const item = document.createElement("div");
    item.className = "hItem";
    item.style.setProperty("--accent", accent);

    item.innerHTML = `
      <div class="hLeft">
        <img class="hLogo" src="${logo}" alt="" />
        <div>
          <div class="hTitle">${escapeHtml(g?.name || s.gameName || s.gameId)}${label}</div>
          <div class="hSub">${ended} · Démarrée: ${fmtDateTime(s.startedAt)} · Manches: ${roundsCount}</div>
          <div class="hSub">Joueurs: ${escapeHtml(players || "—")}</div>
        </div>
      </div>

      <div class="hActions">
        <label class="check" title="Sélection PDF">
          <input type="checkbox" class="chkSession" data-sid="${s.id}" />
          <span>Sélection</span>
        </label>

        <button class="btn btn--ghost" data-open="${s.id}">Ouvrir</button>
        <button class="btn btn--ghost hPin" data-pin="${s.id}" title="Épingler / retirer épingle">${s.pinned ? "★" : "☆"}</button>
        <button class="btn btn--ghost" data-del="${s.id}" title="Supprimer">Suppr.</button>
      </div>
    `;

    item.querySelector("[data-open]").addEventListener("click", () => openFromHistory(s.id));
    item.querySelector("[data-pin]").addEventListener("click", () => togglePinHistory(s.id));
    item.querySelector("[data-del]").addEventListener("click", () => { deleteSession(s.id); renderHistoryList(); });

    list.appendChild(item);
  });
}

function openFromHistory(sessionId) {
  const s = getSessionById(sessionId);
  if (!s) return;

  activeSession = s;
  // si non terminée => c'est l'active session
  if (!s.endedAt) localStorage.setItem(LS_KEY_ACTIVE, s.id);

  location.hash = `#/game/${s.gameId}`;
  // renderLiveSession se fera dans showGame
  setTimeout(() => {
    if (activeSession && activeSession.id === s.id) {
      $("#liveSession").classList.remove("hidden");
      renderLiveSession(activeSession);
    }
  }, 0);
}

function togglePinHistory(sessionId) {
  const s = getSessionById(sessionId);
  if (!s) return;
  s.pinned = !s.pinned;
  upsertSession(s);
  renderHistoryList();
}

function selectAllHistory(flag) {
  [...document.querySelectorAll(".chkSession")].forEach(chk => chk.checked = !!flag);
}

function getSelectedSessionIds() {
  return [...document.querySelectorAll(".chkSession")]
    .filter(c => c.checked)
    .map(c => c.dataset.sid);
}

// ---------- PDF Export ----------
async function exportSelectedPdf() {
  const ids = getSelectedSessionIds();
  if (ids.length === 0) return;

  const includeRounds = $("#chkIncludeRounds").checked;

  // jsPDF available?
  const jspdf = window.jspdf;
  if (!jspdf?.jsPDF) {
    alert("Librairie PDF non chargée. Réessaie (connexion requise la première fois).");
    return;
  }

  const doc = new jspdf.jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = 48;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(SITE?.siteName || "ScorePad", margin, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Export du ${new Date().toLocaleString()}`, margin, y);
  y += 18;

  const sessions = ids.map(getSessionById).filter(Boolean);

  // Sort chronologically by startedAt desc like UI
  sessions.sort((a,b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const g = GAME_MAP.get(s.gameId);

    const title = `${g?.name || s.gameName || s.gameId}${s.label ? " — " + s.label : ""}`;
    const players = (s.players || []).map(p => p.pseudo).join(", ");
    const totals = computeTotals(s);
    const endedTxt = s.endedAt ? fmtDateTime(s.endedAt) : "—";

    // new page if needed
    if (y > 740) { doc.addPage(); y = 48; }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(title, margin, y);
    y += 16;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(`Début: ${fmtDateTime(s.startedAt)}   |   Fin: ${endedTxt}`, margin, y);
    y += 14;

    doc.text(`Joueurs: ${players}`, margin, y);
    y += 14;

    // Totaux
    doc.setFont("helvetica", "bold");
    doc.text("Scores (totaux):", margin, y);
    y += 14;

    doc.setFont("helvetica", "normal");
    (s.players || []).forEach(p => {
      const line = `- ${p.pseudo}: ${totals[p.id] ?? 0}`;
      doc.text(line, margin + 10, y);
      y += 13;
      if (y > 760) { doc.addPage(); y = 48; }
    });

    // Détail manches
    if (includeRounds) {
      y += 6;
      doc.setFont("helvetica", "bold");
      doc.text("Détail des manches:", margin, y);
      y += 14;
      doc.setFont("helvetica", "normal");

      (s.rounds || []).forEach((r, idx) => {
        const parts = (s.players || []).map(p => `${p.pseudo}:${safeInt(r.scores[p.id])}`).join("  ");
        const line = `Manche #${idx+1} — ${parts}`;
        doc.text(line, margin + 10, y);
        y += 13;
        if (y > 760) { doc.addPage(); y = 48; }
      });
    }

    // separator
    y += 10;
    if (i !== sessions.length - 1) {
      doc.setDrawColor(200);
      doc.line(margin, y, pageW - margin, y);
      y += 16;
    }
  }

  doc.save(`scorepad-export-${Date.now()}.pdf`);
}

// ---------- Helpers ----------
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// Boot
init();
