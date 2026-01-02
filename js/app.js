/* ScoreKit — app.js (no framework) */
const App = (() => {
  const SITE_CFG_PATH = "config/site.json";
  const GAMES_CFG_PATH = "config/games.json";

  const STORAGE_KEY = "scorekit:matches:v2";
  const STORAGE_VERSION = 2;

  const EXPIRY_MS = 24 * 60 * 60 * 1000;

  let siteCfg = null;

  function now() { return Date.now(); }
  function fmtDateTime(ts) {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  }

  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Impossible de charger ${path}`);
    return await res.json();
  }

  async function initCommon() {
    siteCfg = await loadJSON(SITE_CFG_PATH);

    const logo = document.getElementById("siteLogo");
    if (logo) logo.src = siteCfg.logoPath || "assets/logo.png";

    const name = document.getElementById("siteName");
    if (name) name.textContent = siteCfg.siteName || "ScoreKit";

    const tag = document.getElementById("siteTagline");
    if (tag) tag.textContent = siteCfg.tagline || "";

    const foot = document.getElementById("footerText");
    if (foot) foot.textContent = siteCfg.footerText || "";

    pruneExpired();
  }

  async function loadGames() {
    return await loadJSON(GAMES_CFG_PATH);
  }

  function setAccent(accent) {
    document.documentElement.style.setProperty("--accent", accent || "#6ee7ff");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", "#0b0d12");
  }

  function renderHomeTiles(games) {
    const grid = document.getElementById("gamesGrid");
    if (!grid) return;

    grid.innerHTML = "";
    for (const g of games) {
      const a = document.createElement("a");
      a.className = "tile";
      a.href = `game.html?id=${encodeURIComponent(g.id)}`;
      a.style.setProperty("--accent", g.accent || "#6ee7ff");

      a.innerHTML = `
        <div class="tile__row">
          <img class="tile__logo" src="${g.logo}" alt="Logo ${escapeHtml(g.name)}" />
          <div>
            <div class="tile__name">${escapeHtml(g.name)}</div>
            <div class="tile__meta">${g.minPlayers}–${g.maxPlayers} joueurs</div>
          </div>
        </div>
      `;
      grid.appendChild(a);
    }
  }

  function mountGamePage(game) {
    setAccent(game.accent);

    document.title = `${game.name} — ${siteCfg?.siteName || "ScoreKit"}`;

    const gameLogo = document.getElementById("gameLogo");
    const gameName = document.getElementById("gameName");
    const gameMeta = document.getElementById("gameMeta");
    const gameScoring = document.getElementById("gameScoring");
    const rulesBtn = document.getElementById("rulesBtn");

    if (gameLogo) gameLogo.src = game.logo;
    if (gameName) gameName.textContent = game.name;
    if (gameMeta) gameMeta.innerHTML = `<span class="badge">${game.minPlayers}–${game.maxPlayers} joueurs</span>`;
    if (gameScoring) gameScoring.textContent = game.scoringInfo || "";
    if (rulesBtn) rulesBtn.href = game.rulesPdf || "#";

    const playersCount = document.getElementById("playersCount");
    playersCount.min = String(game.minPlayers || 2);
    playersCount.max = String(game.maxPlayers || 10);
    playersCount.value = String(Math.max(game.minPlayers || 2, 2));

    const playersFields = document.getElementById("playersFields");
    const form = document.getElementById("newGameForm");

    const rebuildPlayers = () => {
      const n = clampInt(playersCount.value, game.minPlayers, game.maxPlayers);
      playersCount.value = String(n);

      playersFields.innerHTML = "";
      for (let i = 0; i < n; i++) {
        const div = document.createElement("label");
        div.className = "field";
        div.innerHTML = `
          <span class="field__label">Pseudo joueur ${i + 1}</span>
          <input class="input" name="player" maxlength="12" placeholder="Ex: JD" required />
        `;
        playersFields.appendChild(div);
      }
    };

    playersCount.addEventListener("input", rebuildPlayers);
    rebuildPlayers();

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const names = [...form.querySelectorAll('input[name="player"]')].map(i => i.value.trim()).filter(Boolean);
      if (names.length < (game.minPlayers || 2)) return;

      const match = createMatch(game, names);
      saveMatch(match);

      // ouvrir la partie (scroll + focus)
      renderActiveMatches(game.id);
      form.reset();
      playersCount.value = String(Math.max(game.minPlayers || 2, 2));
      rebuildPlayers();
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    });

    renderActiveMatches(game.id);
  }

  function renderActiveMatches(gameId) {
    const container = document.getElementById("activeGames");
    if (!container) return;

    const data = loadMatches();
    const active = data.matches
      .filter(m => m.gameId === gameId && !m.endedAt)
      .sort((a,b) => b.startedAt - a.startedAt);

    if (active.length === 0) {
      container.innerHTML = `<div class="muted">Aucune partie en cours.</div>`;
      return;
    }

    container.innerHTML = "";
    for (const m of active) {
      const card = document.createElement("div");
      card.className = "active-card";

      const totalByPlayer = computeTotals(m);

      card.innerHTML = `
        <div class="active-card__top">
          <div>
            <div class="active-card__title">Partie en cours</div>
            <div class="active-card__meta">Début : ${fmtDateTime(m.startedAt)} • Manches : ${m.rounds.length}</div>
          </div>
          <div class="badge">ID ${m.id.slice(-6)}</div>
        </div>

        <div class="chips">
          ${m.players.map((p, idx) => `
            <div class="chip" title="Pseudo">
              <b>${escapeHtml(p)}</b>
              <span class="muted">: ${totalByPlayer[idx]}</span>
            </div>
          `).join("")}
        </div>

        <div class="rounds">
          <div class="rounds__header">
            <div class="card__title" style="margin:0;">Saisie des manches</div>
            <div class="muted" style="font-size:12px;">Clavier numérique activé</div>
          </div>

          <div class="round-grid" id="roundGrid-${m.id}"></div>

          <div class="active-card__actions">
            <button class="btn btn--primary" data-action="add-round" data-id="${m.id}">+ Ajouter une manche</button>
            <button class="btn" data-action="undo-round" data-id="${m.id}">Annuler dernière manche</button>
            <button class="btn" data-action="end" data-id="${m.id}">Fin de partie</button>
          </div>
        </div>
      `;

      container.appendChild(card);

      renderRoundGrid(m, document.getElementById(`roundGrid-${m.id}`));
    }

    container.querySelectorAll("button[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const action = btn.getAttribute("data-action");
        if (!id || !action) return;

        const data = loadMatches();
        const m = data.matches.find(x => x.id === id);
        if (!m) return;

        if (action === "add-round") {
          m.rounds.push({ scores: new Array(m.players.length).fill(0), validatedAt: null });
          saveAll(data);
          renderActiveMatches(gameId);
        }

        if (action === "undo-round") {
          if (m.rounds.length > 0) m.rounds.pop();
          saveAll(data);
          renderActiveMatches(gameId);
        }

        if (action === "end") {
          m.endedAt = now();
          saveAll(data);
          renderActiveMatches(gameId);
        }
      });
    });
  }

  function renderRoundGrid(match, gridEl) {
    if (!gridEl) return;

    gridEl.innerHTML = "";
    if (match.rounds.length === 0) {
      gridEl.innerHTML = `<div class="muted">Ajoute une manche pour commencer.</div>`;
      return;
    }

    match.rounds.forEach((r, rIdx) => {
      const row = document.createElement("div");
      row.className = "round-row";

      const scoresHtml = match.players.map((p, pIdx) => {
        const v = (r.scores?.[pIdx] ?? 0);
        return `
          <label class="field">
            <span class="field__label">${escapeHtml(p)}</span>
            <input class="input"
              data-mid="${match.id}" data-r="${rIdx}" data-p="${pIdx}"
              type="number" inputmode="numeric" pattern="[0-9]*"
              value="${v}" />
          </label>
        `;
      }).join("");

      row.innerHTML = `
        <div class="rounds__header">
          <div class="badge">Manche ${rIdx + 1}</div>
          <button class="btn btn--primary" data-action="validate-round" data-mid="${match.id}" data-r="${rIdx}">
            Valider la manche
          </button>
        </div>
        <div class="round-row__scores">${scoresHtml}</div>
      `;

      gridEl.appendChild(row);
    });

    gridEl.querySelectorAll('input[type="number"]').forEach(inp => {
      inp.addEventListener("input", () => {
        const mid = inp.getAttribute("data-mid");
        const r = Number(inp.getAttribute("data-r"));
        const p = Number(inp.getAttribute("data-p"));
        const val = Number(inp.value || 0);

        const data = loadMatches();
        const m = data.matches.find(x => x.id === mid);
        if (!m) return;

        m.rounds[r].scores[p] = Number.isFinite(val) ? val : 0;
        saveAll(data);
      });
    });

    gridEl.querySelectorAll('button[data-action="validate-round"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const mid = btn.getAttribute("data-mid");
        const r = Number(btn.getAttribute("data-r"));
        const data = loadMatches();
        const m = data.matches.find(x => x.id === mid);
        if (!m) return;

        m.rounds[r].validatedAt = now();
        saveAll(data);

        // refresh just totals display by re-rendering active block (simple)
        // (gameId page knows to call renderActiveMatches; easiest: reload)
        location.reload();
      });
    });
  }

  function mountHistoryPage(games) {
    const list = document.getElementById("historyList");
    const exportBtn = document.getElementById("exportBtn");
    const includeRounds = document.getElementById("includeRounds");

    const data = loadMatches();
    const matches = data.matches
      .slice()
      .sort((a,b) => b.startedAt - a.startedAt);

    renderHistoryList(matches, games, list);

    exportBtn.addEventListener("click", () => {
      const checked = [...document.querySelectorAll(".selectbox:checked")].map(x => x.value);
      const selected = matches.filter(m => checked.includes(m.id));
      if (selected.length === 0) {
        alert("Sélectionne au moins une partie.");
        return;
      }
      exportMatchesPDF(selected, games, includeRounds.checked);
    });

    list.addEventListener("click", (e) => {
      const starBtn = e.target.closest("[data-star]");
      if (!starBtn) return;

      const id = starBtn.getAttribute("data-star");
      const data = loadMatches();
      const m = data.matches.find(x => x.id === id);
      if (!m) return;

      m.pinned = !m.pinned;
      saveAll(data);
      pruneExpired(); // in case it was expiring
      renderHistoryList(loadMatches().matches.sort((a,b)=>b.startedAt-a.startedAt), games, list);
    });

    list.addEventListener("click", (e) => {
      const act = e.target.closest("[data-action]");
      if (!act) return;

      const id = act.getAttribute("data-id");
      const action = act.getAttribute("data-action");
      if (!id) return;

      const data = loadMatches();
      const m = data.matches.find(x => x.id === id);
      if (!m) return;

      if (action === "reopen") {
        m.endedAt = null;
        saveAll(data);
        renderHistoryList(loadMatches().matches.sort((a,b)=>b.startedAt-a.startedAt), games, list);
      }

      if (action === "duplicate") {
        const game = games.find(g => g.id === m.gameId);
        if (!game) return;
        const dup = createMatch(game, m.players);
        saveMatch(dup);
        renderHistoryList(loadMatches().matches.sort((a,b)=>b.startedAt-a.startedAt), games, list);
      }
    });
  }

  function renderHistoryList(matches, games, listEl) {
    if (!listEl) return;

    if (matches.length === 0) {
      listEl.innerHTML = `<div class="muted">Aucune partie enregistrée.</div>`;
      return;
    }

    listEl.innerHTML = "";
    for (const m of matches) {
      const game = games.find(g => g.id === m.gameId);
      const totals = computeTotals(m);

      const div = document.createElement("div");
      div.className = "hist-item";
      div.style.setProperty("--accent", (game?.accent || "#6ee7ff"));

      const ended = m.endedAt ? `Fin : ${fmtDateTime(m.endedAt)}` : "En cours";
      div.innerHTML = `
        <div class="hist-item__top">
          <div class="hist-item__left">
            <div class="hist-item__title">${escapeHtml(game?.name || m.gameId)}</div>
            <div class="hist-item__sub">Début : ${fmtDateTime(m.startedAt)} • ${ended}</div>
          </div>
          <div class="hist-item__right">
            <button class="star" data-star="${m.id}" title="Épingler">${m.pinned ? "⭐" : "☆"}</button>
            <input class="selectbox" type="checkbox" value="${m.id}" title="Sélection export PDF" />
          </div>
        </div>

        <div class="chips">
          ${m.players.map((p, idx) => `
            <div class="chip"><b>${escapeHtml(p)}</b> <span class="muted">: ${totals[idx]}</span></div>
          `).join("")}
        </div>

        <div class="active-card__actions">
          ${m.endedAt ? `<button class="btn" data-action="reopen" data-id="${m.id}">Réouvrir</button>` : ``}
          <button class="btn btn--primary" data-action="duplicate" data-id="${m.id}">Dupliquer</button>
        </div>
      `;
      listEl.appendChild(div);
    }
  }

  function exportMatchesPDF(matches, games, includeRounds) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const margin = 40;
    let y = margin;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(siteCfg?.siteName || "ScoreKit", margin, y);
    y += 18;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Export des parties", margin, y);
    y += 20;

    for (const m of matches) {
      const game = games.find(g => g.id === m.gameId);
      const totals = computeTotals(m);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(`${game?.name || m.gameId}`, margin, y);
      y += 14;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Début : ${fmtDateTime(m.startedAt)}${m.endedAt ? " • Fin : " + fmtDateTime(m.endedAt) : ""}`, margin, y);
      y += 14;

      doc.text(`Joueurs : ${m.players.join(", ")}`, margin, y);
      y += 14;

      doc.text(`Scores : ${m.players.map((p,i)=> `${p}=${totals[i]}`).join("  •  ")}`, margin, y);
      y += 14;

      if (includeRounds) {
        doc.setFont("helvetica", "bold");
        doc.text(`Détail des manches (${m.rounds.length})`, margin, y);
        y += 14;
        doc.setFont("helvetica", "normal");

        m.rounds.forEach((r, idx) => {
          const line = `Manche ${idx + 1} : ${r.scores.map((s, i) => `${m.players[i]}=${s}`).join("  •  ")}`;
          y = writeWrapped(doc, line, margin, y, 515);
          y += 6;
        });
      }

      y += 14;
      if (y > 760) {
        doc.addPage();
        y = margin;
      }
    }

    doc.save(`scorekit_export_${Date.now()}.pdf`);
  }

  function writeWrapped(doc, text, x, y, maxWidth) {
    const lines = doc.splitTextToSize(text, maxWidth);
    lines.forEach(line => {
      doc.text(line, x, y);
      y += 12;
    });
    return y;
  }

  function createMatch(game, players) {
    return {
      v: STORAGE_VERSION,
      id: crypto.randomUUID(),
      gameId: game.id,
      players: players.map(p => p.slice(0, 12)),
      rounds: [],
      startedAt: now(),
      endedAt: null,
      pinned: false
    };
  }

  function computeTotals(match) {
    const totals = new Array(match.players.length).fill(0);
    for (const r of match.rounds) {
      (r.scores || []).forEach((s, i) => {
        totals[i] += Number(s || 0);
      });
    }
    return totals;
  }

  function loadMatches() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { v: STORAGE_VERSION, matches: [] };
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.matches)) return { v: STORAGE_VERSION, matches: [] };
      return data;
    } catch {
      return { v: STORAGE_VERSION, matches: [] };
    }
  }

  function saveAll(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function saveMatch(match) {
    const data = loadMatches();
    data.matches.push(match);
    saveAll(data);
  }

  function pruneExpired() {
    const data = loadMatches();
    const t = now();
    const before = data.matches.length;

    data.matches = data.matches.filter(m => {
      if (m.pinned) return true;
      const age = t - (m.startedAt || t);
      return age <= EXPIRY_MS;
    });

    if (data.matches.length !== before) saveAll(data);
  }

  function clampInt(v, min, max) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("service-worker.js");
    } catch {}
  }

  return {
    initCommon,
    loadGames,
    renderHomeTiles,
    mountGamePage,
    mountHistoryPage,
    registerSW
  };
})();
