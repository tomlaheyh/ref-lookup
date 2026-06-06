// connectionsGraph.js — Interactive "Connections" citation report for ref-lookup
// Non-module, vanilla JS. Mirrors citationBuilder.js conventions.
//
// THREE VIEWS of the center article, toggled in one report:
//   • Inside  (25) — references WITHIN the article (what it cites)   arrows: center → node (out)
//   • Outside (25) — papers that CITE this article (what cites it)   arrows: node → center (in)
//   • Mix     (24) — 12 inside + 12 outside in one shared ring       arrows: mixed
//
// Layout: graph (left) + detail panel (right). Click a bubble → right panel shows
// title/journal/year/citations/quality/links + abstract.
//
// Abstract cascade on click: OpenAlex (instant) → _allResults cache (instant)
//                          → live PubMed → Crossref → "none available".
//
// Hook (lookup.js): window.ConnectionsGraph.attachButton(result, doi)
// SJR accessor (lookup.js): window.__getSjrByIssn(issn)
// ============================================================================

(function () {
  'use strict';

  // ── Config flags ───────────────────────────────────────────────────────────
  // When a user clicks "Make this the new center" on another bubble, show a
  // confirmation warning that current favorites / view state will be lost.
  // Tester feedback (Jun 2026): the warning felt like an unnecessary extra click.
  // Set to false to skip the warning and switch centers immediately.
  // Flip back to true if later feedback wants the safety prompt restored.
  var SHOW_MAKE_CENTER_WARNING = false;

  // ── Expansion (multi-level) config ─────────────────────────────────────────
  // Budget = max UNIQUE papers in the whole tree (the real blow-up guard).
  // Depth = hard ceiling: center is level 0, so 3 = three rounds of picks below
  //         it; level-3 papers are selected but never expanded further.
  // Concurrency = how many buildData calls run at once (polite-pool friendly).
  var EXPAND_BUDGET = 50;
  var EXPAND_MAX_DEPTH = 3;
  var EXPAND_CONCURRENCY = 3;
  var FOUNDATIONAL_TOP = 200;        // final list size: shown + exported
  var FOUNDATIONAL_CANDIDATES = 300; // co-citation candidate pool resolved before
                                     // ranking by citations and cutting to TOP

  // Captured ONCE at load (page-parse time), before any lookup runs and before
  // index.html rewrites the URL with replaceState (which drops connections=1).
  // attachButton checks this instead of the live URL so the rewrite can't
  // sabotage the auto-open.
  var _autoOpenDoi = null;
  try {
    var _initParams = new URLSearchParams(window.location.search);
    if (_initParams.get('connections') === '1') {
      // The lookup supports up to 15 comma-separated DOIs. The normal connections
      // link is always single-DOI, but a hand-built / shared URL can carry the
      // full list alongside connections=1 — in which case the raw value can never
      // equal any one card's DOI and auto-open would silently never fire. Take the
      // first listed DOI so connections=1 deterministically opens that paper.
      _autoOpenDoi = (_initParams.get('doi') || '').split(',')[0].trim().toLowerCase();
    }
  } catch (e) { /* ignore */ }

  // Back-button support. When a card's "View connections" button opens the panel
  // in place, we pushState a shareable URL and remember the panel's close fn.
  // Browser Back then just closes the panel (revealing the full card list intact,
  // no reload); closing via X/Esc calls history.back() to keep the URL in sync.
  var _connPushed = false;
  var _activeClose = null;
  window.addEventListener('popstate', function () {
    // Only intercept Back for panels we opened in place (pushState). Auto-opened
    // panels from a fresh shared-link load let Back navigate normally.
    if (_connPushed && _activeClose) _activeClose(true);
  });

  var OPENALEX = 'https://api.openalex.org/works';
  // OpenAlex "polite pool": identified traffic gets a separate, more generous
  // rate limit. Not faster per request, but far less likely to be throttled
  // during burst expansion (level 2/3). Appended to every OpenAlex URL below.
  // Swap for a dedicated tool address later — one line.
  var OPENALEX_MAILTO = 'tomlaheyh@gmail.com';
  var MAILTO_Q = '&mailto=' + encodeURIComponent(OPENALEX_MAILTO);
  var N_SINGLE = 25, N_MIX_EACH = 12;

  var esc = (typeof escapeHtml === 'function') ? escapeHtml : function (s) {
    return s == null ? '' : String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trim() + '\u2026' : s; }

  // Heart icon — outline (empty) or filled. 14px. Inline SVG, no font dep.
  function heartSvg(filled, size) {
    size = size || 14;
    var fill = filled ? '#005a8c' : 'none';
    var stroke = filled ? '#005a8c' : '#9a978d';
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" style="vertical-align:-2px;" aria-hidden="true">' +
      '<path d="M12 21s-7-4.35-9.5-9C1 8.5 3 5 6.5 5c1.74 0 3.41 1 4.5 2.5C12.09 6 13.76 5 15.5 5 19 5 21 8.5 21.5 12c-2.5 4.65-9.5 9-9.5 9z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  }

  var SCACHE = 'connGraph6:';

  function qualityTier(sjr) {
    if (sjr === null || isNaN(sjr)) return { label: 'Unknown', fill: '#F1EFE8', stroke: '#888780', text: '#2C2C2A' };
    if (sjr >= 3)   return { label: 'High',  fill: '#C0DD97', stroke: '#3B6D11', text: '#173404' };
    if (sjr >= 0.8) return { label: 'Good',  fill: '#9FE1CB', stroke: '#0F6E56', text: '#04342C' };
    return { label: 'Low', fill: '#D3D1C7', stroke: '#5F5E5A', text: '#2C2C2A' };
  }

  // Open-access badge. Deliberately binary: one green "FREE" chip when the work
  // is free to read anywhere (per OpenAlex's is_oa), nothing otherwise. The
  // gold/green/bronze/hybrid distinctions are still captured on the node
  // (oaStatus) but intentionally not shown — this audience just wants "is it
  // free?", and the levels add confusion without payoff. Returns '' for non-OA
  // nodes so callers can concatenate unconditionally.
  function oaBadge(node) {
    if (!node || !node.isOa) return '';
    return '<span title="Free (per OpenAlex)" style="display:inline-block; background:#e3f1d4; color:#3b6d11; font-size:9px; font-weight:700; letter-spacing:0.5px; padding:2px 7px; border-radius:3px; margin-right:8px; vertical-align:2px; white-space:nowrap;">FREE</span>';
  }

  function sjrForIssns(issns) {
    if (!issns || !issns.length || typeof window.__getSjrByIssn !== 'function') return null;
    for (var i = 0; i < issns.length; i++) {
      var e = window.__getSjrByIssn(issns[i]);
      if (e && e.sjr != null) return parseFloat(e.sjr);
    }
    return null;
  }

  function rebuildAbstract(inv) {
    if (!inv || typeof inv !== 'object') return null;
    var words = [];
    Object.keys(inv).forEach(function (w) { inv[w].forEach(function (pos) { words[pos] = w; }); });
    var t = words.join(' ').replace(/\s+/g, ' ').trim();
    return t || null;
  }

  function workToNode(w, direction) {
    var src = w.primary_location && w.primary_location.source;
    var issns = (src && src.issn) || [];
    var doi = w.doi ? String(w.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, '') : null;
    var refs = (w.referenced_works || []).map(function (u) { return String(u).replace('https://openalex.org/', ''); });
    var authors = (w.authorships || []).map(function (a) {
      return a && a.author && a.author.display_name ? a.author.display_name : null;
    }).filter(Boolean);
    // Open-access status (per OpenAlex). oaUrl prefers the explicit oa_url, then
    // the best_oa_location's PDF, then its landing page. Used for the OA badge
    // and the "Free full text" link, and for the "free only" filter.
    var oa = w.open_access || {};
    var bestLoc = w.best_oa_location || null;
    var oaUrl = oa.oa_url || (bestLoc && (bestLoc.pdf_url || bestLoc.landing_page_url)) || null;
    _rememberWork(w.id, w.display_name, doi, w.cited_by_count);
    return {
      oaId: w.id ? String(w.id).replace('https://openalex.org/', '') : null,
      doi: doi, title: w.display_name || '(untitled)', year: w.publication_year || null,
      cites: w.cited_by_count || 0, journal: (src && src.display_name) || '',
      tier: qualityTier(sjrForIssns(issns)), direction: direction,
      isOa: !!oa.is_oa, oaStatus: oa.oa_status || null, oaUrl: oaUrl,
      abstract: rebuildAbstract(w.abstract_inverted_index),
      refs: refs, authors: authors
    };
  }

  // ── Top-pick selection brain (for the upcoming "levels" expansion) ─────────
  // A non-retracted node qualifies if it satisfies ANY of:
  //   1. Citation spine  : cites > 0 AND cites >= median-cutoff of the cited
  //                        subset (even-sized subset uses the LOWER of the two
  //                        middles, so the bar leans inclusive).
  //   2. Coupling rescue : shared >= 3   (shared > 2)
  //   3. Quality rescue  : tier.label === 'High'
  // Union -> dedupe -> cap at 10, filled in pass order (spine -> coupling ->
  // quality) so the set stays citation-led. Scale-free; returns 0..10 nodes.
  function selectTopNodes(nodes, opts) {
    opts = opts || {};
    var MAX = opts.max != null ? opts.max : 10;
    var COUPLING_MIN = opts.couplingMin != null ? opts.couplingMin : 3;
    var HIGH_LABEL = opts.highLabel || 'High';
    var pool = (nodes || []).filter(function (n) { return n && !n.retracted; });
    function keyOf(n) { return String(n.oaId || n.doi || n.title || '').toLowerCase(); }
    function cit(n) { return n && n.cites ? n.cites : 0; }
    function shr(n) { return n && n.shared ? n.shared : 0; }
    var cited = pool.filter(function (n) { return cit(n) > 0; }).slice()
      .sort(function (a, b) { return cit(a) - cit(b); });
    var cutoff = null;
    if (cited.length) {
      var m = cited.length;
      cutoff = (m % 2 === 1) ? cit(cited[(m - 1) / 2]) : cit(cited[m / 2 - 1]);
    }
    var spine = cutoff == null ? [] : cited.filter(function (n) { return cit(n) >= cutoff; });
    var coupling = pool.filter(function (n) { return shr(n) >= COUPLING_MIN; });
    var quality = pool.filter(function (n) { return n.tier && n.tier.label === HIGH_LABEL; });
    var reasons = {};
    function note(list, label) { list.forEach(function (n) { var k = keyOf(n); (reasons[k] = reasons[k] || []).push(label); }); }
    note(spine, 'cites'); note(coupling, 'shared'); note(quality, 'quality');
    spine.sort(function (a, b) { return cit(b) - cit(a) || shr(b) - shr(a); });
    coupling.sort(function (a, b) { return shr(b) - shr(a) || cit(b) - cit(a); });
    quality.sort(function (a, b) { return cit(b) - cit(a) || shr(b) - shr(a); });
    var picked = [], seen = {};
    function take(list) { for (var i = 0; i < list.length && picked.length < MAX; i++) { var k = keyOf(list[i]); if (seen[k]) continue; seen[k] = 1; picked.push(list[i]); } }
    take(spine); take(coupling); take(quality);
    picked.forEach(function (n) { n._pickReasons = reasons[keyOf(n)] || []; n._spineCutoff = cutoff; });
    return picked;
  }

  // Shared concurrency-limited promise pool. Hoisted function declaration so
  // callers defined earlier in the file (e.g. fetchWorksBatch) can reach it.
  function _mapPool(items, limit, fn) {
    return new Promise(function (resolve) {
      var i = 0, active = 0, done = 0, results = new Array(items.length);
      function next() {
        if (done === items.length) { resolve(results); return; }
        while (active < limit && i < items.length) {
          (function (idx) {
            active++;
            Promise.resolve(fn(items[idx], idx))
              .then(function (r) { results[idx] = r; })
              .catch(function () { results[idx] = null; })
              .then(function () { active--; done++; next(); });
          })(i++);
        }
      }
      next();
    });
  }

  // ── Multi-level expansion (the real engine) ────────────────────────────────
  // Frontier queue, best-first (cites desc, then shared desc), global dedup,
  // hard depth stop, and a unique-paper budget. Three stop conditions, whichever
  // fires first: depth >= EXPAND_MAX_DEPTH (enforced at enqueue), unique count
  // >= EXPAND_BUDGET, or frontier empty.
  // OpenAlex id helpers: keep ORIGINAL case for API filters (ids are
  // case-sensitive), lowercase only for dedupe/membership matching.
  function _oaId(x) { return String(x == null ? '' : x).replace(/^https?:\/\/openalex\.org\//i, ''); }
  function _oaKey(x) { return _oaId(x).toLowerCase(); }

  // ── Session-wide resolved-works map (Option 2) ──────────────────────────────
  // Every work that flows through workToNode (center, citers, refs, expansion
  // picks) drops its id -> {title, doi, cites} here as a side effect. Foundational
  // title resolution then reads from this map and from the in-memory `flat`
  // nodes (Option 1) and only hits OpenAlex for genuine first-time-seen refs.
  // Heap-only, never serialized to sessionStorage — no cache-quota interaction.
  var _resolvedWorks = {};
  function _rememberWork(id, title, doi, cites) {
    var k = _oaKey(id);
    if (!k) return;
    var cur = _resolvedWorks[k] || {};
    _resolvedWorks[k] = {
      title: (title != null && title !== '') ? title : (cur.title || null),
      doi: (doi != null) ? doi : (cur.doi != null ? cur.doi : null),
      cites: (cites != null) ? cites : (cur.cites != null ? cur.cites : 0)
    };
  }

  // Batch-fetch raw works by OpenAlex id (chunks of 100), failure-safe.
  // Chunk-level throttle for the resolution path. OpenAlex caps traffic at
  // ~10 requests/sec; the old Promise.all fired every chunk at once, so an
  // uncapped id list (~45 chunks) instantly tripped 429s — and the silent
  // `.catch(() => [])` dropped up to 100 ids per failed chunk, rendering them
  // as "(unresolved)". We now run a few chunks at a time via _mapPool (a
  // hoisted declaration, reachable here) and retry transient failures with a
  // short backoff before giving up.
  var FETCH_BATCH_CONCURRENCY = 4;   // default chunks in flight at once (stays under 10/sec)
  var FETCH_BATCH_RETRIES = 3;       // attempts per chunk before giving up
  var FETCH_STAGGER_MAX_WAVES = 5;   // cap pacing so a big miss-set adds ~1s, not minutes

  // Count API calls we think got rate-limited (HTTP 429). Cumulative for the
  // session; the expansion report shows the delta for its own run (snapshotted
  // at run start) as an "end-N" line so you can watch how close you are to the
  // limit. Each blocked attempt counts, including ones a retry later recovered.
  var _blockedApiCalls = 0;
  var _blockedAtRunStart = 0;
  function _delay(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  // opts (optional): { concurrency, pauseMs }. Default = concurrency 4, no pause
  // (existing callers keep their old behavior). The foundational resolution
  // passes a gentler { concurrency: 2, pauseMs: 200 } so its larger miss-sets
  // don't burst into the 10/sec wall.
  function fetchWorksBatch(ids, select, opts) {
    opts = opts || {};
    var concurrency = opts.concurrency != null ? opts.concurrency : FETCH_BATCH_CONCURRENCY;
    var pauseMs = opts.pauseMs != null ? opts.pauseMs : 0;
    ids = (ids || []).filter(Boolean);
    if (!ids.length) return Promise.resolve([]);
    var chunks = [];
    for (var i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
    function fetchChunk(ch, attempt) {
      attempt = attempt || 1;
      var url = OPENALEX + '?filter=openalex_id:' + ch.join('|') + '&per-page=' + ch.length + '&select=' + select + MAILTO_Q;
      return fetch(url)
        .then(function (r) { if (!r.ok) { if (r.status === 429) _blockedApiCalls++; throw new Error('batch ' + r.status); } return r.json(); })
        .then(function (d) { return d.results || []; })
        .catch(function () {
          if (attempt < FETCH_BATCH_RETRIES) {
            return _delay(300 * attempt).then(function () { return fetchChunk(ch, attempt + 1); });
          }
          return [];
        });
    }
    return _mapPool(chunks, concurrency, function (ch, idx) {
      // Stagger waves (a wave = `concurrency` chunks) by delaying each wave's
      // start a little more than the last, capped at FETCH_STAGGER_MAX_WAVES so
      // even a large miss-set adds ~1s at most rather than ballooning.
      if (pauseMs > 0) {
        var wave = Math.min(Math.floor(idx / Math.max(concurrency, 1)), FETCH_STAGGER_MAX_WAVES);
        if (wave > 0) return _delay(wave * pauseMs).then(function () { return fetchChunk(ch, 1); });
      }
      return fetchChunk(ch, 1);
    }).then(function (arrs) {
      var out = [];
      for (var j = 0; j < arrs.length; j++) { if (arrs[j] && arrs[j].length) out = out.concat(arrs[j]); }
      return out;
    });
  }

  // Single-work fetch by id. Unlike the openalex_id: batch filter, GET /works/{id}
  // follows OpenAlex's merge redirect to the canonical record — so it can resolve
  // heavily-cited classics that were deduped (the id in referenced_works points at
  // a merged, non-canonical record the filter silently returns nothing for).
  // Failure-safe: resolves to null rather than throwing.
  function fetchWorkSingle(id, select) {
    id = _oaId(id);
    if (!id) return Promise.resolve(null);
    var url = OPENALEX + '/' + id + '?select=' + (select || 'id,doi,display_name,cited_by_count') + MAILTO_Q;
    return fetch(url)
      .then(function (r) { if (!r.ok) { if (r.status === 429) _blockedApiCalls++; throw new Error('work ' + r.status); } return r.json(); })
      .then(function (d) { return d || null; })
      .catch(function () { return null; });
  }

  function runExpansionTest(rootPicks, viewName, centerKeys, onPhase, oaOnly) {
    var now = function () { return (window.performance && performance.now) ? performance.now() : Date.now(); };
    var t0 = now();
    _blockedAtRunStart = _blockedApiCalls; // baseline so the report can show this run's blocked calls
    var field = viewName === 'inside' ? 'inside' : viewName === 'mix' ? 'mix' : 'outside';
    function keyOf(n) { return _oaKey((n && (n.oaId || n.doi)) || ''); }
    function pri(a, b) { return (b.node.cites || 0) - (a.node.cites || 0) || (b.node.shared || 0) - (a.node.shared || 0); }

    var centerId = (centerKeys && centerKeys[0]) ? _oaId(centerKeys[0]) : null; // original case, for fetch
    var seen = {};
    (centerKeys || []).forEach(function (k) { if (k) seen[_oaKey(k)] = 'center'; });
    var stats = { expanded: 0, failed: 0, dups: 0, trims: 0, unique: 0, stopReason: null };
    var roots = [];
    var flat = [];      // flat deduped set of every unique paper in the tree
    var frontier = [];  // expandable tree nodes (depth < EXPAND_MAX_DEPTH)

    function addPick(node, depth, parentArr) {
      var k = keyOf(node);
      if (seen[k]) { stats.dups++; parentArr.push({ node: node, depth: depth, dup: true, children: [] }); return; }
      if (stats.unique >= EXPAND_BUDGET) { stats.trims++; parentArr.push({ node: node, depth: depth, trimmed: true, children: [] }); return; }
      seen[k] = 'd' + depth;
      stats.unique++;
      var tn = { node: node, depth: depth, children: [] };
      parentArr.push(tn);
      flat.push({ node: node, depth: depth });           // emit into the flat set once, on first sight
      if (depth < EXPAND_MAX_DEPTH) frontier.push(tn);
    }

    rootPicks.forEach(function (p) { addPick(p, 1, roots); });

    return new Promise(function (resolve) {
      var active = 0, finished = false;
      function finish() {
        if (finished) return;          // exactly-once: never open two modals / resolve twice
        finished = true;
        stats.seconds = (now() - t0) / 1000;
        if (!stats.stopReason) stats.stopReason = (stats.unique >= EXPAND_BUDGET) ? 'budget' : 'frontier-empty';
        // Resolve only when the REPORT is fully built (onDone), not when the
        // expansion finishes — otherwise the caller re-enables the button while
        // citations/foundational are still loading. resolve is passed as onDone.
        showExpansionModal(roots, flat, centerId, viewName, stats, onPhase, resolve);
      }
      function expand(tn) {
        active++;
        if (!tn.node.oaId) { stats.failed++; tn.err = 'no oaId'; active--; pump(); return; }
        buildData(tn.node.oaId, oaOnly).then(function (data) {
          tn.expanded = true;
          var nodes = (data[field] && data[field].nodes) || [];
          var picks = selectTopNodes(nodes);
          stats.expanded++;
          picks.forEach(function (c) { addPick(c, tn.depth + 1, tn.children); });
        }).catch(function (e) {
          stats.failed++; tn.err = String((e && e.message) || e);
        }).then(function () { active--; pump(); });
      }
      function pump() {
        if (stats.unique >= EXPAND_BUDGET && !stats.stopReason) stats.stopReason = 'budget';
        while (active < EXPAND_CONCURRENCY && frontier.length && stats.unique < EXPAND_BUDGET) {
          frontier.sort(pri);
          expand(frontier.shift());
        }
        if (active === 0 && (frontier.length === 0 || stats.unique >= EXPAND_BUDGET)) finish();
      }
      pump();
    });
  }

  // After expansion: build the two flat lists. Citations come straight from the
  // tree nodes (no fetch). Foundational references need every paper's full ref
  // list (+ the center as a voter) — one batch fetch — then a second batch to
  // resolve the top co-cited ids to titles.
  function buildNeighborhoodLists(flat, centerId, cb, onPhase) {
    // Membership set (lowercase) = the discovered papers + the center.
    var memberKey = {};
    flat.forEach(function (f) { if (f.node.oaId) memberKey[_oaKey(f.node.oaId)] = 1; });
    if (centerId) memberKey[_oaKey(centerId)] = 1;

    // List 1 — ranked by citations (papers we discovered; center added below).
    var citations = flat.map(function (f) {
      return { title: f.node.title, doi: f.node.doi || null, cites: f.node.cites || 0,
               tier: (f.node.tier && f.node.tier.label) || '?', level: f.depth, isCenter: false };
    });

    // Fetch refs (+ cites/title) for every discovered paper and the center.
    var fetchIds = [];
    flat.forEach(function (f) { if (f.node.oaId) fetchIds.push(_oaId(f.node.oaId)); });
    if (centerId) fetchIds.push(_oaId(centerId));

    // Fire the callback EXACTLY once. If the chain below throws anywhere (bad
    // data, a parse error, whatever), the .catch still emits with what we have
    // instead of leaving the modal stuck on "Building…" forever.
    var _emitted = false;
    function emit(res) { if (_emitted) return; _emitted = true; cb(res); }

    fetchWorksBatch(fetchIds, 'id,display_name,cited_by_count,referenced_works').then(function (works) {
      var voters = 0, freq = {};
      var centerWork = null;
      works.forEach(function (w) {
        if (centerId && _oaKey(w.id) === _oaKey(centerId)) centerWork = w;
        var refs = w.referenced_works || [];
        if (refs.length) voters++;
        refs.forEach(function (r) { var k = _oaKey(r); if (k) freq[k] = (freq[k] || 0) + 1; });
      });
      if (centerWork) {
        citations.push({ title: centerWork.display_name || '(center article)', doi: null,
                         cites: centerWork.cited_by_count || 0, tier: '\u2014', level: 0, isCenter: true });
      }
      citations.sort(function (a, b) { return (b.cites || 0) - (a.cites || 0); });

      // Co-cited reference ids: keep every reference cited by more than one
      // neighborhood paper (count > 1 = genuinely co-cited), then take the
      // FOUNDATIONAL_CANDIDATES most co-cited as the candidate pool. We resolve
      // these, rank by global citation count, and cut to FOUNDATIONAL_TOP below.
      var entries = Object.keys(freq).map(function (k) { return { key: k, count: freq[k] }; });
      entries.sort(function (a, b) { return b.count - a.count || (a.key < b.key ? -1 : 1); });
      var top = entries.filter(function (e) { return e.count > 1; }).slice(0, FOUNDATIONAL_CANDIDATES);

      // ── Resolve co-cited ids to titles (Options 1 + 2) ─────────────────────
      // Source titles from what we already hold in memory and hit OpenAlex only
      // for genuine first-time-seen refs:
      //   • Option 1 — neighborhood papers: title/doi/cites live on `flat`.
      //   • Option 2 — the session-wide _resolvedWorks map fed by every fetch.
      // freq keys are lowercased; OpenAlex ids are case-sensitive, so rebuild
      // original-case ids from the referenced_works we already pulled.
      var caseMap = {};
      works.forEach(function (w) { (w.referenced_works || []).forEach(function (r) { caseMap[_oaKey(r)] = _oaId(r); }); });

      // resolver: key -> { title, doi, cites }. Seed from flat nodes (Option 1).
      var resolver = {};
      flat.forEach(function (f) {
        var n = f.node; if (!n || !n.oaId) return;
        resolver[_oaKey(n.oaId)] = { title: n.title || null, doi: n.doi || null, cites: n.cites || 0 };
      });

      // Only ids missing from flat AND the session map need a network fetch.
      var misses = [];
      top.forEach(function (t) {
        if (resolver[t.key]) return;                              // Option 1 hit
        var mem = _resolvedWorks[t.key];
        if (mem && mem.title) { resolver[t.key] = mem; return; }  // Option 2 hit
        misses.push(caseMap[t.key] || t.key);
      });

      if (onPhase) onPhase('Building foundational references\u2026');
      return fetchWorksBatch(misses, 'id,doi,display_name,cited_by_count', { concurrency: 2, pauseMs: 200 }).then(function (rworks) {
        rworks.forEach(function (w) {
          var rdoi = w.doi ? String(w.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : null;
          resolver[_oaKey(w.id)] = { title: w.display_name || null, doi: rdoi, cites: w.cited_by_count || 0 };
          _rememberWork(w.id, w.display_name, rdoi, w.cited_by_count); // grow the session map
        });

        // Stragglers: top entries the batch still couldn't resolve — usually
        // heavily co-cited classics whose referenced_works id is a merged,
        // non-canonical record. Retry each via GET /works/{id}, which follows
        // the merge redirect the batch filter ignores.
        var stragglers = top.filter(function (t) { var r = resolver[t.key]; return !(r && r.title); })
                            .map(function (t) { return { key: t.key, id: caseMap[t.key] || t.key }; });

        return _mapPool(stragglers, 2, function (s) {
          return fetchWorkSingle(s.id).then(function (w) {
            if (!w) return;
            var rdoi = w.doi ? String(w.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : null;
            resolver[s.key] = { title: w.display_name || null, doi: rdoi, cites: w.cited_by_count || 0 };
            _rememberWork(w.id, w.display_name, rdoi, w.cited_by_count);
          });
        }).then(function () {
          // Build from resolved entries only. Anything still without a title
          // means OpenAlex genuinely doesn't know it — drop it rather than
          // showing "(unresolved)".
          var foundational = top
            .filter(function (t) { var r = resolver[t.key]; return r && r.title; })
            .map(function (t) {
              var r = resolver[t.key];
              return {
                count: t.count,                 // co-citation count (the relevance filter)
                title: r.title,
                doi: r.doi || null,
                cites: r.cites || 0,            // global citation count (the ranking key)
                inNeighborhood: !!memberKey[t.key]
              };
            });
          // Rank the resolved candidate pool by global citation count desc (ties:
          // the more co-cited one first), then cut to the final FOUNDATIONAL_TOP
          // and number 1..N over what remains.
          foundational.sort(function (a, b) { return (b.cites - a.cites) || (b.count - a.count); });
          foundational = foundational.slice(0, FOUNDATIONAL_TOP);
          foundational.forEach(function (row, i) { row.rank = i + 1; });
          emit({ citations: citations, foundational: foundational, voters: voters });
        });
      });
    }).catch(function (err) {
      try { console.error('[connections] neighborhood list build failed:', err); } catch (e) {}
      // Degrade gracefully: keep the citations list (from the tree, already in
      // hand) and let foundational fall back to empty rather than hanging.
      emit({ citations: citations, foundational: [], voters: 0 });
    });
  }

  function showExpansionModal(roots, flat, centerId, viewName, stats, onPhase, onDone) {
    var existing = document.getElementById('conn-l3-modal');
    if (existing) existing.remove();
    var viewLabel = viewName === 'inside' ? 'Inside (references)'
                  : viewName === 'mix'   ? 'Mix' : 'Outside (cited by)';
    var lists = null; // filled when buildNeighborhoodLists resolves

    function renderNode(tn) {
      var n = tn.node, pad = 8 + (tn.depth - 1) * 22, marker = '';
      if (tn.dup) marker = ' <span style="color:#c47f00;">(dup)</span>';
      else if (tn.trimmed) marker = ' <span style="color:#cc0000;">(budget-trimmed)</span>';
      else if (tn.err) marker = ' <span style="color:#cc0000;">(failed: ' + esc(tn.err) + ')</span>';
      else if (tn.depth < EXPAND_MAX_DEPTH && !tn.expanded) marker = ' <span style="color:#cc0000;">(not expanded \u2014 budget)</span>';
      else if (tn.expanded && !tn.children.length) marker = ' <span style="color:#9a978d;">(no picks)</span>';
      var meta = (n.cites || 0) + 'c \u00b7 ' + (n.shared || 0) + 's \u00b7 ' + ((n.tier && n.tier.label) || '?');
      var freeTag = n.isOa ? ' <span style="color:#3b6d11; font-weight:700;">FREE</span>' : '';
      var color = (tn.dup || tn.trimmed) ? '#b0ada4' : (tn.depth === 1 ? '#1a1a18' : '#444');
      var html = '<div style="padding:3px 0 3px ' + pad + 'px; font-size:12px; line-height:1.4; color:' + color + ';">' +
        '<span style="font-family:\'IBM Plex Mono\',monospace; color:#005a8c;">L' + tn.depth + '</span> ' +
        esc(truncate(n.title, 78)) + ' <span style="color:#9a978d;">[' + esc(meta) + ']</span>' + freeTag + marker + '</div>';
      for (var i = 0; i < tn.children.length; i++) html += renderNode(tn.children[i]);
      return html;
    }
    function sectionHead(t) { return '<div style="margin:18px 0 6px; font-size:13px; font-weight:600; color:#005a8c; border-top:1px solid #eee; padding-top:12px;">' + esc(t) + '</div>'; }
    function renderCitations(rows) {
      return rows.map(function (r, i) {
        return '<div style="padding:3px 0; font-size:12px; color:' + (r.isCenter ? '#005a8c' : '#333') + ';">' +
          '<span style="font-family:\'IBM Plex Mono\',monospace; color:#9a978d;">' + String(i + 1).padStart(2, '0') + '</span> ' +
          esc(truncate(r.title, 74)) + (r.isCenter ? ' <span style="color:#005a8c;">(center)</span>' : '') +
          ' <span style="color:#9a978d;">[' + (r.cites || 0) + ' cites \u00b7 ' + esc(r.tier) + ' \u00b7 L' + r.level + ']</span></div>';
      }).join('');
    }
    function renderFoundational(rows, voters) {
      if (!rows.length) return '<div style="color:#999; font-style:italic; font-size:12px;">No shared references found.</div>';
      return rows.map(function (r) {
        return '<div style="padding:3px 0; font-size:12px; color:#333;">' +
          '<span style="font-family:\'IBM Plex Mono\',monospace; color:#9a978d;">' + String(r.rank).padStart(2, '0') + '</span> ' +
          esc(truncate(r.title, 70)) +
          ' <span style="color:#005a8c;">[cited by ' + r.count + '/' + voters + ']</span>' +
          ' <span style="color:#666;">\u00b7 ' + (r.cites || 0).toLocaleString() + ' cites</span>' +
          (r.inNeighborhood ? ' <span style="color:#9a978d;">(in tree)</span>' : ' <span style="color:#c47f00;">(outside)</span>') +
          '</div>';
      }).join('');
    }

    var treeBody = roots.length ? roots.map(renderNode).join('')
      : '<div style="color:#999; font-style:italic; padding:10px 0;">No level-1 picks to expand.</div>';

    var overlay = document.createElement('div');
    overlay.id = 'conn-l3-modal';
    overlay.style.cssText = 'position:fixed; inset:0; z-index:10001; background:rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; padding:20px;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff; border:1.5px solid #005a8c; max-width:700px; width:100%; max-height:86vh; overflow-y:auto; padding:22px 24px; font-family:\'IBM Plex Sans\',sans-serif; box-shadow:0 4px 18px rgba(0,0,0,0.20);';
    box.innerHTML =
      '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">' +
        '<div style="font-size:16px; font-weight:600; color:#005a8c;">Multi-level expansion \u2014 ' + esc(viewLabel) + '</div>' +
        '<span id="conn-l3-close" role="button" tabindex="0" title="Close" style="cursor:pointer; color:#888; font-size:18px; line-height:1;">\u2715</span>' +
      '</div>' +
      '<div style="font-size:12px; color:#666; margin-bottom:4px;"><strong>' + stats.unique + '</strong> unique papers \u00b7 ' +
        stats.expanded + ' expanded \u00b7 ' + stats.dups + ' dup \u00b7 ' + stats.trims + ' trimmed' +
        (stats.failed ? ' \u00b7 <span style="color:#cc0000;">' + stats.failed + ' failed</span>' : '') +
        ' \u00b7 <strong>' + stats.seconds.toFixed(1) + 's</strong> \u00b7 stop: ' + esc(stats.stopReason) + '</div>' +
      '<div style="margin:8px 0 4px; padding:8px 11px; background:#fdf6e3; border-left:3px solid #c47f00; font-size:11.5px; line-height:1.45; color:#7a5200;">' +
        '<strong>Heads-up:</strong> each Expanded Analysis report makes many API calls. Running ~20+ a day can temporarily block your IP from the free data tier for the rest of the day \u2014 space them out if you\u2019re running several. The standard lookup and Connections chart should not reach any limits.' +
      '</div>' +
      '<div style="margin:8px 0;"><button id="conn-l3-export" disabled style="padding:6px 14px; border:1px solid #bbb; background:#f4f3ef; color:#999; cursor:default; font-family:\'IBM Plex Mono\',monospace; font-size:12px;">Export CSV (building lists\u2026)</button></div>' +
      sectionHead('Expansion tree') + treeBody +
      sectionHead('Ranked by citations') +
      '<div id="conn-l3-cites"><span style="color:#9a978d; font-size:12px;">Building\u2026</span></div>' +
      sectionHead('Foundational references (most co-cited across the neighborhood)') +
      '<div id="conn-l3-found"><span style="color:#9a978d; font-size:12px;">Building\u2026</span></div>' +
      '<div id="conn-l3-end" style="margin-top:16px; font-family:\'IBM Plex Mono\',monospace; font-size:12px; color:#9a978d;">end-\u2026</div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    var c = document.getElementById('conn-l3-close');
    if (c) c.addEventListener('click', close);

    // Build the two lists asynchronously, then fill the placeholders + enable export.
    if (onPhase) onPhase('Building citation ranking\u2026');
    buildNeighborhoodLists(flat, centerId, function (res) {
      try {
        lists = res;
        var cEl = document.getElementById('conn-l3-cites');
        var fEl = document.getElementById('conn-l3-found');
        if (cEl) cEl.innerHTML = renderCitations(res.citations);
        if (fEl) fEl.innerHTML = renderFoundational(res.foundational, res.voters);
        var endEl = document.getElementById('conn-l3-end');
        if (endEl) {
          var blocked = Math.max(0, _blockedApiCalls - _blockedAtRunStart);
          endEl.textContent = 'end-' + blocked;
          endEl.title = blocked + ' API call' + (blocked === 1 ? '' : 's') + ' looked rate-limited (HTTP 429) while building this report';
        }
        var ex = document.getElementById('conn-l3-export');
        if (ex) {
          ex.disabled = false;
          ex.textContent = 'Export CSV';
          ex.style.cssText = 'padding:6px 14px; border:1px solid #005a8c; background:#fff; color:#005a8c; cursor:pointer; font-family:\'IBM Plex Mono\',monospace; font-size:12px;';
          ex.addEventListener('click', function () { exportExpansionCsv(roots, lists, viewName, stats); });
        }
      } catch (e) {
        try { console.error('[connections] expansion report render failed:', e); } catch (e2) {}
      } finally {
        // Signal "report 100% done" exactly once, even if a render step threw —
        // so the trigger button is never left stuck in its disabled state.
        if (onDone) { try { onDone(); } catch (e3) {} }
      }
    }, onPhase);
  }

  // CSV with three labeled sections: tree, citations ranking, foundational refs.
  function exportExpansionCsv(roots, lists, viewName, stats) {
    function q(s) { s = String(s == null ? '' : s); return '"' + s.replace(/"/g, '""') + '"'; }
    var lines = [];
    lines.push('# Connections multi-level expansion');
    lines.push('# view,' + q(viewName) + ',unique_papers,' + stats.unique + ',expanded,' + stats.expanded + ',seconds,' + stats.seconds.toFixed(1) + ',stop,' + q(stats.stopReason));
    lines.push('');
    lines.push('## TREE');
    lines.push(['level', 'title', 'doi', 'citations', 'shared_with_parent', 'quality', 'free', 'status'].join(','));
    function status(tn) {
      if (tn.dup) return 'duplicate';
      if (tn.trimmed) return 'budget-trimmed';
      if (tn.err) return 'failed:' + tn.err;
      if (tn.depth < EXPAND_MAX_DEPTH && !tn.expanded) return 'not-expanded-budget';
      if (tn.expanded && !tn.children.length) return 'expanded-no-picks';
      return 'ok';
    }
    (function walk(arr) {
      arr.forEach(function (tn) {
        var n = tn.node;
        lines.push([tn.depth, q(n.title), q(n.doi || ''), (n.cites || 0), (n.shared || 0), q((n.tier && n.tier.label) || ''), (n.isOa ? 'yes' : 'no'), q(status(tn))].join(','));
        if (tn.children && tn.children.length) walk(tn.children);
      });
    })(roots);
    lines.push('');
    lines.push('## RANKED BY CITATIONS');
    lines.push(['rank', 'title', 'doi', 'citations', 'quality', 'found_at_level', 'is_center'].join(','));
    lists.citations.forEach(function (r, i) {
      lines.push([(i + 1), q(r.title), q(r.doi || ''), (r.cites || 0), q(r.tier), r.level, (r.isCenter ? 'yes' : 'no')].join(','));
    });
    lines.push('');
    lines.push('## FOUNDATIONAL REFERENCES');
    lines.push(['rank', 'title', 'doi', 'cited_by_n_of_' + lists.voters, 'own_citations', 'in_neighborhood'].join(','));
    lists.foundational.forEach(function (r) {
      lines.push([r.rank, q(r.title), q(r.doi || ''), r.count, (r.cites || 0), (r.inNeighborhood ? 'yes' : 'no')].join(','));
    });
    var csv = lines.join('\r\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'neighborhood-expansion-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  var SELECT = 'id,doi,display_name,publication_year,cited_by_count,primary_location,abstract_inverted_index,referenced_works,authorships,open_access,best_oa_location';

  function fetchCiters(workId, n, oaOnly) {
    var id = String(workId).toLowerCase().replace(/^https?:\/\/openalex\.org\//, '');
    var filter = 'cites:' + encodeURIComponent(id) + (oaOnly ? ',open_access.is_oa:true' : '');
    var url = OPENALEX + '?filter=' + filter + '&sort=cited_by_count:desc&per-page=' + n + '&select=' + SELECT + MAILTO_Q;
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('citers ' + r.status); return r.json(); })
      .then(function (d) { return { total: (d.meta && d.meta.count) || (d.results || []).length, nodes: (d.results || []).map(function (w) { return workToNode(w, 'out'); }) }; });
  }

  function fetchRefs(workId, n, oaOnly) {
    var id = String(workId).replace(/^https?:\/\/openalex\.org\//, '');
    return fetch(OPENALEX + '/' + id + '?select=referenced_works' + MAILTO_Q).then(function (r) { if (!r.ok) throw new Error('refs ' + r.status); return r.json(); })
      .then(function (d) {
        var refs = (d.referenced_works || []).map(function (u) { return u.replace('https://openalex.org/', ''); });
        if (!refs.length) return { total: 0, nodes: [], centerRefs: [] };
        var batch = refs.slice(0, 100);
        // centerRefs stays the FULL reference list (coupling needs every ref);
        // oaOnly only restricts which of the first 100 get resolved + shown.
        var filter = 'openalex_id:' + batch.join('|') + (oaOnly ? ',open_access.is_oa:true' : '');
        var url = OPENALEX + '?filter=' + filter + '&sort=cited_by_count:desc&per-page=' + n + '&select=' + SELECT + MAILTO_Q;
        return fetch(url).then(function (r2) { if (!r2.ok) throw new Error('ref-resolve ' + r2.status); return r2.json(); })
          .then(function (d2) {
            // In oaOnly mode the meaningful denominator is "free refs among the
            // resolvable first 100", which meta.count reports; otherwise it's the
            // article's full reference count.
            var total = oaOnly ? ((d2.meta && d2.meta.count) || (d2.results || []).length) : refs.length;
            return { total: total, nodes: (d2.results || []).map(function (w) { return workToNode(w, 'in'); }), centerRefs: refs };
          });
      });
  }

  // Resolve a list of shared-reference OpenAlex IDs to { oaId, doi, title }.
  // Used by the card when a user clicks the "N shared references" count.
  // Reuses the same batch-by-id OpenAlex filter pattern as fetchRefs above.
  function fetchSharedRefs(ids) {
    var clean = (ids || [])
      .map(function (u) { return String(u).replace(/^https?:\/\/openalex\.org\//, ''); })
      .filter(Boolean);
    if (!clean.length) return Promise.resolve([]);
    var batch = clean.slice(0, 100); // OpenAlex OR-filter cap
    var url = OPENALEX + '?filter=openalex_id:' + batch.join('|') +
              '&per-page=' + batch.length + '&select=id,doi,display_name' + MAILTO_Q;
    return fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('shared-refs ' + r.status); return r.json(); })
      .then(function (d) {
        return (d.results || []).map(function (w) {
          return {
            oaId: w.id ? String(w.id).replace('https://openalex.org/', '') : null,
            doi: w.doi ? String(w.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, '') : null,
            title: w.display_name || '(untitled)'
          };
        });
      });
  }

  function buildData(workId, oaOnly) {
    var key = SCACHE + (oaOnly ? 'oa:' : '') + String(workId).toLowerCase().replace(/^https?:\/\/openalex\.org\//, '');
    try { var c = sessionStorage.getItem(key); if (c) return Promise.resolve(JSON.parse(c)); } catch (e) {}
    // Ensure the SJR cache is loaded BEFORE building nodes — node tiers (and
    // thus bubble colors) are computed at build time via sjrForIssns, so if the
    // cache isn't ready every node bakes in a null/gray tier.
    var sjrReady = (typeof window.__loadSjrCache === 'function')
      ? window.__loadSjrCache().catch(function () { return null; })
      : Promise.resolve(null);
    return sjrReady.then(function () {
      return Promise.all([fetchCiters(workId, N_SINGLE, oaOnly), fetchRefs(workId, N_SINGLE, oaOnly)]);
    }).then(function (res) {
      var citers = res[0], refs = res[1];

      // Collect unique DOIs from both sides for the retraction batch check
      var dois = [];
      var seen = {};
      function add(arr) { arr.forEach(function (n) { if (n.doi && !seen[n.doi.toLowerCase()]) { seen[n.doi.toLowerCase()] = 1; dois.push(n.doi); } }); }
      add(citers.nodes); add(refs.nodes);

      var rcPromise = (window.RetractionCheck && window.RetractionCheck.checkBatch)
        ? window.RetractionCheck.checkBatch(dois)
        : Promise.resolve({});

      return rcPromise.then(function (rmap) {
        function mark(n) { n.retracted = !!(n.doi && rmap[n.doi]); return n; }
        citers.nodes.forEach(mark);
        refs.nodes.forEach(mark);

        // Bibliographic coupling: shared refs between each outer node and the
        // CENTER article. Computed once here so all views share the same value.
        var centerRefSet = {};
        (refs.centerRefs || []).forEach(function (r) { centerRefSet[r] = 1; });
        function countShared(node) {
          var list = node.refs || [], sharedList = [];
          for (var i = 0; i < list.length; i++) if (centerRefSet[list[i]]) sharedList.push(list[i]);
          node.shared = sharedList.length;
          // Keep ONLY the shared (overlapping) ref IDs — small, used by the
          // card to fetch+show shared references on demand. We still drop the
          // full `refs` list below, which can be huge.
          node.sharedRefs = sharedList;
          delete node.refs;
          return node;
        }
        citers.nodes.forEach(countShared);
        refs.nodes.forEach(countShared);

        // Mix built AFTER marking — same node objects, so retraction status carries over
        var mix = refs.nodes.slice(0, N_MIX_EACH).concat(citers.nodes.slice(0, N_MIX_EACH));
        var out = { outside: { total: citers.total, nodes: citers.nodes }, inside: { total: refs.total, nodes: refs.nodes }, mix: { nodes: mix } };
        try { sessionStorage.setItem(key, JSON.stringify(out)); } catch (e) {}
        return out;
      });
    });
  }

  function radiusFor(cites, maxCites) {
    var min = 9, max = 22;
    if (!maxCites || maxCites <= 0) return min;
    return Math.round(min + (Math.sqrt(cites) / Math.sqrt(maxCites)) * (max - min));
  }

  function renderGraph(nodes, centerStatus) {
    centerStatus = centerStatus || { retracted: false, concern: false };
    var hubFill, hubStroke, hubText, line1, line2;
    if (centerStatus.retracted) {
      hubFill = '#fbe9e9'; hubStroke = '#cc0000'; hubText = '#cc0000';
      line1 = 'RETRACTED'; line2 = '';
    } else if (centerStatus.concern) {
      hubFill = '#fff3d6'; hubStroke = '#b25c00'; hubText = '#a04a00';
      line1 = 'EXPRESSION'; line2 = 'OF CONCERN';
    } else {
      hubFill = '#B5D4F4'; hubStroke = '#185FA5'; hubText = '#0C447C';
      line1 = 'This'; line2 = 'article';
    }
    var W = 560, H = 560, cx = W / 2, cy = H / 2, ringR = 215, hubR = 44;
    var maxCites = nodes.reduce(function (m, n) { return Math.max(m, n.cites); }, 0);
    var p = [];
    p.push('<svg id="conn-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block; max-width:' + W + 'px; margin:0 auto; font-family:Arial,sans-serif;">');
    p.push('<defs>' +
      '<marker id="arrOut" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6 Z" fill="#9a978d"/></marker>' +
      '<marker id="arrIn" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6 Z" fill="#185FA5"/></marker>' +
      '<marker id="arrCoup" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6 Z" fill="#005a8c"/></marker>' +
      '</defs>');

    var pos = [];
    for (var i = 0; i < nodes.length; i++) {
      var ang = (-90 + (360 / nodes.length) * i) * Math.PI / 180;
      pos.push({ x: cx + ringR * Math.cos(ang), y: cy + ringR * Math.sin(ang) });
    }
    for (var a = 0; a < nodes.length; a++) {
      var n = nodes[a], pt = pos[a], r = radiusFor(n.cites, maxCites);
      var dx = pt.x - cx, dy = pt.y - cy, len = Math.sqrt(dx * dx + dy * dy), ux = dx / len, uy = dy / len;
      var hx = cx + ux * (hubR + 2), hy = cy + uy * (hubR + 2);
      var nx = pt.x - ux * (r + 4), ny = pt.y - uy * (r + 4);
      // Coupling-aware styling: any shared refs at all switches the spoke to
      // accent blue (#005a8c) so it "jumps out"; thickness gradient communicates
      // strength among coupled spokes. Uncoupled spokes stay at original colors.
      var shared = n.shared || 0;
      var coupled = shared >= 1;
      var sw, strokeColor, markerSuffix;
      if (coupled) {
        if (shared >= 6)      sw = 3.0;
        else if (shared >= 3) sw = 2.3;
        else                  sw = 1.7;
        strokeColor = '#005a8c';
        markerSuffix = 'Coup';
      } else {
        sw = 1;
        strokeColor = (n.direction === 'in') ? '#c9c6bc' : '#bcd2ea';
        markerSuffix = (n.direction === 'in') ? 'Out' : 'In';
      }
      // Hidden "halo" line drawn UNDER the spoke — shown on selection to create
      // a soft track effect that distinguishes selected from heavily-coupled spokes.
      // Always emit it; toggle visibility via the inline style attribute.
      if (n.direction === 'in')
        p.push('<line class="conn-halo" data-idx="' + a + '" x1="' + hx.toFixed(1) + '" y1="' + hy.toFixed(1) + '" x2="' + nx.toFixed(1) + '" y2="' + ny.toFixed(1) + '" stroke="#bcd2ea" stroke-width="7" stroke-linecap="round" style="display:none;"/>');
      else
        p.push('<line class="conn-halo" data-idx="' + a + '" x1="' + nx.toFixed(1) + '" y1="' + ny.toFixed(1) + '" x2="' + hx.toFixed(1) + '" y2="' + hy.toFixed(1) + '" stroke="#bcd2ea" stroke-width="7" stroke-linecap="round" style="display:none;"/>');
      if (n.direction === 'in')
        // reference: center → node
        p.push('<line class="conn-spoke" data-idx="' + a + '" data-shared="' + shared + '" data-natural-sw="' + sw + '" x1="' + hx.toFixed(1) + '" y1="' + hy.toFixed(1) + '" x2="' + nx.toFixed(1) + '" y2="' + ny.toFixed(1) + '" stroke="' + strokeColor + '" stroke-width="' + sw + '" marker-end="url(#arr' + markerSuffix + ')"/>');
      else
        // citer: node → center
        p.push('<line class="conn-spoke" data-idx="' + a + '" data-shared="' + shared + '" data-natural-sw="' + sw + '" x1="' + nx.toFixed(1) + '" y1="' + ny.toFixed(1) + '" x2="' + hx.toFixed(1) + '" y2="' + hy.toFixed(1) + '" stroke="' + strokeColor + '" stroke-width="' + sw + '" marker-end="url(#arr' + markerSuffix + ')"/>');
    }
    p.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + hubR + '" fill="' + hubFill + '" stroke="' + hubStroke + '" stroke-width="1.4"/>');
    if (line2) {
      p.push('<text x="' + cx + '" y="' + (cy - 3) + '" text-anchor="middle" font-size="11" font-weight="bold" fill="' + hubText + '">' + line1 + '</text>');
      p.push('<text x="' + cx + '" y="' + (cy + 11) + '" text-anchor="middle" font-size="11" font-weight="bold" fill="' + hubText + '">' + line2 + '</text>');
    } else {
      p.push('<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="12" font-weight="bold" fill="' + hubText + '">' + line1 + '</text>');
    }
    for (var j = 0; j < nodes.length; j++) {
      var nd = nodes[j], q = pos[j], rr = radiusFor(nd.cites, maxCites), fs = rr >= 14 ? 12 : 10;
      p.push('<g class="conn-node" data-idx="' + j + '" style="cursor:pointer;">');
      p.push('<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="' + rr + '" fill="' + nd.tier.fill + '" stroke="' + nd.tier.stroke + '" stroke-width="0.9"/>');
      p.push('<text x="' + q.x.toFixed(1) + '" y="' + (q.y + fs / 3).toFixed(1) + '" text-anchor="middle" font-size="' + fs + '" font-weight="bold" fill="' + nd.tier.text + '" style="pointer-events:none;">' + (j + 1) + '</text></g>');
    }
    p.push('</svg>');
    return p.join('');
  }

  function getAbstract(node) {
    if (node.abstract) return Promise.resolve({ text: node.abstract, src: 'OpenAlex' });
    if (node.doi && typeof _allResults !== 'undefined' && _allResults.length) {
      var hit = _allResults.find(function (r) { return (r.doiOrgDoi || r._doi || '').toLowerCase() === node.doi.toLowerCase(); });
      if (hit && (hit.pubmedAbstract || hit.raAbstract)) {
        var raw = (hit.pubmedAbstract || hit.raAbstract).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (raw) return Promise.resolve({ text: raw, src: 'cached lookup' });
      }
    }
    if (!node.doi) return Promise.resolve({ text: null, src: null });
    return liveAbstract(node.doi);
  }

  function liveAbstract(doi) {
    var tryPM = Promise.resolve(null);
    if (window.PubMedLookup && typeof window.PubMedLookup.fetchPubMedData === 'function') {
      tryPM = window.PubMedLookup.fetchPubMedData(doi).then(function (d) { return d && d.pubmedAbstract ? d.pubmedAbstract : null; }).catch(function () { return null; });
    }
    return tryPM.then(function (pm) {
      if (pm) return { text: pm.replace(/\s+/g, ' ').trim(), src: 'PubMed' };
      return fetch('https://api.crossref.org/works/' + encodeURIComponent(doi)).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var ab = j && j.message && j.message.abstract;
          if (ab) return { text: ab.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), src: 'Crossref' };
          return { text: null, src: null };
        }).catch(function () { return { text: null, src: null }; });
    });
  }

  function showDetail(node, favCtx, numLabel) {
    var el = document.getElementById('conn-detail');
    if (!el) return;
    var dirLabel = node.direction === 'in' ? 'Referenced by this article' : 'Cites this article';
    var numPrefix = numLabel ? '<span style="font-family:\'IBM Plex Mono\',monospace; margin-right:8px;">' + esc(numLabel) + '</span>' : '';
    var links = [];
    if (node.isOa && node.oaUrl) links.push('<a href="' + esc(node.oaUrl) + '" target="_blank" rel="noopener" style="color:#0f6e56; font-weight:600;">Free full text \u2192</a>');
    if (node.doi) links.push('<a href="https://doi.org/' + esc(node.doi) + '" target="_blank" rel="noopener" style="color:#005a8c;">View article (DOI) \u2192</a>');
    if (node.oaId) links.push('<a href="https://openalex.org/' + esc(node.oaId) + '" target="_blank" rel="noopener" style="color:#005a8c;">OpenAlex \u2192</a>');
    // "Make this center" — only meaningful if we have a DOI to navigate to,
    // and only relevant in real (panel-scoped) sessions where favCtx exists.
    var canMakeCenter = !!(favCtx && node.doi);
    var makeCenterBtn = canMakeCenter
      ? '<button class="conn-make-center-btn" data-doi="' + esc(node.doi) + '" style="font-family:\'IBM Plex Mono\',monospace; font-size:11px; padding:4px 10px; border:1px solid #005a8c; background:#fff; color:#005a8c; cursor:pointer; letter-spacing:0.3px;">Make this center</button>'
      : '';
    var retractedBadge = node.retracted
      ? '<span style="display:inline-block; background:#cc0000; color:#fff; font-size:9px; font-weight:700; letter-spacing:0.5px; padding:2px 7px; border-radius:3px; margin-right:8px; vertical-align:2px;">RETRACTED</span>'
      : '';
    var canFavorite = !!(favCtx && node.doi);
    var isFav = canFavorite && favCtx.isFav(node.doi);
    var heart = canFavorite
      ? '<button class="conn-fav-btn" data-doi="' + esc(node.doi) + '" title="' + (isFav ? 'Remove favorite' : 'Mark as favorite') + '" style="border:none; background:none; padding:0; margin-right:8px; cursor:pointer; vertical-align:-1px;">' + heartSvg(isFav, 18) + '</button>'
      : '';
    el.innerHTML =
      '<div style="font-size:11px; text-transform:uppercase; letter-spacing:0.6px; color:#9a978d; margin-bottom:6px;">' + numPrefix + dirLabel + '</div>' +
      '<div style="font-size:15px; font-weight:600; line-height:1.35; color:#1a1a18; margin-bottom:8px;">' + retractedBadge + oaBadge(node) + heart + esc(node.title) + '</div>' +
      '<div style="font-size:12px; color:#666; margin-bottom:4px;">' + esc(node.journal || '') + (node.year ? (node.journal ? ', ' : '') + node.year : '') + '</div>' +
      '<div style="font-size:12px; color:#666; margin-bottom:10px;">' + node.cites.toLocaleString() + ' citations &#183; <span style="color:' + node.tier.text + ';">' + node.tier.label + ' quality</span> &#183; ' + ((node.shared && node.shared > 0) ? '<span id="conn-shared-toggle" role="button" tabindex="0" style="color:#005a8c; cursor:pointer; text-decoration:underline;">' + node.shared + ' shared reference' + (node.shared === 1 ? '' : 's') + '</span>' : '<span>0 shared references</span>') + '</div>' +
      '<div id="conn-shared-list" style="display:none; margin:-4px 0 10px; font-size:12px;"></div>' +
      ((links.length || makeCenterBtn) ? '<div style="font-size:12px; margin-bottom:12px; display:flex; gap:14px; align-items:center; flex-wrap:wrap;">' + links.join('') + makeCenterBtn + '</div>' : '') +
      '<div style="border-top:1px solid #e5e2d9; padding-top:10px;"><div style="font-size:11px; text-transform:uppercase; letter-spacing:0.6px; color:#9a978d; margin-bottom:6px;">Abstract</div>' +
      '<div id="conn-abstract" style="font-size:13px; line-height:1.5; color:#333;">Loading\u2026</div></div>';
    // Wire the heart button to the favorites context (if applicable)
    if (canFavorite) {
      var btn = el.querySelector('.conn-fav-btn');
      if (btn) btn.addEventListener('click', function () { favCtx.toggle(node); });
    }
    if (canMakeCenter) {
      var mcBtn = el.querySelector('.conn-make-center-btn');
      if (mcBtn) mcBtn.addEventListener('click', function () { favCtx.makeCenter(node.doi, node.title); });
    }
    // Shared-references reveal: fetch DOI + title for the shared ref IDs on
    // first click, cache the result, toggle visibility on subsequent clicks.
    var shToggle = el.querySelector('#conn-shared-toggle');
    var shList = el.querySelector('#conn-shared-list');
    if (shToggle && shList) {
      var shLoaded = false, shLoading = false;
      var hideList = function () { shList.style.display = 'none'; };
      var closeHeader = '<div style="display:flex; justify-content:flex-end; margin-bottom:2px;">' +
        '<span id="conn-shared-close" role="button" tabindex="0" title="Close" style="cursor:pointer; color:#888; font-size:14px; line-height:1; padding:2px 4px;">\u2715</span></div>';
      var wireClose = function () {
        var x = shList.querySelector('#conn-shared-close');
        if (x) x.addEventListener('click', hideList);
      };
      var renderShared = function (items) {
        if (!items.length) {
          shList.innerHTML = closeHeader + '<span style="color:#999; font-style:italic;">No shared references found.</span>';
          wireClose();
          return;
        }
        var rows = items.map(function (it) {
          var doiHtml = it.doi
            ? '<a href="https://doi.org/' + encodeURIComponent(it.doi) + '" target="_blank" rel="noopener" style="color:#005a8c; font-family:monospace; text-decoration:none;">' + esc(it.doi) + '</a>'
            : '<span style="color:#999; font-style:italic;">no DOI</span>';
          return '<div style="padding:5px 0; border-bottom:1px solid #f0eee7; line-height:1.4;">' +
                   '<div style="color:#1a1a18;">' + esc(it.title) + '</div>' +
                   '<div style="margin-top:1px;">' + doiHtml + '</div>' +
                 '</div>';
        }).join('');
        shList.innerHTML = closeHeader + rows;
        wireClose();
      };
      shToggle.addEventListener('click', function () {
        if (shLoading) return;
        // Already loaded → just toggle visibility.
        if (shLoaded) {
          shList.style.display = (shList.style.display === 'none') ? 'block' : 'none';
          return;
        }
        shLoading = true;
        shList.style.display = 'block';
        shList.innerHTML = '<span style="color:#999;">Loading shared references\u2026</span>';
        fetchSharedRefs(node.sharedRefs || []).then(function (items) {
          shLoaded = true; shLoading = false;
          renderShared(items);
        }).catch(function () {
          shLoading = false;
          shList.innerHTML = '<span style="color:#b00; font-style:italic;">Could not load shared references. Try again.</span>';
        });
      });
    }
    getAbstract(node).then(function (res) {
      var ab = document.getElementById('conn-abstract');
      if (!ab) return;
      ab.innerHTML = res.text
        ? esc(res.text) + '<div style="font-size:10px; color:#bbb; margin-top:8px;">source: ' + esc(res.src) + '</div>'
        : '<span style="color:#999; font-style:italic;">No abstract available for this article.</span>';
    });
  }

  function openPanel(result, doi) {
    var existing = document.getElementById('conn-graph-panel');
    if (existing) existing.remove();
    var hTitle = result.doiOrgTitle || result.raTitle || result.pubmedTitle || 'Article';
    var hJournal = result.doiOrgJournal || result.raJournal || result.pubmedJournalFull || result.pubmedJournal || '';
    var hDate = result.doiOrgPublishedDate || result.raPublishedDate || result.doiOrgEarliestTimestamp || result.pubmedPublishDate || result.pubmedYear || '';
    var hMeta = [hJournal, hDate].filter(Boolean).join(' \u00b7 ');

    var panel = document.createElement('div');
    panel.id = 'conn-graph-panel';
    panel.style.cssText = 'margin:0 auto 16px; max-width:1040px; background:#fff; border:1.5px solid #005a8c; box-shadow:0 2px 12px rgba(0,0,0,0.12);';
    panel.innerHTML =
      '<div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid #e5e2d9; background:#f7f6f2;">' +
        '<span style="font-family:\'IBM Plex Sans\',sans-serif; font-weight:600; color:#005a8c;">Connections</span>' +
        '<button id="conn-close" style="border:none; background:none; font-size:18px; cursor:pointer; color:#888; line-height:1;">\u2715</button></div>' +
      '<div style="padding:14px 18px; border-bottom:1px solid #f0eee7;">' +
        '<div style="font-weight:600; font-size:14px; line-height:1.35;">' + esc(hTitle) + '</div>' +
        '<div style="font-size:12px; color:#666; margin-top:3px;">DOI ' + esc(doi) + (hMeta ? '  &#183;  ' + esc(hMeta) : '') + '</div>' +
        '<div id="conn-toggle" style="margin-top:12px; display:inline-flex; border:1px solid #d8d5cc; border-radius:4px; overflow:hidden; font-family:\'IBM Plex Mono\',monospace; font-size:12px;">' +
          '<button data-view="inside" class="conn-tab" style="padding:7px 14px; border:none; background:#fff; cursor:pointer;">Inside (refs)</button>' +
          '<button data-view="outside" class="conn-tab" style="padding:7px 14px; border:none; background:#005a8c; color:#fff; cursor:pointer;">Outside (cited by)</button>' +
          '<button data-view="mix" class="conn-tab" style="padding:7px 14px; border:none; background:#fff; cursor:pointer;">Mix</button></div>' +
        '<button id="conn-test-level3" title="Full multi-level expansion (budget + depth-3 + dedup)" style="margin-top:12px; margin-left:10px; padding:7px 14px; border:1px solid #005a8c; background:#fff; color:#005a8c; cursor:pointer; font-family:\'IBM Plex Mono\',monospace; font-size:12px; letter-spacing:0.3px; vertical-align:top;">Expanded Analysis</button>' +
        '<label id="conn-free-top-label" title="Show only articles that are free to read" style="margin-top:12px; margin-left:14px; display:inline-flex; align-items:center; gap:6px; font-family:\'IBM Plex Mono\',monospace; font-size:12px; font-weight:600; color:#0f6e56; cursor:pointer; user-select:none; vertical-align:top;">' +
          '<input type="checkbox" id="conn-free-toggle-top" style="margin:0; cursor:pointer; accent-color:#0f6e56;"> Free only' +
        '</label>' +
        '<button id="conn-copy-link" title="Copy a shareable link to this connections view" style="margin-top:12px; margin-left:14px; padding:7px 14px; border:1px solid #005a8c; background:#fff; color:#005a8c; cursor:pointer; font-family:\'IBM Plex Mono\',monospace; font-size:12px; letter-spacing:0.3px; vertical-align:top;">Copy link</button>' +
        '<span id="conn-copy-msg" style="display:none; margin-left:8px; margin-top:12px; vertical-align:top; line-height:30px; font-size:12px; color:#3b6d11; font-style:italic;"></span>' +
        '<div id="conn-viewinfo" style="font-size:12px; color:#888; margin-top:8px;"></div></div>' +
      '<div style="display:flex; flex-wrap:wrap; align-items:flex-start;">' +
        '<div id="conn-graphpane" style="flex:1 1 560px; min-width:320px; padding:14px;">' +
          '<div id="conn-status" style="font-size:13px; color:#666; padding:20px; text-align:center;">Loading citation data from OpenAlex\u2026</div>' +
          '<div id="conn-graphpane-inner" style="position:relative; background:#f6f9fc; border-radius:6px; padding:6px 0;">' +
            '<div id="conn-graphholder"></div>' +
            '<div id="conn-tip" style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:5; display:none; width:230px; background:#ffffff; color:#1a1a18; font-family:\'IBM Plex Sans\',sans-serif; font-size:12px; line-height:1.4; padding:9px 12px; border:1px solid #d8d5cc; border-radius:6px; pointer-events:none; box-shadow:0 3px 12px rgba(0,0,0,0.15); -webkit-font-smoothing:antialiased; text-align:left;"></div>' +
          '</div>' +
          '<div id="conn-legend" style="display:none; font-size:11px; color:#777; margin-top:6px; text-align:center;">Size=citations &#183; color=quality &#183; <span style="color:#185FA5;">\u2192 in</span>=cites this &#183; <span style="color:#9a978d;">\u2192 out</span>=referenced by this &#183; <span style="color:#005a8c;">blue spoke=shares references with this article</span></div></div>' +
        '<div id="conn-detail" style="flex:1 1 360px; min-width:300px; padding:18px; border-left:1px solid #f0eee7; min-height:300px;">' +
          '<div style="color:#999; font-size:13px; font-style:italic; padding-top:40px; text-align:center;">Click any bubble to see its details and abstract.</div></div></div>' +
      '<div id="conn-list-section" style="border-top:1px solid #f0eee7; padding:14px 18px;">' +
        '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; gap:14px; flex-wrap:wrap;">' +
          '<div style="font-size:11px; text-transform:uppercase; letter-spacing:0.6px; color:#9a978d;">Articles in this view</div>' +
          '<div style="display:flex; align-items:center; gap:14px; margin-left:auto;">' +
            '<label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#555; cursor:pointer; user-select:none;">' +
              '<input type="checkbox" id="conn-free-toggle" style="margin:0; cursor:pointer;"> Free only' +
            '</label>' +
            '<label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#555; cursor:pointer; user-select:none;">' +
              '<input type="checkbox" id="conn-fav-toggle" style="margin:0; cursor:pointer;"> Show favorites only' +
            '</label>' +
            '<button id="conn-export-csv" style="font-family:\'IBM Plex Mono\',monospace; font-size:11px; padding:5px 11px; border:1px solid #005a8c; background:#fff; color:#005a8c; cursor:pointer; letter-spacing:0.3px;">Export CSV</button>' +
            '<button id="conn-export-ris" style="font-family:\'IBM Plex Mono\',monospace; font-size:11px; padding:5px 11px; border:1px solid #005a8c; background:#fff; color:#005a8c; cursor:pointer; letter-spacing:0.3px;" title="For Zotero, Mendeley, EndNote, RefWorks">Export RIS</button>' +
            '<span id="conn-export-msg" style="font-size:11px; color:#9a978d; font-style:italic; display:none;"></span>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:11px; color:#9a978d; font-style:italic; margin-bottom:8px;">Favorites are temporary — they\'ll be cleared when this panel closes.</div>' +
        '<div id="conn-list" style="max-height:360px; overflow-y:auto; border:1px solid #ececec; border-radius:4px;"></div>' +
      '</div>';

    var resultsDiv = document.getElementById('results');
    if (resultsDiv && resultsDiv.firstChild) resultsDiv.insertBefore(panel, resultsDiv.firstChild);
    else if (resultsDiv) resultsDiv.appendChild(panel);
    else document.body.appendChild(panel);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    function close(fromPop) {
      panel.remove();
      document.removeEventListener('keydown', onKey);
      _activeClose = null;
      // If we pushed a history entry to open this panel, closing via X/Esc should
      // pop it so the URL reverts to the list. When close came FROM a Back press
      // (fromPop), the browser already popped — don't bounce again.
      if (_connPushed && !fromPop) { _connPushed = false; try { history.back(); } catch (e) {} }
      else { _connPushed = false; }
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    _activeClose = close;
    document.getElementById('conn-close').onclick = function () { close(); };
    document.addEventListener('keydown', onKey);

    var workId = result._openAlexWorkId || result._oaWorkId || null;
    if (!workId) { document.getElementById('conn-status').textContent = 'No OpenAlex record for this DOI — cannot build the report.'; return; }

    var DATA = null;
    var retractedRevealed = false;   // toggled by the "X retracted" link
    var currentSelected = null;       // the node currently shown in the right panel
    var visibleRows = [];             // populated by paint() — what export sees: [{node, num, isRetracted}, ...]
    // Favorites — in-memory, panel-scoped. favSet: quick membership lookup.
    // favRecords: full snapshot per fav for the eventual export.
    var favSet = {};
    var favRecords = {};
    var favoritesOnly = false;
    // "Free only" filter state. FREE_DATA is a second dataset (same shape as
    // DATA) holding the top free citers/refs, fetched lazily the first time the
    // toggle is switched on and then cached for the life of the panel.
    var freeOnly = false;
    var FREE_DATA = null;
    var freeLoading = false;

    function isFav(doi) { return doi && !!favSet[doi.toLowerCase()]; }
    function favRecord(node) {
      return {
        doi: node.doi, oaId: node.oaId, title: node.title, journal: node.journal,
        year: node.year, citations: node.cites, qualityLabel: node.tier.label,
        direction: node.direction, retracted: !!node.retracted,
        centerDoi: doi, favoritedAt: new Date().toISOString()
      };
    }
    function toggleFav(node) {
      if (!node.doi) return;
      var key = node.doi.toLowerCase();
      if (favSet[key]) { delete favSet[key]; delete favRecords[key]; }
      else { favSet[key] = true; favRecords[key] = favRecord(node); }
      paint(currentView);  // re-render list + right panel with new heart states
    }

    // Make-this-center: show a styled confirmation modal warning the user that
    // all current state will be lost, then navigate to a fresh Connections
    // session for the chosen DOI. Navigation reuses the existing share-link
    // infrastructure — same URL shape, same handler on page load.
    function makeCenter(targetDoi, targetTitle) {
      var url = _connectionsUrl(targetDoi);
      if (SHOW_MAKE_CENTER_WARNING) {
        showMakeCenterModal(targetTitle, url);
      } else {
        window.location.href = url;
      }
    }

    function showMakeCenterModal(targetTitle, targetUrl) {
      // Remove any existing modal first
      var existing = document.getElementById('conn-mc-modal');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.id = 'conn-mc-modal';
      overlay.style.cssText = 'position:fixed; inset:0; z-index:10001; background:rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; padding:20px;';

      var box = document.createElement('div');
      box.style.cssText = 'background:#fff; border:1.5px solid #005a8c; max-width:480px; width:100%; padding:22px 24px; font-family:\'IBM Plex Sans\',sans-serif; box-shadow:0 4px 18px rgba(0,0,0,0.20);';
      var truncated = truncate(targetTitle || 'this article', 80);
      box.innerHTML =
        '<div style="font-size:16px; font-weight:600; color:#005a8c; margin-bottom:12px; line-height:1.35;">Make this the new center?</div>' +
        '<div style="font-size:13px; color:#1a1a18; margin-bottom:8px; line-height:1.5;">You\'ll start a fresh Connections session for:</div>' +
        '<div style="font-size:13px; font-style:italic; color:#333; margin-bottom:14px; padding:8px 12px; background:#f6f9fc; border-left:2px solid #005a8c; line-height:1.4;">' + esc(truncated) + '</div>' +
        '<div style="font-size:13px; color:#1a1a18; line-height:1.5; margin-bottom:8px;">All current work \u2014 favorites, retraction reveal, and view selection \u2014 will be lost.</div>' +
        '<div style="font-size:13px; color:#cc0000; font-weight:600; margin-bottom:14px;">Export your favorites first if you need them.</div>' +
        '<div style="font-size:12px; color:#666; margin-bottom:18px; line-height:1.5;">Use your browser\'s back button to return to this chart afterward.</div>' +
        '<div style="display:flex; gap:10px; justify-content:flex-end;">' +
          '<button id="conn-mc-cancel" style="font-family:\'IBM Plex Mono\',monospace; font-size:12px; padding:7px 16px; border:1px solid #888; background:#fff; color:#444; cursor:pointer; letter-spacing:0.3px;">Cancel</button>' +
          '<button id="conn-mc-continue" style="font-family:\'IBM Plex Mono\',monospace; font-size:12px; padding:7px 16px; border:1px solid #005a8c; background:#005a8c; color:#fff; cursor:pointer; letter-spacing:0.3px;">Continue</button>' +
        '</div>';
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
      function onKey(e) { if (e.key === 'Escape') close(); }
      document.addEventListener('keydown', onKey);
      // Click outside the box closes (treats as cancel)
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
      document.getElementById('conn-mc-cancel').onclick = close;
      document.getElementById('conn-mc-continue').onclick = function () {
        window.location.href = targetUrl;
      };
    }

    var favCtx = { isFav: isFav, toggle: toggleFav, makeCenter: makeCenter };
    var currentView = 'outside';

    // ── Share link: one place that builds the URL so export and Copy-link agree ──
    // Uses the current page origin so it works on doilookup.com, github.io mirror,
    // and local previews without hard-coding the host.
    function buildShareLink() {
      return _connectionsUrl(doi);
    }

    // ── CSV export: rows = what's currently visible, columns include favorite flag ──
    function csvEscape(v) {
      if (v == null) return '';
      var s = String(v);
      // Quote if contains comma, quote, newline, or carriage return
      if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    function buildCsv() {
      var headers = ['#', 'Title', 'Authors', 'Journal', 'Year', 'Citations', 'Shared references', 'Quality', 'Direction', 'DOI', 'Article URL', 'Free', 'Retracted', 'Favorite', 'Center DOI', 'Connections link', 'Export date'];
      var lines = [headers.join(',')];
      // Single human-readable date for all rows in this export — text month avoids
      // US (MM/DD) vs EU (DD/MM) ambiguity when merging exports later.
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var d = new Date();
      var pad2 = function (n) { return n < 10 ? '0' + n : '' + n; };
      var exportDate = months[d.getMonth()] + '-' + pad2(d.getDate()) + '-' + d.getFullYear();
      var shareLink = buildShareLink();
      for (var i = 0; i < visibleRows.length; i++) {
        var r = visibleRows[i], n = r.node;
        var numLabel = r.isRetracted ? 'R' + r.num : String(r.num);
        var dirLabel = n.direction === 'in' ? 'Referenced by this article' : 'Cites this article';
        var url = n.doi ? 'https://doi.org/' + n.doi : '';
        var favKey = n.doi ? n.doi.toLowerCase() : '';
        var fav = favKey && favSet[favKey] ? 'Favorite' : '';
        var authors = (n.authors || []).join('; ');
        lines.push([
          numLabel, n.title || '', authors, n.journal || '', n.year || '',
          n.cites != null ? n.cites : '', n.shared != null ? n.shared : 0,
          n.tier ? n.tier.label : '',
          dirLabel, n.doi || '', url,
          n.isOa ? 'Yes' : 'No',
          n.retracted ? 'Yes' : 'No', fav, doi, shareLink, exportDate
        ].map(csvEscape).join(','));
      }
      return lines.join('\r\n');
    }
    function safeSlug(s) {
      return String(s || 'article').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'article';
    }
    function exportCsv() {
      var msg = document.getElementById('conn-export-msg');
      function flash(text) {
        if (!msg) return;
        msg.textContent = text; msg.style.display = 'inline';
        setTimeout(function () { msg.style.display = 'none'; }, 2400);
      }
      if (!visibleRows.length) { flash('Nothing to export.'); return; }
      var titleForName = result.doiOrgTitle || result.raTitle || result.pubmedTitle || 'article';
      var dateStr = new Date().toISOString().slice(0, 10);
      var filename = 'connections-' + safeSlug(titleForName) + '-' + dateStr + '.csv';
      var csv = buildCsv();
      // BOM helps Excel detect UTF-8 properly
      var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      flash('Exported ' + visibleRows.length + ' row' + (visibleRows.length === 1 ? '' : 's') + '.');
    }

    // ── RIS export for reference managers (Zotero, Mendeley, EndNote, RefWorks) ──
    // RIS is line-based: `TAG  - value`, with a blank line between records and ER
    // closing each one. Most fields map cleanly; we put extra context (retraction
    // status, shared-ref count, favorite flag) into N1 notes so they import as
    // a "Notes" field rather than being silently dropped.
    function buildRis() {
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var d = new Date();
      var pad2 = function (n) { return n < 10 ? '0' + n : '' + n; };
      var exportDate = months[d.getMonth()] + '-' + pad2(d.getDate()) + '-' + d.getFullYear();
      function tag(t, v) {
        if (v == null || v === '') return '';
        // RIS values shouldn't contain bare line breaks; collapse whitespace.
        var s = String(v).replace(/[\r\n]+/g, ' ').trim();
        return t + '  - ' + s + '\r\n';
      }
      var records = [];
      for (var i = 0; i < visibleRows.length; i++) {
        var r = visibleRows[i], n = r.node;
        var rec = '';
        rec += tag('TY', 'JOUR');
        rec += tag('TI', n.title);
        var authors = n.authors || [];
        for (var a = 0; a < authors.length; a++) rec += tag('AU', authors[a]);
        rec += tag('JF', n.journal);  // JF = journal name (full)
        rec += tag('PY', n.year);
        rec += tag('DO', n.doi);
        if (n.doi) rec += tag('UR', 'https://doi.org/' + n.doi);
        // Compact note bundling our extra context so it survives import.
        var noteParts = [];
        var numLabel = r.isRetracted ? 'R' + r.num : '#' + r.num;
        noteParts.push(numLabel + ' in Connections for ' + doi);
        noteParts.push(n.direction === 'in' ? 'Referenced by center article' : 'Cites center article');
        if (n.cites != null) noteParts.push(n.cites + ' citations');
        if (n.tier && n.tier.label) noteParts.push(n.tier.label + ' quality');
        if (n.shared != null) noteParts.push(n.shared + ' shared refs with center');
        if (n.isOa) noteParts.push('Free to read');
        if (n.retracted) noteParts.push('RETRACTED');
        var favKey = n.doi ? n.doi.toLowerCase() : '';
        if (favKey && favSet[favKey]) noteParts.push('Favorite');
        noteParts.push('Exported ' + exportDate);
        rec += tag('N1', noteParts.join(' | '));
        rec += 'ER  - \r\n';
        records.push(rec);
      }
      return records.join('\r\n');
    }
    function exportRis() {
      var msg = document.getElementById('conn-export-msg');
      function flash(text) {
        if (!msg) return;
        msg.textContent = text; msg.style.display = 'inline';
        setTimeout(function () { msg.style.display = 'none'; }, 2400);
      }
      if (!visibleRows.length) { flash('Nothing to export.'); return; }
      var titleForName = result.doiOrgTitle || result.raTitle || result.pubmedTitle || 'article';
      var dateStr = new Date().toISOString().slice(0, 10);
      var filename = 'connections-' + safeSlug(titleForName) + '-' + dateStr + '.ris';
      var ris = buildRis();
      var blob = new Blob([ris], { type: 'application/x-research-info-systems;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      flash('Exported ' + visibleRows.length + ' row' + (visibleRows.length === 1 ? '' : 's') + ' to RIS.');
    }

    // ── Copy share link: writes a doilookup.com URL to the clipboard ──
    function copyLink() {
      var msg = document.getElementById('conn-copy-msg');
      function flash(text) {
        if (!msg) return;
        msg.textContent = text; msg.style.display = 'inline';
        setTimeout(function () { msg.style.display = 'none'; }, 2400);
      }
      var link = buildShareLink();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(
          function () { flash('Link copied.'); },
          function () { fallback(); }
        );
      } else {
        fallback();
      }
      function fallback() {
        // Older browsers: select a hidden textarea, execCommand('copy')
        var ta = document.createElement('textarea');
        ta.value = link;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); flash('Link copied.'); }
        catch (e) { flash('Copy failed — long-press to copy: ' + link); }
        document.body.removeChild(ta);
      }
    }

    function renderListRow(node, num, isRetracted, isFavorited) {
      var dir = node.direction === 'in' ? 'Referenced by this article' : 'Cites this article';
      var dirColor = node.direction === 'in' ? '#7a7a73' : '#185FA5';
      var titleHref = node.doi ? 'https://doi.org/' + encodeURI(node.doi) : (node.oaId ? 'https://openalex.org/' + node.oaId : '#');
      var journalYear = node.journal && node.year ? node.journal + ', ' + node.year : (node.journal || (node.year ? String(node.year) : ''));
      var metaParts = [];
      if (journalYear) metaParts.push(esc(journalYear));
      metaParts.push(node.cites.toLocaleString() + ' citations');
      if (node.shared && node.shared > 0) {
        metaParts.push('<span style="color:#005a8c;">' + node.shared + ' shared reference' + (node.shared === 1 ? '' : 's') + '</span>');
      } else {
        metaParts.push('0 shared references');
      }
      var metaHtml = metaParts.join(' \u00b7 ');
      // Free-to-read marker at the end of the meta line (matches the detail badge).
      if (node.isOa) metaHtml += ' <span style="display:inline-block; background:#e3f1d4; color:#3b6d11; font-size:9px; font-weight:700; letter-spacing:0.5px; padding:1px 6px; border-radius:3px; margin-left:6px; vertical-align:1px;">FREE</span>';
      var retractedBadge = isRetracted
        ? '<span style="display:inline-block; background:#cc0000; color:#fff; font-size:9px; font-weight:700; letter-spacing:0.5px; padding:1px 6px; border-radius:3px; margin-right:8px; vertical-align:1px;">RETRACTED</span>'
        : '';
      var numLabel = isRetracted ? 'R' + num : String(num);
      var canFav = !!node.doi;
      var heartBtn = canFav
        ? '<button class="conn-fav-btn" data-doi="' + esc(node.doi) + '" title="' + (isFavorited ? 'Remove favorite' : 'Mark as favorite') + '" style="border:none; background:none; padding:0; margin:0 2px 0 0; cursor:pointer; line-height:1;">' + heartSvg(isFavorited, 15) + '</button>'
        : '<span style="display:inline-block; width:17px;"></span>';
      return '<div class="conn-row" data-idx="' + (isRetracted ? 'r' + num : num) + '" data-retracted="' + (isRetracted ? '1' : '0') + '" style="padding:10px 12px; border-bottom:1px solid #f0eee7; cursor:pointer; transition:background 0.12s;">' +
        '<div style="display:flex; align-items:baseline; gap:8px; line-height:1.35;">' +
          heartBtn +
          '<span style="font-family:\'IBM Plex Mono\',monospace; font-size:11px; color:#9a978d; min-width:22px;">' + numLabel + '</span>' +
          retractedBadge +
          '<span style="font-size:11px; color:' + dirColor + '; white-space:nowrap; font-weight:500;">' + dir + '</span>' +
          '<a href="' + esc(titleHref) + '" target="_blank" rel="noopener" class="conn-row-title" style="font-size:13px; color:#005a8c; text-decoration:none; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(node.title) + '</a>' +
        '</div>' +
        '<div style="font-size:11px; color:#888780; margin-top:3px; padding-left:30px;">' + metaHtml + '</div>' +
      '</div>';
    }

    function paint(view) {
      currentView = view;
      var info = document.getElementById('conn-viewinfo'), holder = document.getElementById('conn-graphholder');
      // When the "free only" filter is on, paint from the lazily-built free
      // dataset (top free citers/refs) instead of the default one. The "f"
      // adjective threads into the count labels so it's clear the set is filtered.
      var SRC = (freeOnly && FREE_DATA) ? FREE_DATA : DATA;
      var freeAdj = (freeOnly && FREE_DATA) ? 'free ' : '';
      var rawNodes, label;
      if (view === 'inside') {
        rawNodes = SRC.inside.nodes;
        var insideTotal = SRC.inside.total;
        if (insideTotal === 0)              label = 'No ' + freeAdj + 'references found in OpenAlex';
        else if (rawNodes.length >= insideTotal) label = 'Showing all ' + rawNodes.length + ' ' + freeAdj + 'reference' + (rawNodes.length === 1 ? '' : 's');
        else                                 label = insideTotal.toLocaleString() + ' ' + freeAdj + 'references \u2014 showing top ' + rawNodes.length + ' by citations';
      } else if (view === 'mix') {
        rawNodes = SRC.mix.nodes;
        // Recompute the split: Mix is up to 12 refs + 12 citers from the same underlying data
        var mixRefCount = 0, mixCiteCount = 0;
        for (var mi = 0; mi < rawNodes.length; mi++) {
          if (rawNodes[mi].direction === 'in') mixRefCount++; else mixCiteCount++;
        }
        if (rawNodes.length === 0)           label = 'No ' + freeAdj + 'references or citing articles found';
        else                                 label = 'Showing ' + mixRefCount + ' ' + freeAdj + 'reference' + (mixRefCount === 1 ? '' : 's') + ' + ' + mixCiteCount + ' ' + freeAdj + 'citing article' + (mixCiteCount === 1 ? '' : 's');
      } else {
        rawNodes = SRC.outside.nodes;
        var outsideTotal = SRC.outside.total;
        if (outsideTotal === 0)             label = 'No ' + freeAdj + 'articles cite this yet';
        else if (rawNodes.length >= outsideTotal) label = 'Showing all ' + rawNodes.length + ' ' + freeAdj + 'citing article' + (rawNodes.length === 1 ? '' : 's');
        else                                 label = outsideTotal.toLocaleString() + ' ' + freeAdj + 'articles cite this \u2014 showing top ' + rawNodes.length + ' by citations';
      }

      // Split raw into visible (non-retracted) and retracted
      var nodes = [], retractedNodes = [];
      for (var i = 0; i < rawNodes.length; i++) {
        if (rawNodes[i].retracted) retractedNodes.push(rawNodes[i]);
        else nodes.push(rawNodes[i]);
      }
      var retractedCount = retractedNodes.length;

      var retractedNoun;
      if (view === 'inside')      retractedNoun = 'retracted reference' + (retractedCount === 1 ? '' : 's');
      else if (view === 'mix')    retractedNoun = 'retracted in the graph';
      else                        retractedNoun = 'retracted citing article' + (retractedCount === 1 ? '' : 's');

      var retractLabelHTML;
      if (retractedCount > 0) {
        var linkText = retractedRevealed ? 'hide' : 'show';
        retractLabelHTML = '<a href="#" id="conn-retract-toggle" style="color:#005a8c; text-decoration:underline; cursor:pointer;">' + retractedCount + ' ' + esc(retractedNoun) + '</a> <span style="color:#9a978d;">(' + linkText + ')</span>';
      } else {
        retractLabelHTML = '<span style="color:#9a978d;">0 ' + esc(retractedNoun) + '</span>';
      }

      var leader = '';
      if (result._isRetracted)      leader = '<span style="color:#cc0000; font-weight:600;">This article is retracted.</span> ';
      else if (result._hasEOC)      leader = '<span style="color:#a04a00; font-weight:600;">This article has an Expression of Concern.</span> ';

      info.innerHTML = leader + esc(label) + ' \u00b7 ' + retractLabelHTML;

      var toggleEl = document.getElementById('conn-retract-toggle');
      if (toggleEl) toggleEl.addEventListener('click', function (e) {
        e.preventDefault(); retractedRevealed = !retractedRevealed; paint(view);
      });

      if (!nodes.length) {
        holder.innerHTML = '<div style="padding:30px; text-align:center; color:#999; font-style:italic;">' +
          (freeOnly ? 'No free-to-read articles found in this view.' : 'No data for this view.') + '</div>';
      } else {
        holder.innerHTML = renderGraph(nodes, { retracted: !!result._isRetracted, concern: !!result._hasEOC });
        document.getElementById('conn-legend').style.display = 'block';
      }

      // Build the list. Numbering is fixed per node (1..N for visible; R1..Rk
      // for retracted) — favorites-only just filters which rows are displayed,
      // it doesn't renumber.
      var listEl = document.getElementById('conn-list');
      var rows = '';
      var anyShown = false;
      visibleRows = [];                  // reset for this paint
      for (var j = 0; j < nodes.length; j++) {
        if (favoritesOnly && !isFav(nodes[j].doi)) continue;
        rows += renderListRow(nodes[j], j + 1, false, isFav(nodes[j].doi));
        visibleRows.push({ node: nodes[j], num: j + 1, isRetracted: false });
        anyShown = true;
      }
      if (retractedRevealed) for (var k = 0; k < retractedNodes.length; k++) {
        if (favoritesOnly && !isFav(retractedNodes[k].doi)) continue;
        rows += renderListRow(retractedNodes[k], k + 1, true, isFav(retractedNodes[k].doi));
        visibleRows.push({ node: retractedNodes[k], num: k + 1, isRetracted: true });
        anyShown = true;
      }
      if (!anyShown) {
        listEl.innerHTML = favoritesOnly
          ? '<div style="padding:20px; text-align:center; color:#999; font-style:italic; font-size:12px;">No favorites yet — click a <span style="color:#005a8c;">\u2665</span> to add one.</div>'
          : '<div style="padding:20px; text-align:center; color:#999; font-style:italic; font-size:12px;">No items.</div>';
      } else {
        listEl.innerHTML = rows;
      }

      // Unified selection: highlight bubble + spoke + row, show detail, auto-scroll right panel
      function select(node, listIdAttr, fromList) {
        currentSelected = node;
        holder.querySelectorAll('.conn-node circle').forEach(function (c) { c.setAttribute('stroke-width', '0.9'); });
        holder.querySelectorAll('.conn-spoke').forEach(function (s) { s.setAttribute('stroke-width', s.getAttribute('data-natural-sw') || '1'); });
        holder.querySelectorAll('.conn-halo').forEach(function (h) { h.style.display = 'none'; });
        listEl.querySelectorAll('.conn-row').forEach(function (r) { r.style.background = ''; });

        if (!node.retracted) {
          var graphIdx = nodes.indexOf(node);
          var g = holder.querySelector('.conn-node[data-idx="' + graphIdx + '"]');
          if (g) {
            var c = g.querySelector('circle'); if (c) c.setAttribute('stroke-width', '3');
            var sp = holder.querySelector('.conn-spoke[data-idx="' + graphIdx + '"]'); if (sp) sp.setAttribute('stroke-width', '3.6');
            var halo = holder.querySelector('.conn-halo[data-idx="' + graphIdx + '"]'); if (halo) halo.style.display = '';
          }
        }
        var row = listIdAttr ? listEl.querySelector('.conn-row[data-idx="' + listIdAttr + '"]') : null;
        if (row) row.style.background = '#eaf3fb';

        // listIdAttr is either "14" (normal) or "r3" (retracted) — format for display
        var displayNum = listIdAttr ? (listIdAttr.charAt(0) === 'r' ? 'R' + listIdAttr.slice(1) : '#' + listIdAttr) : '';
        showDetail(node, favCtx, displayNum);

        if (fromList) {
          var detail = document.getElementById('conn-detail');
          if (detail) detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      // Re-show currently selected article in the right panel after a re-paint
      // (e.g., after toggling a favorite), so the heart there updates too.
      if (currentSelected) {
        // Find the selected node in the *current* nodes/retracted arrays by DOI
        // (the references could be the same object, but matching by DOI is safer)
        var match = null, listId = null;
        for (var m = 0; m < nodes.length; m++) {
          if (nodes[m].doi && currentSelected.doi && nodes[m].doi.toLowerCase() === currentSelected.doi.toLowerCase()) { match = nodes[m]; listId = String(m + 1); break; }
        }
        if (!match) for (var rm = 0; rm < retractedNodes.length; rm++) {
          if (retractedNodes[rm].doi && currentSelected.doi && retractedNodes[rm].doi.toLowerCase() === currentSelected.doi.toLowerCase()) { match = retractedNodes[rm]; listId = 'r' + (rm + 1); break; }
        }
        if (match) {
          var displayNum2 = listId ? (listId.charAt(0) === 'r' ? 'R' + listId.slice(1) : '#' + listId) : '';
          showDetail(match, favCtx, displayNum2);
          var sRow = listEl.querySelector('.conn-row[data-idx="' + listId + '"]');
          if (sRow) sRow.style.background = '#eaf3fb';
          // Re-apply graph highlight too
          if (!match.retracted) {
            var gIdx = nodes.indexOf(match);
            var gEl = holder.querySelector('.conn-node[data-idx="' + gIdx + '"]');
            if (gEl) {
              var gC = gEl.querySelector('circle'); if (gC) gC.setAttribute('stroke-width', '3');
              var gSp = holder.querySelector('.conn-spoke[data-idx="' + gIdx + '"]'); if (gSp) gSp.setAttribute('stroke-width', '3.6');
              var gHalo = holder.querySelector('.conn-halo[data-idx="' + gIdx + '"]'); if (gHalo) gHalo.style.display = '';
            }
          }
        }
      }

      // Wire list rows
      listEl.querySelectorAll('.conn-row').forEach(function (row) {
        row.addEventListener('click', function (e) {
          // Heart buttons handle themselves; title link too
          if (e.target.closest('.conn-fav-btn') || e.target.closest('.conn-row-title')) return;
          var idAttr = row.getAttribute('data-idx');
          var isRetracted = row.getAttribute('data-retracted') === '1';
          var nodeRef;
          if (isRetracted) {
            var rIdx = parseInt(idAttr.slice(1), 10) - 1;
            nodeRef = retractedNodes[rIdx];
          } else {
            nodeRef = nodes[parseInt(idAttr, 10) - 1];
          }
          if (nodeRef) select(nodeRef, idAttr, true);
        });
        // subtle hover background
        row.addEventListener('mouseenter', function () { if (row.style.background !== 'rgb(234, 243, 251)') row.style.background = '#f7f6f2'; });
        row.addEventListener('mouseleave', function () { if (row.style.background === 'rgb(247, 246, 242)') row.style.background = ''; });
      });

      // Wire heart buttons (rows) — find by class, look up node by DOI, toggle.
      listEl.querySelectorAll('.conn-fav-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var btnDoi = btn.getAttribute('data-doi');
          if (!btnDoi) return;
          var key = btnDoi.toLowerCase();
          // Locate the node by DOI in either nodes or retractedNodes
          var n = null;
          for (var x = 0; x < nodes.length; x++) if (nodes[x].doi && nodes[x].doi.toLowerCase() === key) { n = nodes[x]; break; }
          if (!n) for (var rx = 0; rx < retractedNodes.length; rx++) if (retractedNodes[rx].doi && retractedNodes[rx].doi.toLowerCase() === key) { n = retractedNodes[rx]; break; }
          if (n) toggleFav(n);
        });
      });

      var tip = document.getElementById('conn-tip');
      var hoverTimer = null, tipShowing = false, activeIdx = null;
      function fillTip(node) {
        var journalYear = node.journal && node.year ? truncate(node.journal, 50) + ', ' + node.year
          : (node.journal ? truncate(node.journal, 50) : (node.year ? String(node.year) : ''));
        var jyLine = journalYear ? '<div style="font-size:11px; color:#888780; margin-top:3px;">' + esc(journalYear) + '</div>' : '';
        var sharedHtml = (node.shared && node.shared > 0)
          ? '<span style="color:#005a8c;">' + node.shared + ' shared reference' + (node.shared === 1 ? '' : 's') + '</span>'
          : '0 shared references';
        var citesShared = '<div style="font-size:11px; color:#888780; margin-top:3px;">' + node.cites.toLocaleString() + ' citations \u00b7 ' + sharedHtml + '</div>';
        tip.innerHTML = '<div style="font-weight:500; color:#1a1a18;">' + esc(truncate(node.title, 90)) + '</div>' + jyLine + citesShared;
      }
      function showTip() { tip.style.display = 'block'; tipShowing = true; }
      function hideTip() { tip.style.display = 'none'; tipShowing = false; }

      holder.querySelectorAll('.conn-node').forEach(function (g) {
        var idx = parseInt(g.getAttribute('data-idx'), 10);
        var circle = g.querySelector('circle');
        var baseStroke = circle.getAttribute('stroke');
        g.addEventListener('click', function () { select(nodes[idx], String(idx + 1), false); });
        g.addEventListener('mouseover', function () {
          activeIdx = idx;
          // bubble hover state: light ring (distinct from click's thick stroke)
          if (circle.getAttribute('stroke-width') !== '3') circle.setAttribute('stroke-width', '1.8');
          if (tipShowing) { fillTip(nodes[idx]); return; }
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(function () {
            if (activeIdx !== idx) return;
            fillTip(nodes[idx]); showTip();
          }, 300);
        });
        g.addEventListener('mouseout', function () {
          clearTimeout(hoverTimer);
          if (circle.getAttribute('stroke-width') !== '3') circle.setAttribute('stroke-width', '0.9');
          if (activeIdx === idx) activeIdx = null;
          setTimeout(function () { if (activeIdx === null) hideTip(); }, 10);
        });
      });
      document.querySelectorAll('.conn-tab').forEach(function (t) {
        var on = t.getAttribute('data-view') === view;
        t.style.background = on ? '#005a8c' : '#fff';
        t.style.color = on ? '#fff' : '#1a1a18';
      });
    }

    buildData(workId).then(function (data) {
      DATA = data;
      document.getElementById('conn-status').style.display = 'none';
      document.querySelectorAll('.conn-tab').forEach(function (t) { t.addEventListener('click', function () { paint(t.getAttribute('data-view')); }); });
      var favChk = document.getElementById('conn-fav-toggle');
      if (favChk) favChk.addEventListener('change', function () { favoritesOnly = favChk.checked; paint(currentView); });
      // "Free only" has two checkboxes — one on the view-tab line (always
      // visible) and one in the list section (visible after scrolling). Both
      // drive the same freeOnly state and FREE_DATA, and are kept in sync so
      // flipping either updates both.
      var freeChk = document.getElementById('conn-free-toggle');
      var freeChkTop = document.getElementById('conn-free-toggle-top');
      function syncFreeChecks(v) {
        if (freeChk) freeChk.checked = v;
        if (freeChkTop) freeChkTop.checked = v;
      }
      function setFreeDisabled(v) {
        if (freeChk) freeChk.disabled = v;
        if (freeChkTop) freeChkTop.disabled = v;
      }
      function applyFreeOnly(checked) {
        freeOnly = checked;
        syncFreeChecks(checked);
        // Off, or on with the free set already cached → just repaint.
        if (!freeOnly || FREE_DATA) { paint(currentView); return; }
        if (freeLoading) return;               // a fetch is already in flight
        freeLoading = true;
        setFreeDisabled(true);                 // both boxes locked during the one-time fetch
        var info = document.getElementById('conn-viewinfo');
        var holder = document.getElementById('conn-graphholder');
        if (info) info.textContent = 'Finding free papers\u2026';
        if (holder) holder.innerHTML = '<div style="padding:30px; text-align:center; color:#999; font-style:italic;">Finding free papers\u2026</div>';
        buildData(workId, true).then(function (fd) {
          FREE_DATA = fd; freeLoading = false; setFreeDisabled(false);
          paint(currentView);                  // boxes were locked, so freeOnly is still true
        }).catch(function () {
          freeLoading = false; setFreeDisabled(false);
          freeOnly = false; syncFreeChecks(false);
          if (info) info.textContent = 'Could not load free-article data \u2014 try again.';
          paint(currentView);
        });
      }
      if (freeChk) freeChk.addEventListener('change', function () { applyFreeOnly(freeChk.checked); });
      if (freeChkTop) freeChkTop.addEventListener('change', function () { applyFreeOnly(freeChkTop.checked); });
      var exportBtn = document.getElementById('conn-export-csv');
      if (exportBtn) exportBtn.addEventListener('click', exportCsv);
      var risBtn = document.getElementById('conn-export-ris');
      if (risBtn) risBtn.addEventListener('click', exportRis);
      var copyBtn = document.getElementById('conn-copy-link');
      if (copyBtn) copyBtn.addEventListener('click', copyLink);
      var l3Btn = document.getElementById('conn-test-level3');
      if (l3Btn) l3Btn.addEventListener('click', function () {
        if (l3Btn.disabled) return; // hard guard: ignore clicks while a run is active
        // Follow the "Free only" filter: seed from the free dataset and expand
        // the whole tree free. Foundational references stay full (computed
        // separately in showExpansionModal), by design.
        var useFree = freeOnly && !!FREE_DATA;
        var src = useFree ? FREE_DATA : DATA;
        var raw = currentView === 'inside' ? (src.inside && src.inside.nodes)
                : currentView === 'mix'    ? (src.mix && src.mix.nodes)
                :                            (src.outside && src.outside.nodes);
        var level1 = selectTopNodes(raw || []);
        var label = l3Btn.textContent;
        var settled = false, watchdog = null;
        function restore() {
          if (settled) return; settled = true;
          if (watchdog) { clearTimeout(watchdog); watchdog = null; }
          l3Btn.disabled = false; l3Btn.textContent = label; l3Btn.style.opacity = '1';
        }
        // Pure UI: update the button label as the run advances. Ignored once
        // settled, and never throws into the run.
        function onPhase(msg) { if (settled) return; try { l3Btn.textContent = msg; } catch (e) {} }
        l3Btn.disabled = true; l3Btn.style.opacity = '0.6';
        onPhase('Running tree\u2026');
        // Backstop: never leave the button stuck disabled, even if the report
        // somehow never signals completion.
        watchdog = setTimeout(restore, 60000);
        // Resolves only when the report is 100% built (see runExpansionTest).
        runExpansionTest(level1, currentView, [workId], onPhase, useFree).then(restore, restore);
      });
      paint('outside');
    }).catch(function (err) { document.getElementById('conn-status').textContent = 'Could not load citation data: ' + err.message; });
  }

  // Build the share/connections URL for a given DOI — same logic used elsewhere.
  // Preserves the current page's pathname so localhost previews (/index.html) and
  // GitHub project sites (/ref-lookup/) work, not just doilookup.com root.
  function _connectionsUrl(doi) {
    var origin = 'https://doilookup.com';
    var pathname = '/';
    try {
      var host = window.location.hostname.toLowerCase();
      if (host === 'doilookup.com' || host === 'www.doilookup.com' || host === 'localhost' || host === '127.0.0.1') {
        origin = window.location.origin;
        pathname = window.location.pathname || '/';
      }
    } catch (e) { /* fallback */ }
    return origin + pathname + '?doi=' + encodeURIComponent(doi) + '&connections=1';
  }

  function attachButton(result, doi) {
    setTimeout(function () {
      var cardId = 'card-' + String(doi).replace(/[^a-zA-Z0-9]/g, '-');
      var card = document.getElementById(cardId);
      if (!card || card.querySelector('.conn-graph-trigger')) return;
      var btn = document.createElement('button');
      btn.className = 'conn-graph-trigger';
      btn.textContent = 'View connections graph';
      btn.style.cssText = 'font-family:"IBM Plex Mono",monospace; font-size:12px; font-weight:600; padding:7px 14px; border:1px solid #005a8c; background:#fff; color:#005a8c; cursor:pointer; letter-spacing:0.3px;';
      btn.addEventListener('click', function () {
        // Open in place over the current cards (no reload, so a multi-DOI list
        // stays intact behind the panel) and push a shareable URL. Browser Back
        // then closes the panel and reveals the list again. A fresh visit to the
        // pushed URL still runs the reload + auto-open path below.
        if (document.getElementById('conn-graph-panel')) return;
        try { history.pushState({ connDoi: doi }, '', _connectionsUrl(doi)); _connPushed = true; } catch (e) { _connPushed = false; }
        openPanel(result, doi);
      });
      // Prefer the dedicated slot just below the DOI line; fall back to appending
      // to the card if the slot is missing (older card templates).
      var slot = card.querySelector('.conn-trigger-slot');
      if (slot) slot.appendChild(btn);
      else card.appendChild(btn);

      // If the URL requested the chart for this DOI (captured at load, before
      // index.html rewrote the URL), open it now.
      try {
        if (_autoOpenDoi && doi && _autoOpenDoi === doi.toLowerCase()) {
          if (!document.getElementById('conn-graph-panel')) openPanel(result, doi);
        }
      } catch (e) { /* ignore */ }
    }, 0);
  }

  window.ConnectionsGraph = { attachButton: attachButton, openPanel: openPanel };
})();