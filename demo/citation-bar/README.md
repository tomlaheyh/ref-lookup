# Citation Bar demo

A frozen PubMed results page with the real citation bar running over it, so
people can try the extension without installing it. Published at
`/demo/citation-bar/`.

## Why it exists

Installing a Chrome extension is impossible on many managed hospital and
university machines, which is a large part of the audience. This page removes
that barrier and gives librarians something they can link to in a guide and
authors something they can cite in a paper.

## How it works

`demo.js` supplies everything the bar would normally get from Chrome or the
network:

- **`chrome.*` shim** — in-memory `storage.local`, plus `runtime.getURL` and a
  no-op `sendMessage`. Storage is not persisted, so every visitor gets a clean
  demo.
- **Seeded export cache** — `pcbExportRecords` is pre-filled with the MEDLINE
  record for every article on the page. The export list checks its cache before
  fetching, so ticking an article never touches the network, and the `.nbib` and
  `.ris` downloads produce genuine files.
- **Offline MeSH** — the MeSH modal parses efetch XML. `demo.js` rebuilds that
  XML from the `MH` lines already present in the cached MEDLINE records, so the
  terms shown are real, including major-topic asterisks and subheadings.
- **Fetch interception** — anything addressed to NCBI is answered locally.
  Nothing reaches an API.

Outbound links (Altmetric, Google Scholar, Semantic Scholar, SJR, PMC, PubMed,
doilookup) are left alone and work normally — a visitor clicking one is ordinary
browsing.

Two features can't be demonstrated because they need a live search: **Xout** and
**Scan 1,000**. The page footer says so.

## Updating the data

The extension generates its own fixtures. Run a search that shows the range of
the bar — ideally including a retraction, a preprint, something trending, a free
full-text article and a spread of scores — let the bar load, then tick every
article. That caches a full MEDLINE record (abstract and MeSH included) for each
one.

Then in the extension's service worker console:

```js
(async () => {
  const d = await chrome.storage.local.get(['fullDataSet', 'pcbExportRecords']);
  copy(JSON.stringify({
    capturedUTC: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version,
    query: 'the search term you used',
    fullDataSet: d.fullDataSet || [],
    medlineRecords: d.pcbExportRecords || {}
  }, null, 1));
})();
```

Paste into `data/demo-data.json`. The article count and the MEDLINE record count
should match; if records is lower, some ticks failed and those articles will have
no abstract or MeSH terms in the demo.

## Keeping it current

`citationBarContentScript.js` and `helpContent.js` here are **copies** taken from
the extension. They do not update themselves. When the bar changes in a way a
visitor would notice, copy both files again and recapture the data.

Snapshot source: PubMed Citation Bar **v3.820**.
