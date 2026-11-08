// retractionCheck.js — Focused retraction-status check for Connections.
// Crossref-only (Crossref ingests Retraction Watch), batch-friendly, returns
// a simple {doi: bool} map. Intentionally duplicated logic (not shared with
// lookup.js) to keep this module independent and easy to reason about.
//
// "Retracted" for our purposes = Crossref `updated-by` contains an entry whose
// type is 'retraction' OR 'expression-of-concern', or `update-to` does AND points
// at this same DOI (in-place retraction). An `update-to` pointing at ANOTHER DOI
// means this DOI is the notice, not a retracted paper. Corrections and other
// update types do NOT count as retracted.
//
// Public API:
//   window.RetractionCheck.checkBatch(doisArray)
//     → Promise<{ "10.x/y": true, "10.x/z": false, ... }>
// ============================================================================

(function () {
  'use strict';

  var CROSSREF = 'https://api.crossref.org/works/';
  var BLOCKED_TYPES = ['retraction', 'expression-of-concern'];
  var TIMEOUT_MS = 6000;            // per-DOI timeout, generous
  var CONCURRENCY = 3;              // parallel requests cap (CrossRef-friendly)
  var CACHE = {};                   // in-memory cache: doi → bool (confirmed only)
  var SKEY = 'retractionCheckCache';

  // Seed from sessionStorage so reloads (and repeat visits in the same session)
  // don't re-hit CrossRef for DOIs already confirmed this session.
  try {
    var _saved = sessionStorage.getItem(SKEY);
    if (_saved) {
      var _parsed = JSON.parse(_saved);
      if (_parsed && typeof _parsed === 'object') CACHE = _parsed;
    }
  } catch (e) { /* sessionStorage unavailable or corrupt — start empty */ }

  function _persistCache() {
    try { sessionStorage.setItem(SKEY, JSON.stringify(CACHE)); } catch (e) { /* quota/unavailable — in-memory still works */ }
  }

  // Distinct marker for "couldn't check" (timeout / network / non-ok / 429),
  // so callers can tell a real failure apart from a valid empty response.
  var FAILED = { __failed: true };

  // Fetch with timeout. Resolves parsed JSON on success, or FAILED on any
  // failure (timeout, network error, or non-ok status including 429).
  function fetchWithTimeout(url, ms) {
    return new Promise(function (resolve) {
      var t = setTimeout(function () { resolve(FAILED); }, ms);
      fetch(url).then(function (r) {
        clearTimeout(t);
        if (r && r.ok) { r.json().then(resolve).catch(function () { resolve(FAILED); }); }
        else { resolve(FAILED); }
      }).catch(function () { clearTimeout(t); resolve(FAILED); });
    });
  }

  // Decide retraction status from a Crossref work response.
  // updated-by: a notice points AT this DOI. update-to: this DOI is a notice for
  // the listed DOI, unless the listed DOI is this DOI (in-place retraction).
  // Same rule as lookup.js.
  function isRetractedFromCrossref(data) {
    var msg = data && data.message;
    if (!msg) return false;
    var own = String(msg.DOI || '').toLowerCase();
    var lists = [];
    if (Array.isArray(msg['update-to'])) lists.push({ arr: msg['update-to'], fromUpdateTo: true });
    if (Array.isArray(msg['updated-by'])) lists.push({ arr: msg['updated-by'], fromUpdateTo: false });
    for (var L = 0; L < lists.length; L++) {
      var arr = lists[L].arr;
      for (var i = 0; i < arr.length; i++) {
        if (lists[L].fromUpdateTo && String(arr[i].DOI || '').toLowerCase() !== own) continue; // this DOI is the notice
        var t = String(arr[i]['update-type'] || arr[i].type || '').toLowerCase();
        if (BLOCKED_TYPES.indexOf(t) !== -1) return true;
      }
    }
    return false;
  }

  // Check one DOI (with caching). Resolves true/false.
  // A failed check (FAILED) resolves false (treated as "no flag" by callers)
  // but is NOT cached, so a transient failure/429 doesn't get permanently
  // remembered as "not retracted" — it will be re-checked next time.
  function checkOne(doi) {
    if (!doi) return Promise.resolve(false);
    var key = String(doi).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CACHE, key)) return Promise.resolve(CACHE[key]);
    return fetchWithTimeout(CROSSREF + encodeURIComponent(key), TIMEOUT_MS).then(function (data) {
      if (data === FAILED) return false;            // couldn't check → no flag, don't cache
      var retracted = isRetractedFromCrossref(data); // confirmed answer
      CACHE[key] = retracted;
      _persistCache();
      return retracted;
    });
  }

  // Run an array of DOIs through checkOne with a concurrency cap.
  // Returns {doi: bool} map keyed by ORIGINAL (un-lowercased) DOI input.
  function checkBatch(dois) {
    if (!Array.isArray(dois) || !dois.length) return Promise.resolve({});
    var out = {};
    var queue = dois.slice();      // copy
    var inflight = 0;
    return new Promise(function (resolve) {
      function next() {
        if (queue.length === 0 && inflight === 0) { resolve(out); return; }
        while (inflight < CONCURRENCY && queue.length > 0) {
          var doi = queue.shift();
          inflight++;
          checkOne(doi).then(function (originalDoi, res) {
            out[originalDoi] = res;
            inflight--;
            next();
          }.bind(null, doi));
        }
      }
      next();
    });
  }

  window.RetractionCheck = { checkBatch: checkBatch, _cache: CACHE };
})();
