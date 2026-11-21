// citationBuilder.js - Citation formatting for Awesome DOI-Ref-Lookup
// Supports APA 7th, MLA 9th, Chicago 18th, AMA 11th, Vancouver/ICMJE, and RIS export
// Ver 1.1 Nov-2026. The formatters (sentence case .. generateRIS) are the
// Easy Cite extension's citation.js, unchanged except _knownWords below; keep the two in step.

// Where this script was loaded from, to find words.csv beside it
const CB_BASE = (document.currentScript && document.currentScript.src) || location.href;

// Sentence case: common English words from words.csv (lower case, one per line,
// # lines are its notice). Scientific words the list lacks still count when they
// are a prefix + a listed word, or end in a scientific suffix. Same rules as the
// extension's background.js.
const CB_WORD_EXTRA = new Set(['meta', 'dataset', 'datasets', 'microbiome', 'microbiomes', 'preprint', 'preprints', 'biobank', 'biobanks',
  'comorbidity', 'comorbidities', 'morbidities']);
const CB_NOT_WORDS = new Set(['microsoft', 'facebook', 'twitter']);
const CB_PREFIXES = ['anti', 'auto', 'bio', 'cardio', 'clinico', 'co', 'cyto', 'electro', 'endo', 'epi', 'extra',
  'gastro', 'hemato', 'haemato', 'hepato', 'histo', 'hyper', 'hypo', 'immuno', 'inter', 'intra', 'meta', 'micro',
  'multi', 'nano', 'nephro', 'neuro', 'non', 'onco', 'patho', 'peri', 'pharmaco', 'photo', 'physio', 'poly',
  'post', 'pre', 'pro', 'psycho', 'radio', 're', 'retro', 'semi', 'sub', 'super', 'trans', 'ultra', 'uni'];
const CB_SCI_SUFFIX = /(omics?|ology|ologies|itis|osis|oses|a?emia|ectomy|ectomies|cytes?|oids?|genic|genesis|pathy|pathies|plasty|scopy|kines?|ases?)$/;

function cbIsWord(w, set, depth = 0) {
  if (set.has(w) || CB_WORD_EXTRA.has(w)) return true;
  if (depth === 0 && w.length >= 7 && CB_SCI_SUFFIX.test(w)) return true;
  if (depth < 3) {
    for (const p of CB_PREFIXES) {
      if (w.startsWith(p) && w.length - p.length >= 3 && cbIsWord(w.slice(p.length), set, depth + 1)) return true;
    }
  }
  return false;
}

