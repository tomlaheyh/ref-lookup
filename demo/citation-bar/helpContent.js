// helpContent.js - Help text and styles for citation bar
// Ver 3.820 Sep-2026

// Short tooltips for hover (1.5s delay)
export const tooltips = {
    retracted: "Article has been retracted from the literature.",
    highImpact: "High impact article based on extension scoring.",
    overallScore: "Overall article quality score based on multiple metrics.",
    mesh: "View MeSH terms for this article.",
    new: "New article (< 2 years) based on PubMed create date.",
    trending: "Trending on PubMed (top 1,000 articles).",
    medline: "Indexed for Medline.",
    preprint: "Preprint article (not yet peer-reviewed).",
    erratum: "Has correction/erratum (not a retraction).",
    cited: "Citation count from NIH iCite.",
    rcr: "Relative Citation Ratio - scientific influence normalized to field.",
    ic: "Influential Citations from Semantic Scholar.",
    alt: "Altmetric Attention Score (social/news mentions).",
    similar: "Similar articles from PubMed.",
    citedBy: "Articles in PubMed citing this paper.",
    scholar: "Google Scholar link via DOI.",
    cp: "Connections — interactive citation graph for this article (doilookup.com).",
    abstract: "View Abstract",
    link: "Full-text link (green = free).",
    divider: "Divider: article info | journal info",
    topJournal: "From curated list of top medical journals.",
    sjr: "SCImago Journal Rank - journal visibility score.",
    rank: "Journal ranking from extension YTD data.",
    articleCount: "Journal articles published in the ranking period.",
    medlinePct: "Percent Medline-indexed; recent articles may not be indexed yet.",
    freePct: "Percent of journal articles with free full text.",
    xout: "Filter out reviews, retractions, editorials etc. which are 25% of PubMed",
    citationReport: "Generate detailed citation report.",
    authors: "View author information and metrics",
    pubmedReports: "PubMed Reports (key overviews)",
    pick: "Add to export list. Pulls the full PubMed record, including abstract and MeSH - takes a moment.",
    pickList: "Open the export list - review, remove, and download as .nbib for Zotero."
};

