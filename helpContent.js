// helpContent.js - Help text and styles for Awesome DOI-Ref-Lookup
// Ver 1.6 Jul-2026

const DOIHelp = {

  version: '1.6 — Jul 2026',

  helpItems: [
    // =====================
    // GETTING STARTED
    // =====================
    {
      section: 'Getting Started',
      label: 'What is this tool?',
      description: 'Awesome DOI-Ref-Lookup retrieves metadata, metrics, author information, and external links for DOIs, ISBNs, and more. It queries over a dozen data sources in real time and presents a consolidated summary. Unrecognized input is sent to CrossRef as a general search; prefix with <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">worldcat</code> or <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">book</code> to search WorldCat instead. All feedback is appreciated — <a href="mailto:tomlaheyh@gmail.com" style="color:#005a8c;">tomlaheyh@gmail.com</a>.',
      ref: 'https://www.doi.org/'
    },
    {
      label: 'Quick demo — type "example"',
      description: 'You do not need a DOI to try this. Type <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">example</code> (or <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">sample</code>, <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">demo</code>, <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">try</code>) and press Enter to run a live lookup on a real article. Type <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;color:#cc0000;">tryretraction</code> (or <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;color:#cc0000;">try retraction</code> / <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;color:#cc0000;">tryretracted</code>) to load a known retracted paper and see how a retraction is flagged. These are real lookups, not screenshots — every panel behaves exactly as it would for your own DOI.',
      ref: null
    },
    {
      label: 'Entering DOIs',
      description: 'Enter a DOI in standard format (e.g. <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">10.1038/s41586-025-09227-0</code>) or as a full URL — prefixes like <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">doi:</code> and <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">https://doi.org/</code> are stripped automatically. Retraction and correction status is checked automatically across multiple sources including Retraction Watch and PubMed — try <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;color:red;">10.1016/S0140-6736(97)11096-0</code> for an example.',
      ref: null
    },
    {
      label: 'Batch lookup (up to 15 DOIs)',
      description: 'Separate multiple DOIs with commas. Duplicates are removed automatically, and the list is capped at 15. Each DOI is looked up sequentially, and errors on one DOI will not stop the rest. New DOIs are added to existing results — the newest appears at the top.',
      ref: null
    },
    {
      label: 'ORCID, ISSN, PMID → authoritative source',
      description: `Three identifier types are recognised on input and handed straight to the authority that owns them, in a new tab. No result card is built for these — the destination site is already the definitive record:

<strong>ORCID</strong> (e.g. <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">0000-0002-1825-0097</code>, or the full orcid.org URL) → the researcher's ORCID profile.
<strong>ISSN</strong> (e.g. <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">0140-6736</code>) → the ISSN Portal record for that journal.
<strong>PMID</strong> (plain digits, e.g. <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">40670798</code>) → the PubMed record.

Prefixes such as <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">ORCID:</code>, <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">ISSN:</code> and <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">PMID:</code> are stripped automatically.

Note the difference between typing an ISSN and looking up a DOI: enter a DOI and the tool resolves that journal's ISSNs for you, tags them print or electronic, and uses them to fetch SJR and DOAJ data (see "ISSN links" under Journal-Level Data).`,
      ref: null
    },
    {
      label: 'ISBN → WorldCat',
      description: 'Enter an ISBN-10 or ISBN-13 (with or without hyphens) to open the book\'s page on WorldCat. Prefixes like <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">ISBN:</code> or <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">ISBN-13:</code> are stripped automatically.',
      ref: 'https://search.worldcat.org/'
    },
    {
      label: 'Text search → CrossRef',
      description: 'Any input that doesn\'t match a DOI, ISSN, ISBN, ORCID, or PMID pattern is sent as a search to CrossRef. Results are shown inline — click any result to run a full DOI lookup. For example, <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">Detecting structural heart disease</code> will search CrossRef and display matching articles.',
      ref: 'https://www.crossref.org/'
    },
    {
      label: 'WorldCat search (book / worldcat prefix)',
      description: 'Prefix your search with <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">worldcat</code> or <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">book</code> to search WorldCat instead of CrossRef. The prefix can be followed by a colon, semicolon, slash, or just a space — for example <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">worldcat Brief History of Time</code>, <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">worldcat: Brief History of Time</code>, or <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">book; Brief History of Time</code> all work. WorldCat opens in a new tab. Note: rapid repeated searches may trigger WorldCat\'s rate limiting — if this happens, wait a moment and try again.',
      ref: 'https://search.worldcat.org/'
    },
    {
      label: 'Shareable URLs',
      description: `After a lookup, the browser URL updates to include a <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">?doi=</code> query parameter. You can copy and share this URL — anyone opening it will automatically run the same lookup. Comma-separated DOIs are supported in the URL as well.

Two further parameters can be added by hand:

<strong>&connections=1</strong> — opens the Connections graph automatically for the first DOI listed, so the link lands directly on the chart.
<strong>&nocache</strong> — forces a fresh load of the tool's own scripts, bypassing the browser cache. Useful after an update.`,
      ref: null
    },
    {
      label: 'Caching (session only)',
      description: `Lookups are cached for the life of the browser tab, using sessionStorage. Revisiting a DOI you have already looked up in this tab is nearly instant and logs <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">[Session Cache] HIT</code> to the console.

Nothing persists once the tab is closed. There is no expiry to wait out and nothing to clear — close the tab, or open the page in a new one, and every lookup starts fresh.

Three separate caches work this way: article results, retraction-status checks, and Connections graph data. The SJR table is held in memory only and reloads on every page refresh.

The <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">&nocache</code> URL parameter is unrelated to lookup results — it forces a fresh load of the tool's own JavaScript files.`,
      ref: null
    },
    {
      label: 'Page controls',
      description: `The row beneath the input box holds:

<strong>?</strong> — this help panel.
<strong>Export CSV</strong> — appears once you have results (see CSV Export below).
<strong>Clear list</strong> — removes every result card except the newest one at the top, and clears any error cards. It does not clear the whole page; to start completely fresh, reload without a <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">?doi=</code> parameter.
<strong>Advanced Retraction Search</strong> — opens the Retraction Watch Database directly, for searching retractions by author, journal, subject or reason rather than by DOI.`,
      ref: 'https://retractiondatabase.org/RetractionSearch.aspx'
    },
    {
      label: 'Retraction alerts (batch)',
      description: 'When any DOI currently on the page is retracted or carries an Expression of Concern, a warning line appears near the top of the page listing that DOI and its status — <span style="color:#cc0000;font-weight:bold;">red</span> for retracted, <span style="color:#e07000;font-weight:bold;">orange</span> for Expression of Concern. This is deliberately placed above the result cards so that in a batch of fifteen you see the problem immediately, without scrolling through every card. The list updates as you add or remove DOIs.',
      ref: null
    },
    {
      label: 'Chrome extension',
      description: 'A companion Chrome extension adds a small "Ref" link next to DOIs it finds on any web page — journal tables of contents, PubMed results, reference lists — which opens that DOI here. It can be toggled on and off per site. The link to install it sits at the right-hand end of the button row.',
      ref: 'https://chromewebstore.google.com/detail/doi-ref-lookup/eeefkdjjcilinphodokjljocffkkgkfa'
    },
    // =====================
    // SUMMARY SECTION
    // =====================
    {
      section: 'Summary Card',
      label: 'DOI + Free PDF link + Cite',
      description: 'The DOI is shown at the top with a link to <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">doi.org</code>. If a free full-text version is available (from PMC via PubMed, or from Unpaywall), a green "Free PDF" or "Free Manuscript" link appears next to it. A "Cite this paper" link opens a citation formatting modal (see the Cite section below).',
      ref: 'https://unpaywall.org/'
    },
    {
      label: 'Title + Abstract',
      description: 'The article title is shown in bold. If the article has been retracted, "RETRACTED:" is prepended in red. A truncated abstract is shown below (from PubMed when available, otherwise from CrossRef). Click "full abstract" to see the complete text in a popup.',
      ref: null
    },
    {
      label: 'Retractions / Updates',
      description: `Shows retraction and correction status from two independent sources:

<strong>CrossRef:</strong> Uses the <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">update-to</code> and <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">updated-by</code> fields. Detects: retraction, correction, expression of concern, reinstatement, and withdrawal. Sources include publishers and Retraction Watch.

<strong>PubMed:</strong> Uses eSummary references (Erratum in, Retraction in, Retraction of) and publication types (Retracted Publication, Published Erratum, Retraction of Publication).

Retractions and Expressions of Concern override the quality badge. When a date is available from CrossRef, it is shown alongside the status (e.g. "Retracted (Oct 29, 2018)"). "None" means the source was checked and nothing was found; "N/A" means the source was not available (e.g. article not in PubMed).`,
      ref: 'https://www.crossref.org/blog/linking-corrections-and-retractions/'
    },
    {
      label: 'Quality badge',
      description: `Quality is determined by the journal's SJR (SCImago Journal Rank) score:

<strong>High Quality</strong> (green) — SJR ≥ 3
<strong>Good Quality</strong> (yellow) — SJR ≥ 0.8
<strong>Low Quality</strong> (grey) — SJR < 0.8
<strong>Quality Unknown</strong> — no SJR data available

This is overridden by <span style="color:#cc0000;font-weight:bold;">Retracted</span> or <span style="color:#e07000;font-weight:bold;">Expression of Concern</span> when applicable.

Note: SJR measures journal-level visibility, not individual article quality. It is one signal among many.`,
      ref: 'https://www.scimagojr.com/aboutus.php'
    },
    // =====================
    // CITATIONS & METRICS
    // =====================
    {
      section: 'Citations & Metrics',
      label: 'Citations — CrossRef, OpenAlex, OpenAlex-FWCI, Semantic Scholar, iCite',
      description: `Citation counts are shown from up to four sources. Counts may differ because each source has a different corpus and update cadence:

<strong>CrossRef:</strong> Publisher-deposited citation links. Broadest coverage.
<strong>OpenAlex:</strong> Open bibliometric database built from multiple sources including CrossRef and MAG.
<strong>OpenAlex-FWCI:</strong> Field-Weighted Citation Impact — the ratio of citations received to citations expected for the publication year, document type, and subfield. An FWCI of 1.0 means average for its field; above 1.0 means more cited than expected.
<strong>Semantic Scholar:</strong> AI-powered academic search. Also reports "influential citations" — citations where the citing paper meaningfully builds on this work, detected via machine learning.
<strong>iCite:</strong> NIH's citation analysis tool. Only available for articles with a PubMed ID (PMID).

Click the small bar-chart icon (▊▊▊) at the beginning of the citations line to see a "Citations by Year" chart (from OpenAlex). Resting the pointer on the icon for about a second opens the same chart without clicking; it then stays put until you close it with the ×, click elsewhere, or open another chart. Only one chart is open at a time. The chart shows the last 10 years of data; for older articles, earlier citations are noted separately. The icon is greyed out when there are no citations. Below the chart, a "View citing articles" link opens OpenAlex filtered to the last two years of citing works — you can adjust the year range and other filters directly on OpenAlex.`,
      ref: 'https://icite.od.nih.gov/'
    },
    {
      label: 'RCR = Relative Citation Ratio',
      description: 'From NIH iCite. Defined as "the citations per year of each paper, normalized to citations per year received by NIH-funded papers in the same field and year." An RCR of 1.0 means average for its field. Only available for PubMed-indexed articles. Displays "N/A" otherwise.',
      ref: 'https://support.icite.nih.gov/hc/en-us/articles/9062490125083-Metrics'
    },
    {
      label: 'Grants / Funders',
      description: 'Funding information is shown from PubMed (preferred), CrossRef (fallback), or OpenAlex (second fallback). CrossRef funder data comes from the Open Funder Registry — funder names link to their registry DOI when available. Grants are grouped by agency and deduplicated. Grant IDs are shown in monospace. The source is labelled in parentheses (e.g. "PubMed", "CrossRef", "OpenAlex"). If the article is in PubMed but no grants are reported, "None reported" is shown explicitly so you know it was checked.',
      ref: null
    },
    {
      label: 'OpenAIRE — Popularity, Influence, Impulse',
      description: `OpenAIRE BIP (Bibliometric Impact Profile) metrics rank articles relative to their field:

<strong>Popularity:</strong> Recent attention / citation momentum (Top 1%, 10%, 25%, 50%, or Bottom 50%)
<strong>Influence:</strong> Overall citation-based prestige
<strong>Impulse:</strong> Early citation rate (how fast it gained attention)

These are percentile-based classes, not raw counts.`,
      ref: 'https://graph.openaire.eu/docs/data-model/pids/bipfinder'
    },
    // =====================
    // JOURNAL-LEVEL DATA
    // =====================
    {
      section: 'Journal-Level Data',
      label: 'SJR = SCImago Journal Rank',
      description: 'A widely respected, free journal ranking. SJR measures journal visibility using an algorithm similar to Google\'s PageRank™, analyzing citation networks across Scopus-indexed journals. The score is looked up from a bundled CSV file matched by ISSN. The link goes to the journal\'s SCImago charts page.',
      ref: 'https://www.scimagojr.com/aboutus.php'
    },
    {
      label: 'DOAJ = Directory of Open Access Journals',
      description: 'Indicates whether the journal is listed in DOAJ, a curated index of reputable open access journals. When found, also shows the journal\'s APC (Article Processing Charge) and licence type (e.g. CC BY). "No" means the journal was looked up but not found in DOAJ.',
      ref: 'https://doaj.org/'
    },
    {
      label: 'ISSN links',
      description: `A journal usually has more than one ISSN — typically one for the print edition and one for the electronic edition — and different sources report different ones. The tool collects every ISSN it can find for the article, from the Registration Agency record and from PubMed (both its ISSN and ESSN fields), removes duplicates, and labels each one <strong>print</strong> or <strong>electronic</strong> where the source says so. Each is linked to its ISSN Portal record, which holds the authoritative journal identity: publisher, country, and linked ISSNs.

That collected set is then used as the key for the journal-level lookups further down the card. SJR, DOAJ and the publisher-country lookup are each tried against every ISSN in turn rather than just the first, because a journal's SJR row may be filed under its print ISSN while CrossRef reports only the electronic one. This is why journal metrics resolve for articles where a single-ISSN match would come back empty.`,
      ref: 'https://portal.issn.org/'
    },
    // =====================
    // PUBMED
    // =====================
    {
      section: 'PubMed Data',
      label: 'PubMed: Yes / No',
      description: 'Shows whether the article was found in PubMed (searched by DOI). Many biomedical articles are in PubMed; datasets, software, and non-biomedical articles typically are not.',
      ref: 'https://pubmed.ncbi.nlm.nih.gov/'
    },
    {
      label: 'Medline',
      description: 'Indicates whether the article has been indexed for MEDLINE, the NLM\'s premier bibliographic database. MEDLINE indexing means the article has been reviewed and assigned MeSH terms by NLM indexers. Not all PubMed articles are MEDLINE-indexed.',
      ref: 'https://www.nlm.nih.gov/medline/medline_overview.html'
    },
    {
      label: 'Preprint',
      description: 'Detected via PubMed\'s pubstatus field, publication types, and journal name matching against known preprint servers (bioRxiv, medRxiv, Research Square, SSRN, arXiv). Preprints have not undergone formal peer review.',
      ref: 'https://pmc.ncbi.nlm.nih.gov/about/nihpreprints/'
    },
    {
      label: 'PMC (PubMed Central)',
      description: 'If the article is available in PMC, a free full-text link is provided. PMC is the NIH\'s free full-text archive. This is checked via PubMed eSummary article IDs and takes priority over Unpaywall for the "Free PDF" link.',
      ref: 'https://www.ncbi.nlm.nih.gov/pmc/'
    },
    // =====================
    // AUTHORS
    // =====================
    {
      section: 'Authors',
      label: 'First and last authors',
      description: `In academic convention, first author typically led the work, last author typically supervised. This convention is widely followed across disciplines, though the majority of users — including many librarians — may not be aware of it. Articles often have many authors, but the first and last positions carry the most significance.

Author information is merged from up to three sources: the Registration Agency (CrossRef, DataCite, etc.), PubMed, and OpenAlex. The tool picks the source with the most ORCID coverage — RA wins ties. When the chosen source lacks ORCIDs but OpenAlex has them, the OpenAlex ORCIDs are used as a fallback.

An ORCID comparison table is shown at the bottom of the summary, displaying author names and ORCIDs from all three sources for transparency.`,
      ref: 'https://orcid.org/'
    },
    {
      label: 'Author metrics (from OpenAlex)',
      description: `When an ORCID is available, author-level metrics are fetched from OpenAlex:

<strong>h-index:</strong> Minimum number of citations across papers. Example: 12 papers all with ≥12 citations = h-index of 12.
<strong>i10-index:</strong> Number of papers with ≥10 citations.
<strong>2yr citation rate:</strong> Average citations per paper over 2 years.

Different sources (Google Scholar, Scopus, Web of Science) calculate these metrics slightly differently due to varying citation databases.`,
      ref: 'https://en.wikipedia.org/wiki/Author-level_metrics'
    },
    // =====================
    // EXTERNAL LINKS
    // =====================
    {
      section: 'External Links & Discovery',
      label: 'Altmetric',
      description: 'Links to the Altmetric details page for the DOI. The Altmetric Attention Score measures online attention including social media, news, policy documents, and blog mentions.',
      ref: 'https://help.altmetric.com/en/articles/9800513'
    },
    {
      label: 'CORE',
      description: 'CORE aggregates open access research outputs from repositories and journals worldwide. The link searches for the DOI in CORE\'s index.',
      ref: 'https://core.ac.uk/about'
    },
    {
      label: 'Dimensions',
      description: 'Dimensions is a research analytics platform. The link searches for the DOI. Note: a free account is required to access Dimensions.',
      ref: 'https://www.dimensions.ai/'
    },
    {
      label: 'Google Scholar',
      description: 'Links to a Google Scholar search for the DOI. Google Scholar provides its own citation counts and related articles.',
      ref: 'https://scholar.google.com/intl/en/scholar/about.html'
    },
    // =====================
    // CONNECTIONS GRAPH
    // =====================
    {
      section: 'Connections Graph',
      label: 'Opening the graph',
      description: 'Every result card carries a "View connections graph" button. It opens a panel in place, above the cards, showing that article at the center of a wheel of related papers drawn from OpenAlex. Close it with the × or the Escape key; your browser\'s Back button also closes it and returns you to the full card list without reloading anything. A link ending in <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">&connections=1</code> opens straight to the graph.',
      ref: 'https://openalex.org/'
    },
    {
      label: 'Three views — Inside, Outside, Mix',
      description: `The toggle at the top of the panel switches between three ways of looking at the same article:

<strong>Inside (refs)</strong> — up to 25 works this article cites. Arrows point outward, from the center to each node.
<strong>Outside (cited by)</strong> — up to 25 works that cite this article. Arrows point inward. This is the view you land on first.
<strong>Mix</strong> — 12 of each in one ring, so you can see what the article drew on and what it went on to influence side by side.

Inside answers "what is this built on"; Outside answers "what came of it". Mix is the fastest way to place a paper in its lineage.`,
      ref: null
    },
    {
      label: 'Reading the graph',
      description: `Nothing in the picture is decorative:

<strong>Bubble size</strong> — citation count. Bigger means more cited.
<strong>Bubble colour</strong> — journal quality tier, using the same SJR bands as the quality badge on the result card.
<strong>Arrow direction</strong> — inward arrows cite the center article; outward arrows are cited by it.
<strong>Blue spokes</strong> — that paper shares references with the center article. More shared references means a stronger visual link, so papers working from the same literature stand out from papers that merely happen to cite it.
<strong>Flags</strong> — retracted papers are marked in the graph itself, and open-access papers carry a free-to-read badge.

A legend beneath the wheel restates all of this. Click any bubble's "shared references" count to list the overlapping works by title and DOI.`,
      ref: null
    },
    {
      label: 'Node details and abstracts',
      description: 'Clicking a bubble fills the right-hand panel with that paper\'s title, journal, year, citation count, quality tier and links. The abstract is fetched through a cascade designed to show something immediately rather than spin: OpenAlex first (already in hand, so instant), then any copy already loaded on the page, then a live PubMed request, then CrossRef. If none of them has one, it says so plainly rather than leaving the space blank.',
      ref: null
    },
    {
      label: 'Favorites and filters',
      description: `Two controls narrow what you are looking at:

<strong>Free only</strong> — restricts the view to articles that are free to read. Useful when you want a reading list you can actually open today rather than a list of paywalls.
<strong>Show favorites only</strong> — hides everything you have not starred.

Click the heart on any node or list row to favorite it. Favorites are deliberately temporary: they exist to help you triage one graph in one sitting, and they are cleared when the panel closes. Export before you close if you want to keep them — the export marks which rows were favorited.`,
      ref: null
    },
    {
      label: 'Expanded Analysis (multi-level)',
      description: `The single wheel shows one step out from the center article. "Expanded Analysis" walks further, following the strongest picks outward through up to three levels and stopping at a budget of 50 unique papers, so the search stays bounded rather than snowballing. The report it produces has three parts:

<strong>Expansion tree</strong> — what was followed, and from where.
<strong>Ranked by citations</strong> — the neighborhood ordered by how heavily cited each paper is.
<strong>Foundational references</strong> — the most co-cited works across the whole neighborhood. These are the papers that many of the surrounding articles independently cite, which is a good proxy for the foundational literature of a topic, and they will often include work the center article never cited itself.

The foundational list is the reason to use this feature. Ranking by raw citations tells you what is famous; ranking by co-citation across a neighborhood tells you what that specific corner of the literature is actually built on. Results are drawn from a candidate pool of about 300 works and reported as a ranked list of up to 200. It makes many API calls, so it takes noticeably longer than the single wheel.`,
      ref: null
    },
    {
      label: 'Exporting and sharing from the graph',
      description: `The article list beneath the graph has its own exports, separate from the main CSV export on the results page:

<strong>Export CSV</strong> — every article in the current view, with its direction (referenced by the center article, or citing it), shared-reference count, favorite status, the center DOI, and a link back to this connections view.
<strong>Export RIS</strong> — the same set as a .ris file for Zotero, Mendeley, EndNote or RefWorks. This is the quickest route from "explore a topic" to "populate a reference library".
<strong>Copy link</strong> — a shareable URL that reopens this graph on this article.

Exports respect the filters, so "Free only" plus Export RIS gives you a reference list of papers you can read immediately.`,
      ref: null
    },
    {
      label: 'Make this the new center',
      description: 'Any node can become the center of its own wheel. Click "Make this center" on a detail card and the graph rebuilds around that paper, letting you walk through a literature one hop at a time. Your browser\'s Back button retraces the path. Favorites are not carried across, since they belong to the graph you were looking at.',
      ref: null
    },
    // =====================
    // REGISTRATION AGENCIES
    // =====================
    {
      section: 'Registration Agencies',
      label: 'What is a Registration Agency (RA)?',
      description: `Every DOI is registered with a specific Registration Agency. The tool auto-detects the RA and routes to the appropriate API:

<strong>CrossRef</strong> — journals and articles (~90% of research DOIs). Full API.
<strong>DataCite</strong> — datasets, software, grey literature (~8%). Full API.
<strong>JaLC</strong> — Japanese publications. Full API, bilingual (English/Japanese).
<strong>mEDRA</strong> — European publications. Full API, XML/ONIX format.
<strong>CNKI</strong> — Chinese publications. Paid API only, restricted outside mainland China.
<strong>ISTIC</strong> — Chinese publications via Wanfang Data. No public API.
<strong>KISTI</strong> — Korean publications. Very rare; most Korean journals use CrossRef.

CrossRef and DataCite together represent over 95% of all research DOIs.`,
      ref: 'https://www.doi.org/the-community/existing-registration-agencies/'
    },
    // =====================
    // DETAILS SECTION
    // =====================
    {
      section: 'Details Panel',
      label: 'Details (collapsed by default)',
      description: 'Click "Details" to expand the full metadata panel. This includes raw data from the International DOI Foundation (handle timestamps, resolves-to URL), full article details from the RA (title, journal, volume, issue, pages, type, language, abstract, copyright), and raw PubMed metadata (MeSH terms, keywords, databanks, conflict of interest statements).',
      ref: null
    },
    {
      label: 'Links section (in Details)',
      description: `The "Links" section shows every external service checked, with Web and Data (API) links for each. Services are grouped into:

<strong>DOI Resolution:</strong> doi.org, CrossRef, DataCite, JaLC, mEDRA, plus other RAs without APIs.
<strong>Article Metrics:</strong> Semantic Scholar, OpenAlex, Unpaywall, Altmetric, DOAJ, CORE, OpenAIRE, Dimensions, PubMed, PMC, iCite, and Retraction Watch status.
<strong>Journal Metrics:</strong> ISSN Portal, DOAJ (journal-level), SJR, OpenAlex.
<strong>Author:</strong> OpenAlex and PubMed author searches (when ORCID is available).

Blue links are available; greyed-out links mean the service did not have data for this DOI.`,
      ref: null
    },
    // =====================
    // CSV EXPORT
    // =====================
    {
      section: 'CSV Export',
      label: 'Export CSV',
      description: `After looking up DOIs, click "Export CSV" to download a spreadsheet with one row per DOI. The button shows how many results are currently included. The file is named with the date, e.g. <code style="font-size:12px;background:#f0f0f0;padding:1px 5px;">ref-lookup-2026-07-31.csv</code>.

26 columns are written: DOI, title, journal, publisher, year, volume, issue, pages, type and ISSN; first and last author with their ORCIDs; citation counts from CrossRef, OpenAlex, Semantic Scholar and iCite, plus FWCI, RCR and SJR; DOAJ and PubMed status; the free PDF URL; and funders, grant numbers and the grant source.

<strong>Note on the card checkbox:</strong> unticking the checkbox on a result card <em>removes</em> that card — it disappears from the page, from the export, and from the URL. It is not a reversible include/exclude toggle. To get a removed DOI back, look it up again.`,
      ref: null
    },
    // =====================
    // CITATIONS / CITE
    // =====================
    {
      section: 'Cite',
      label: 'Citation formatting',
      description: `Click "Cite" on the DOI line of any result card to open the citation modal. Four styles are available:

<strong>APA (7th edition)</strong> — psychology, social sciences, education, nursing.
<strong>AMA (11th edition)</strong> — medical journals, clinical research.
<strong>Vancouver / ICMJE</strong> — biomedical journals (NEJM, Lancet, BMJ, JAMA).
<strong>MLA (9th edition)</strong> — humanities, literature, languages.

Each citation has a "Copy" button for one-click copying. An optional "Pages" input at the top lets you add or correct page numbers — all four citations update live as you type.`,
      ref: null
    },
    {
      label: 'RIS export (reference managers)',
      description: 'Click "Download RIS" in the Cite modal to save the reference as a .ris file. RIS can be imported directly into Zotero, Mendeley, EndNote, RefWorks, and other reference managers.',
      ref: null
    },
    {
      label: 'ZoteroBib',
      description: 'The "ZoteroBib" link in the Cite modal opens ZoteroBib — a free tool by the Zotero team that supports thousands of citation styles. It opens in a new tab with the DOI pre-filled.',
      ref: 'https://zbib.org/'
    },
    // =====================
    // DATA SOURCES
    // =====================
    {
      section: 'Data Sources & Privacy',
      label: 'Data sources',
      description: `This tool queries the following public APIs in real time — no data is stored on any server:

CrossRef, DataCite, JaLC, mEDRA (Registration Agency APIs)
PubMed / NCBI (eSearch, eSummary, eFetch)
iCite (NIH citation metrics)
OpenAlex (bibliometrics, FWCI, citation trends, author metrics, grants)
Semantic Scholar (citations, influential citations)
Unpaywall (open access detection)
DOAJ (open access journal directory)
CORE (open access aggregator)
OpenAIRE (European research metrics)
ISSN Portal (journal identity)
Retraction Watch (retraction notices, reached via CrossRef)
WorldCat (books, by ISBN or title search)
SJR (journal ranking, from a bundled CSV snapshot rather than a live API — it is refreshed when a new SCImago release is published)

All API calls are made directly from your browser. There is no backend server, no tracking, and no user data collection. Nothing you look up is transmitted to, logged by, or visible to this site — there is no server here to receive it.`,
      ref: 'https://github.com/tomlaheyh/ref-lookup'
    },
    {
      section: 'Other Pages',
      label: 'Supplementary reference pages',
      description: `The site menu links to a few standalone reference pages that sit alongside the lookup tool but are not part of it. They are working references — data snapshots and notes kept here for convenience — and are intentionally left out of search engines (noindexed), so they will not surface in Google results for the DOI tool.

<strong>Topic Search</strong>, <strong>Nutrition Reference</strong>, and the PubMed reports (<strong>Summary</strong>, <strong>Filters</strong>, <strong>MeSH Counts</strong>, <strong>Journal Ranking</strong>) each load their own data and behave independently of the DOI lookup. Nothing on these pages is needed to use the lookup, and — like the rest of the site — they carry no tracking.`,
      ref: null
    },
  ],

  // Generate HTML for help items
  generateHelpHTML() {
    let html = '';
    let currentSection = null;

    this.helpItems.forEach((item, index) => {
      // Section header
      if (item.section && item.section !== currentSection) {
        if (currentSection !== null) {
          html += '<hr style="border:none;border-top:2px solid #d8d5cc;margin:18px 0;">';
        }
        currentSection = item.section;
        html += `<div style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:#005a8c;margin:16px 0 10px;">${item.section}</div>`;
      }

      const refLink = item.ref
        ? ` <a href="${item.ref}" target="_blank" style="color:#005a8c;font-size:11px;font-weight:400;text-decoration:none;margin-left:6px;">Ref ↗</a>`
        : '';

      html += `<div style="margin-bottom:10px;">`;
      html += `<div style="margin-bottom:3px;"><strong style="color:#1a1a18;font-size:14px;">${item.label}</strong>${refLink}</div>`;
      html += `<div style="color:#555;font-size:13px;line-height:1.55;font-weight:300;white-space:pre-line;">${item.description}</div>`;
      html += `</div>`;

      // Separator between items within same section
      const nextItem = this.helpItems[index + 1];
      if (nextItem && !nextItem.section) {
        html += '<hr style="border:none;border-top:1px solid #eee;margin:10px 0;">';
      }
    });

    // Version footer
    html += `<div style="text-align:center;color:#888880;font-family:'IBM Plex Mono',monospace;font-size:11px;padding:14px 0 4px;border-top:1px solid #eee;margin-top:16px;">Awesome DOI-Ref-Lookup — v${this.version}</div>`;

    return html;
  },

  // Create and show the help modal
  showHelpModal() {
    // Remove existing if present
    const existing = document.getElementById('doi-help-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'doi-help-modal';
    overlay.style.cssText = `
      margin: 0 auto 16px;
      max-width: 680px;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: #fff;
      width: 100%;
      border: 1.5px solid #005a8c;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 2px 10px rgba(0,0,0,0.10);
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 14px 20px;
      border-bottom: 2px solid #1a1a18;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f4f3ef;
      flex-shrink: 0;
    `;
    header.innerHTML = `
      <div>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:600;color:#1a1a18;letter-spacing:-0.3px;">Help</span>
        <span style="font-family:'IBM Plex Sans',sans-serif;font-size:12px;color:#888880;margin-left:10px;font-weight:300;">Awesome DOI-Ref-Lookup</span>
      </div>
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `
      font-size: 24px;
      font-weight: 600;
      cursor: pointer;
      color: #888880;
      background: none;
      border: none;
      width: 32px; height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'IBM Plex Mono', monospace;
    `;
    closeBtn.onmouseover = () => { closeBtn.style.color = '#1a1a18'; closeBtn.style.background = '#e8e6e0'; };
    closeBtn.onmouseout  = () => { closeBtn.style.color = '#888880'; closeBtn.style.background = 'none'; };
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.style.cssText = `
      padding: 20px 24px;
      overflow-y: auto;
      flex: 1;
      font-family: 'IBM Plex Sans', sans-serif;
      font-weight: 300;
      color: #1a1a18;
    `;
    body.innerHTML = this.generateHelpHTML();

    // Assemble
    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);

    // Escape key to close
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
  }
};

// Export for use
window.DOIHelp = DOIHelp;
