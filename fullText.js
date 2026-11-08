// fullText.js - Full-text section under the abstract on doilookup.com.
// The JATS-to-Markdown converter and the light formatter (from PACK_MIN_WORDS
// down to renderPmcFullText) are copied unchanged from the PubMed Citation Bar
// extension (citationBarContentScript.js); keep the two in step.
//
// Public API:
//   window.FullText.attach(slotElement, result)  - when the card is drawn; fetches nothing
//   window.FullText.open(slotElement)            - from the abstract's expand button; fills once
// ============================================================================

(function () {
  'use strict';

  const PACK_MIN_WORDS = 250;

  const PACK_BLOCK = new Set(['table-wrap', 'table-wrap-group', 'fig', 'fig-group', 'list',
      'disp-formula', 'boxed-text', 'disp-quote', 'def-list', 'supplementary-material']);

  function packClean(s) {
      return String(s || '').replace(/\s+/g, ' ').replace(/\s+([,.;:)\]])/g, '$1').trim();
  }

  function packEmphasis(mark, text) {
      const t = text.trim();
      if (!t) return text;
      const lead = text.match(/^\s*/)[0];
      const trail = text.match(/\s*$/)[0];
      return `${lead}${mark}${t}${mark}${trail}`;
  }

  function packInline(node) {
      let out = '';
      node.childNodes.forEach(child => {
          if (child.nodeType === 3) { out += child.nodeValue; return; }
          if (child.nodeType !== 1) return;
          const name = child.localName;
          if (PACK_BLOCK.has(name)) return;
          if (name === 'italic') out += packEmphasis('*', packInline(child));
          else if (name === 'bold') out += packEmphasis('**', packInline(child));
          else if (name === 'xref' && child.getAttribute('ref-type') === 'bibr') {
              const t = packClean(packInline(child));
              out += /^\[.*\]$/.test(t) ? t : `[${t}]`;
          } else if (name === 'sup') {
              const hasRef = child.querySelector('xref');
              out += hasRef ? packInline(child) : `^${packInline(child)}`;
          } else if (name === 'ext-link' || name === 'uri') {
              const href = child.getAttribute('xlink:href') || child.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
              const t = packClean(packInline(child));
              out += href && /^https?:/i.test(href) ? `[${t || href}](${href})` : t;
          } else if (name === 'break') out += ' ';
          else if (name === 'inline-graphic' || name === 'fn') { /* skip */ }
          else out += packInline(child);
      });
      return out;
  }

  function packChild(node, name) {
      return Array.from(node.children).find(c => c.localName === name) || null;
  }

  function packCaption(node, kind) {
      const label = packChild(node, 'label');
      const caption = packChild(node, 'caption');
      const parts = [];
      if (label) parts.push(packClean(packInline(label)));
      if (caption) {
          const title = packChild(caption, 'title');
          if (title) parts.push(packClean(packInline(title)));
          Array.from(caption.children).filter(c => c.localName === 'p')
              .forEach(p => parts.push(packClean(packInline(p))));
      }
      return parts.filter(Boolean).join(' ') || kind;
  }

  function packTable(wrap) {
      const out = [`**${packCaption(wrap, 'Table')}**`];
      const table = wrap.querySelector('table');
      if (!table) {
          out.push('_(This table is an image in the original article and is not included.)_');
      } else {
          const rows = Array.from(table.querySelectorAll('tr')).map(tr =>
              Array.from(tr.children).filter(c => c.localName === 'th' || c.localName === 'td')
                  .map(c => packClean(packInline(c)).replace(/\|/g, '\\|')));
          const width = Math.max(0, ...rows.map(r => r.length));
          if (width > 0) {
              const pad = r => r.concat(Array(width - r.length).fill(''));
              out.push('| ' + pad(rows[0]).join(' | ') + ' |');
              out.push('|' + ' --- |'.repeat(width));
              rows.slice(1).forEach(r => out.push('| ' + pad(r).join(' | ') + ' |'));
          }
      }
      const foot = packChild(wrap, 'table-wrap-foot');
      if (foot) {
          const text = packClean(packInline(foot) || foot.textContent);
          if (text) out.push(`_${text}_`);
      }
      return out.join('\n');
  }

  function packList(list) {
      const ordered = list.getAttribute('list-type') === 'order';
      return Array.from(list.children).filter(c => c.localName === 'list-item').map((item, i) => {
          const text = Array.from(item.children).map(c => packClean(packInline(c))).filter(Boolean).join(' ')
              || packClean(packInline(item));
          return `${ordered ? `${i + 1}.` : '-'} ${text}`;
      }).join('\n');
  }

  function packBlocks(node, level, out) {
      Array.from(node.children).forEach(child => {
          const name = child.localName;
          if (name === 'sec' || name === 'app' || name === 'boxed-text' || name === 'ack') {
              const title = packChild(child, 'title');
              const heading = title ? packClean(packInline(title)) : (name === 'ack' ? 'Acknowledgements' : '');
              if (heading) out.push(`${'#'.repeat(Math.min(level, 6))} ${heading}`);
              packBlocks(child, level + 1, out);
          } else if (name === 'title' || name === 'label' || name === 'sec-meta') {
              // titles are handled by the parent; labels by captions
          } else if (name === 'p') {
              const text = packClean(packInline(child));
              if (text) out.push(text);
              Array.from(child.children).filter(c => PACK_BLOCK.has(c.localName))
                  .forEach(c => packBlocks({ children: [c] }, level, out));
          } else if (name === 'table-wrap') {
              out.push(packTable(child));
          } else if (name === 'fig') {
              out.push(`_Figure: ${packCaption(child, 'Figure')}_`);
          } else if (name === 'list') {
              out.push(packList(child));
          } else if (name === 'disp-formula') {
              const text = packClean(child.textContent);
              if (text) out.push('`' + text + '`');
          } else if (name === 'disp-quote') {
              out.push('> ' + packClean(packInline(child) || child.textContent));
          } else if (name === 'supplementary-material') {
              out.push(`_Supplementary material: ${packCaption(child, 'see the original article')}_`);
          } else if (name === 'ref-list' || name === 'fn-group' || name === 'glossary') {
              // references are written separately; notes and glossaries skipped
          } else {
              packBlocks(child, level, out);
          }
      });
  }

  const PACK_CITE_SEP = { name: ',', 'string-name': ',', collab: ',', 'person-group': '.',
      'article-title': '.', 'chapter-title': '.', source: '.', year: ';' };

  function packSpacedText(node) {
      const structured = node.localName === 'element-citation';
      const parts = [];
      (function walk(n) {
          n.childNodes.forEach(c => {
              if (c.nodeType === 3) parts.push(c.nodeValue);
              else if (c.nodeType === 1) {
                  parts.push(' ');
                  walk(c);
                  parts.push(structured && PACK_CITE_SEP[c.localName] ? PACK_CITE_SEP[c.localName] + ' ' : ' ');
              }
          });
      })(node);
      return packClean(parts.join('')).replace(/,\s*\./g, '.').replace(/([.;,])\s*\1/g, '$1').replace(/[;,]\s*$/, '');
  }

  function jatsToMarkdown(xmlText) {
      const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
      const article = doc.querySelector('article');
      const body = article && article.querySelector('body');
      if (!body) return null;
      const meta = article.querySelector('front article-meta');

      const sections = [];
      if (meta) {
          const abstract = Array.from(meta.children).find(c => c.localName === 'abstract' && !c.getAttribute('abstract-type'))
              || Array.from(meta.children).find(c => c.localName === 'abstract');
          if (abstract) {
              const parts = [];
              packBlocks(abstract, 3, parts);
              if (parts.length) sections.push('## Abstract', ...parts);
          }
      }

      const bodyParts = [];
      packBlocks(body, 2, bodyParts);
      sections.push(...bodyParts);

      // Many articles keep tables and figures in a floats-group after the
      // body rather than inside it.
      const floats = Array.from(article.children).find(c => c.localName === 'floats-group');
      if (floats) {
          const floatParts = [];
          packBlocks(floats, 2, floatParts);
          if (floatParts.length) sections.push('## Tables and figures', ...floatParts);
      }

      const back = article.querySelector('back');
      if (back) {
          const backParts = [];
          packBlocks(back, 2, backParts);
          sections.push(...backParts);
      }

      // References can sit in the back matter or inside a body section.
      // Returned separately: the pack puts them in their own file, since
      // they can outweigh the article (4,003 in one AHA report).
      const refs = Array.from(article.querySelectorAll('ref-list ref'));
      const refLines = refs.map((ref, i) => {
          const label = packChild(ref, 'label');
          const cite = ref.querySelector('mixed-citation, element-citation, citation');
          const text = packSpacedText(cite || ref).replace(/^\[?\d+\]?\.?\s+/, '');
          return `${label ? packClean(label.textContent).replace(/[.\[\]]/g, '') : i + 1}. ${text}`;
      });

      let license = '';
      const lic = meta && meta.querySelector('permissions license');
      if (lic) {
          license = lic.getAttribute('xlink:href') || lic.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
          const licText = packSpacedText(lic);
          if (licText) license = license ? `${license} (${licText.slice(0, 200)})` : licText.slice(0, 200);
      }

      const markdown = sections.join('\n\n');
      const words = packClean(bodyParts.join(' ')).split(' ').filter(Boolean).length;
      // Some articles carry only tables, figures and references in the XML,
      // with the text itself in supplementary files (the AHA Statistical
      // Update: 38 words of body). Marked partial, so nobody - the user or
      // the AI - takes it for the article.
      return {
          markdown, words, license,
          references: refs.length,
          referencesMarkdown: refLines.join('\n\n'),
          partial: words < PACK_MIN_WORDS
      };
  }

  function renderPmcFullText(container, markdown) {
      const inline = s => s
          .replace(/\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '$1')
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/(^|[\s(\[])\*(\S(?:.*?\S)?)\*(?=[\s).,;:\]]|$)/g, '$1$2')
          .replace(/`([^`]+)`/g, '$1')
          .replace(/\\\|/g, '|');
      markdown.split(/\n{2,}/).forEach(block => {
          const el = document.createElement('div');
          const heading = block.match(/^(#{1,6}) (.+)$/);
          if (heading) {
              el.style.cssText = `margin:14px 0 6px;font-weight:bold;font-size:${heading[1].length <= 2 ? 15 : 14}px;`;
              el.textContent = inline(heading[2]);
          } else {
              let isTable = false;
              const lines = block.split('\n')
                  .filter(line => !/^\|(\s*-{3,}\s*\|)+\s*$/.test(line))
                  .map(line => {
                      if (/^\|.*\|\s*$/.test(line)) {
                          isTable = true;
                          line = line.replace(/^\|\s?/, '').replace(/\s?\|\s*$/, '');
                      }
                      return inline(line.replace(/^_(.+)_$/, '$1').replace(/^> /, ''));
                  });
              el.style.cssText = 'margin:0 0 10px;white-space:pre-line;' + (isTable ? 'font-size:12px;' : '');
              el.textContent = lines.join('\n');
          }
          container.appendChild(el);
      });
  }

  // ---- Site-specific: the full-text section under the abstract -------------
  var EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
  var cache = {}; // PMCID -> loaded result, for this page (failures are not kept)

  function timedFetch(url, ms) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, ms);
    return fetch(url, { signal: controller.signal }).finally(function () { clearTimeout(timer); });
  }

  // Readable licence label: "open access (CC BY 4.0)", "free for text mining", ...
  function fullTextLicenceLabel(license, isOA) {
    var cc = String(license || '').match(/creativecommons\.org\/licenses\/([a-z-]+)\/([\d.]+)/i);
    if (cc) return 'open access (CC ' + cc[1].toUpperCase() + ' ' + cc[2] + ')';
    if (/publicdomain|public domain|US Government employee/i.test(license || '')) return 'public domain';
    if (/text mining/i.test(license || '')) return 'free for text mining';
    return isOA ? 'open access' : 'free to read';
  }

  // Open access: Europe PMC (fast). Anything else, or Europe PMC failing: PMC,
  // which serves some free-to-read articles (NIH author manuscripts, text-mining
  // releases) and refuses the rest.
  // -> { markdown, words, partial, source, label } | { refused: true } | { failed: true }
  async function loadPmc(pmcid) {
    var isOA = false;
    try {
      var s = await timedFetch(EPMC + '/search?query=PMCID:' + pmcid + '&resultType=lite&format=json', 15000);
      if (s.ok) {
        var hits = (((await s.json()).resultList || {}).result) || [];
        isOA = !!(hits[0] && hits[0].isOpenAccess === 'Y');
      }
    } catch (e) { /* fall through to PMC */ }
    if (isOA) {
      try {
        var r = await timedFetch(EPMC + '/' + pmcid + '/fullTextXML', 20000);
        if (r.ok) {
          var c = jatsToMarkdown(await r.text());
          if (c && c.words > 0) return Object.assign(c, { source: 'Europe PMC', label: fullTextLicenceLabel(c.license, true) });
        }
      } catch (e) { /* fall through to PMC */ }
    }
    var xml;
    try {
      var p = await timedFetch('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=' + pmcid, 45000);
      if (!p.ok) return { failed: true };
      xml = await p.text();
    } catch (e) { return { failed: true }; }
    if (/does not allow downloading/i.test(xml)) return { refused: true };
    var conv = jatsToMarkdown(xml);
    if (!conv || conv.words === 0) return { refused: true };
    return Object.assign(conv, { source: 'PubMed Central', label: fullTextLicenceLabel(conv.license, isOA) });
  }

  var VERSION_LABELS = { publishedVersion: 'published version', acceptedVersion: 'accepted manuscript', submittedVersion: 'preprint' };

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  // Unpaywall licence codes: "cc-by" -> "CC BY", "cc-by-nc-nd" -> "CC BY-NC-ND", "public-domain"
  function unpaywallLicence(code) {
    if (!code) return '';
    if (/^cc-/i.test(code)) return 'CC ' + code.slice(3).toUpperCase();
    if (code === 'cc0') return 'CC0';
    if (code === 'public-domain' || code === 'pd') return 'public domain';
    return '';
  }

  // slot: the hidden div under the abstract. Gets a divider and a status line;
  // PMC articles also get their text.
  function fill(slot, result) {
    slot.style.cssText = 'margin: 0 0 12px; padding: 8px 0; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd;';
    var status = document.createElement('div');
    status.style.cssText = 'font-size: 13px; color: #666; margin-bottom: 8px;';
    slot.appendChild(status);
    function say(text, href, linkText) {
      status.textContent = text;
      if (href) {
        var a = document.createElement('a');
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = linkText;
        status.appendChild(a);
      }
    }

    var pmcid = result.pubmedPMCID ? 'PMC' + String(result.pubmedPMCID).replace(/^PMC/i, '') : '';
    if (pmcid) {
      var pmcUrl = 'https://pmc.ncbi.nlm.nih.gov/articles/' + pmcid + '/';
      var show = function (r) {
        if (!slot.isConnected) return;
        if (r.markdown) {
          say('Full text from ' + r.source + ' · ' + r.label);
          if (r.partial) {
            var note = document.createElement('div');
            note.style.cssText = status.style.cssText;
            note.textContent = 'Only part of this article\'s text is in PMC (' + r.words + ' words); the rest is in the original article.';
            slot.appendChild(note);
          }
          var body = document.createElement('div');
          body.style.cssText = 'font-size: 14px; color: #333; line-height: 1.55;';
          renderPmcFullText(body, r.markdown);
          slot.appendChild(body);
          slot.appendChild(closeButton(slot));
        } else if (r.refused) {
          say('Free to read in PMC, but not open access, so it cannot be shown here. ', pmcUrl, 'Open in PMC');
        } else {
          say('The full text could not be loaded right now. Look the DOI up again to retry, or ', pmcUrl, 'open it in PMC');
        }
      };
      if (cache[pmcid]) { show(cache[pmcid]); return; }
      say('Loading full text…');
      loadPmc(pmcid).then(function (r) {
        if (!r.failed) cache[pmcid] = r;
        show(r);
      });
      return;
    }

    var best = result._oaBest;
    if (best && best.url) {
      var where = hostOf(best.url);
      var lic = unpaywallLicence(best.license);
      say('Free to read: ' + (VERSION_LABELS[best.version] || 'free copy') + (where ? ' at ' + where : '') + (lic ? ' · ' + lic : '') + '. ', best.url, 'Open');
      return;
    }
    var doi = result.doiOrgDoi || '';
    var arxiv = doi.match(/^10\.48550\/arxiv\.(.+)$/i);
    if (arxiv) { say('Free to read at arxiv.org. ', 'https://arxiv.org/abs/' + arxiv[1], 'Open'); return; }
    if (result.doiOrgRa && result.doiOrgRa !== 'Crossref') {
      say('Free full-text status is not available for ' + result.doiOrgRa + ' DOIs. ', 'https://doi.org/' + doi, 'Open the record');
      return;
    }
    say('No free full text found.');
  }

  // A second "show less" at the end of a full text, so a reader who has scrolled
  // down can close it from the bottom. It works the abstract's own button, so the
  // two stay in step, then brings the abstract back into view.
  function closeButton(slot) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'show less';
    btn.style.cssText = 'font-family:IBM Plex Mono,monospace;font-size:11px;padding:2px 8px;background:#005a8c;color:#fff;border:none;cursor:pointer;margin-top:4px;';
    btn.addEventListener('click', function () {
      var top = slot.id ? document.querySelector('button[onclick*="' + slot.id + '"]') : null;
      if (!top) { slot.style.display = 'none'; return; }
      top.click();
      if (top.scrollIntoView) top.scrollIntoView({ block: 'center' });
    });
    return btn;
  }

  // Called when the card is drawn: remember the article, fetch nothing yet.
  function attach(slot, result) {
    if (slot) slot._ftResult = result;
  }

  // Called by the abstract's expand button: fill the section on the first click only.
  function open(slot) {
    if (!slot || slot._ftStarted) return;
    slot._ftStarted = true;
    fill(slot, slot._ftResult || {});
  }

  window.FullText = { attach: attach, open: open };
})();