export const helpItems = [
    {
        label: "Retracted = PMID and Retraction PMID (when clicked)",
        description: "Shows if an article has been retracted from the literature.",
        ref: "https://www.nlm.nih.gov/bsd/policy/errata.html"
    },
    {
        label: "* = High impact article (green background)",
        description: `Articles are marked as high impact (green background) when their score meets your threshold (default: 5, adjustable in extension settings). The score is calculated as follows:

<code>function calculateScore(item) {
    let score = 0;

    // MEDLINE: 2.25 points
    if (item.recordStatus === 'PubMed - indexed for MEDLINE') {
        score += 2.25;
    }

    const citations = parseInt(item.Citations);
    const crc = parseFloat(item.RelativeCitationRatio);
    
    if (item.PublishCurrent === 'n') {
        // Recent articles (< 2 years)
        
        // Citations scoring
        if (citations > 30) score += 2.25;
        else if (citations > 15) score += 1.75;
        else if (citations > 5) score += 1;
        else if (citations > 2) score += 0.25;
        
        // RCR scoring
        if (crc > 2) score += 1.25;
        
    } else {
        // Older articles (>= 2 years)
        
        // Citations scoring
        if (citations >= 200) score += 3.5;
        else if (citations >= 50) score += 2.75;
        else if (citations >= 10) score += 1.5;

        // RCR scoring
        if (crc > 10) score += 1.25;
        else if (crc > 5) score += 0.75;
    }

    // SJR: 1.25 points
    if (item.SJR !== '-' && item.SJR > 3) {
        score += 1.25;
    }

    // Trending: 1 point
    if (item.isTrending) {
        score += 1;
    }

    // Influential Citations: 0.5 points
    if (item.s2Url && item.influentialCitations >= 1) {
        score += 0.5;
    }

    return score;
}</code>`,
        ref: null
    },
    {
        label: "Overall Score = Numerical article quality score",
        description: "The overall score is a calculated value that represents the article's quality based on multiple factors including MEDLINE indexing, citation counts, Relative Citation Ratio (RCR), journal SJR ranking, trending status, and influential citations. The score is displayed at the top of the citation report and helps quickly assess an article's impact and significance.",
        ref: null
    },
    {
        label: "doi = Open article in DOI Lookup",
        description: "Opens the article's DOI in DOI Lookup (doilookup.com), a free website that checks retractions, citations, journal metrics, and open access from a dozen sources. Multiple DOIs can be collected (up to 15) and viewed together. If the article has no DOI, the link is grayed out.",
        ref: "https://doilookup.com/"
    },
    {
        label: "MeSH = Shows MeSH tags for the article",
        description: "Some PubMed articles are classified as Medline and have MeSH (Medical Subject Headings) assigned to them. This displays those MeSH tags for the article.",
        ref: "https://www.nlm.nih.gov/mesh/meshhome.html"
    },
    {
        label: "n = New, less than 2 years old",
        description: "Based on the create date [crdt] in PubMed when the article was first entered into the system. This date does not change, unlike publish dates which can sometimes change.",
        ref: null
    },
    {
        label: "t = Trending article based on PubMed Trending",
        description: "Trending is based on the top 1,000 PubMed articles. The actual logic is not public (per NIH policy), but think \"new and lots of views\" and you'll be close.",
        ref: "https://pubmed.ncbi.nlm.nih.gov/trending/"
    },
    {
        label: "m = Medline indexed based on PubMed",
        description: "Indicates the article has been indexed for Medline.",
        ref: "https://www.nlm.nih.gov/medline/medline_overview.html"
    },
    {
        label: "p = Preprint",
        description: "Indicates the article is a preprint (not yet peer-reviewed). Preprints allow researchers to share findings quickly before formal peer review. While they provide early access to research, they should be interpreted with caution as they haven't undergone the rigorous peer review process.",
        ref: "https://pmc.ncbi.nlm.nih.gov/about/nihpreprints/"
    },
    {
        label: "e = erratum",
        description: "Articles can have updates or corrections — this is not a retraction. Approximately 1% of articles have corrections. When clicked, this shows both the original PMID and the correction PMID.",
        ref: "https://www.nlm.nih.gov/bsd/policy/errata.html"
    },
    {
        label: "Cited = Citation count from iCite (NIH) or Europe PMC",
        description: "Citation count from iCite, provided by the NIH — the same government agency that runs PubMed. There are several sources of citation counts, including PubMed itself, but I feel iCite is the best overall fit. Occasionally iCite may be down or slow, in which case I pull citation counts from Europe PMC, a long-standing literature database run by EMBL-EBI alongside a group of research funders.",
        ref: "https://icite.od.nih.gov/"
    },
    {
        label: "RCR = Relative Citation Ratio from iCite",
        description: "The Relative Citation Ratio (RCR) is an iCite measure defined as \"the cites/year of each paper, normalized to the citations per year received by NIH-funded papers in the same field and year.\" It represents a citation-based measure of scientific influence. When iCite is unavailable, RCR will display \"-\" since it is a custom iCite measure not available from other sources.",
        ref: "https://support.icite.nih.gov/hc/en-us/articles/9062490125083-Metrics"
    },
    {
        label: "IC = Influential Citations from Semantic Scholar",
        description: "Semantic Scholar identifies citations where the cited publication has a significant impact on the citing publication. Influential citations are determined using a machine-learning model analyzing factors including the number of citations and the surrounding context for each. Displays \"-\" if not found.",
        ref: "https://www.semanticscholar.org/faq#influential-citations"
    },
    {
        label: "Alt = Altmetric Score",
        description: "The Altmetric Attention Score provides an indicator of the amount of attention a research output has received, including social media, news, and policy documents. The score is derived from an automated algorithm and represents a weighted count of attention. The link goes directly to the Altmetric page for the article.",
        ref: "https://help.altmetric.com/en/articles/9800513"
    },
    {
        label: "s = Similar articles from PubMed",
        description: "A list of similar articles from PubMed. You can also view these by clicking \"Similar Articles\" in the right sidebar on any PubMed article page.",
        ref: "https://www.ncbi.nlm.nih.gov/guide/howto/find-articles-similar/"
    },
    {
        label: "c = Citing articles from PubMed",
        description: "A list from PubMed of articles citing this article. Note this varies slightly from iCite as they use different systems and methods. The NIH focus going forward is on iCite, but PubMed still provides this as an easy way to see citing articles.",
        ref: "https://pubmed.ncbi.nlm.nih.gov/help/#cited-by"
    },
    {
        label: "G Sch = Google Scholar for the DOI",
        description: "Google Scholar is an excellent reference resource for articles, including its own citation counts (which may be slightly inflated). The best way to find an article in Google Scholar is by its DOI (Digital Object Identifier) — a unique string used to identify an article and provide it with a permanent web address. I use the PubMed article's DOI (97% have one) to link directly to Google Scholar.",
        ref: "https://scholar.google.com/intl/en/scholar/about.html"
    },
    {
        label: "Con = Connections citation graph (doilookup.com)",
        description: "Connections opens an interactive citation graph for the article on doilookup.com, built from OpenAlex data. It maps three views — references the article cites (Inside), papers that cite it (Outside), and a combined Mix — with bubbles color-coded by journal quality and tagged for free full text; click any paper for its title, journal, year, citation count, and abstract. You can re-center on any paper or run a multi-level expansion that surfaces the foundational, most co-cited works across the wider neighborhood.",
        ref: "https://doilookup.com/"
    },
    {
        label: "Abstract = Abstract (click to view)",
        description: "The abstract is a short description of the article, present on 99% of PubMed articles. Normally you have to open the article to read it — this provides a quick way to view the abstract without leaving the search results.",
        ref: "https://pubmed.ncbi.nlm.nih.gov/18830537/"
    },
    {
        label: "link = Full-text link",
        description: "PubMed provides the abstract and metadata, but not the full article text. It links to the actual article (typically in the top-right of the article page). Some articles require a paid subscription — many university libraries have subscriptions, so if you're logged into their system you can access articles behind the paywall. If a free version is available (e.g., PMC), I provide that link; otherwise I link to the publisher's page.",
        ref: "https://www.ncbi.nlm.nih.gov/guide/howto/obtain-full-text/"
    },
    {
        label: "✓ = Add to export list (green when added)",
        description: `The check at the start of the second row adds an article to your export list. Grey means not added, green means added. Click it again to remove it.

Adding an article fetches its complete record from PubMed — all authors, volume, issue, pages, abstract and MeSH terms — so the check turns amber and pulses for a moment while that happens. If the fetch fails the check stays grey and tells you why, rather than turning green with nothing behind it.

<strong>SELECTIONS PERSIST</strong>
<ul>
<li>Articles stay checked as you page through results and run new searches, so you can gather from several searches before exporting</li>
<li>Re-adding an article you removed is instant — its record is kept, so PubMed is not asked twice</li>
<li>The list is cleared when you switch the citation bar off</li>
</ul>

Requests are spaced a second apart, so checking quickly down a page queues them rather than tripping NCBI's rate limit. Clicking one article at a time never waits.`,
        ref: null
    },
    {
        label: "Checklist icon = Open the export list",
        description: `Next to the check, the checklist icon opens your export list. It is grey when nothing is selected, and blue with a count once you have added articles — that count is the same on every bar on the page.

The list shows each article with its title, journal, year and PMID, and an ✕ to remove it. Articles added on an earlier page show as their PMID, since their details are no longer on screen.

<strong>FOUR ACTIONS</strong>
<ul>
<li><strong>Clear all:</strong> empties the list</li>
<li><strong>Open in new tab:</strong> shows the selected articles as a PubMed search, in a new tab so you keep your place in the results you were working through</li>
<li><strong>Download .ris:</strong> RIS format — EndNote, Mendeley, RefWorks, Papers, Zotero</li>
<li><strong>Download .nbib:</strong> MEDLINE format — the same file PubMed's own "Send to → Citation manager" produces; Zotero and EndNote</li>
</ul>

Both downloads carry the full record for every article, including the abstract and MeSH terms. Files are named with the date and time (for example <code>pubmed-citations-2026-09-12-3-04pm.nbib</code>), so exporting several times in a day never overwrites an earlier file.

PubMed accepts at most 200 articles in one search, so "Open in new tab" shows the first 200 if your list is longer — the list says so when that applies. The downloads have no limit.`,
        ref: null
    },
    {
        label: "Author = Author Information",
        description: `Shows first and last authors (in academic convention, first author typically leads the work, last author leads the lab).

<strong>SEARCH LINKS</strong>
<ul>
<li><strong>PubMed:</strong> Uses ORCID (a widely used author ID, Ref: <a href="https://orcid.org/" target="_blank">https://orcid.org/</a>) when available; otherwise uses last name and first initial</li>
<li><strong>ORCID Profile:</strong> Provides detailed author information with unique researcher ID - more reliable than name-based searches (not all articles include ORCIDs)</li>
</ul>

<em>Note: Name-based searches may include other researchers with similar names. ORCID provides accurate identification.</em>

<strong>METRICS (from OpenAlex, requires ORCID)</strong>
<ul>
<li><strong>h-index:</strong> Minimum number of citations across papers. Example: 12 papers all with ≥12 citations = h-index of 12 (Ref: <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC10771139/" target="_blank">https://pmc.ncbi.nlm.nih.gov/articles/PMC10771139/</a>)</li>
<li><strong>i10-index:</strong> Number of papers with ≥10 citations</li>
<li><strong>2yr citation rate:</strong> Average citations per paper over 2 years</li>
</ul>

<em>Note: Different sources (Google Scholar, Scopus, Web of Science) calculate these metrics slightly differently due to varying citation databases. See Ref: <a href="https://en.wikipedia.org/wiki/Author-level_metrics" target="_blank">https://en.wikipedia.org/wiki/Author-level_metrics</a></em>

<strong>AFFILIATIONS</strong>
Lists institutional affiliations from the article.`,
        ref: null
    },
    {
        label: "||| = Divider",
        description: "A visual separator between article-level information (to the left) and journal-level information (to the right).",
        ref: null
    },
    {
        label: "Top-J = Top Journal",
        description: "My own curated list of top medical journals, including associated journals within publisher umbrellas (e.g., JAMA family). Matched by ISSN — displays \"Yes\" if the journal matches. The list is intentionally small and highly selective. Current list: Annals of Internal Medicine, British Medical Journal (BMJ), European Heart Journal, Journal of the American College of Cardiology, JAMA, Lancet, Nature, New England Journal of Medicine. I'm open to suggestions, but it's designed to be a super-MVP list.",
        ref: null
    },
    {
        label: "SJR = SCImago Journal Rank",
        description: "A widely respected, free journal ranking. The SCImago Journal Rank (SJR) measures journal visibility using an algorithm similar to Google's PageRank™. SCImago is a research group affiliated with several Spanish universities and the CSIC, specializing in information analysis and visualization.",
        ref: "https://www.scimagojr.com/aboutus.php"
    },
    {
        label: "YTD = Journal articles year-to-date",
        description: "The number of articles this journal (by ISSN) published over the period covered by the extension's ranking data. I pull all PubMed data (typically monthly) and rank journals by total articles, free articles, and Medline-indexed articles for the year. That ranking data ships with the extension and is refreshed with each release, so the figures cover the period stated in the ranking file. When I was learning PubMed, something like this would have been very helpful — I hope it is for you too.",
        ref: null
    },
    {
        label: "Medline % = Percentage of journal articles Medline YTD",
        description: "The percentage of a journal's articles (by ISSN) that have been indexed for Medline over the same period. This is from my own ranking data. Note that this reflects indexing rather than journal quality: recently published articles may not be indexed yet, so a journal that publishes frequently can show a lower percentage than its eventual rate.",
        ref: null
    },
    {
        label: "Free % = Percentage of journal articles with free full text YTD",
        description: "The percentage of a journal's articles (by ISSN) available as free full text over the same period. This is from the same ranking data as the YTD count and Medline %.",
        ref: null
    },
    {
        label: "Xout = Exclusion Search",
        description: `Re-search PubMed with filters to exclude non-primary research. Opens a dialog with your current search pre-filled and checkboxes to exclude publication types that collectively represent approximately 25% of all PubMed articles:

<ul>
<li><strong>Has Abstract:</strong> Requires articles to have an abstract (recommended — articles without abstracts are rarely peer-reviewed primary research)</li>
<li><strong>No Retracted Publications:</strong> Excludes retraction notices (not the original article, just the notice)</li>
<li><strong>No Published Errata:</strong> Excludes correction/erratum notices</li>
<li><strong>No Letters:</strong> Excludes letters to the editor</li>
<li><strong>No Editorials:</strong> Excludes editorial pieces</li>
<li><strong>No Comments:</strong> Excludes commentary articles</li>
<li><strong>No Systematic Reviews:</strong> Excludes systematic reviews</li>
<li><strong>No Meta-Analyses:</strong> Excludes meta-analyses</li>
<li><strong>No Reviews:</strong> Excludes review articles</li>
</ul>

All filters are checked by default. Uncheck any filter to allow that type through. The full query preview updates live as you adjust filters. You can search directly (navigates current tab), copy the query, or cancel.`,
        ref: null
    },
    {
        label: "pR = PubMed Reports (key overviews)",
        description: "Opens a menu with four PubMed report tools on the PubMed Citation Bar site: PubMed Summary Report (overview of a PubMed search), PubMed Filters Report (filter analysis), PubMed MeSH Counts (MeSH term frequency counts), and PubMed Journal Ranking (journal ranking data). Each opens in a new tab.",
        ref: "https://tomlaheyh.github.io/citation-bar/"
    },
    {
        label: "/Report = Citation report",
        description: "A report listing all key measures and links for an article in an easy-to-copy format. Two buttons on the popup export the whole page of results: \"Excel\" gives a tab-separated table of exactly what the bar shows — one row per article, ready to paste straight into Excel or Google Sheets — while \"Data\" dumps everything, PMIDs first, then all measures, extension timestamps and internal fields. That second one is full disclosure of all data the extension uses. There is zero user tracking.",
        ref: null
    },
    {
        label: "Memory = free system memory (turns red when low)",
        description: "Shown at the bottom of the extension popup. Chrome keeps the pages you have already visited in a tab held in memory so that Back is instant, so a PubMed tab used for many searches gradually holds a great deal of it. This happens with or without this extension \u2014 a run of searches adds memory either way, and the citation bar makes each retained page larger.<br><br>To stop that building up, the extension reopens your tab on the same page after the citation bar has run six times. You stay on the results you were looking at and nothing needs retyping; what you lose is that tab's Back history, which is a fair trade for the memory it frees. It never does this in the middle of a Scan 1,000, or while you are on a High Impact or Scan 1,000 results page.<br><br>The Memory line turns red when free memory drops below 2 GB, which is where Chrome starts to struggle on any size of machine. When it does, closing applications you are not using is usually enough. The Reset Extension button also clears the extension's stored data and Chrome's cache and reopens the tab, if you want to do it by hand.",
        ref: null
    }
];