const CitationBuilder = {

  /**
   * Extract a structured data object from the result for citation formatting.
   * Gathers authors, title, journal, date, volume, issue, pages, DOI from all sources.
   */
  extractCiteData(result) {
    const data = {};

    data.doi = result.doiOrgDoi || null;
    data.title = result.doiOrgTitle || result.raTitle || result.pubmedTitle || '';
    data.journal = result.doiOrgJournal || result.raJournal || result.pubmedJournalFull || result.pubmedJournal || '';
    data.journalAbbrev = result.pubmedJournal || result.raShortJournal || data.journal || '';
    data.publisher = result.doiOrgPublisher || result.raPublisher || '';
    data.volume = result.doiOrgVolume || result.raVolume || result.pubmedVolume || '';
    data.issue = result.doiOrgIssue || result.raIssue || result.pubmedIssue || '';
    data.type = result.doiOrgType || result.raType || '';

    // Pages — from RA or PubMed
    const rawPages = result.doiOrgPages || result.raPage || result.pubmedPages || '';
    data.pages = rawPages;
    data.startPage = '';
    data.endPage = '';
    if (rawPages && /[-\u2013]/.test(rawPages)) {
      const parts = rawPages.split(/[-\u2013]/);
      data.startPage = parts[0].trim();
      data.endPage = parts[parts.length - 1].trim();
    } else if (rawPages) {
      data.startPage = rawPages.trim();
    }

    // Article number (e-locator) — CrossRef sometimes has this instead of pages
    data.articleNumber = result.raArticleNumber || '';

    // Date
    const dateStr = result.doiOrgPublishedDate || result.raPublishedOnline || result.raPublishedPrint || result.raIssued || result.pubmedPublishDate || '';
    data.dateRaw = dateStr;
    data.year = '';
    data.month = '';
    data.day = '';
    if (dateStr) {
      const parts = dateStr.split('-');
      data.year = parts[0] || '';
      if (parts[1]) data.month = parts[1];
      if (parts[2]) data.day = parts[2];
    }
    if (!data.year && result.pubmedYear) {
      data.year = result.pubmedYear;
    }
    // The issue's month for MLA and Chicago: print, then issued, then online (the order Zotero uses)
    const issueDate = [result.raPublishedPrint, result.raIssued, result.raPublishedOnline, result.doiOrgPublishedDate]
      .map(d => String(d || '').split('-')).find(p => p[0] && p[1]);
    data.issueMonth = issueDate && issueDate[0] === String(data.year) ? Number(issueDate[1]) : null;

    // PMID
    data.pmid = result.pubmedPMID || '';

    // Authors — parse from RA JSON (CrossRef/DataCite format)
    // Shape: [{ given, family, name, ORCID }, ...]
    data.authors = [];
    const authRaw = result.raAuthors || result.doiOrgAuthors || null;
    if (authRaw) {
      try {
        const arr = typeof authRaw === 'string' ? JSON.parse(authRaw) : authRaw;
        if (Array.isArray(arr)) {
          data.authors = arr.map(a => ({
            given: a.given || '',
            family: a.family || '',
            name: a.name || '',  // organizational author
          }));
        }
      } catch (e) { /* skip */ }
    }

    // Fallback to PubMed authors if RA had none
    if (data.authors.length === 0 && result.pubmedAuthorsAll && result.pubmedAuthorsAll.length > 0) {
      data.authors = result.pubmedAuthorsAll.map(a => ({
        given: a.foreName || a.initials || '',
        family: a.lastName || '',
        name: '',
      }));
    }

    // ISSN
    data.issn = '';
    const issnRaw = result.doiOrgIssn || result.raIssn || '';
    if (issnRaw) {
      try {
        const arr = typeof issnRaw === 'string' && issnRaw.startsWith('[') ? JSON.parse(issnRaw) : [issnRaw];
        data.issn = arr[0] || '';
      } catch (e) { data.issn = issnRaw; }
    }

    // ISBN (books and chapters) and editors, when the lookup has them
    data.isbn = '';
    try {
      const isbn = result.raIsbn && (typeof result.raIsbn === 'string' && result.raIsbn.startsWith('[') ? JSON.parse(result.raIsbn) : [result.raIsbn]);
      data.isbn = (isbn && isbn[0]) || '';
    } catch (e) { /* skip */ }
    data.editors = [];
    try {
      const eds = result.raEditors || result.doiOrgEditors || null;
      const arr = typeof eds === 'string' ? JSON.parse(eds) : eds;
      if (Array.isArray(arr)) data.editors = arr.map(a => ({ given: a.given || '', family: a.family || '', name: a.name || '' }));
    } catch (e) { /* skip */ }

    return data;
  },

  // ========================================================================
  // SENTENCE CASE (APA, AMA, Vancouver)
  // ========================================================================

  /**
   * When CrossRef gives the title in Title Case, set data.sentTitle to it in
   * sentence case. Only words on the bundled list of common English words
   * (words.csv, looked up by background.js) are lower-cased; a capitalised word
   * not on the list is probably a name (Alzheimer, Europe), so it keeps its
   * capital and goes in data.keptCaps for the note above the citations.
   * Acronyms and mixed case (DNA, mRNA, BNT162b2) are never touched, nor the
   * first word or the first word after a colon. A title already in sentence
   * case, or in all capitals, is left as it is. Any failure leaves the title.
   */
  async _sentenceCase(data) {
    const t = await this._toSentence(data.title || '');
    const kept = [];
    if (t) {
      data.sentTitle = t.apa;
      data.sentTitleNlm = t.nlm;
      kept.push(...t.kept);
    }
    // A chapter's book title too
    if (this._kind(data) === 'chapter' && data.journal) {
      const b = await this._toSentence(data.journal);
      if (b) {
        data.sentBook = b.apa;
        data.sentBookNlm = b.nlm;
        kept.push(...b.kept);
      }
    }
    if (kept.length) data.keptCaps = [...new Set(kept)];
  },

  /** Title Case text -> { apa, nlm, kept }, or null when it is not Title Case (see above) */
  _wordsPromise: null,

  /** The words (lower case) that count as ordinary English words. The website
   *  loads words.csv itself (the extension asks its background.js) */
  async _knownWords(words) {
    if (!this._wordsPromise) {
      this._wordsPromise = fetch(new URL('words.csv', CB_BASE))
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(t => new Set(t.split(/\r?\n/).filter(w => w && !w.startsWith('#'))));
      this._wordsPromise.catch(() => { this._wordsPromise = null; });
    }
    const set = await this._wordsPromise;
    return words.map(w => String(w).toLowerCase()).filter(w => !CB_NOT_WORDS.has(w) && cbIsWord(w, set));
  },

  async _toSentence(title) {
    const tokens = title.split(' ');
    // Each hyphen part of each word: { i, j, pre, core, post, start }
    const parts = [];
    let start = true;
    tokens.forEach((w, i) => {
      // A word with an acronym or mixed-case part is a name as a whole: EMPEROR-Reduced, COVID-Related
      const named = w.split('-').some(p => /[A-Z]/.test(p.replace(/^[^A-Za-z]*/, '').slice(1)));
      if (!named) w.split('-').forEach((p, j) => {
        const m = p.match(/^([^A-Za-z]*)([A-Za-z][A-Za-z']*?)('s|\u2019s)?([^A-Za-z]*)$/);
        if (m) parts.push({ i, j, pre: m[1], core: m[2], poss: m[3] || '', post: m[4], start: start && j === 0 });
      });
      start = /[:?!]$/.test(w);
    });
    // Names made of ordinary words keep their capitals: United States, World Health Organization
    const plain = tokens.map(w => w.toLowerCase().replace(/[^a-z]/g, ''));
    const keep = new Set();
    for (const name of this._NAMES) {
      const n = name.split(' ');
      for (let i = 0; i + n.length <= plain.length; i++) {
        if (n.every((x, k) => plain[i + k] === x)) n.forEach((x, k) => keep.add(i + k));
      }
    }
    const capWord = q => /^[A-Z][a-z]+$/.test(q.core);
    const simpleCap = q => capWord(q) && !keep.has(q.i);
    const cand = parts.filter(q => !q.start && (capWord(q) || /^[a-z]+$/.test(q.core)) && !this._MINOR.has(q.core.toLowerCase()));
    const capped = cand.filter(capWord);
    // Title Case: most words capitalised (one is enough in a short title: "Deep Learning")
    if (!capped.length || capped.length / cand.length < 0.6 || (capped.length < 2 && cand.length > 2)) return null;
    let known;
    try {
      known = await this._knownWords([...new Set(parts.filter(q => (!q.start || q.i > 0) && simpleCap(q)).map(q => q.core.toLowerCase()))]);
    } catch (e) { return null; }
    if (!Array.isArray(known)) return null;
    const knownSet = new Set(known);
    const kept = [];
    const out = tokens.map(w => w.split('-'));
    const outNlm = tokens.map(w => w.split('-'));   // AMA and NLM: subtitle in lower case too
    for (const q of parts) {
      // "A" opening a subtitle counts too (AMA, NLM: "…: a systematic review")
      if (!simpleCap(q) && !(q.core === 'A' && q.start && q.i > 0)) continue;
      const low = q.core.toLowerCase();
      const common = knownSet.has(low) || this._MINOR.has(low);
      if (q.start) {
        if (q.i > 0 && common) outNlm[q.i][q.j] = q.pre + low + q.poss + q.post;
        continue;
      }
      if (common) out[q.i][q.j] = outNlm[q.i][q.j] = q.pre + low + q.poss + q.post;
      else kept.push(q.core + q.poss);
    }
    return { apa: out.map(p => p.join('-')).join(' '), nlm: outNlm.map(p => p.join('-')).join(' '), kept };
  },

  // ========================================================================
  // BOOKS AND CHAPTERS
  // ========================================================================

  /** 'chapter' (a chapter, or a paper in proceedings), 'book', or 'article' (everything else) */
  _kind(data) {
    const t = data.type || '';
    if (['book-chapter', 'chapter', 'book-section', 'book-part', 'reference-entry',
      'proceedings-article', 'paper-conference', 'BookChapter', 'ConferencePaper'].includes(t)) return 'chapter';
    if (['book', 'monograph', 'edited-book', 'reference-book', 'book-set', 'Book'].includes(t)) return 'book';
    return 'article';
  },

  /** Publisher without the company ending: "Elsevier BV" -> "Elsevier" */
  _publisher(data) {
    let p = data.publisher || '';
    for (let k = 0; k < 2; k++) p = p.replace(/,?\s+(Inc\.?|LLC|Ltd\.?|Limited|BV|B\.V\.|GmbH|AG|S\.A\.|Co\.)$/i, '');
    return p.trim();
  },

  /** Editors as each style lists them, '' when CrossRef gives none */
  _editors(data, style) {
    const eds = (data.editors || []).map(a => this._authorDisplay(a)).filter(a => a.family);
    if (!eds.length) return '';
    const n = eds.length;
    const compact = g => (g || '').trim().split(/[\s-]+/).filter(Boolean).map(p => p[0].toUpperCase()).join('');
    if (style === 'apa') {
      const names = eds.map(a => { const i = this._initials(a.given); return i ? `${i} ${a.family}` : a.family; });
      const list = n === 1 ? names[0] : n === 2 ? `${names[0]} & ${names[1]}` : `${names.slice(0, -1).join(', ')}, & ${names[n - 1]}`;
      return `${list} (${n > 1 ? 'Eds.' : 'Ed.'}),`;
    }
    if (style === 'ama' || style === 'nlm') {
      const list = eds.map(a => { const i = compact(a.given); return i ? `${a.family} ${i}` : a.family; }).join(', ');
      return style === 'ama' ? `${list}, ${n > 1 ? 'eds' : 'ed'}.` : `${list}, ${n > 1 ? 'editors' : 'editor'}.`;
    }
    // MLA: "edited by First Last", "First Last and First Last", "First Last et al."
    const full = a => a.given ? `${a.given} ${a.family}` : a.family;
    return n === 1 ? full(eds[0]) : n === 2 ? `${full(eds[0])} and ${full(eds[1])}` : `${full(eds[0])} et al.`;
  },

  /** Italic title with the period outside the italics */
  _italicTitle(title) {
    const t = String(title).replace(/\.$/, '');
    return /[?!]$/.test(t) ? `<i>${t}</i>` : `<i>${t}</i>.`;
  },

  // ========================================================================
  // AUTHOR FORMATTING HELPERS
  // ========================================================================

  /** Get display name for an author — handles organizational authors */
  _authorDisplay(a) {
    if (a.family || a.given) return { given: a.given, family: a.family };
    if (a.name) return { given: '', family: a.name };
    return { given: '', family: '' };
  },

  /** Get initials from a given name: "Timothy J." → "T. J." */
  _initials(given) {
    if (!given) return '';
    // "Jean-Paul" keeps its hyphen: "J.-P." (APA)
    return given.trim().split(/\s+/).map(w => w.split('-').map(p => {
      if (!p) return '';
      // Already an initial like "J." or "J" (not a short name like "Yi")
      if (p.length === 1) return p + '.';
      if (p.endsWith('.')) return p;
      return p[0].toUpperCase() + '.';
    }).filter(Boolean).join('-')).filter(Boolean).join(' ');
  },

  /** Get first initial only: "Timothy J." → "T." */
  _firstInitial(given) {
    if (!given) return '';
    const first = given.trim().split(/[\s-]+/)[0];
    if (!first) return '';
    if (first.length === 1) return first + '.';
    if (first.endsWith('.')) return first;
    return first[0].toUpperCase() + '.';
  },

  // ========================================================================
  // PAGE AND TITLE HELPERS
  // ========================================================================

  /** "221-230" (hyphen or en dash) -> ["221", "230"]; a single page -> ["221", ""] */
  _range(p) {
    const parts = String(p || '').split(/\s*[-\u2013\u2014]\s*/).filter(Boolean);
    return [parts[0] || '', parts.length > 1 ? parts[parts.length - 1] : ''];
  },

  /** { pages } or { article }. Pages typed in the popup always count as pages. An
   *  article number that CrossRef also gives as the page (Elsevier, PLOS, ...) is
   *  an article number, not a page. */
  _locator(data, overridePages) {
    // The Pages box starts filled with data.pages: only a change is an override
    if (overridePages && overridePages !== data.pages) return { pages: overridePages };
    const art = data.articleNumber, pg = data.pages;
    if (art && (!pg || pg === art)) return { article: art };
    // A single "page" that is really an article number with none given:
    // PLOS e0120513, or the number the DOI ends with (MDPI nu12020334 -> 334)
    if (pg && !/[-\u2013]/.test(pg)) {
      // The DOI ends in the number, after a 0 or a non-digit (not 1234 for page 234)
      const tail = /^\d{3,}$/.test(pg) && new RegExp('(^|\\D|0)' + pg + '$').test(String(data.doi || ''));
      if (/^e\d+$/i.test(pg) || tail) {
        return { article: pg };
      }
    }
    return { pages: pg || '' };
  },

  /** Shorten the last page: minKeep 1 drops every repeated leading digit (NLM:
   *  123-30, 1111-6); minKeep 2 keeps at least two digits, and the whole number
   *  below 100 (MLA: 115-18, 1003-05, 1395-401, 21-32) */
  _shortRange(a, b, minKeep) {
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b) || a.length !== b.length || Number(b) <= Number(a)) return b;
    if (minKeep === 2 && Number(a) < 100) return b;
    let i = 0;
    while (i < a.length - 1 && a[i] === b[i]) i++;
    return b.slice(Math.min(i, b.length - minKeep));
  },

  /** Chicago's last page (CMOS 9.64): in full below 100 and after a multiple of
   *  100 (100-104); only what changes after x01-x09 (101-8, 1103-4); otherwise
   *  at least two digits (321-28, 1087-89, 11564-615), but all four when three
   *  of four digits change (1496-1500) */
  _chicagoRange(a, b) {
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b) || a.length !== b.length || Number(b) <= Number(a)) return b;
    const n = Number(a);
    if (n < 100 || n % 100 === 0) return b;
    const short = this._shortRange(a, b, n % 100 < 10 ? 1 : 2);
    if (a.length === 4 && short.length >= 3) return b;
    return short;
  },

  /** A page or page range as the style writes it: APA en dash, NLM and MLA
   *  shortened, AMA in full */
  _pages(p, style) {
    const [a, b] = this._range(p);
    if (!b) return a;
    if (style === 'apa') return `${a}\u2013${b}`;
    if (style === 'nlm') return `${a}-${this._shortRange(a, b, 1)}`;
    if (style === 'mla') return `${a}-${this._shortRange(a, b, 2)}`;
    if (style === 'chicago') return `${a}\u2013${this._chicagoRange(a, b)}`;
    return `${a}-${b}`;
  },

  /** Journal abbreviation without periods (AMA, NLM): "N. Engl. J. Med." -> "N Engl J Med" */
  _abbrevNoDots(j) {
    return String(j || '').replace(/\.(?=\s|$)/g, '').trim();
  },

  _NAMES: ['united states', 'united kingdom', 'united nations', 'new york', 'new zealand', 'new england',
    'new south wales', 'south africa', 'south korea', 'north korea', 'north america', 'south america',
    'central america', 'latin america', 'middle east', 'hong kong', 'saudi arabia', 'great britain',
    'european union', 'world health organization', 'world war', 'national health service',
    'national institutes of health', 'food and drug administration', 'centers for disease control',
    'veterans affairs', 'native american', 'native americans', 'first nations', 'west africa',
    'east africa', 'southeast asia', 'south asia', 'east asia', 'puerto rico', 'costa rica', 'sri lanka',
    'el salvador', 'sierra leone', 'ivory coast', 'cape town', 'los angeles', 'san francisco'],

  _MINOR: new Set(('a an the and but or nor for so yet as at by in of off on onto per to up via vs ' +
    'from into with over upon than').split(' ')),

  /** MLA title case: every word capitalised except articles, prepositions and
   *  conjunctions, which stay lower case unless first, last or after a colon.
   *  Words with a capital after their first letter (DNA, mRNA, eBioMedicine)
   *  are left as they are. */
  _titleCase(s) {
    const words = String(s).split(' ');
    let start = true;
    return words.map((w, i) => {
      const last = i === words.length - 1;
      const out = w.split('-').map((part, j) => {
        const m = part.match(/^([^A-Za-z]*)([A-Za-z].*)$/);
        if (!m) return part;
        const pre = m[1], word = m[2];
        if (/[A-Z]/.test(word.slice(1))) return part;
        const core = word.toLowerCase().replace(/[^a-z]+$/, '');
        if (!start && !last && j === 0 && this._MINOR.has(core)) return pre + word.toLowerCase();
        return pre + word[0].toUpperCase() + word.slice(1);
      }).join('-');
      start = /[:?!]$/.test(w) || /^[\u2013\u2014]$/.test(w);
      return out;
    }).join(' ');
  },

  // ========================================================================
  // APA 7th Edition
  // ========================================================================
  // Author, A. A., & Author, B. B. (Year). Title of article. Journal Name, Volume(Issue), pages. https://doi.org/xx
  // - Up to 20 authors listed; 21+ use first 19 ... last author
  // - Journal name italicised, volume italicised

  formatAPA(data, overridePages) {
    const loc = this._locator(data, overridePages);
    let parts = [];
    // An author list ending in an initial ("Shu, Y.") already has its period
    const endDot = s => s.endsWith('.') ? s : s + '.';

    // Authors
    const auths = data.authors.map(a => {
      const d = this._authorDisplay(a);
      if (!d.family) return '';
      const init = this._initials(d.given);
      return init ? `${d.family}, ${init}` : d.family;
    }).filter(Boolean);

    // The title, as APA writes it
    let title = '';
    if (data.title) {
      title = data.sentTitle || data.title;
      // APA capitalises the first word after a colon, ? or ! (the subtitle)
      title = title.replace(/([:?!]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
      // Ensure ends with period
      if (!title.endsWith('.') && !title.endsWith('?') && !title.endsWith('!')) title += '.';
    }

    if (auths.length === 0) {
      // No author: the title takes the author's place (and is not repeated)
      if (title) parts.push(title);
    } else if (auths.length === 1) {
      parts.push(endDot(auths[0]));
    } else if (auths.length <= 20) {
      const last = auths.pop();
      parts.push(auths.join(', ') + ', & ' + endDot(last));
    } else {
      // 21+ authors: first 19 ... last
      const first19 = auths.slice(0, 19);
      const last = auths[auths.length - 1];
      parts.push(first19.join(', ') + ', . . . ' + endDot(last));
    }

    // Year
    parts.push(`(${data.year || 'n.d.'}).`);

    // Title (sentence case, no italics; a book's in italics), after the year when there are authors
    const kind = this._kind(data);
    if (title && kind === 'book') title = this._italicTitle(title);
    if (title && auths.length > 0) parts.push(title);

    const pub = this._publisher(data);
    if (kind === 'chapter') {
      // In E. Editor (Ed.), Book title (pp. 1–10). Publisher.
      let book = (data.sentBook || data.journal || '').replace(/([:?!]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
      const eds = this._editors(data, 'apa');
      let inPart = 'In ' + (eds ? eds + ' ' : '') + (book ? `<i>${this._escHtml(book)}</i>` : '');
      if (loc.pages) {
        const pg = this._pages(loc.pages, 'apa');
        inPart += ` (${/\u2013/.test(pg) ? 'pp.' : 'p.'} ${pg})`;
      }
      parts.push(inPart + '.');
      if (pub) parts.push(pub + '.');
    } else if (kind === 'book') {
      if (pub) parts.push(pub + '.');
    }

    // Journal (italic), Volume(Issue), pages
    let journalPart = '';
    if (kind === 'article' && data.journal) {
      journalPart = `<i>${this._escHtml(data.journal)}</i>`;
      if (data.volume) {
        journalPart += `, <i>${this._escHtml(data.volume)}</i>`;
        if (data.issue) journalPart += `(${this._escHtml(data.issue)})`;
      }
      if (loc.pages) {
        journalPart += `, ${this._pages(loc.pages, 'apa')}`;
      } else if (loc.article) {
        journalPart += `, Article ${loc.article}`;
      }
      journalPart += '.';
    }
    if (journalPart) parts.push(journalPart);

    // DOI
    if (data.doi) {
      parts.push(`https://doi.org/${data.doi}`);
    }

    return { html: parts.join(' '), plain: this._stripHtml(parts.join(' ')) };
  },

  // ========================================================================
  // AMA 11th Edition
  // ========================================================================
  // Author AA, Author BB. Title. Journal Abbrev. Year;Volume(Issue):pages. doi:xx
  // - Up to 6 authors; 7+ use first 3 et al
  // - Journal abbreviated, not italicised

  formatAMA(data, overridePages) {
    const loc = this._locator(data, overridePages);
    let parts = [];

    // Authors — initials without periods/spaces: "Timothy J." → "TJ"
    const amaInitials = (given) => {
      if (!given) return '';
      return given.trim().split(/[\s-]+/).map(p => {
        if (!p) return '';
        return p[0].toUpperCase();
      }).join('');
    };

    const auths = data.authors.map(a => {
      const d = this._authorDisplay(a);
      if (!d.family) return '';
      const init = amaInitials(d.given);
      return init ? `${d.family} ${init}` : d.family;
    }).filter(Boolean);

    if (auths.length === 0) {
      // no authors
    } else if (auths.length <= 6) {
      parts.push(auths.join(', ') + '.');
    } else {
      parts.push(auths.slice(0, 3).join(', ') + ', et al.');
    }

    // Title
    if (data.title) {
      let title = data.sentTitleNlm || data.title;
      if (!title.endsWith('.') && !title.endsWith('?') && !title.endsWith('!')) title += '.';
      // A whole book: title in italics and title case (AMA)
      if (this._kind(data) === 'book') title = this._italicTitle(this._titleCase(data.title));
      parts.push(title);
    }

    const kind = this._kind(data);
    const pub = this._publisher(data);
    if (kind === 'chapter') {
      // In: Editor AB, ed. Book Title. Publisher; Year:pages.
      const eds = this._editors(data, 'ama');
      let inPart = 'In: ' + (eds ? eds + ' ' : '') + (data.journal ? this._italicTitle(this._titleCase(data.journal)) + ' ' : '');
      inPart += (pub ? pub + '; ' : '') + (data.year || '');
      if (loc.pages) inPart += ':' + this._pages(loc.pages, 'ama');
      parts.push(inPart + '.');
    } else if (kind === 'book') {
      parts.push((pub ? pub + '; ' : '') + (data.year || '') + '.');
    }

    // Journal (abbreviated), year, volume, issue, pages
    let journalPart = '';
    if (kind === 'article' && (data.journalAbbrev || data.journal)) {
      journalPart = `<i>${this._escHtml(this._abbrevNoDots(data.journalAbbrev || data.journal))}</i>.`;
      if (data.year) {
        journalPart += ` ${data.year}`;
      }
      if (data.volume) {
        journalPart += `;${data.volume}`;
        if (data.issue) journalPart += `(${this._escHtml(data.issue)})`;
      }
      if (loc.pages) {
        journalPart += `:${this._pages(loc.pages, 'ama')}`;
      } else if (loc.article) {
        journalPart += `:${loc.article}`;
      }
      journalPart += '.';
    }
    if (journalPart) parts.push(journalPart);

    // DOI
    if (data.doi) {
      parts.push(`doi:${data.doi}`);
    }

    return { html: parts.join(' '), plain: this._stripHtml(parts.join(' ')) };
  },

  // ========================================================================
  // MLA 9th Edition
  // ========================================================================
  // Author. "Title." Journal, vol. V, no. I, Year, pp. X–Y. DOI link.
  // - 1 author: Last, First.
  // - 2 authors: Last, First, and First Last.
  // - 3+: Last, First, et al.

  formatMLA(data, overridePages) {
    const loc = this._locator(data, overridePages);
    let parts = [];

    // Authors
    const auths = data.authors.map(a => this._authorDisplay(a)).filter(a => a.family);

    // "Last, First" (inverted) or "First Last"; an organisation is its name alone
    const nm = (a, inverted) => !a.given ? a.family : inverted ? `${a.family}, ${a.given}` : `${a.given} ${a.family}`;
    const endDot = s => s.endsWith('.') ? s : s + '.';
    if (auths.length === 0) {
      // no authors
    } else if (auths.length === 1) {
      parts.push(endDot(nm(auths[0], true)));
    } else if (auths.length === 2) {
      parts.push(endDot(`${nm(auths[0], true)}, and ${nm(auths[1], false)}`));
    } else {
      parts.push(`${nm(auths[0], true)}, et al.`);
    }

    // Title in quotes
    if (data.title) {
      let title = this._titleCase(data.title);
      // Remove trailing period for quoting; a ? or ! ends the title on its own
      if (title.endsWith('.')) title = title.slice(0, -1);
      if (this._kind(data) === 'book') parts.push(this._italicTitle(title));   // a whole book: italics
      else parts.push(/[?!]$/.test(title) ? `\u201c${title}\u201d` : `\u201c${title}.\u201d`);
    }

    // Journal (italic), vol., no., year, pp. — a chapter: Book, edited by ..., Publisher, year, pp.
    const kind = this._kind(data);
    let journalParts = [];
    if (data.journal && kind !== 'book') {
      journalParts.push(`<i>${this._escHtml(kind === 'chapter' ? this._titleCase(data.journal) : data.journal)}</i>`);
    }
    if (kind !== 'article') {
      const eds = this._editors(data, 'mla');
      if (eds && kind === 'chapter') journalParts.push(`edited by ${eds}`);
    }
    if (data.volume) journalParts.push(`vol. ${data.volume}`);
    if (data.issue) journalParts.push(`no. ${data.issue}`);
    if (kind !== 'article' && this._publisher(data)) journalParts.push(this._publisher(data));
    // A journal article's date is month and year (Aug. 2025); a book's is the year
    const MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
    const mon = kind === 'article' && data.issueMonth >= 1 && data.issueMonth <= 12 ? MONTHS[data.issueMonth - 1] + ' ' : '';
    if (data.year) journalParts.push(mon + data.year);
    if (loc.pages) {
      const pg = this._pages(loc.pages, 'mla');
      journalParts.push((pg.includes('-') ? 'pp. ' : 'p. ') + pg);
    }
    // An article number is left out (MLA 9)
    if (journalParts.length > 0) {
      parts.push(journalParts.join(', ') + '.');
    }

    // DOI as URL, ending the entry with a period
    if (data.doi) {
      parts.push(`https://doi.org/${data.doi}.`);
    }

    return { html: parts.join(' '), plain: this._stripHtml(parts.join(' ')) };
  },

  // ========================================================================
  // Chicago 18th Edition — notes-bibliography style, bibliography entry
  // ========================================================================
  // Last, First, and First Last. "Title." Journal 10, no. 4 (2015): 1–10. https://doi.org/xx.
  // - 1–6 authors listed; 7+ use the first three et al.
  // - Chapter: "Title." In Book, edited by First Last, 568–85. Publisher, 2020.
  // - Book: Title (italics). Publisher, 2016.

  formatChicago(data, overridePages) {
    const loc = this._locator(data, overridePages);
    const kind = this._kind(data);
    const pub = this._publisher(data);
    let parts = [];

    // Authors: the first inverted, the rest "First Last"
    const auths = data.authors.map(a => this._authorDisplay(a)).filter(a => a.family);
    const nm = (a, inverted) => !a.given ? a.family : inverted ? `${a.family}, ${a.given}` : `${a.given} ${a.family}`;
    const endDot = s => s.endsWith('.') ? s : s + '.';
    if (auths.length === 1) {
      parts.push(endDot(nm(auths[0], true)));
    } else if (auths.length >= 2 && auths.length <= 6) {
      const names = auths.map((a, i) => nm(a, i === 0));
      const last = names.pop();
      parts.push(endDot(`${names.join(', ')}, and ${last}`));
    } else if (auths.length > 6) {
      parts.push(`${auths.slice(0, 3).map((a, i) => nm(a, i === 0)).join(', ')}, et al.`);
    }

    // Title: headline case, in quotes (a book's in italics)
    if (data.title) {
      let title = this._titleCase(data.title);
      if (title.endsWith('.')) title = title.slice(0, -1);
      if (kind === 'book') parts.push(this._italicTitle(title));
      else parts.push(/[?!]$/.test(title) ? `\u201c${title}\u201d` : `\u201c${title}.\u201d`);
    }

    const pg = loc.pages ? this._pages(loc.pages, 'chicago') : (loc.article || '');
    if (kind === 'chapter') {
      const eds = this._editors(data, 'mla');   // "First Last and First Last", "First Last et al."
      let inPart = 'In ' + (data.journal ? `<i>${this._escHtml(this._titleCase(data.journal))}</i>` : '');
      if (eds) inPart += `, edited by ${eds}`;
      if (pg) inPart += `, ${pg}`;
      parts.push(inPart + '.');
      parts.push([pub, data.year].filter(Boolean).join(', ') + '.');
    } else if (kind === 'book') {
      parts.push([pub, data.year].filter(Boolean).join(', ') + '.');
    } else {
      // Journal Volume, no. Issue (Year): pages.
      let j = data.journal ? `<i>${this._escHtml(data.journal)}</i>` : '';
      if (data.volume) j += ` ${this._escHtml(data.volume)}`;
      if (data.issue) j += `, no. ${this._escHtml(data.issue)}`;
      // The issue's month when known, spelled out: (August 2025)
      const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
        'September', 'October', 'November', 'December'];
      const mon = data.issueMonth >= 1 && data.issueMonth <= 12 ? MONTHS[data.issueMonth - 1] + ' ' : '';
      if (data.year) j += ` (${mon}${data.year})`;
      if (pg) j += `: ${pg}`;
      if (j) parts.push(j.trim() + '.');
    }

    if (data.doi) parts.push(`https://doi.org/${data.doi}.`);

    return { html: parts.join(' '), plain: this._stripHtml(parts.join(' ')) };
  },

  // ========================================================================
  // Vancouver / ICMJE
  // ========================================================================
  // Author AA, Author BB. Title. Journal Abbrev. Year;Vol(Issue):pages. doi:xx
  // - Up to 6 authors; 7+ use first 6 et al
  // - Very similar to AMA but slightly different author cutoff

  formatVancouver(data, overridePages) {
    const loc = this._locator(data, overridePages);
    let parts = [];

    // Authors — initials without periods: "Timothy J." → "TJ"
    const vanInitials = (given) => {
      if (!given) return '';
      return given.trim().split(/[\s-]+/).map(p => {
        if (!p) return '';
        return p[0].toUpperCase();
      }).join('');
    };

    const auths = data.authors.map(a => {
      const d = this._authorDisplay(a);
      if (!d.family) return '';
      const init = vanInitials(d.given);
      return init ? `${d.family} ${init}` : d.family;
    }).filter(Boolean);

    if (auths.length === 0) {
      // no authors
    } else if (auths.length <= 6) {
      parts.push(auths.join(', ') + '.');
    } else {
      parts.push(auths.slice(0, 6).join(', ') + ', et al.');
    }

    // Title
    if (data.title) {
      let title = data.sentTitleNlm || data.title;
      if (!title.endsWith('.') && !title.endsWith('?') && !title.endsWith('!')) title += '.';
      parts.push(title);
    }

    const kind = this._kind(data);
    const pub = this._publisher(data);
    if (kind === 'chapter') {
      // In: Editor AB, editor. Book title. Publisher; Year. p. 1-10.
      const eds = this._editors(data, 'nlm');
      const book = data.sentBookNlm || data.journal || '';
      let inPart = 'In: ' + (eds ? eds + ' ' : '') + (book ? book.replace(/\.$/, '') + '. ' : '');
      inPart += (pub ? pub + '; ' : '') + (data.year || '') + '.';
      if (loc.pages) inPart += ' p. ' + this._pages(loc.pages, 'nlm') + '.';
      parts.push(inPart);
    } else if (kind === 'book') {
      parts.push((pub ? pub + '; ' : '') + (data.year || '') + '.');
    }

    // Journal (abbreviated)
    let journalPart = '';
    if (kind === 'article' && (data.journalAbbrev || data.journal)) {
      journalPart = this._abbrevNoDots(data.journalAbbrev || data.journal) + '.';
      if (data.year) {
        journalPart += ` ${data.year}`;
      }
      if (data.volume) {
        journalPart += `;${data.volume}`;
        if (data.issue) journalPart += `(${this._escHtml(data.issue)})`;
      }
      if (loc.pages) {
        journalPart += `:${this._pages(loc.pages, 'nlm')}`;
      } else if (loc.article) {
        journalPart += `:${loc.article}`;
      }
      journalPart += '.';
    }
    if (journalPart) parts.push(journalPart);

    // DOI
    if (data.doi) {
      parts.push(`doi:${data.doi}`);
    }

    return { html: parts.join(' '), plain: this._stripHtml(parts.join(' ')) };
  },

  // ========================================================================
  // RIS Export
  // ========================================================================

  generateRIS(data, overridePages) {
    const loc = this._locator(data, overridePages);
    const lines = [];

    // Type
    const typeMap = {
      'journal-article': 'JOUR',
      'book-chapter': 'CHAP',
      'book': 'BOOK',
      'proceedings-article': 'CPAPER',
      'dataset': 'DATA',
      'dissertation': 'THES',
      'preprint': 'JOUR',
      // doi.org CSL-JSON type names
      'article-journal': 'JOUR',
      'article': 'JOUR',
      'chapter': 'CHAP',
      'paper-conference': 'CPAPER',
      'thesis': 'THES',
      'report': 'RPRT',
    };
    const ty = typeMap[data.type] || 'JOUR';
    lines.push(`TY  - ${ty}`);

    // Authors
    data.authors.forEach(a => {
      const d = this._authorDisplay(a);
      if (d.family) {
        lines.push(`AU  - ${d.given ? `${d.family}, ${d.given}` : d.family}`);
      }
    });

    // Title
    if (data.title) lines.push(`TI  - ${data.title}`);

    // Journal
    // A chapter's book or a paper's proceedings goes in T2, a journal in JO
    if (data.journal) lines.push(`${ty === 'CHAP' || ty === 'CPAPER' ? 'T2' : 'JO'}  - ${data.journal}`);
    // Editors (A2: the book's editors)
    (data.editors || []).forEach(a => {
      const d = this._authorDisplay(a);
      if (d.family) lines.push(`A2  - ${d.given ? `${d.family}, ${d.given}` : d.family}`);
    });
    if (ty === 'JOUR' && data.journalAbbrev && data.journalAbbrev !== data.journal) {
      lines.push(`JA  - ${data.journalAbbrev}`);
    }

    // Year / Date
    if (data.year) lines.push(`PY  - ${data.year}`);
    if (data.year) lines.push(`DA  - ${data.year}/${data.month}/${data.day}/`);   // RIS: YYYY/MM/DD/

    // Volume, Issue
    if (data.volume) lines.push(`VL  - ${data.volume}`);
    if (data.issue) lines.push(`IS  - ${data.issue}`);

    // Pages
    const [sp, ep] = loc.pages ? this._range(loc.pages) : [loc.article || '', ''];
    if (sp) lines.push(`SP  - ${sp}`);
    if (ep) lines.push(`EP  - ${ep}`);

    // DOI
    if (data.doi) lines.push(`DO  - ${data.doi}`);

    // PMID
    if (data.pmid) lines.push(`AN  - ${data.pmid}`);

    // Publisher
    if (data.publisher) lines.push(`PB  - ${data.publisher}`);

    // ISBN for a book or chapter, else ISSN
    const sn = this._kind(data) !== 'article' && data.isbn ? data.isbn : data.issn;
    if (sn) lines.push(`SN  - ${sn}`);

    // URL
    if (data.doi) lines.push(`UR  - https://doi.org/${data.doi}`);

    lines.push('ER  - ');
    return lines.join('\r\n');
  },


  // ========================================================================
  // MODAL
  // ========================================================================

  /**
   * Show the citation modal for a given result object.
   * Called from the "Cite" link on the DOI line.
   */
  showCiteModal(result) {
    // Remove existing modal
    const existing = document.getElementById('cite-modal');
    if (existing) existing.remove();

    const data = this.extractCiteData(result);

    // Pre-fill pages from data
    const currentPages = data.pages || '';

    // Build inline panel (no dark overlay — renders in-page)
    const overlay = document.createElement('div');
    overlay.id = 'cite-modal';
    overlay.style.cssText = 'margin:0 auto 16px; max-width:720px;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:#fff; width:100%; border:1.5px solid #005a8c; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 2px 10px rgba(0,0,0,0.10);';

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'padding:14px 20px; border-bottom:2px solid #1a1a18; display:flex; justify-content:space-between; align-items:center; background:#f4f3ef; flex-shrink:0;';
    header.innerHTML = `<div>
      <span style="font-family:'IBM Plex Mono',monospace; font-size:16px; font-weight:600; color:#1a1a18; letter-spacing:-0.3px;">Cite</span>
      <span style="font-family:'IBM Plex Sans',sans-serif; font-size:12px; color:#888880; margin-left:10px; font-weight:300;">${this._escAttr(data.doi || '')}</span>
    </div>`;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u00D7';
    closeBtn.style.cssText = 'font-size:24px; font-weight:600; cursor:pointer; color:#888880; background:none; border:none; width:32px; height:32px; display:flex; align-items:center; justify-content:center; font-family:"IBM Plex Mono",monospace;';
    closeBtn.onmouseover = () => { closeBtn.style.color = '#1a1a18'; closeBtn.style.background = '#e8e6e0'; };
    closeBtn.onmouseout = () => { closeBtn.style.color = '#888880'; closeBtn.style.background = 'none'; };
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'padding:20px 24px; overflow-y:auto; flex:1; font-family:"IBM Plex Sans",sans-serif; font-weight:300; color:#1a1a18;';

    // Page input
    const pageInputId = 'cite-page-input';
    let bodyHtml = `<div style="margin-bottom:16px;">
      <label style="font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:600; color:#005a8c; letter-spacing:0.5px;">PAGES <span style="font-weight:400; color:#999;">(optional — updates citations below)</span></label>
      <input id="${pageInputId}" type="text" value="${this._escAttr(currentPages)}" placeholder="e.g. 221-230"
        style="display:block; margin-top:4px; width:160px; font-family:'IBM Plex Mono',monospace; font-size:13px; padding:6px 10px; border:1.5px solid #d8d5cc; background:#fff; color:#1a1a18; outline:none;"
        onfocus="this.style.borderColor='#005a8c'" onblur="this.style.borderColor='#d8d5cc'" />
    </div>`;

    // Citation formats container
    bodyHtml += '<div id="cite-formats-container"></div>';

    // Actions row: RIS + ZBib
    bodyHtml += `<div style="margin-top:16px; padding-top:14px; border-top:1px solid #eee; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
      <a href="https://zbib.org/?q=${encodeURIComponent(data.doi ? 'https://doi.org/' + data.doi : '')}" target="_blank" rel="noopener" style="font-family:'IBM Plex Mono',monospace; font-size:13px; font-weight:600; padding:8px 18px; background:#005a8c; color:#fff; border:none; cursor:pointer; letter-spacing:0.5px; text-decoration:none; display:inline-block;">Open ZoteroBib (more styles)</a>
      <button id="cite-ris-btn" style="font-family:'IBM Plex Mono',monospace; font-size:13px; font-weight:600; color:#005a8c; background:none; border:none; cursor:pointer; padding:8px 0;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Download RIS</button>
      <span style="font-size:11px; color:#999; margin-left:auto;">Import RIS into Zotero, Mendeley, EndNote</span>
    </div>`;

    body.innerHTML = bodyHtml;

    // Assemble
    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);

    // Escape key closes the panel
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Insert inline at the top of the results area (no overlay, page never dims)
    const resultsDiv = document.getElementById('results');
    if (resultsDiv) {
      resultsDiv.insertBefore(overlay, resultsDiv.firstChild);
    } else {
      document.body.appendChild(overlay);
    }
    overlay.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Render citations initially
    this._renderCitations(data, currentPages);

    // Wire up page input to re-render on change
    const pageInput = document.getElementById(pageInputId);

    // A Title Case title: render again in sentence case once words.csv is in
    this._sentenceCase(data).then(() => {
      if (data.sentTitle || data.sentBook) this._renderCitations(data, pageInput ? pageInput.value.trim() : currentPages);
    }).catch(() => { /* keep the title as it is */ });
    if (pageInput) {
      const rerender = () => this._renderCitations(data, pageInput.value.trim());
      pageInput.addEventListener('input', rerender);
    }

    // Wire up RIS download
    const risBtn = document.getElementById('cite-ris-btn');
    if (risBtn) {
      risBtn.addEventListener('click', () => {
        const pg = document.getElementById(pageInputId)?.value.trim() || '';
        const ris = this.generateRIS(data, pg || null);
        const blob = new Blob([ris], { type: 'application/x-research-info-systems' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeTitle = (data.title || 'citation').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
        a.download = `${safeTitle}.ris`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }
  },

  /**
   * Render the five citation formats, most used first, into the container.
   */
  _renderCitations(data, overridePages) {
    const container = document.getElementById('cite-formats-container');
    if (!container) return;

    const pg = overridePages || null;
    const styles = [
      { label: 'APA (7th)', result: this.formatAPA(data, pg) },
      { label: 'MLA (9th)', result: this.formatMLA(data, pg) },
      { label: 'Chicago (18th)', result: this.formatChicago(data, pg) },
      { label: 'AMA (11th)', result: this.formatAMA(data, pg) },
      { label: 'Vancouver / ICMJE', result: this.formatVancouver(data, pg) },
    ];

    let html = '';
    if (data.keptCaps && data.keptCaps.length) {
      html += `<div style="font-size:11px; color:#8a5a00; background:#fff7e6; border:1px solid #f0d9a8; padding:6px 8px; margin-bottom:12px; line-height:1.4;">APA, AMA and Vancouver use sentence case. Capitals kept on: ${this._escAttr(data.keptCaps.join(', '))} \u2014 lower-case any that are not names.</div>`;
    }
    styles.forEach((s, i) => {
      const copyId = `cite-copy-${i}`;
      html += `<div style="margin-bottom:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:600; color:#005a8c; letter-spacing:0.5px;">${s.label}</span>
          <button id="${copyId}"
            style="font-family:'IBM Plex Mono',monospace; font-size:11px; padding:2px 10px; background:#f0f4f8; color:#005a8c; border:1px solid #d8d5cc; cursor:pointer; font-weight:600;">Copy</button>
        </div>
        <div style="font-size:13px; line-height:1.6; color:#333; padding:10px 12px; background:#fafaf8; border:1px solid #eee;">${this._safeHtml(s.result.html)}</div>
      </div>`;
    });

    container.innerHTML = html;

    // Wire up copy buttons after DOM insertion
    styles.forEach((s, i) => {
      const btn = document.getElementById(`cite-copy-${i}`);
      if (btn) {
        btn.addEventListener('click', () => CitationBuilder._copyText(`cite-copy-${i}`, s.result.plain));
      }
    });
  },

  /**
   * Copy citation text to clipboard and flash the button.
   */
  _copyText(btnId, text) {
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById(btnId);
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = '#d4edda';
        btn.style.color = '#2d6a2d';
        setTimeout(() => {
          btn.textContent = orig;
          btn.style.background = '#f0f4f8';
          btn.style.color = '#005a8c';
        }, 1500);
      }
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    });
  },


  // ========================================================================
  // UTILITY
  // ========================================================================

  // The formatters call _escHtml on some fields. Here it passes text through
  // unchanged, and _safeHtml escapes the whole citation once at render time,
  // keeping only the formatters' <i> tags, so metadata can never inject markup.
  _escHtml(s) {
    return s == null ? '' : String(s);
  },

  _safeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/&lt;(\/?)i&gt;/g, '<$1i>');
  },

  /** Escape text for an HTML attribute or text in the modal's own markup */
  _escAttr(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  _stripHtml(s) {
    // Only the formatters' own <i> tags: a title's "p < 0.05 and q > 1" stays whole
    return s.replace(/<\/?i>/g, '');
  },
};

// Export for use
window.CitationBuilder = CitationBuilder;