// Generate HTML for help items
export function generateHelpHTML() {
    let html = '';
    helpItems.forEach((item, index) => {
        const refLink = item.ref 
            ? ` <a href="${item.ref}" target="_blank" class="help-ref-link">Ref</a>` 
            : '';
        
        html += `<div class="help-item">
            <div class="help-item-label"><strong>${item.label}</strong>${refLink}</div>
            <div class="help-item-description">${item.description}</div>
        </div>`;
        
        // Add separator between items (except last)
        if (index < helpItems.length - 1) {
            html += '<hr class="help-separator">';
        }
    });
    return html;
}

export const helpStyles = `
    .citation-help {
        display: inline-block;
        width: 16px;
        height: 16px;
        background-color: #0066cc;
        color: white;
        border-radius: 50%;
        text-align: center;
        line-height: 16px;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        margin-right: 5px;
        position: relative;
    }
    
    .citation-help:hover {
        background-color: #0052a3;
    }

    .help-modal {
        display: none;
        position: fixed;
        z-index: 10001;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
    }

    .help-modal-content {
        background-color: white;
        margin: 5% auto;
        border: 1px solid #888;
        width: 90%;
        max-width: 600px;
        max-height: 80vh;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .help-modal-header {
        padding: 15px 20px;
        border-bottom: 1px solid #ddd;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background-color: #f5f5f5;
        border-radius: 8px 8px 0 0;
    }

    .help-modal-header h3 {
        margin: 0;
        font-size: 18px;
        color: #333;
    }

    .help-modal-close {
        cursor: pointer;
    }

        .help-modal-body {
        padding: 20px;
        overflow-y: auto;
        flex: 1;
    }

    .help-item {
        margin-bottom: 8px;
    }

    .help-item-label {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 4px;
    }

    .help-item-label strong {
        color: #333;
    }

    .help-item-description {
        color: #555;
        font-size: 13px;
        line-height: 1.5;
        padding-left: 0;
    }

    .help-item-description code {
        display: block;
        background-color: #f4f4f4;
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 12px;
        margin-top: 8px;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        font-size: 11px;
        line-height: 1.4;
        overflow-x: auto;
        white-space: pre;
        color: #333;
    }

    .help-ref-link {
        color: #0066cc;
        text-decoration: none;
        font-size: 12px;
        font-weight: normal;
        margin-left: 8px;
    }

    .help-ref-link:hover {
        text-decoration: underline;
    }

    .help-separator {
        border: none;
        border-top: 1px solid #eee;
        margin: 12px 0;
    }

    .help-version {
        text-align: center;
        color: #999;
        font-size: 11px;
        padding: 10px;
        border-top: 1px solid #eee;
        margin-top: 10px;
    }

    /* Tooltip styles for citation bar items */
    [data-tooltip] {
        position: relative;
    }

    [data-tooltip]::after {
        content: attr(data-tooltip);
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        background-color: #333;
        color: white;
        padding: 6px 10px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: normal;
        white-space: nowrap;
        z-index: 10000;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.2s ease, visibility 0.2s ease;
        transition-delay: 0s;
        pointer-events: none;
        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        margin-bottom: 5px;
    }

    [data-tooltip]:hover::after {
        opacity: 1;
        visibility: visible;
        transition-delay: 1.5s;
    }
`;

// For backward compatibility, also export the old helpText format
export const helpText = {
    title: "Citation Bar Help",
    content: "Click the ? icon for detailed help information."
};
