// citationBarContentScript.js - DOM manipulation logic that runs in page context

const REF_LOOKUP_URL = 'https://doilookup.com/';

export function injectCitationBars(fullDataSet, states, helpText, helpStyles, helpContentHTML, tooltips, handlers, injectToken) {
   // injectToken identifies the extension context doing the injecting.
   //
   // This function runs again on every tabs.onUpdated AND every tabs.onActivated,
   // i.e. every time the user switches back to the PubMed tab. It used to re-add
   // a stylesheet, three window/document listeners and ~14 listeners per bar on
   // every one of those runs, none of which were ever removed. The guards below
   // make a repeat injection close to free.
   //
   // Keyed on the token rather than a plain boolean so a NEW extension context
   // (auto-update, or a reload during development) still rebinds: those old
   // listeners belong to an invalidated context and would throw when clicked.
   const bindOnce = (el, key) => {
       if (el.dataset[key] === injectToken) return false;
       el.dataset[key] = injectToken;
       return true;
   };
   let injectedCount = 0;
   const insertedPMIDs = new Set(); // Track inserted PMIDs

   // Function to get iCite URL for a specific PMID
   async function getICiteUrl(pmid) {
       try {
           const response = await fetch('https://icite.od.nih.gov/iciterest/store-search', {
               method: 'POST',
               headers: {
                   'Content-Type': 'application/json'
               },
               body: JSON.stringify({
                   userType: 'app',
                   searchType: 'List of PMIDs input',
                   searchRequest: {
                       pubmedQueryStr: '',
                       uploadedFileName: '',
                       pmids: [pmid],
                       activeTab: 'infl',
                       papersSearch: '',
                       filters: []
                   }
               })
           });

           if (!response.ok) {
               throw new Error(`HTTP error! status: ${response.status}`);
           }

           const data = await response.json();
           if (data.id) {
               return `https://icite.od.nih.gov/results?searchId=${data.id}`;
           } else {
               return null;
           }
       } catch (error) {
           console.error('Error getting iCite URL:', error);
           return null;
       }
   }

   // Function to get Altmetric score for a specific DOI (via background script to avoid CORS)
   async function getAltmetricScore(doi) {
       if (!doi || doi === '0') {
           return null;
       }

       try {
           const response = await chrome.runtime.sendMessage({
               action: 'getAltmetricScore',
               doi: doi
           });
           return response?.score || null;
       } catch (error) {
           console.error('Error getting Altmetric score:', error);
           return null;
       }
   }

   // Function to get OpenAlex author metrics for a specific ORCID
   async function getOpenAlexMetrics(orcid) {
       if (!orcid) {
           return null;
       }

       try {
           const url = `https://api.openalex.org/authors/orcid:${orcid}`;
           const response = await fetch(url);
           
           if (!response.ok) {
               throw new Error(`HTTP error! status: ${response.status}`);
           }
           
           const data = await response.json();
           
           if (data.summary_stats) {
               return {
                   hIndex: data.summary_stats.h_index || null,
                   i10Index: data.summary_stats.i10_index || null,
                   twoYrCites: data.summary_stats['2yr_mean_citedness'] || null
               };
           }
           
           return null;
       } catch (error) {
           console.error('Error getting OpenAlex metrics:', error);
           return null;
       }
   }

   // Shared function to fetch abstract on-demand from PubMed
   async function fetchAbstractOnDemand(pmid) {
       try {
           const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml`;
           const response = await fetch(url);
           
           if (!response.ok) {
               throw new Error(`HTTP error! status: ${response.status}`);
           }
           
           const xmlText = await response.text();
           
           // --- Extract abstract ---
           let abstract = 'No abstract';
           const abstractStart = xmlText.indexOf('<Abstract>');
           const abstractEnd = xmlText.indexOf('</Abstract>');
           
           if (abstractStart !== -1 && abstractEnd !== -1) {
               const abstractSection = xmlText.substring(abstractStart, abstractEnd + 11);
               
               if (abstractSection.includes('Label="')) {
                   const structuredPattern = /<AbstractText Label="([^"]+)"[^>]*>([\s\S]*?)<\/AbstractText>/g;
                   let structuredAbstract = [];
                   let match;
                   
                   while ((match = structuredPattern.exec(abstractSection)) !== null) {
                       const label = match[1];
                       const content = match[2].replace(/<[^>]*>/g, '').trim();
                       structuredAbstract.push(`${label}: ${content}`);
                   }
                   
                   if (structuredAbstract.length > 0) {
                       abstract = structuredAbstract.join('\n\n');
                   }
               } else {
                   const simplePattern = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/;
                   const simpleMatch = abstractSection.match(simplePattern);
                   
                   if (simpleMatch && simpleMatch[1]) {
                       abstract = simpleMatch[1].replace(/<[^>]*>/g, '').trim();
                   }
               }
           }
           
           // --- Extract grants ---
           const grants = [];
           const grantListMatch = xmlText.match(/<GrantList[^>]*>([\s\S]*?)<\/GrantList>/);
           if (grantListMatch) {
               const grantPattern = /<Grant>([\s\S]*?)<\/Grant>/g;
               let grantMatch;
               while ((grantMatch = grantPattern.exec(grantListMatch[1])) !== null) {
                   const grantXml = grantMatch[1];
                   const grantIdMatch = grantXml.match(/<GrantID>([^<]+)<\/GrantID>/);
                   const agencyMatch = grantXml.match(/<Agency>([^<]+)<\/Agency>/);
                   const countryMatch = grantXml.match(/<Country>([^<]+)<\/Country>/);
                   grants.push({
                       grantId: grantIdMatch ? grantIdMatch[1].trim() : 'N/A',
                       agency: agencyMatch ? agencyMatch[1].trim() : 'N/A',
                       country: countryMatch ? countryMatch[1].trim() : null
                   });
               }
           }
           
           // --- Extract author count ---
           const authorMatches = xmlText.match(/<Author /g);
           const authorCount = authorMatches ? authorMatches.length : 0;
           
           return {
               abstract: abstract,
               grants: grants,
               authorCount: authorCount
           };
       } catch (error) {
           console.error('Error fetching abstract:', error);
           return {
               abstract: 'Error loading abstract',
               grants: [],
               authorCount: 0
           };
       }
   }

   // Author data functions
   async function getAuthorData(pmid) {
       try {
           const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml`;
           const response = await fetch(url);
           
           if (!response.ok) {
               throw new Error(`HTTP error! status: ${response.status}`);
           }
           
           const xmlText = await response.text();
           const parser = new DOMParser();
           const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
           
           // Extract affiliations first
           const affiliations = extractAffiliations(xmlDoc);
           
           // Extract all authors
           const authors = extractAuthors(xmlDoc, affiliations);
           
           if (authors.length === 0) {
               return {
                   firstAuthor: null,
                   lastAuthor: null,
                   isSingleAuthor: false,
                   totalAuthors: 0
               };
           }
           
           // Get first and last
           const firstAuthor = authors[0];
           const lastAuthor = authors[authors.length - 1];
           const isSingleAuthor = authors.length === 1;
           
           // Fetch OpenAlex metrics for authors with ORCID
           if (firstAuthor.orcid) {
               firstAuthor.openAlexMetrics = await getOpenAlexMetrics(firstAuthor.orcid);
           }
           if (lastAuthor.orcid && !isSingleAuthor) {
               lastAuthor.openAlexMetrics = await getOpenAlexMetrics(lastAuthor.orcid);
           }
           
           return {
               firstAuthor: firstAuthor,
               lastAuthor: isSingleAuthor ? null : lastAuthor,
               isSingleAuthor: isSingleAuthor,
               totalAuthors: authors.length
           };
           
       } catch (error) {
           console.error('Error fetching author data:', error);
           return {
               firstAuthor: null,
               lastAuthor: null,
               isSingleAuthor: false,
               totalAuthors: 0,
               error: error.message
           };
       }
   }

   function extractAffiliations(xmlDoc) {
       const affiliationMap = {};
       const affiliationInfos = xmlDoc.querySelectorAll('AffiliationInfo Affiliation');
       affiliationInfos.forEach((affEl, index) => {
           const affText = affEl.textContent.trim();
           if (affText) {
               affiliationMap[index + 1] = affText;
           }
       });
       return affiliationMap;
   }

   function extractAuthors(xmlDoc, affiliations) {
       const authors = [];
       const authorElements = xmlDoc.querySelectorAll('Author');
       
       authorElements.forEach((authorEl, authorIndex) => {
           const lastName = authorEl.querySelector('LastName')?.textContent || '';
           const foreName = authorEl.querySelector('ForeName')?.textContent || '';
           const initials = authorEl.querySelector('Initials')?.textContent || '';
           const firstName = foreName || initials;
           
           let orcid = '';
           const identifiers = authorEl.querySelectorAll('Identifier');
           identifiers.forEach(id => {
               if (id.getAttribute('Source') === 'ORCID') {
                   orcid = id.textContent.trim();
               }
           });
           
           const authorAffiliations = [];
           const affInfos = authorEl.querySelectorAll('AffiliationInfo Affiliation');
           affInfos.forEach(affEl => {
               const affText = affEl.textContent.trim();
               if (affText) {
                   authorAffiliations.push(affText);
               }
           });
           
           if (lastName) {
               authors.push({
                   lastName: lastName,
                   firstName: firstName,
                   fullName: `${firstName} ${lastName}`.trim(),
                   orcid: orcid,
                   affiliations: authorAffiliations,
                   position: authorIndex + 1
               });
           }
       });
       
       return authors;
   }

   function formatAuthorHTML(authorData) {
       if (!authorData.firstAuthor && !authorData.lastAuthor) {
           return '<div style="color: #666; font-style: italic;">Author information not available</div>';
       }
       
       let html = '<div style="margin-top: 10px;">';
       
       if (authorData.firstAuthor) {
           html += '<div style="margin-bottom: 8px;">';
           html += `<strong>First Author:</strong> ${authorData.firstAuthor.fullName}`;
           
           // Build PubMed search link (by ORCID if available, otherwise by name)
           let pubmedUrl;
           let pubmedTitle = '';
           if (authorData.firstAuthor.orcid) {
               pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/?term=${authorData.firstAuthor.orcid}[AUID]`;
           } else {
               const searchName = `${authorData.firstAuthor.lastName} ${authorData.firstAuthor.firstName.charAt(0)}`;
               pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(searchName)}[Author]`;
               pubmedTitle = 'Name-based search - may include other authors with similar names';
           }
           
           html += ` (<a href="${pubmedUrl}" target="_blank" style="color: #4CAF50; text-decoration: none;"${pubmedTitle ? ` title="${pubmedTitle}"` : ''}>PubMed</a>`;
           
           if (authorData.firstAuthor.orcid) {
               html += ` | <a href="https://orcid.org/${authorData.firstAuthor.orcid}" target="_blank" style="color: #4CAF50; text-decoration: none;">ORCID</a>`;
               html += ` | <a href="https://api.openalex.org/authors/orcid:${authorData.firstAuthor.orcid}" target="_blank" style="color: #4CAF50; text-decoration: none;">OpenAlex</a>`;
           }
           
           html += ')';
           
           // Display OpenAlex metrics or note if ORCID required
           if (authorData.firstAuthor.orcid) {
               if (authorData.firstAuthor.openAlexMetrics) {
                   const m = authorData.firstAuthor.openAlexMetrics;
                   html += '<div style="margin-left: 20px; font-size: 0.9em; color: #555; margin-top: 4px;">';
                   const metrics = [];
                   if (m.hIndex !== null) metrics.push(`h-index: ${m.hIndex}`);
                   if (m.i10Index !== null) metrics.push(`i10-index: ${m.i10Index}`);
                   if (m.twoYrCites !== null) metrics.push(`2yr cites: ${parseFloat(m.twoYrCites).toFixed(2)}`);
                   if (metrics.length > 0) {
                       html += `${metrics.join(', ')} (OpenAlex via ORCID)`;
                   }
                   html += '</div>';
               }
           } else {
               html += '<div style="margin-left: 20px; font-size: 0.9em; color: #555; margin-top: 4px;">h-index, i10-index require ORCID</div>';
           }
           
           if (authorData.firstAuthor.affiliations.length > 0) {
               html += '<div style="margin-left: 20px; font-size: 0.9em; color: #555; margin-top: 4px;">';
               authorData.firstAuthor.affiliations.forEach((aff, idx) => {
                   if (idx > 0) html += '<br>';
                   html += aff;
               });
               html += '</div>';
           }
           html += '</div>';
       }
       
       if (authorData.lastAuthor && !authorData.isSingleAuthor) {
           html += '<div style="margin-bottom: 8px;">';
           html += `<strong>Last Author:</strong> ${authorData.lastAuthor.fullName}`;
           
           // Build PubMed search link (by ORCID if available, otherwise by name)
           let pubmedUrl;
           let pubmedTitle = '';
           if (authorData.lastAuthor.orcid) {
               pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/?term=${authorData.lastAuthor.orcid}[AUID]`;
           } else {
               const searchName = `${authorData.lastAuthor.lastName} ${authorData.lastAuthor.firstName.charAt(0)}`;
               pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(searchName)}[Author]`;
               pubmedTitle = 'Name-based search - may include other authors with similar names';
           }
           
           html += ` (<a href="${pubmedUrl}" target="_blank" style="color: #4CAF50; text-decoration: none;"${pubmedTitle ? ` title="${pubmedTitle}"` : ''}>PubMed</a>`;
           
           if (authorData.lastAuthor.orcid) {
               html += ` | <a href="https://orcid.org/${authorData.lastAuthor.orcid}" target="_blank" style="color: #4CAF50; text-decoration: none;">ORCID</a>`;
               html += ` | <a href="https://api.openalex.org/authors/orcid:${authorData.lastAuthor.orcid}" target="_blank" style="color: #4CAF50; text-decoration: none;">OpenAlex</a>`;
           }
           
           html += ')';
           
           // Display OpenAlex metrics or note if ORCID required
           if (authorData.lastAuthor.orcid) {
               if (authorData.lastAuthor.openAlexMetrics) {
                   const m = authorData.lastAuthor.openAlexMetrics;
                   html += '<div style="margin-left: 20px; font-size: 0.9em; color: #555; margin-top: 4px;">';
                   const metrics = [];
                   if (m.hIndex !== null) metrics.push(`h-index: ${m.hIndex}`);
                   if (m.i10Index !== null) metrics.push(`i10-index: ${m.i10Index}`);
                   if (m.twoYrCites !== null) metrics.push(`2yr cites: ${parseFloat(m.twoYrCites).toFixed(2)}`);
                   if (metrics.length > 0) {
                       html += `${metrics.join(', ')} (OpenAlex via ORCID)`;
                   }
                   html += '</div>';
               }
           } else {
               html += '<div style="margin-left: 20px; font-size: 0.9em; color: #555; margin-top: 4px;">h-index, i10-index require ORCID</div>';
           }
           
           if (authorData.lastAuthor.affiliations.length > 0) {
               html += '<div style="margin-left: 20px; font-size: 0.9em; color: #555; margin-top: 4px;">';
               authorData.lastAuthor.affiliations.forEach((aff, idx) => {
                   if (idx > 0) html += '<br>';
                   html += aff;
               });
               html += '</div>';
           }
           html += '</div>';
       }
       
       html += '</div>';
       return html;
   }

   function formatAuthorPlainText(authorData) {
       if (!authorData.firstAuthor && !authorData.lastAuthor) {
           return 'Author information not available';
       }
       
       let text = '';
       
       if (authorData.firstAuthor) {
           text += `First Author: ${authorData.firstAuthor.fullName}`;
           
           // Build PubMed search URL
           let pubmedUrl;
           if (authorData.firstAuthor.orcid) {
               pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/?term=${authorData.firstAuthor.orcid}[AUID]`;
               text += `\n              PubMed: ${pubmedUrl}`;
               text += `\n              ORCID: https://orcid.org/${authorData.firstAuthor.orcid}`;
               text += `\n              OpenAlex: https://api.openalex.org/authors/orcid:${authorData.firstAuthor.orcid}`;
               
               // Add metrics if available
               if (authorData.firstAuthor.openAlexMetrics) {
                   const m = authorData.firstAuthor.openAlexMetrics;
                   const metrics = [];
                   if (m.hIndex !== null) metrics.push(`h-index: ${m.hIndex}`);
                   if (m.i10Index !== null) metrics.push(`i10-index: ${m.i10Index}`);
                   if (m.twoYrCites !== null) metrics.push(`2yr cites: ${parseFloat(m.twoYrCites).toFixed(2)}`);
                   if (metrics.length > 0) {
                       text += `\n              ${metrics.join(', ')} (OpenAlex via ORCID)`;
                   }
               }
           } else {
               const searchName = `${authorData.firstAuthor.lastName} ${authorData.firstAuthor.firstName.charAt(0)}`;
               pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(searchName)}[Author]`;
               text += `\n              PubMed: ${pubmedUrl}`;
               text += `\n              h-index, i10-index require ORCID`;
           }
           
           if (authorData.firstAuthor.affiliations.length > 0) {
               authorData.firstAuthor.affiliations.forEach(aff => {
                   text += `\n              ${aff}`;
               });
           }
           text += '\n';
       }
       
       if (authorData.lastAuthor && !authorData.isSingleAuthor) {
           text += `Last Author:  ${authorData.lastAuthor.fullName}`;
           
           // Build PubMed search URL
           let pubmedUrl;
           if (authorData.lastAuthor.orcid) {
               pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/?term=${authorData.lastAuthor.orcid}[AUID]`;
               text += `\n              PubMed: ${pubmedUrl}`;
               text += `\n              ORCID: https://orcid.org/${authorData.lastAuthor.orcid}`;
               text += `\n              OpenAlex: https://api.openalex.org/authors/orcid:${authorData.lastAuthor.orcid}`;
               
               // Add metrics if available
               if (authorData.lastAuthor.openAlexMetrics) {
                   const m = authorData.lastAuthor.openAlexMetrics;
                   const metrics = [];
                   if (m.hIndex !== null) metrics.push(`h-index: ${m.hIndex}`);
                   if (m.i10Index !== null) metrics.push(`i10-index: ${m.i10Index}`);
                   if (m.twoYrCites !== null) metrics.push(`2yr cites: ${parseFloat(m.twoYrCites).toFixed(2)}`);
                   if (metrics.length > 0) {
                       text += `\n              ${metrics.join(', ')} (OpenAlex via ORCID)`;
                   }
               }
           } else {
               const searchName = `${authorData.lastAuthor.lastName} ${authorData.lastAuthor.firstName.charAt(0)}`;
               pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(searchName)}[Author]`;
               text += `\n              PubMed: ${pubmedUrl}`;
               text += `\n              h-index, i10-index require ORCID`;
           }
           
           if (authorData.lastAuthor.affiliations.length > 0) {
               authorData.lastAuthor.affiliations.forEach(aff => {
                   text += `\n              ${aff}`;
               });
           }
           text += '\n';
       }
       
       return text;
   }

   // Include citation report functions directly in this file
   // CITATION BAR - Get Registration Agency from DOI.org
   // This is separate from popup.js DOI lookup code
   async function getRegistrationAgency(doi) {
       if (!doi || doi === '0') return null;
       
       try {
           const url = `https://doi.org/doiRA/${doi}`;
           const response = await fetch(url);
           
           if (!response.ok) {
               return null;
           }
           
           const data = await response.json();
           
           // Extract RA from response
           // Response format: [{"DOI": "10.xxx", "RA": "Crossref"}]
           if (data && Array.isArray(data) && data.length > 0 && data[0].RA) {
               return data[0].RA;
           }
           
           return null;
       } catch (error) {
           console.error('Error fetching Registration Agency:', error);
           return null;
       }
   }

   async function buildCitationReport(data, pmid) {
       // Helper function to decode HTML entities
       const decodeHTMLEntities = (text) => {
           if (!text) return text;
           const textarea = document.createElement('textarea');
           textarea.innerHTML = text;
           return textarea.value;
       };

       // Helper function to format RCR description with iCite attribution
       const getRCRDescription = (rcr) => {
           const rcrValue = parseFloat(rcr);
           if (isNaN(rcrValue) || rcr === '-') return '';
           let desc = '';
           if (rcrValue >= 5) desc = 'exceptional';
           else if (rcrValue >= 2) desc = 'well above average';
           else if (rcrValue >= 1) desc = 'above average';
           else desc = 'below average';
           return `iCite: ${desc}`; // Updated for clarity
       };

       // Helper function to format SJR description
       const getSJRDescription = (sjr) => {
           const sjrValue = parseFloat(sjr);
           if (isNaN(sjrValue) || sjr === '-') return '';
           if (sjrValue >= 5) return 'exceptional';
           if (sjrValue >= 3) return 'excellent';
           if (sjrValue >= 1.5) return 'very good';
           if (sjrValue >= 0.5) return 'moderate';
           return 'developing';
       };

       // Get iCite URL for this specific PMID
       const iciteUrl = await getICiteUrl(pmid);

       // Get Altmetric score for this DOI
       const altmetricScore = await getAltmetricScore(data.DOI);

       // Get author information
       const authorData = await getAuthorData(pmid);

       // Get Registration Agency for DOI (Citation Bar separate code)
       const registrationAgency = await getRegistrationAgency(data.DOI);

       // Build data object for both plain text and HTML
       const reportData = {
           title: data.Title || 'Title not available',
           journal: data.Journal || 'Not available',
           publishDate: data.PublishDate || 'Not available',
           pubType: data.pubType && Array.isArray(data.pubType) && data.pubType.length > 0 ? data.pubType.join(', ') : null,
           pmid: pmid,
           doi: data.DOI && data.DOI !== '0' ? data.DOI : null,
           registrationAgency: registrationAgency,
           issn: data.defaultISSN || null,
           abstract: null,
           grants: null,
           authorCount: null,
           preprint: data.isPreprint ? 'Yes' : 'No',
           overallScore: data.overallScore !== undefined ? data.overallScore : '-',
           citations: data.Citations || '0',
           rcr: data.RelativeCitationRatio && data.RelativeCitationRatio !== '-' ? parseFloat(data.RelativeCitationRatio).toFixed(1) : '-',
           rcrDesc: getRCRDescription(data.RelativeCitationRatio),
           altmetric: altmetricScore || '-',
           influential: data.s2Url && data.influentialCitations !== 'N/A' ? `${data.influentialCitations} of ${data.s2Citations} (Semantic Scholar)` : '-', // Updated for clarity
           age: data.PublishCurrent === 'n' ? 'Recent (< 2 years)' : (data.PublishCurrent === '' ? 'Established (2+ years)' : 'Unknown'),
           medline: data.medlineCode === 'm' || data.recordStatus === 'PubMed - indexed for MEDLINE' ? 'Yes' : 'No',
           trending: data.isTrending ? 'Yes' : 'No',
           topJournal: data.TopJournal && data.TopJournal !== '-' ? `${data.TopJournal} (extension curated list)` : 'No (extension curated list)', // Updated for clarity
           sjr: data.SJR && data.SJR !== '-' ? parseFloat(data.SJR).toFixed(2) : '-',
           sjrDesc: getSJRDescription(data.SJR),
           medlinePct: data.medline_per !== '' && data.medline_per !== undefined ? Math.round(parseFloat(data.medline_per) * 100) + '% YTD (extension Journal Ranking)' : null, // Updated for clarity
           articleCount: data.counts ? parseInt(data.counts).toLocaleString() + ' YTD (extension Journal Ranking)' : null, // Updated for clarity
           access: null,
           authorInfo: authorData,
           links: {}
       };

       // Abstract, grants, author count - always fetch fresh from efetch
       const efetchData = await fetchAbstractOnDemand(pmid);
       if (efetchData.abstract && efetchData.abstract !== 'No abstract' && efetchData.abstract !== 'Error loading abstract') {
           const decodedAbstract = decodeHTMLEntities(efetchData.abstract);
           reportData.abstract = decodedAbstract.length > 300 ? decodedAbstract.substring(0, 300) + '...' : decodedAbstract;
       }
       if (efetchData.grants && efetchData.grants.length > 0) {
           reportData.grants = efetchData.grants;
       }
       if (efetchData.authorCount > 0) {
           reportData.authorCount = efetchData.authorCount;
       }

       // Full text access
       if (data.fullTextUrl) {
           if (data.fullTextIsFree || data.fullTextProvider === 'PMC') {
               reportData.access = `Free (${data.fullTextProvider || 'Open Access'})`;
           } else {
               reportData.access = `Publisher (${data.fullTextProvider})`;
           }
       } else if (reportData.doi) {
           reportData.access = 'Via DOI';
       } else {
           reportData.access = 'Check institutional access';
       }

       // Links
       reportData.links.pubmed = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
       if (reportData.doi) {
           reportData.links.doi = `https://doi.org/${reportData.doi}`;
           reportData.links.scholar = `https://scholar.google.com/scholar?q=${encodeURIComponent(reportData.doi)}`;
       }
       if (data.fullTextUrl) reportData.links.fullText = data.fullTextUrl;
       if (iciteUrl) reportData.links.icite = iciteUrl;
       reportData.links.similar = `https://pubmed.ncbi.nlm.nih.gov/?linkname=pubmed_pubmed&from_uid=${pmid}`;
       reportData.links.citedBy = `https://pubmed.ncbi.nlm.nih.gov/?linkname=pubmed_pubmed_citedin&from_uid=${pmid}`;
       if (altmetricScore && reportData.doi) reportData.links.altmetric = `https://www.altmetric.com/details.php?doi=${reportData.doi}`;
       if (data.s2Url) reportData.links.semantic = data.s2Url;
       if (data.SJRurl) reportData.links.sjr = data.SJRurl;
       if (data.cellsUrl) reportData.links.ranking = data.cellsUrl;

       // Build plain text version
       const divider = '================================================================';
       const sectionDivider = '----------------------------------------------------------------';
       
       let plainText = '';
       plainText += divider + '\n';
       plainText += 'CITATION REPORT\n';
       plainText += divider + '\n';
       plainText += `Overall Score: ${reportData.overallScore}\n\n`;

       plainText += 'ARTICLE\n' + sectionDivider + '\n';
       plainText += `Title:       "${reportData.title}"\n`;
       if (reportData.pubType) plainText += `Type:        ${reportData.pubType}\n`;
       plainText += `Journal:     ${reportData.journal}\n`;
       plainText += `Published:   ${reportData.publishDate}\n`;
       plainText += `PMID:        ${reportData.pmid}\n`;
       if (reportData.doi) plainText += `DOI:         ${reportData.doi}\n`;
       if (reportData.registrationAgency) plainText += `Reg Agency:  ${reportData.registrationAgency}\n`;
       plainText += '\n';

       plainText += 'ABSTRACT\n' + sectionDivider + '\n';
       plainText += (reportData.abstract || 'No abstract.') + '\n\n';

       // Grants section - always shown
       plainText += 'GRANTS\n' + sectionDivider + '\n';
       if (reportData.grants && reportData.grants.length > 0) {
           reportData.grants.forEach(grant => {
               if (grant.grantId && grant.grantId !== 'N/A') {
                   plainText += `${grant.grantId}: ${grant.agency}`;
               } else {
                   plainText += `${grant.agency}`;
               }
               if (grant.country) {
                   plainText += ` (${grant.country})`;
               }
               plainText += '\n';
           });
       } else {
           plainText += 'No grant data available\n';
       }
       plainText += '\n';

       plainText += 'AUTHORS\n' + sectionDivider + '\n';
       plainText += 'In academic convention, first author typically leads the work, last author leads the lab.\n';
       plainText += `Total Authors: ${reportData.authorCount || 'No data available'}\n`;
       plainText += '\n';
       plainText += formatAuthorPlainText(reportData.authorInfo) + '\n';

       plainText += 'METRICS\n' + sectionDivider + '\n';
       plainText += `Preprint:    ${reportData.preprint}\n`;
       plainText += `Overall Score: ${reportData.overallScore}\n`;
       plainText += `Citations:   ${reportData.citations}${reportData.citations !== '0' ? ' (iCite)' : ''}\n`;
       plainText += `RCR:         ${reportData.rcr}${reportData.rcrDesc ? ` (${reportData.rcrDesc})` : ''}\n`;
       plainText += `Altmetric:   ${reportData.altmetric}\n`;
       plainText += `Influential: ${reportData.influential}\n\n`;

       plainText += 'STATUS\n' + sectionDivider + '\n';
       plainText += `Age:         ${reportData.age}\n`;
       plainText += `Medline:     ${reportData.medline}\n`;
       plainText += `Trending:    ${reportData.trending}\n\n`;

       plainText += 'JOURNAL\n' + sectionDivider + '\n';
       if (reportData.issn) plainText += `ISSN:        ${reportData.issn} (https://portal.issn.org/resource/ISSN/${reportData.issn})\n`;
       plainText += `Top Journal: ${reportData.topJournal}\n`;
       plainText += `SJR:         ${reportData.sjr}${reportData.sjrDesc ? ` (${reportData.sjrDesc})` : ''}\n`;
       if (reportData.medlinePct) plainText += `Medline %:   ${reportData.medlinePct}\n`;
       if (reportData.articleCount) plainText += `Articles:    ${reportData.articleCount}\n`;
       plainText += '\n';

       plainText += 'FULL TEXT\n' + sectionDivider + '\n';
       plainText += `Access:      ${reportData.access}\n\n`;

       plainText += 'LINKS\n' + sectionDivider + '\n';
       if (reportData.links.pubmed) plainText += `PubMed:      ${reportData.links.pubmed}\n`;
       if (reportData.links.doi) plainText += `DOI:         ${reportData.links.doi}\n`;
       if (reportData.links.fullText) plainText += `Full Text:   ${reportData.links.fullText}\n`;
       if (reportData.links.icite) plainText += `iCite:       ${reportData.links.icite}\n`;
       if (reportData.links.scholar) plainText += `Scholar:     ${reportData.links.scholar}\n`;
       if (reportData.links.similar) plainText += `Similar:     ${reportData.links.similar}\n`;
       if (reportData.links.citedBy) plainText += `Cited By:    ${reportData.links.citedBy}\n`;
       if (reportData.links.altmetric) plainText += `Altmetric:   ${reportData.links.altmetric}\n`;
       if (reportData.links.semantic) plainText += `Semantic:    ${reportData.links.semantic}\n`;
       if (reportData.links.sjr) plainText += `SJR:         ${reportData.links.sjr}\n`;
       if (reportData.links.ranking) plainText += `Ranking:     ${reportData.links.ranking}\n`;
       plainText += '\n';

       plainText += divider + '\n';
       plainText += 'Generated by PubMed Citation Bar Extension v3.720\n';
       plainText += divider + '\n';

       // Build HTML version
       const makeLink = (url, text) => `<a href="${url}" target="_blank" class="report-link">${text || url}</a>`;
       
       let html = '';
       
       // Add overall score header
       html += '<div class="report-section" style="text-align: center; font-size: 18px; font-weight: bold; padding: 15px; background-color: #f0f0f0; margin-bottom: 10px;">';
       html += `The overall score of the article is <span style="font-size: 24px; color: #0066cc;">${reportData.overallScore}</span>`;
       html += '</div>';
       
       html += '<div class="report-section">';
       html += '<div class="report-heading">ARTICLE</div>';
       html += `<div class="report-row"><span class="report-label">Title:</span> <span class="report-value">"${reportData.title}"</span></div>`;
       if (reportData.pubType) html += `<div class="report-row"><span class="report-label">Type:</span> <span class="report-value">${reportData.pubType}</span></div>`;
       html += `<div class="report-row"><span class="report-label">Journal:</span> <span class="report-value">${reportData.journal}</span></div>`;
       html += `<div class="report-row"><span class="report-label">Published:</span> <span class="report-value">${reportData.publishDate}</span></div>`;
       html += `<div class="report-row"><span class="report-label">PMID:</span> <span class="report-value">${reportData.pmid}</span></div>`;
       if (reportData.doi) html += `<div class="report-row"><span class="report-label">DOI:</span> <span class="report-value">${reportData.doi}</span></div>`;
       if (reportData.registrationAgency) {
           html += `<div class="report-row"><span class="report-label">Reg Agency:</span> <span class="report-value">${reportData.registrationAgency}`;
           
           // Add Raw Data link for CrossRef and DataCite
           if (reportData.registrationAgency === 'Crossref' && reportData.doi) {
               const apiUrl = `https://api.crossref.org/works/${reportData.doi}`;
               html += ` | <a href="${apiUrl}" target="_blank" style="color: #0066cc;">Raw Data</a>`;
           } else if (reportData.registrationAgency === 'DataCite' && reportData.doi) {
               const apiUrl = `https://api.datacite.org/dois/${reportData.doi}`;
               html += ` | <a href="${apiUrl}" target="_blank" style="color: #0066cc;">Raw Data</a>`;
           } else {
               html += ` | <span style="color: #999;">Raw Data</span>`;
           }
           
           html += `</span></div>`;
       }
       html += '</div>';

       html += '<div class="report-section">';
       html += '<div class="report-heading">ABSTRACT</div>';
       html += `<div class="report-abstract">${reportData.abstract || 'No abstract.'}</div>`;
       html += '</div>';

       // Grants section - always shown
       html += '<div class="report-section">';
       html += '<div class="report-heading">GRANTS</div>';
       if (reportData.grants && reportData.grants.length > 0) {
           reportData.grants.forEach(grant => {
               html += `<div class="report-row">`;
               if (grant.grantId && grant.grantId !== 'N/A') {
                   html += `<span class="report-label">${grant.grantId}:</span> `;
                   html += `<span class="report-value">${grant.agency}${grant.country ? ` (${grant.country})` : ''}</span>`;
               } else {
                   html += `<span class="report-value">${grant.agency}${grant.country ? ` (${grant.country})` : ''}</span>`;
               }
               html += `</div>`;
           });
       } else {
           html += '<div class="report-row"><span class="report-value" style="color: #999;">No grant data available</span></div>';
       }
       html += '</div>';

       html += '<div class="report-section">';
       html += '<div class="report-heading">AUTHORS</div>';
       html += '<div style="font-style: italic; color: #666; margin-bottom: 10px; font-size: 0.9em;">In academic convention, first author typically leads the work, last author leads the lab.</div>';
       html += `<div class="report-row"><span class="report-label">Total Authors:</span> <span class="report-value">${reportData.authorCount || 'No data available'}</span></div>`;
       html += formatAuthorHTML(reportData.authorInfo);
       html += '</div>';

       html += '<div class="report-section">';
       html += '<div class="report-heading">METRICS</div>';
       html += `<div class="report-row"><span class="report-label">Preprint:</span> <span class="report-value">${reportData.preprint}</span></div>`;
       html += `<div class="report-row"><span class="report-label">Overall Score:</span> <span class="report-value">${reportData.overallScore}</span></div>`;
       html += `<div class="report-row"><span class="report-label">Citations:</span> <span class="report-value">${reportData.citations}${reportData.citations !== '0' ? ' (iCite)' : ''}</span></div>`;
       html += `<div class="report-row"><span class="report-label">RCR:</span> <span class="report-value">${reportData.rcr}${reportData.rcrDesc ? ` (${reportData.rcrDesc})` : ''}</span></div>`;
       html += `<div class="report-row"><span class="report-label">Altmetric:</span> <span class="report-value">${reportData.altmetric}</span></div>`;
       html += `<div class="report-row"><span class="report-label">Influential:</span> <span class="report-value">${reportData.influential}</span></div>`;
       html += '</div>';

       html += '<div class="report-section">';
       html += '<div class="report-heading">STATUS</div>';
       html += `<div class="report-row"><span class="report-label">Age:</span> <span class="report-value">${reportData.age}</span></div>`;
       html += `<div class="report-row"><span class="report-label">Medline:</span> <span class="report-value">${reportData.medline}</span></div>`;
       html += `<div class="report-row"><span class="report-label">Trending:</span> <span class="report-value">${reportData.trending}</span></div>`;
       html += '</div>';

       html += '<div class="report-section">';
       html += '<div class="report-heading">JOURNAL</div>';
       if (reportData.issn) html += `<div class="report-row"><span class="report-label">ISSN:</span> <span class="report-value"><a href="https://portal.issn.org/resource/ISSN/${reportData.issn}" target="_blank" style="color: #4CAF50; text-decoration: none;">${reportData.issn}</a></span></div>`;
       html += `<div class="report-row"><span class="report-label">Top Journal:</span> <span class="report-value">${reportData.topJournal}</span></div>`;
       html += `<div class="report-row"><span class="report-label">SJR:</span> <span class="report-value">${reportData.sjr}${reportData.sjrDesc ? ` (${reportData.sjrDesc})` : ''}</span></div>`;
       if (reportData.medlinePct) html += `<div class="report-row"><span class="report-label">Medline %:</span> <span class="report-value">${reportData.medlinePct}</span></div>`;
       if (reportData.articleCount) html += `<div class="report-row"><span class="report-label">Articles:</span> <span class="report-value">${reportData.articleCount}</span></div>`;
       html += '</div>';

       html += '<div class="report-section">';
       html += '<div class="report-heading">FULL TEXT</div>';
       html += `<div class="report-row"><span class="report-label">Access:</span> <span class="report-value">${reportData.access}</span></div>`;
       html += '</div>';

       html += '<div class="report-section">';
       html += '<div class="report-heading">LINKS</div>';
       if (reportData.links.pubmed) html += `<div class="report-row"><span class="report-label">PubMed:</span> <span class="report-value">${makeLink(reportData.links.pubmed)}</span></div>`;
       if (reportData.links.doi) html += `<div class="report-row"><span class="report-label">DOI:</span> <span class="report-value">${makeLink(reportData.links.doi)}</span></div>`;
       if (reportData.links.fullText) html += `<div class="report-row"><span class="report-label">Full Text:</span> <span class="report-value">${makeLink(reportData.links.fullText)}</span></div>`;
       if (reportData.links.icite) html += `<div class="report-row"><span class="report-label">iCite:</span> <span class="report-value">${makeLink(reportData.links.icite)}</span></div>`;
       if (reportData.links.scholar) html += `<div class="report-row"><span class="report-label">Scholar:</span> <span class="report-value">${makeLink(reportData.links.scholar)}</span></div>`;
       if (reportData.links.similar) html += `<div class="report-row"><span class="report-label">Similar:</span> <span class="report-value">${makeLink(reportData.links.similar)}</span></div>`;
       if (reportData.links.citedBy) html += `<div class="report-row"><span class="report-label">Cited By:</span> <span class="report-value">${makeLink(reportData.links.citedBy)}</span></div>`;
       if (reportData.links.altmetric) html += `<div class="report-row"><span class="report-label">Altmetric:</span> <span class="report-value">${makeLink(reportData.links.altmetric)}</span></div>`;
       if (reportData.links.semantic) html += `<div class="report-row"><span class="report-label">Semantic:</span> <span class="report-value">${makeLink(reportData.links.semantic)}</span></div>`;
       if (reportData.links.sjr) html += `<div class="report-row"><span class="report-label">SJR:</span> <span class="report-value">${makeLink(reportData.links.sjr)}</span></div>`;
       if (reportData.links.ranking) html += `<div class="report-row"><span class="report-label">Ranking:</span> <span class="report-value">${makeLink(reportData.links.ranking)}</span></div>`;
       html += '</div>';

       html += '<div class="report-footer">Generated by PubMed Citation Bar Extension v3.720</div>';

       return { plainText, html };
   }

   // Function to show the report in a modal and handle copying
   async function showAuthorInfo(data, pmid) {
       // Fetch author data
       const authorData = await getAuthorData(pmid);
       
       // Create modal if it doesn't exist
       let modal = document.getElementById('author-info-modal');
       if (!modal) {
           modal = document.createElement('div');
           modal.id = 'author-info-modal';
           modal.style.cssText = 'position: fixed; z-index: 10000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); display: none;';
           
           const content = document.createElement('div');
           content.id = 'author-modal-content';
           content.style.cssText = 'background-color: white; margin: 10% auto; padding: 20px; border: 1px solid #888; width: 500px; max-height: 70vh; overflow-y: auto; border-radius: 8px;';
           
           modal.appendChild(content);
           document.body.appendChild(modal);
           
           // Close on outside click
           modal.addEventListener('click', (e) => {
               if (e.target === modal) {
                   modal.style.display = 'none';
               }
           });
       }
       
       // Build content
       const content = document.getElementById('author-modal-content');
       let html = '<h3>Author Information</h3>';
       html += '<button id="close-author-modal" style="float: right; margin-top: -30px;">Close</button>';
       html += `<div style="margin-bottom: 15px; clear: both;"><strong>Article:</strong> ${data.Title || 'Title not available'}</div>`;
       html += `<div style="margin-bottom: 15px; font-style: italic; color: #555; font-size: 0.9em;">Shows first and last authors (in academic convention, first author typically leads the work, last author leads the lab).</div>`;
       
       // Add author count
       if (authorData.totalAuthors && authorData.totalAuthors > 0) {
           html += `<div style="margin-bottom: 15px;"><strong>Number of Authors:</strong> ${authorData.totalAuthors}</div>`;
       }
       
       // Add first author
       if (authorData.firstAuthor) {
           html += '<div style="margin-bottom: 15px;">';
           html += `<strong>First Author:</strong> ${authorData.firstAuthor.fullName}<br>`;
           
           // Links
           if (authorData.firstAuthor.orcid) {
               html += `<a href="https://pubmed.ncbi.nlm.nih.gov/?term=${authorData.firstAuthor.orcid}[AUID]" target="_blank">PubMed</a> | `;
               html += `<a href="https://orcid.org/${authorData.firstAuthor.orcid}" target="_blank">ORCID</a> | `;
               html += `<a href="https://api.openalex.org/authors/orcid:${authorData.firstAuthor.orcid}" target="_blank">OpenAlex</a><br>`;
               
               // OpenAlex metrics
               if (authorData.firstAuthor.openAlexMetrics) {
                   const m = authorData.firstAuthor.openAlexMetrics;
                   const metrics = [];
                   if (m.hIndex !== null) metrics.push(`h-index: ${m.hIndex}`);
                   if (m.i10Index !== null) metrics.push(`i10-index: ${m.i10Index}`);
                   if (m.twoYrCites !== null) metrics.push(`2yr cites: ${parseFloat(m.twoYrCites).toFixed(2)}`);
                   if (metrics.length > 0) {
                       html += `<span style="font-size: 0.9em; color: #555;">${metrics.join(', ')} (OpenAlex via ORCID)</span><br>`;
                   }
               }
           } else {
               const searchName = `${authorData.firstAuthor.lastName} ${authorData.firstAuthor.firstName.charAt(0)}`;
               html += `<a href="https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(searchName)}[Author]" target="_blank">PubMed</a><br>`;
               html += `<span style="font-size: 0.9em; color: #555;">h-index, i10-index require ORCID</span><br>`;
           }
           
           // Affiliations
           if (authorData.firstAuthor.affiliations && authorData.firstAuthor.affiliations.length > 0) {
               html += '<div style="margin-left: 20px; margin-top: 5px; font-size: 0.9em; color: #555;">';
               authorData.firstAuthor.affiliations.forEach(aff => {
                   html += `${aff}<br>`;
               });
               html += '</div>';
           }
           html += '</div>';
       }
       
       // Add last author if different
       if (authorData.lastAuthor && !authorData.isSingleAuthor) {
           html += '<div style="margin-bottom: 15px;">';
           html += `<strong>Last Author:</strong> ${authorData.lastAuthor.fullName}<br>`;
           
           // Links
           if (authorData.lastAuthor.orcid) {
               html += `<a href="https://pubmed.ncbi.nlm.nih.gov/?term=${authorData.lastAuthor.orcid}[AUID]" target="_blank">PubMed</a> | `;
               html += `<a href="https://orcid.org/${authorData.lastAuthor.orcid}" target="_blank">ORCID</a> | `;
               html += `<a href="https://api.openalex.org/authors/orcid:${authorData.lastAuthor.orcid}" target="_blank">OpenAlex</a><br>`;
               
               // OpenAlex metrics
               if (authorData.lastAuthor.openAlexMetrics) {
                   const m = authorData.lastAuthor.openAlexMetrics;
                   const metrics = [];
                   if (m.hIndex !== null) metrics.push(`h-index: ${m.hIndex}`);
                   if (m.i10Index !== null) metrics.push(`i10-index: ${m.i10Index}`);
                   if (m.twoYrCites !== null) metrics.push(`2yr cites: ${parseFloat(m.twoYrCites).toFixed(2)}`);
                   if (metrics.length > 0) {
                       html += `<span style="font-size: 0.9em; color: #555;">${metrics.join(', ')} (OpenAlex via ORCID)</span><br>`;
                   }
               }
           } else {
               const searchName = `${authorData.lastAuthor.lastName} ${authorData.lastAuthor.firstName.charAt(0)}`;
               html += `<a href="https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(searchName)}[Author]" target="_blank">PubMed</a><br>`;
               html += `<span style="font-size: 0.9em; color: #555;">h-index, i10-index require ORCID</span><br>`;
           }
           
           // Affiliations
           if (authorData.lastAuthor.affiliations && authorData.lastAuthor.affiliations.length > 0) {
               html += '<div style="margin-left: 20px; margin-top: 5px; font-size: 0.9em; color: #555;">';
               authorData.lastAuthor.affiliations.forEach(aff => {
                   html += `${aff}<br>`;
               });
               html += '</div>';
           }
           html += '</div>';
       }
       
       content.innerHTML = html;
       
       // Re-attach close handler (since we replaced innerHTML)
       document.getElementById('close-author-modal').addEventListener('click', () => {
           modal.style.display = 'none';
       });
       
       // Show modal
       modal.style.display = 'block';
   }

   async function showCitationReport(data, pmid) {
       // Generate the report (now async)
       const report = await buildCitationReport(data, pmid);
       
       // Create modal if it doesn't exist
       let modal = document.getElementById('citation-report-modal');
       if (!modal) {
           modal = document.createElement('div');
           modal.id = 'citation-report-modal';
           modal.className = 'citation-report-modal';
           modal.innerHTML = `
               <div class="citation-report-content">
                   <div class="citation-report-header">
                       <h3>Citation Report</h3>
                       <button class="citation-report-close">Close</button>
                   </div>
                   <div class="citation-report-body"></div>
                   <div class="citation-report-footer">
                       <button class="citation-report-copy">Copy to Clipboard</button>
                       <span class="citation-report-status"></span>
                   </div>
               </div>
           `;
           document.body.appendChild(modal);
           
           // Add styles if not already added
           if (!document.getElementById('citation-report-styles')) {
               const styles = document.createElement('style');
               styles.id = 'citation-report-styles';
               styles.textContent = `
                   .citation-report-modal {
                       display: none;
                       position: fixed;
                       z-index: 10000;
                       left: 0;
                       top: 0;
                       width: 100%;
                       height: 100%;
                       background-color: rgba(0, 0, 0, 0.5);
                   }
                   
                   .citation-report-content {
                       background-color: white;
                       margin: 5% auto;
                       border: 1px solid #888;
                       width: 90%;
                       max-width: 550px;
                       max-height: 80vh;
                       border-radius: 8px;
                       box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
                       display: flex;
                       flex-direction: column;
                       overflow: hidden;
                   }
                   
                   .citation-report-header {
                       padding: 15px 20px;
                       border-bottom: 1px solid #ddd;
                       display: flex;
                       justify-content: space-between;
                       align-items: center;
                       background-color: #f5f5f5;
                   }
                   
                   .citation-report-header h3 {
                       margin: 0;
                       font-size: 18px;
                       color: #333;
                   }
                   
                   .citation-report-close {
                       cursor: pointer;
                   }
                   
                                      .citation-report-body {
                       flex: 1;
                       padding: 20px;
                       overflow-y: auto;
                       font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                       font-size: 13px;
                       line-height: 1.3;
                       background-color: #fff;
                   }
                   
                   .citation-report-footer {
                       padding: 15px 20px;
                       border-top: 1px solid #ddd;
                       display: flex;
                       justify-content: space-between;
                       align-items: center;
                       background-color: #f5f5f5;
                   }
                   
                   .citation-report-copy {
                       background-color: #0066cc;
                       color: white;
                       border: none;
                       padding: 8px 20px;
                       border-radius: 4px;
                       cursor: pointer;
                       font-size: 14px;
                   }
                   
                   .citation-report-copy:hover {
                       background-color: #0052a3;
                   }
                   
                   .citation-report-status {
                       color: #28a745;
                       font-size: 14px;
                   }
                   
                   .report-section {
                       margin-bottom: 16px;
                       padding-bottom: 12px;
                       border-bottom: 1px solid #eee;
                   }
                   
                   .report-section:last-of-type {
                       border-bottom: none;
                   }
                   
                   .report-heading {
                       font-weight: bold;
                       font-size: 14px;
                       color: #333;
                       margin-bottom: 6px;
                       text-transform: uppercase;
                       letter-spacing: 0.5px;
                   }
                   
                   .report-row {
                       display: flex;
                       line-height: 1.3;
                       margin-bottom: 1px;
                   }
                   
                   .report-label {
                       min-width: 90px;
                       color: #666;
                       flex-shrink: 0;
                   }
                   
                   .report-value {
                       color: #333;
                       word-break: break-word;
                   }
                   
                   .report-abstract {
                       color: #444;
                       font-style: italic;
                       line-height: 1.4;
                   }
                   
                   .report-link {
                       color: #0066cc;
                       text-decoration: none;
                       word-break: break-all;
                   }
                   
                   .report-link:hover {
                       color: #004499;
                   }
                   
                   .report-score {
                       font-size: 15px;
                       color: #333;
                       margin-bottom: 16px;
                       padding-bottom: 12px;
                       border-bottom: 2px solid #0066cc;
                   }
                   
                   .report-footer {
                       margin-top: 16px;
                       padding-top: 12px;
                       border-top: 1px solid #ddd;
                       text-align: center;
                       color: #999;
                       font-size: 11px;
                   }
               `;
               document.head.appendChild(styles);
           }
           
           // Event listeners
           modal.querySelector('.citation-report-close').addEventListener('click', () => {
               modal.style.display = 'none';
           });
           
           modal.querySelector('.citation-report-copy').addEventListener('click', () => {
               // Get the stored plain text
               const plainText = modal.getAttribute('data-plain-text');
               
               // Copy to clipboard
               navigator.clipboard.writeText(plainText).then(() => {
                   const status = modal.querySelector('.citation-report-status');
                   status.textContent = 'Copied to clipboard!';
                   setTimeout(() => {
                       status.textContent = '';
                   }, 3000);
               }).catch(() => {
                   // Fallback for older browsers
                   const textarea = document.createElement('textarea');
                   textarea.value = plainText;
                   document.body.appendChild(textarea);
                   textarea.select();
                   document.execCommand('copy');
                   document.body.removeChild(textarea);
                   
                   const status = modal.querySelector('.citation-report-status');
                   status.textContent = 'Copied to clipboard!';
                   setTimeout(() => {
                       status.textContent = '';
                   }, 3000);
               });
           });
           
           // Close on outside click
           modal.addEventListener('click', (e) => {
               if (e.target === modal) {
                   modal.style.display = 'none';
               }
           });
       }
       
       // Store plain text for copying and display HTML
       modal.setAttribute('data-plain-text', report.plainText);
       modal.querySelector('.citation-report-body').innerHTML = report.html;
       
       // Reset scroll position
       setTimeout(() => {
           modal.querySelector('.citation-report-body').scrollTop = 0;
       }, 10);
       
       modal.style.display = 'block';
   }

   try {
       if (!states.citationBarEnabled) {
           // Switching the bar off discards the export list. The ticks live on
           // the bar, so leaving the list behind would mean a selection the
           // user can no longer see, review, or clear.
           chrome.storage.local.remove(['pcbExportPMIDs', 'pcbExportRecords']);
           if (window.__pcbExport) {
               window.__pcbExport.ids = [];
               window.__pcbExport.records = {};
               window.__pcbExport.loaded = true;
           }
           return { injectedCount };
       }

       function formatPercentage(value) {
           if (value === '' || value === null || value === undefined) return '-';
           const percentage = parseFloat(value) * 100;
           if (percentage > 0 && percentage < 1) {
               return '1%';
           }
           return `${Math.round(percentage)}%`;
       }

       // ---------------------------------------------------------------
       // Export list (.nbib for reference managers)
       //
       // A tick per article on row 2, and a checklist icon that opens the
       // list. Ticking an article fetches its complete MEDLINE record from
       // efetch and caches the raw text; the download is those blocks joined.
       //
       // The record is NOT assembled from fullDataSet. One efetch returns
       // abstract, MeSH, every author, and the page range in PubMed's own
       // formatting, and that text IS nbib - so there is no field mapping to
       // write and nothing to keep in sync. Assembling it instead would mean
       // splitting "1745-7" into start and end pages and guessing which part
       // of "von Haehling S" is the surname, both of which fail silently.
       //
       // Drawn as SVG rather than a Unicode tick or emoji: those render as
       // colour emoji on some platforms and glyphs on others, and the bar
       // cannot afford a character whose height it does not control.
       // currentColor means the states below are pure CSS.
       // Stroke 3.4 against the list icon's 1.8: the tick is the control users
       // reach for on every article, so it carries the weight. It is also the
       // only mark on either row that is not a letter, and a thin one read as
       // incidental punctuation next to the text.
       const PICK_CHECK_SVG =
           '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3.4" ' +
           'stroke-linecap="round" stroke-linejoin="round" d="M2.6 8.6 L6.4 12.4 L13.4 3.6"/></svg>';

       const PICK_LIST_SVG =
           '<svg viewBox="0 0 16 16" aria-hidden="true">' +
           '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
           'd="M1.2 4.3 L2.8 5.9 L5.6 2.8 M1.2 11.3 L2.8 12.9 L5.6 9.8"/>' +
           '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
           'd="M8 4.6 H15 M8 11.6 H15"/></svg>';

       const PICK_IDS_KEY = 'pcbExportPMIDs';
       const PICK_RECORDS_KEY = 'pcbExportRecords';

       // Ceiling on "Open in new tab" only - the downloads have no limit.
       // The PubMed URL carries every PMID in the query string at about nine
       // characters each, so 200 is already ~1,800 characters before the base
       // URL. Past that the request is liable to be truncated or refused, and
       // the damage would show as a quietly incomplete result set rather than
       // an error. Scan 1,000 caps its own top-200 URL at the same number.
       const PICK_OPEN_LIMIT = 200;

       // Picks live on window so that a re-injection - which happens on every
       // tab switch - reuses the same set and the same request queue rather
       // than building a second one alongside the first.
       if (!window.__pcbExport) {
           window.__pcbExport = {
               ids: [],
               records: {},
               pending: new Set(),
               loaded: false,
               chain: Promise.resolve(),
               lastAt: 0
           };
       }
       const pickState = window.__pcbExport;

       // One request per second, enforced between requests rather than between
       // clicks. A delay attached to each click lets a fast run down the page
       // fire them in a bunch anyway; this serialises them. NCBI allows 3/sec,
       // so this sits at a third of the allowance. It costs nothing in the
       // normal case - a single efetch returns well inside a second, so
       // clicking one article at a time never waits.
       function pickQueued(fn) {
           const result = pickState.chain.then(async () => {
               const wait = Math.max(0, 1000 - (Date.now() - pickState.lastAt));
               if (wait) await new Promise(r => setTimeout(r, wait));
               pickState.lastAt = Date.now();
               return fn();
           });
           // The chain must survive a rejection, or one failed fetch stalls
           // every later click. The caller still sees the real outcome.
           pickState.chain = result.then(() => {}, () => {});
           return result;
       }

       async function loadPicks() {
           if (pickState.loaded) return;
           const stored = await chrome.storage.local.get([PICK_IDS_KEY, PICK_RECORDS_KEY]);
           pickState.ids = Array.isArray(stored[PICK_IDS_KEY]) ? stored[PICK_IDS_KEY] : [];
           pickState.records = stored[PICK_RECORDS_KEY] || {};
           pickState.loaded = true;
       }

       async function savePicks() {
           await chrome.storage.local.set({
               [PICK_IDS_KEY]: pickState.ids,
               [PICK_RECORDS_KEY]: pickState.records
           });
       }

       // Every bar carries its own copy of the count, so a change to one has
       // to repaint all of them or the counts silently drift apart.
       function paintPicks() {
           const count = pickState.ids.length;
           document.querySelectorAll('.pcb-pick').forEach(el => {
               const pmid = el.getAttribute('data-pmid');
               el.classList.toggle('picked', pickState.ids.includes(pmid));
               el.classList.toggle('picking', pickState.pending.has(pmid));
           });
           document.querySelectorAll('.pcb-picklist').forEach(el => {
               el.classList.toggle('has-picks', count > 0);
               const badge = el.querySelector('.pcb-pick-count');
               if (badge) badge.textContent = count > 0 ? String(count) : '';
           });
       }

       // PubMed titles carry markup of their own (<i>, <sub>, Greek entities),
       // so they cannot go into innerHTML raw without breaking the row.
       function escapePickHTML(value) {
           return String(value == null ? '' : value)
               .replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;');
       }

       // ---------------------------------------------------------------
       // MEDLINE -> RIS
       //
       // RIS is converted from the same cached MEDLINE record the .nbib export
       // uses, so both files are one set of data in two shapes. That also
       // removes the hazard that made RIS unattractive earlier: MEDLINE's FAU
       // field is already "Surname, Firstname", which is exactly RIS's form,
       // so nothing has to guess where the surname ends in "von Haehling S".
       const MEDLINE_MONTHS = {
           Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
           Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
       };

       // MEDLINE wraps long values onto continuation lines indented six
       // spaces, so reading line by line would return an abstract in pieces.
       function parseMedlineRecord(text) {
           const fields = [];
           let current = null;
           for (const rawLine of String(text).split(/\r?\n/)) {
               if (!rawLine.trim()) continue;
               const start = rawLine.match(/^([A-Z][A-Z0-9]{0,3})\s*-\s?(.*)$/);
               if (start) {
                   current = { tag: start[1], value: start[2].trim() };
                   fields.push(current);
               } else if (/^\s+/.test(rawLine) && current) {
                   current.value += ' ' + rawLine.trim();
               }
           }
           return fields;
       }

       function medlineValues(fields, tag) {
           return fields.filter(f => f.tag === tag).map(f => f.value).filter(Boolean);
       }

       function medlineFirst(fields, tag) {
           const all = medlineValues(fields, tag);
           return all.length ? all[0] : '';
       }

       // PubMed abbreviates the end page to its changed digits only: "1745-7"
       // means 1745-1747 and "369-80" means 369-380. RIS wants SP and EP
       // separately, so a shorter end page is completed from the start page's
       // leading digits. Copying it verbatim produces a citation that looks
       // entirely normal and cites the wrong pages.
       function splitPageRange(pg) {
           const value = String(pg || '').trim();
           if (!value) return { sp: '', ep: '' };
           const match = value.match(/^([^-\s]+)\s*-\s*([^-\s]+)$/);
           if (!match) return { sp: value, ep: '' };
           const sp = match[1];
           const rawEp = match[2];
           if (/^\d+$/.test(sp) && /^\d+$/.test(rawEp) && rawEp.length < sp.length) {
               return { sp, ep: sp.slice(0, sp.length - rawEp.length) + rawEp };
           }
           return { sp, ep: rawEp };
       }

       function parseMedlinePubDate(dp) {
           const parts = String(dp || '').trim().split(/\s+/);
           const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parts[0] : '';
           const month = parts[1] ? (MEDLINE_MONTHS[parts[1].slice(0, 3)] || '') : '';
           const day = parts[2] && /^\d{1,2}$/.test(parts[2]) ? parts[2].padStart(2, '0') : '';
           return { year, month, day };
       }

       function medlineToRis(text) {
           const fields = parseMedlineRecord(text);
           if (!fields.length) return '';

           const out = [];
           const add = (tag, value) => {
               if (value === undefined || value === null) return;
               const v = String(value).trim();
               if (v) out.push(`${tag}  - ${v}`);
           };

           const pubTypes = medlineValues(fields, 'PT').map(t => t.toLowerCase());
           out.push(`TY  - ${pubTypes.some(t => t.includes('book')) ? 'BOOK' : 'JOUR'}`);

           const fullAuthors = medlineValues(fields, 'FAU');
           if (fullAuthors.length) {
               fullAuthors.forEach(a => add('AU', a));
           } else {
               medlineValues(fields, 'AU').forEach(a => add('AU', a));
           }

           add('TI', medlineFirst(fields, 'TI'));
           add('JF', medlineFirst(fields, 'JT'));
           add('JO', medlineFirst(fields, 'TA'));
           add('VL', medlineFirst(fields, 'VI'));
           // MEDLINE IP is the issue and MEDLINE IS is the ISSN, while RIS IS
           // means issue. Reading the wrong one puts an ISSN in the issue field.
           add('IS', medlineFirst(fields, 'IP'));

           const pages = splitPageRange(medlineFirst(fields, 'PG'));
           add('SP', pages.sp);
           add('EP', pages.ep);

           const date = parseMedlinePubDate(medlineFirst(fields, 'DP'));
           add('PY', date.year);
           if (date.year) add('DA', `${date.year}/${date.month}/${date.day}/`.replace(/\/+$/, '/'));

           add('AB', medlineFirst(fields, 'AB'));
           // ISSN arrives qualified, as "1874-1754 (Electronic)".
           add('SN', medlineFirst(fields, 'IS').replace(/\s*\(.*\)\s*$/, ''));
           medlineValues(fields, 'LA').forEach(l => add('LA', l));

           // MeSH headings carry a leading * for major topics and /subheadings
           // after a slash. Zotero treats KW as a tag, so the heading alone is
           // what is useful there.
           medlineValues(fields, 'MH').forEach(mh => {
               add('KW', mh.replace(/^\*/, '').split('/')[0].trim());
           });

           const doiEntry = medlineValues(fields, 'AID')
               .concat(medlineValues(fields, 'LID'))
               .find(v => /\[doi\]$/i.test(v));
           if (doiEntry) add('DO', doiEntry.replace(/\s*\[doi\]$/i, '').trim());

           const pmid = medlineFirst(fields, 'PMID');
           if (pmid) {
               add('AN', pmid);
               add('UR', `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`);
           }

           out.push('ER  - ');
           return out.join('\n');
       }

       // efetch in MEDLINE text form - the same thing PubMed's own
       // "Send to > Citation manager" produces, so the .nbib download needs
       // no conversion. A response that carries no PMID line is treated as a
       // failure: NCBI returns errors as 200 with an HTML or empty body.
       async function fetchMedlineRecord(pmid) {
           const url = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi' +
               `?db=pubmed&id=${encodeURIComponent(pmid)}&rettype=medline&retmode=text`;
           const response = await fetch(url);
           if (!response.ok) throw new Error(`efetch HTTP ${response.status}`);
           const text = (await response.text()).trim();
           if (!/^PMID-\s*\d+/m.test(text)) throw new Error('efetch returned no MEDLINE record');
           return text;
       }

       function buildCitationBarHTML(data, pmid) {
           const formatPercentage = (value) => {
               if (value === '' || value === null || value === undefined) return '-';
               const percentage = parseFloat(value) * 100;
               if (percentage > 0 && percentage < 1) {
                   return '1%';
               }
               return `${Math.round(percentage)}%`;
           };

           // YTD article count for the journal, from Journal_Ranking_YTD.csv
           const formatCount = (value) => {
               if (value === '' || value === null || value === undefined) return '-';
               const n = parseInt(value, 10);
               return isNaN(n) ? '-' : n.toLocaleString();
           };

           // Get tooltips with fallbacks
           const tt = tooltips || {};

           const similarUrl = `https://pubmed.ncbi.nlm.nih.gov/?linkname=pubmed_pubmed&from_uid=${pmid}`;
           const citedInUrl = `https://pubmed.ncbi.nlm.nih.gov/?linkname=pubmed_pubmed_citedin&from_uid=${pmid}`;
           
           
           // Always show "Abstract" since abstracts are fetched on-demand
           const abText = 'Abstract';

           // Build full-text link HTML
           let fullTextLinkHTML = '';
           if (data.fullTextUrl) {
               // We have an actual URL - always show as "Link" for consistency
               const linkClass = (data.fullTextProvider === 'PMC' || data.fullTextIsFree) ? 'free-fulltext-link' : '';
               fullTextLinkHTML = `| <a href="${data.fullTextUrl}" target="_blank" class="${linkClass}" data-tooltip="${tt.link || ''}">Link</a> `;
           } else if (data.fullTextProvider === 'Link' && data.DOI) {
               // No URL but we have DOI - show clickable "Link" for on-demand CrossRef fetch
               const linkStyle = data.fullTextIsFree ? 'color: green; font-weight: bold; text-decoration: none; cursor: pointer;' : 'color: #0066cc; text-decoration: none; cursor: pointer;';
               fullTextLinkHTML = `| <span class="crossref-link" data-doi="${data.DOI}" style="${linkStyle}" data-tooltip="${tt.link || ''}">Link</span> `;
           }

           // Build PDF button - always visible, active when PMC PDF available
           let pdfHTML = '';
           const pmcMatch = data.fullTextProvider === 'PMC' && data.fullTextUrl ? data.fullTextUrl.match(/PMC(\d+)/) : null;
           const pmcId = pmcMatch ? pmcMatch[1] : null;
           if (pmcId) {
               const pdfUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcId}/pdf/`;
               pdfHTML = `| <a href="${pdfUrl}" target="_blank" class="pdf-link-active" data-tooltip="View free PMC PDF • More sources coming">PDF</a> `;
           } else {
               pdfHTML = `| <span class="pdf-link-disabled" data-tooltip="No direct PDF found • Try Link button for article page with PDF download • More sources coming">PDF</span> `;
           }

           // Build MeSH link based on MEDLINE status
           const isMedline = data.medlineCode === 'm' || data.recordStatus === 'PubMed - indexed for MEDLINE';
           const meshLinkHTML = isMedline 
               ? `<span class="mesh-link" data-pmid="${pmid}" data-tooltip="${tt.mesh || ''}">MeSH</span>` 
               : `<span class="mesh-link-disabled" data-tooltip="${tt.mesh || ''}">MeSH</span>`;

           // Build retraction warning (bold red, clickable, shown at start of bar)
           const retractionHTML = data.hasRetraction 
               ? `<span class="retraction-link" data-pmid="${pmid}" data-retraction-pmid="${data.retractionPmid || ''}" data-original-pmid="${data.originalPmid || ''}" style="color: #cc0000; font-weight: bold; cursor: pointer;" data-tooltip="${tt.retracted || ''}">Retraction</span> | ` 
               : '';

           // Build correction flag (red 'e' for erratum, clickable)
           const correctionHTML = data.hasCorrection 
               ? `<span class="erratum-link" data-pmid="${pmid}" data-correction-pmid="${data.correctionPmid || ''}" data-original-pmid="${data.originalPmid || ''}" style="color: #cc0000; cursor: pointer;" data-tooltip="${tt.erratum || ''}">e</span>` 
               : '';

           // Build high impact indicator
           const highImpactHTML = data.overallColor === 'green' 
               ? `<span data-tooltip="${tt.highImpact || ''}">*</span>` 
               : '';

           // Build new indicator
           const newHTML = data.PublishCurrent 
               ? `<span data-tooltip="${tt.new || ''}">${data.PublishCurrent}</span>` 
               : '';

           // Build trending indicator
           const trendingHTML = data.isTrending 
               ? `<span data-tooltip="${tt.trending || ''}">t</span>` 
               : '';

           // Build medline indicator
           // Build medline indicator
           const medlineIndicatorHTML = data.medlineCode === 'm' 
               ? `<span data-tooltip="${tt.medline || ''}">m</span>` 
               : '';

           // Build preprint indicator
           const preprintHTML = data.isPreprint 
               ? `<span data-tooltip="${tt.preprint || ''}">p</span>` 
               : '';

           // Combine flags with proper spacing
           const flags = [correctionHTML, preprintHTML, medlineIndicatorHTML, newHTML, trendingHTML].filter(f => f);
           let flagsHTML = '';
           if (highImpactHTML || flags.length > 0) {
               if (highImpactHTML) {
                   flagsHTML = highImpactHTML + (flags.length > 0 ? ' ' + flags.join(' ') : '');
               } else {
                   flagsHTML = flags.join(' ');
               }
               flagsHTML += '| ';
           }

           // DOI link for ref-lookup (always visible, clickable only when DOI exists)
           const doiRefHTML = data.DOI
               ? `<span class="doi-ref-link" data-doi="${data.DOI}" style="cursor: pointer; color: #0066cc;" data-tooltip="Full DOI lookup at doilookup.com">doi</span>| `
               : `<span style="color: #999;" data-tooltip="No associated DOI">doi</span>| `;

           return `<span class="citation-help" data-score="${data.overallScore}" data-tooltip="Click for detailed help">?</span>` +
               `${retractionHTML}${flagsHTML}` +
               `${doiRefHTML}` +
               `${meshLinkHTML}| ` +
               `<a href="#" class="icite-link" data-pmid="${pmid}" data-tooltip="${tt.cited || ''}">Cited ${data.Citations}</a>| ` +
               `<span data-tooltip="${tt.rcr || ''}">RCR ${isNaN(Number(data.RelativeCitationRatio)) ? '-' : Number(data.RelativeCitationRatio).toFixed(1)}</span>| ` +
               `${data.s2Url ? `<a href="${data.s2Url}" target="_blank" data-tooltip="${tt.ic || ''}">IC ${data.influentialCitations}</a>` : `<span data-tooltip="${tt.ic || ''}">IC -</span>`}| ` +
               `${data.DOI ? `<a href="https://www.altmetric.com/details.php?doi=${data.DOI}" target="_blank" data-tooltip="${tt.alt || ''}">Alt</a>` : `<span style="color: #999;" data-tooltip="${tt.alt || ''}">Alt</span>`}| ` +
               `<a href="${similarUrl}" target="_blank" data-tooltip="${tt.similar || ''}">s</a>| ` +
               `<a href="${citedInUrl}" target="_blank" data-tooltip="${tt.citedBy || ''}">c</a>| ` +
               `${data.DOI ? 
                   `<a href="https://scholar.google.com/scholar?hl=en&as_sdt=0%2C5&q=${data.DOI}" target="_blank" data-tooltip="${tt.scholar || ''}">G Sch</a>` : 
                   (data.Title ? 
                       `<a href="https://scholar.google.com/scholar?hl=en&as_sdt=0%2C5&q=${data.Title}" target="_blank" data-tooltip="${tt.scholar || ''}">G Sch</a>` : 
                       `<span data-tooltip="${tt.scholar || ''}">G Sch</span>`)}| ` +
               `<span class="cp-link" data-doi="${data.DOI || '0'}" style="cursor: pointer; text-decoration: none; color: #0066cc;">-Con-</span>| ` +
               `<span class="ab-link" data-pmid="${pmid}" data-tooltip="${tt.abstract || ''}">${abText}</span>${fullTextLinkHTML}${pdfHTML}` +
               `<br>` +
               `<span class="pcb-pick" data-pmid="${pmid}" data-tooltip="${tt.pick || ''}">${PICK_CHECK_SVG}</span>` +
               `<span class="pcb-picklist" data-tooltip="${tt.pickList || ''}">${PICK_LIST_SVG}<span class="pcb-pick-count"></span></span>| ` +
               `<span class="author-link" data-pmid="${pmid}" style="color: #0066cc; text-decoration: none; cursor: pointer;" data-tooltip="${tt.authors || ''}">Author</span> <span data-tooltip="${tt.divider || ''}">|||</span> ` +
               `<span data-tooltip="${tt.topJournal || ''}">Top-J ${data.TopJournal}</span>| ` +
               `${data.SJRurl ? `<a href="${data.SJRurl}" target="_blank" data-tooltip="${tt.sjr || ''}">SJR ${data.SJRlinkText}</a>` : `<span data-tooltip="${tt.sjr || ''}">SJR ${data.SJRlinkText}</span>`}| ${data.cellsUrl ? `<a href="${data.cellsUrl}" target="_blank" data-tooltip="${tt.rank || ''}">Rank</a>| ` : ''}` +
               `<span data-tooltip="${tt.articleCount || ''}">YTD ${formatCount(data.counts)}</span>| ` +
               `<span data-tooltip="${tt.medlinePct || ''}">Medline ${formatPercentage(data.medline_per)}</span>| ` +
               `<span data-tooltip="${tt.freePct || ''}">Free ${formatPercentage(data.free_per)}</span>| ` +
               `<span class="xout-trigger" style="cursor: pointer; color: #0066cc; text-decoration: none;" data-tooltip="Filter out reviews, retractions, editorials etc. which are 25% of PubMed">Xout</span>| ` +
               `<span class="pr-menu-trigger" style="cursor: pointer; color: #0066cc; text-decoration: none; position: relative;" data-tooltip="PubMed Reports (key overviews)">pR</span>| ` +
               `<span class="citation-report-link" data-pmid="${pmid}" style="color: #0066cc; text-decoration: none; cursor: pointer;" data-tooltip="${tt.citationReport || ''}">/Report</span>`;
       }

       // Add CSS for the modal and Ab link. Guarded by id the same way the
       // modals below already are - this appended another copy every injection.
       const styleElement = document.createElement('style');
       styleElement.id = 'pcb-bar-styles';
       styleElement.textContent = `
           ${helpStyles}
           .ab-link {
               color: #0066cc;
               text-decoration: none;
               cursor: pointer;
           }
           
           .icite-link {
               color: #0066cc;
               text-decoration: none;
               cursor: pointer;
           }
           
           .mesh-link {
               color: #0066cc;
               text-decoration: none;
               cursor: pointer;
           }
           
           .mesh-link-disabled {
               color: #999;
               text-decoration: none;
               cursor: default;
           }
           
           /* Export list controls.
              Height is fixed at 12px with vertical-align: middle so the icons
              sit on the text baseline without raising the line box - anything
              taller makes every bar on a 200-result page grow. */
           .pcb-pick svg,
           .pcb-picklist svg {
               height: 12px;
               width: 12px;
               vertical-align: middle;
               display: inline-block;
           }

           /* The tick is a touch larger than the list icon as well as heavier.
              13px still sits inside the 12px line box the rest of the bar sets,
              so this does not change the height of any row. */
           .pcb-pick svg {
               height: 13px;
               width: 13px;
           }

           /* Unselected sits at #d6d6d6 rather than the #bbb used elsewhere in
              the bar, so the gap to the green reads at a glance on a page of
              200 rows. It can go this light because the tick is drawn at
              stroke 3.4 - a heavier mark stays legible at a lighter tone than
              a thin one would. Hover darkens it, so a tick that is nearly
              invisible against the background still answers to the pointer. */
           .pcb-pick {
               cursor: pointer;
               color: #d6d6d6;
               margin-right: 5px;
           }

           .pcb-pick:hover {
               color: #9a9a9a;
           }

           .pcb-pick.picked,
           .pcb-pick.picked:hover {
               color: #1a9c3c;
           }

           /* Pending: the fetch is in flight or queued behind another. The
              tick must not look settled until the record is actually cached,
              or a failed fetch leaves a green tick with nothing behind it. */
           .pcb-pick.picking {
               color: #e8a33d;
               cursor: progress;
               animation: pcb-pick-pulse 0.9s ease-in-out infinite;
           }

           @keyframes pcb-pick-pulse {
               0%, 100% { opacity: 1; }
               50% { opacity: 0.35; }
           }

           .pcb-picklist {
               cursor: pointer;
               color: #bbb;
               margin-right: 2px;
           }

           .pcb-picklist.has-picks {
               color: #0066cc;
           }

           .pcb-pick-count {
               font-size: 0.85em;
               vertical-align: middle;
               margin-left: 2px;
           }

           .pcb-export-modal {
               display: none;
               position: fixed;
               z-index: 9999;
               left: 0;
               top: 0;
               width: 100%;
               height: 100%;
               background-color: rgba(0, 0, 0, 0.5);
           }

           .pcb-export-content {
               background-color: white;
               margin: 8% auto;
               padding: 0;
               border: 1px solid #888;
               width: 90%;
               max-width: 640px;
               max-height: 76vh;
               border-radius: 5px;
               box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
               display: flex;
               flex-direction: column;
           }

           .pcb-export-header {
               display: flex;
               justify-content: space-between;
               align-items: center;
               padding: 14px 18px;
               border-bottom: 1px solid #e0e0e0;
           }

           .pcb-export-header h3 {
               margin: 0;
               font-size: 16px;
           }

           .pcb-export-body {
               overflow-y: auto;
               padding: 6px 18px;
               flex: 1 1 auto;
           }

           .pcb-export-row {
               display: flex;
               align-items: flex-start;
               gap: 10px;
               padding: 8px 0;
               border-bottom: 1px solid #f0f0f0;
               font-size: 13px;
               line-height: 1.4;
           }

           .pcb-export-row:last-child {
               border-bottom: none;
           }

           .pcb-export-remove {
               flex: 0 0 auto;
               cursor: pointer;
               color: #cc0000;
               background: none;
               border: none;
               font-size: 14px;
               line-height: 1.4;
               padding: 0 2px;
           }

           .pcb-export-meta {
               color: #666;
               font-size: 12px;
           }

           .pcb-export-empty {
               padding: 24px 0;
               text-align: center;
               color: #777;
               font-size: 13px;
           }

           .pcb-export-note {
               display: none;
               padding: 10px 18px;
               margin: 0;
               background-color: #fff8e6;
               border-top: 1px solid #f0e0b8;
               color: #7a5c12;
               font-size: 12px;
               line-height: 1.45;
           }

           .pcb-export-footer {
               display: flex;
               justify-content: flex-end;
               gap: 8px;
               padding: 12px 18px;
               border-top: 1px solid #e0e0e0;
           }

           /* Colour, weight and font are all set explicitly, and so is :hover.
              This modal is injected into a PubMed page, so any property left
              unset is decided by PubMed's own button rules - which left the
              labels invisible until their hover rule turned them blue. The
              existing .xout-btn sets colour for exactly this reason. */
           .pcb-export-btn {
               padding: 6px 14px;
               border: 1px solid #ccc;
               background-color: #fff;
               color: #333;
               border-radius: 4px;
               cursor: pointer;
               font-size: 13px;
               font-weight: 500;
               font-family: inherit;
               line-height: normal;
               text-decoration: none;
               text-transform: none;
               appearance: none;
               -webkit-appearance: none;
           }

           .pcb-export-btn:hover {
               background-color: #f0f0f0;
               color: #333;
           }

           .pcb-export-btn:disabled {
               opacity: 0.5;
               cursor: default;
           }

           .pcb-export-btn-primary {
               background-color: #0066cc;
               border-color: #0066cc;
               color: #fff;
           }

           .pcb-export-btn-primary:hover {
               background-color: #0052a3;
               color: #fff;
           }

           .pr-menu-trigger {
               position: relative;
               display: inline;
           }
           
           .pr-dropdown-menu {
               display: none;
               position: absolute;
               bottom: 100%;
               left: 50%;
               transform: translateX(-50%);
               background: #ffffff;
               border: 1px solid #ccc;
               border-radius: 4px;
               box-shadow: 0 2px 8px rgba(0,0,0,0.15);
               z-index: 999999;
               min-width: 200px;
               padding: 4px 0;
               margin-bottom: 4px;
           }
           
           .pr-dropdown-menu.show {
               display: block;
           }
           
           .pr-dropdown-item {
               display: block;
               padding: 6px 12px;
               color: #0066cc;
               text-decoration: none;
               font-size: 13px;
               white-space: nowrap;
               cursor: pointer;
           }
           
           .pr-dropdown-item:hover {
               background-color: #f0f0f0;
           }
           
           .pdf-link-active {
               color: green;
               font-weight: bold;
               text-decoration: none;
               cursor: pointer;
           }
           
           .pdf-link-active:visited {
               color: green;
           }
           
           .pdf-link-active:hover {
               text-decoration: underline;
           }
           
           .pdf-link-disabled {
               color: #bbb;
               font-weight: bold;
               text-decoration: none;
               cursor: default;
           }
           
           .free-fulltext-link {
               color: green;
               font-weight: bold;
               text-decoration: none;
           }
           
           .free-fulltext-link:visited {
               color: green;
           }
           
           .free-fulltext-link:hover {
               text-decoration: underline;
           }
           
           .mesh-modal {
               display: none;
               position: fixed;
               z-index: 9999;
               left: 0;
               top: 0;
               width: 100%;
               height: 100%;
               background-color: rgba(0, 0, 0, 0.5);
           }
           
           .mesh-modal-content {
               background-color: white;
               margin: 10% auto;
               padding: 20px;
               border: 1px solid #888;
               width: 80%;
               max-width: 500px;
               max-height: 70vh;
               overflow-y: auto;
               border-radius: 5px;
               box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
               position: relative;
           }
           
           .mesh-close {
               float: right;
               cursor: pointer;
           }
           
                      .mesh-title {
               font-weight: bold;
               margin-bottom: 15px;
               font-size: 16px;
           }
           
           .mesh-body {
               line-height: 1.6;
               white-space: pre-line;
           }
           
           .notice-modal {
               display: none;
               position: fixed;
               z-index: 9999;
               left: 0;
               top: 0;
               width: 100%;
               height: 100%;
               background-color: rgba(0, 0, 0, 0.5);
           }
           
           .notice-modal-content {
               background-color: white;
               margin: 15% auto;
               padding: 20px;
               border: 1px solid #888;
               width: 80%;
               max-width: 400px;
               border-radius: 5px;
               box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
               position: relative;
           }
           
           .notice-close {
               float: right;
               cursor: pointer;
           }
           
                      .notice-title {
               font-weight: bold;
               margin-bottom: 15px;
               font-size: 16px;
               color: #cc0000;
           }
           
           .notice-body {
               line-height: 1.8;
               font-size: 14px;
           }
           
           .notice-body .pmid-line {
               margin: 5px 0;
           }
           
           .abstract-modal {
               display: none;
               position: fixed;
               z-index: 9999;
               left: 0;
               top: 0;
               width: 100%;
               height: 100%;
               background-color: rgba(0, 0, 0, 0.5);
           }
           
           .abstract-modal-content {
               background-color: white;
               margin: 10% auto;
               padding: 20px;
               border: 1px solid #888;
               width: 80%;
               max-width: 700px;
               max-height: 70vh;
               overflow-y: auto;
               border-radius: 5px;
               box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
               position: relative;
           }
           
           .abstract-close {
              float: right;
              cursor: pointer;
          }
          
                    .abstract-title {
              font-weight: bold;
              margin-bottom: 15px;
              font-size: 16px;
          }
          
          .abstract-body {
              line-height: 1.5;
              white-space: pre-line;
          }

          /* Xout modal styles */
          .xout-modal {
              display: none;
              position: fixed;
              z-index: 9999;
              left: 0;
              top: 0;
              width: 100%;
              height: 100%;
              background-color: rgba(0, 0, 0, 0.5);
          }
          
          .xout-modal-content {
              background-color: white;
              margin: 8% auto;
              padding: 0;
              border: 1px solid #888;
              width: 480px;
              max-width: 90%;
              border-radius: 8px;
              box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 13px;
          }
          
          .xout-modal-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 14px 18px;
              border-bottom: 1px solid #ddd;
              background-color: #f5f5f5;
              border-radius: 8px 8px 0 0;
          }
          
          .xout-modal-header h3 {
              margin: 0;
              font-size: 16px;
              color: #333;
          }
          
          .xout-modal-close {
              cursor: pointer;
          }
          
                    .xout-modal-body {
              padding: 14px 18px;
          }
          
          .xout-input-wrapper {
              position: relative;
              margin-bottom: 10px;
          }
          
          .xout-input-label {
              display: block;
              font-size: 11px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.8px;
              color: #666;
              margin-bottom: 5px;
          }
          
          .xout-search-input {
              width: 100%;
              height: 60px;
              padding: 8px 30px 8px 10px;
              border: 1px solid #ccc;
              border-radius: 5px;
              font-family: monospace;
              font-size: 12px;
              resize: none;
              box-sizing: border-box;
          }
          
          .xout-search-input:focus {
              border-color: #0066cc;
              outline: none;
          }
          
          .xout-clear-btn {
              position: absolute;
              top: 24px;
              right: 6px;
              background: none;
              border: none;
              font-size: 16px;
              color: #999;
              cursor: pointer;
              padding: 2px 5px;
              line-height: 1;
          }
          
          .xout-clear-btn:hover {
              color: #333;
          }
          
          .xout-filters-section {
              margin-bottom: 10px;
          }
          
          .xout-filter-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 6px;
          }
          
          .xout-toggle-all {
              font-size: 11px;
              color: #0066cc;
              background: none;
              border: none;
              cursor: pointer;
              padding: 0;
          }
          
          .xout-toggle-all:hover {
              text-decoration: underline;
          }
          
          .xout-abstract-filter {
              margin-bottom: 6px;
              padding-bottom: 5px;
              border-bottom: 1px solid #eee;
          }
          
          .xout-filter-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 1px 8px;
          }
          
          #xout-modal .xout-filter-item,
          #xout-modal .xout-filter-item * {
              line-height: normal;
              margin: 0;
              box-sizing: border-box;
          }
          
          .xout-filter-item {
              display: flex;
              align-items: center;
              gap: 5px;
              padding: 1px 4px;
              border-radius: 3px;
              cursor: pointer;
              user-select: none;
              line-height: 1.1;
          }
          
          .xout-filter-item:hover {
              background-color: #f5f5f5;
          }
          
          .xout-filter-item input[type="checkbox"] {
              margin: 0;
              padding: 0;
              cursor: pointer;
          }
          
          .xout-filter-item label {
              cursor: pointer;
              font-size: 12px;
              color: #333;
              padding: 0;
              margin: 0;
          }
          
          .xout-filter-item.unchecked label {
              color: #999;
              text-decoration: line-through;
          }
          
          .xout-preview-section {
              margin-bottom: 10px;
          }
          
          .xout-preview-box {
              width: 100%;
              height: 60px;
              padding: 8px 10px;
              border: 1px solid #ddd;
              border-radius: 5px;
              background-color: #f9f9f9;
              font-family: monospace;
              font-size: 11px;
              line-height: 1.5;
              overflow-y: auto;
              box-sizing: border-box;
              color: #333;
              word-break: break-word;
          }
          
          .xout-modal-footer {
              display: flex;
              justify-content: flex-end;
              gap: 8px;
              padding: 14px 18px;
              border-top: 1px solid #ddd;
              background-color: #f9f9f9;
              border-radius: 0 0 8px 8px;
          }
          
          .xout-btn {
              padding: 7px 16px;
              border-radius: 5px;
              font-size: 13px;
              font-weight: 500;
              cursor: pointer;
              border: 1px solid #ccc;
              background-color: #fff;
              color: #333;
          }
          
          .xout-btn:hover {
              background-color: #f0f0f0;
          }
          
          .xout-btn-primary {
              background-color: #0066cc;
              color: #fff;
              border-color: #0066cc;
          }
          
          .xout-btn-primary:hover {
              background-color: #0052a3;
          }
          
          .xout-btn-copied {
              background-color: #28a745;
              border-color: #28a745;
              color: #fff;
          }
      `;
      if (!document.getElementById('pcb-bar-styles')) {
          document.head.appendChild(styleElement);
      }

      // Create modal container if it doesn't exist
      if (!document.getElementById('abstract-modal')) {
          const modalContainer = document.createElement('div');
          modalContainer.id = 'abstract-modal';
          modalContainer.className = 'abstract-modal';
          modalContainer.innerHTML = `
              <div class="abstract-modal-content">
                  <button class="abstract-close">Close</button>
                  <div class="abstract-title"></div>
                  <div class="abstract-body">This is a test</div>
              </div>
          `;
          document.body.appendChild(modalContainer);

          const modal = document.getElementById('abstract-modal');
          const closeBtn = modal.querySelector('.abstract-close');
          
          closeBtn.addEventListener('click', function() {
              modal.style.display = 'none';
          });
          
          window.addEventListener('click', function(event) {
              if (event.target === modal) {
                  modal.style.display = 'none';
              }
          });
      }

      // Create MeSH modal container if it doesn't exist
      if (!document.getElementById('mesh-modal')) {
          const meshModalContainer = document.createElement('div');
          meshModalContainer.id = 'mesh-modal';
          meshModalContainer.className = 'mesh-modal';
          meshModalContainer.innerHTML = `
              <div class="mesh-modal-content">
                  <button class="mesh-close">Close</button>
                  <div class="mesh-title">MeSH Terms</div>
                  <div class="mesh-body"></div>
              </div>
          `;
          document.body.appendChild(meshModalContainer);

          const meshModal = document.getElementById('mesh-modal');
          const meshCloseBtn = meshModal.querySelector('.mesh-close');
          
          meshCloseBtn.addEventListener('click', function() {
              meshModal.style.display = 'none';
          });
          
          window.addEventListener('click', function(event) {
              if (event.target === meshModal) {
                  meshModal.style.display = 'none';
              }
          });
      }

      // Create notice modal for retraction/erratum popups
      if (!document.getElementById('notice-modal')) {
          const noticeModalContainer = document.createElement('div');
          noticeModalContainer.id = 'notice-modal';
          noticeModalContainer.className = 'notice-modal';
          noticeModalContainer.innerHTML = `
              <div class="notice-modal-content">
                  <button class="notice-close">Close</button>
                  <div class="notice-title"></div>
                  <div class="notice-body"></div>
              </div>
          `;
          document.body.appendChild(noticeModalContainer);

          const noticeModal = document.getElementById('notice-modal');
          const noticeCloseBtn = noticeModal.querySelector('.notice-close');
          
          noticeCloseBtn.addEventListener('click', function() {
              noticeModal.style.display = 'none';
          });
          
          window.addEventListener('click', function(event) {
              if (event.target === noticeModal) {
                  noticeModal.style.display = 'none';
              }
          });
      }

      // Create help modal for citation bar help
      if (!document.getElementById('help-modal')) {
          const helpModalContainer = document.createElement('div');
          helpModalContainer.id = 'help-modal';
          helpModalContainer.className = 'help-modal';
          
          // Use pre-generated help HTML content
          const helpContent = helpContentHTML || '<p>Help content not available.</p>';
          
          helpModalContainer.innerHTML = `
              <div class="help-modal-content">
                  <div class="help-modal-header">
                      <h3>Citation Bar Help</h3>
                      <button class="help-modal-close">Close</button>
                  </div>
                  <div class="help-modal-body">
                      ${helpContent}
                      <div class="help-version">Ver 3.820 Sep-2026</div>
                  </div>
              </div>
          `;
          document.body.appendChild(helpModalContainer);

          const helpModal = document.getElementById('help-modal');
          const helpCloseBtn = helpModal.querySelector('.help-modal-close');
          
          helpCloseBtn.addEventListener('click', function() {
              helpModal.style.display = 'none';
          });
          
          window.addEventListener('click', function(event) {
              if (event.target === helpModal) {
                  helpModal.style.display = 'none';
              }
          });
          
          // Close on Escape key
          document.addEventListener('keydown', function(event) {
              if (event.key === 'Escape' && helpModal.style.display === 'block') {
                  helpModal.style.display = 'none';
              }
          });
      }

      // Create Xout modal for exclusion search
      if (!document.getElementById('xout-modal')) {
          // Extract current search term from URL
          let currentSearchTerm = '';
          try {
              const urlParams = new URLSearchParams(window.location.search);
              const termParam = urlParams.get('term');
              if (termParam) {
                  currentSearchTerm = decodeURIComponent(termParam);
              }
          } catch (e) {}

          const xoutFilters = [
              { id: 'xout-retracted', label: 'No Retracted Publications', pt: '"Retracted Publication"[pt]' },
              { id: 'xout-erratum', label: 'No Published Errata', pt: '"Published Erratum"[pt]' },
              { id: 'xout-letter', label: 'No Letters', pt: '"Letter"[pt]' },
              { id: 'xout-editorial', label: 'No Editorials', pt: '"Editorial"[pt]' },
              { id: 'xout-comment', label: 'No Comments', pt: '"Comment"[pt]' },
              { id: 'xout-systematic', label: 'No Systematic Reviews', pt: '"Systematic Review"[pt]' },
              { id: 'xout-meta', label: 'No Meta-Analyses', pt: '"Meta-Analysis"[pt]' },
              { id: 'xout-review', label: 'No Reviews', pt: '"Review"[pt]' }
          ];

          let filterCheckboxesHTML = xoutFilters.map(f => 
              `<div class="xout-filter-item">
                  <input type="checkbox" id="${f.id}" checked>
                  <label for="${f.id}">${f.label}</label>
              </div>`
          ).join('');

          const xoutModalContainer = document.createElement('div');
          xoutModalContainer.id = 'xout-modal';
          xoutModalContainer.className = 'xout-modal';
          xoutModalContainer.innerHTML = `
              <div class="xout-modal-content">
                  <div class="xout-modal-header">
                      <h3>Xout — Exclusion Search</h3>
                      <button class="xout-modal-close">Close</button>
                  </div>
                  <div class="xout-modal-body">
                      <div class="xout-input-wrapper">
                          <span class="xout-input-label">Search Query</span>
                          <textarea class="xout-search-input" id="xout-search-input" placeholder="Enter your PubMed search query...">${currentSearchTerm}</textarea>
                          <button class="xout-clear-btn" id="xout-clear-btn" title="Clear search">✕</button>
                      </div>
                      
                      <div class="xout-filters-section">
                          <div class="xout-filter-header">
                              <span class="xout-input-label" style="margin-bottom: 0;">Filters</span>
                              <button class="xout-toggle-all" id="xout-toggle-all">Uncheck all</button>
                          </div>
                          
                          <div class="xout-abstract-filter">
                              <div class="xout-filter-item">
                                  <input type="checkbox" id="xout-hasabstract" checked>
                                  <label for="xout-hasabstract">Has Abstract (recommended)</label>
                              </div>
                          </div>
                          
                          <div class="xout-filter-grid">
                              ${filterCheckboxesHTML}
                          </div>
                      </div>
                      
                      <div class="xout-preview-section">
                          <span class="xout-input-label">Full Query Preview</span>
                          <div class="xout-preview-box" id="xout-preview-box"></div>
                      </div>
                  </div>
                  <div class="xout-modal-footer">
                      <button class="xout-btn" id="xout-cancel-btn">Cancel</button>
                      <button class="xout-btn" id="xout-copy-btn">Copy Query</button>
                      <button class="xout-btn xout-btn-primary" id="xout-search-btn">Search</button>
                  </div>
              </div>
          `;
          document.body.appendChild(xoutModalContainer);

          const xoutModal = document.getElementById('xout-modal');

          // Build query preview function
          function updateXoutPreview() {
              const searchInput = document.getElementById('xout-search-input').value.trim();
              const hasAbstract = document.getElementById('xout-hasabstract').checked;
              const excludedTypes = xoutFilters
                  .filter(f => document.getElementById(f.id).checked)
                  .map(f => f.pt);
              
              let query = '';
              if (searchInput) {
                  query = searchInput;
              }
              if (hasAbstract) {
                  query += (query ? ' AND ' : '') + 'hasabstract';
              }
              if (excludedTypes.length > 0) {
                  query += (query ? ' ' : '') + 'NOT (' + excludedTypes.join(' OR ') + ')';
              }
              
              document.getElementById('xout-preview-box').textContent = query;
              
              // Update filter item styling
              xoutFilters.forEach(f => {
                  const item = document.getElementById(f.id).closest('.xout-filter-item');
                  if (document.getElementById(f.id).checked) {
                      item.classList.remove('unchecked');
                  } else {
                      item.classList.add('unchecked');
                  }
              });
              
              // Update hasabstract item styling
              const absItem = document.getElementById('xout-hasabstract').closest('.xout-filter-item');
              if (document.getElementById('xout-hasabstract').checked) {
                  absItem.classList.remove('unchecked');
              } else {
                  absItem.classList.add('unchecked');
              }
              
              // Update toggle all button text
              const allExclusionsChecked = xoutFilters.every(f => document.getElementById(f.id).checked);
              document.getElementById('xout-toggle-all').textContent = allExclusionsChecked ? 'Uncheck all' : 'Check all';

              return query;
          }

          // Attach change listeners to all checkboxes
          document.getElementById('xout-hasabstract').addEventListener('change', updateXoutPreview);
          xoutFilters.forEach(f => {
              document.getElementById(f.id).addEventListener('change', updateXoutPreview);
          });

          // Search input listener
          document.getElementById('xout-search-input').addEventListener('input', updateXoutPreview);

          // Clear button
          document.getElementById('xout-clear-btn').addEventListener('click', function() {
              document.getElementById('xout-search-input').value = '';
              document.getElementById('xout-search-input').focus();
              updateXoutPreview();
          });

          // Toggle all exclusion checkboxes
          document.getElementById('xout-toggle-all').addEventListener('click', function() {
              const allChecked = xoutFilters.every(f => document.getElementById(f.id).checked);
              const newState = !allChecked;
              xoutFilters.forEach(f => {
                  document.getElementById(f.id).checked = newState;
              });
              updateXoutPreview();
          });

          // Cancel button
          document.getElementById('xout-cancel-btn').addEventListener('click', function() {
              xoutModal.style.display = 'none';
          });

          // Copy Query button
          document.getElementById('xout-copy-btn').addEventListener('click', function() {
              const query = document.getElementById('xout-preview-box').textContent;
              if (!query) return;
              navigator.clipboard.writeText(query).then(() => {
                  const btn = document.getElementById('xout-copy-btn');
                  btn.textContent = '✓ Copied';
                  btn.classList.add('xout-btn-copied');
                  setTimeout(() => {
                      btn.textContent = 'Copy Query';
                      btn.classList.remove('xout-btn-copied');
                  }, 1500);
              }).catch(() => {
                  // Fallback
                  const textarea = document.createElement('textarea');
                  textarea.value = query;
                  document.body.appendChild(textarea);
                  textarea.select();
                  document.execCommand('copy');
                  document.body.removeChild(textarea);
                  const btn = document.getElementById('xout-copy-btn');
                  btn.textContent = '✓ Copied';
                  btn.classList.add('xout-btn-copied');
                  setTimeout(() => {
                      btn.textContent = 'Copy Query';
                      btn.classList.remove('xout-btn-copied');
                  }, 1500);
              });
          });

          // Search button - navigate current tab
          document.getElementById('xout-search-btn').addEventListener('click', function() {
              const query = document.getElementById('xout-preview-box').textContent;
              if (!query) return;
              const pubmedUrl = 'https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(query);
              window.location.href = pubmedUrl;
          });

          // Close modal
          xoutModal.querySelector('.xout-modal-close').addEventListener('click', function() {
              xoutModal.style.display = 'none';
          });

          // Close on outside click
          window.addEventListener('click', function(event) {
              if (event.target === xoutModal) {
                  xoutModal.style.display = 'none';
              }
          });

          // Close on Escape key
          document.addEventListener('keydown', function(event) {
              if (event.key === 'Escape' && xoutModal.style.display === 'block') {
                  xoutModal.style.display = 'none';
              }
          });

          // Initial preview
          updateXoutPreview();
      }

      // Detect if we are on a single article page
      const pmidElementSingle = document.querySelector('strong.current-id[title="PubMed ID"]');
      const isSingleArticlePage = !!pmidElementSingle;

      if (pmidElementSingle) {
          const pmid = pmidElementSingle.textContent.trim();
          const existingBar = document.querySelector(`.citation-bar[data-pmid="${pmid}"]`);
          if (!insertedPMIDs.has(pmid) && !existingBar) { // Skip if PMID processed or bar exists
              const existingSingleBar = document.querySelector('.citation-bar');
              if (existingSingleBar) {
                  existingSingleBar.remove();
              }
              const data = fullDataSet.find(item => item.PMID === pmid);
              if (data) {
                  const citationBar = document.createElement('div');
                  citationBar.className = 'citation-bar special-citation-bar';
                  citationBar.setAttribute('data-pmid', pmid); // Add PMID attribute
                  citationBar.innerHTML = buildCitationBarHTML(data, pmid);
                  citationBar.style.backgroundColor = data.hasRetraction ? '#ffe6e6' : (data.overallColor === 'green' ? '#f0fff0' : '#f0f8ff');
                  citationBar.style.color = 'black';
                  citationBar.style.padding = '8px';
                  citationBar.style.marginTop = '10px';
                  citationBar.style.borderRadius = '4px';
                  citationBar.style.fontSize = '0.9em';
                  citationBar.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
                  const disclaimerElement = document.querySelector('p.disclaimer');
                  if (disclaimerElement) {
                      disclaimerElement.parentNode.insertBefore(citationBar, disclaimerElement.nextSibling);
                      injectedCount++;
                  } else {
                      const disclaimerLink = document.querySelector('a[ga_label="under_abstract"]');
                      if (disclaimerLink) {
                          disclaimerLink.parentNode.insertBefore(citationBar, disclaimerLink.nextSibling);
                          injectedCount++;
                      } else {
                          const abstractSection = document.querySelector('.abstract-content, .abstract');
                          if (abstractSection) {
                              abstractSection.parentNode.insertBefore(citationBar, abstractSection.nextSibling);
                              injectedCount++;
                          } else {
                              document.body.appendChild(citationBar);
                              injectedCount++;
                          }
                      }
                  }
                  insertedPMIDs.add(pmid); // Mark PMID as processed
              }
          }
      }

      // Process other articles on the page
      let articleElements = document.querySelectorAll('.docsum-content');
      if (articleElements.length === 0) {
          const titleElements = document.querySelectorAll('.docsum-title');
          if (titleElements.length > 0) {
              articleElements = Array.from(titleElements).map(title => title.closest('article') || title.parentElement);
          }
      }

      articleElements.forEach(articleElement => {
          const existingBar = articleElement.querySelector('.citation-bar');
          if (existingBar) {
              existingBar.remove();
          }
          let pmidElement = articleElement.querySelector('span[class*="docsum-pmid"]');
          if (!pmidElement) {
              pmidElement = articleElement.querySelector('.citation-part .docsum-pmid');
          }
          if (!pmidElement) return;
          const pmid = pmidElement.textContent.trim();
          if (insertedPMIDs.has(pmid) || document.querySelector(`.citation-bar[data-pmid="${pmid}"]`)) return; // Skip if PMID processed or bar exists
         const data = fullDataSet.find(item => item.PMID === pmid);
         if (!data) return;
         if (states.filterEnabled && !isSingleArticlePage && data.overallColor !== 'green') {
             articleElement.style.display = 'none';
             return;
         }
         const citationBar = document.createElement('div');
         citationBar.className = 'citation-bar';
         citationBar.setAttribute('data-pmid', pmid); // Add PMID attribute
         citationBar.innerHTML = buildCitationBarHTML(data, pmid);
         citationBar.style.backgroundColor = data.hasRetraction ? '#ffe6e6' : (data.overallColor === 'green' ? '#f0fff0' : '#f0f8ff');
         citationBar.style.color = 'black';
         citationBar.style.padding = '8px';
         citationBar.style.marginTop = '10px';
         citationBar.style.borderRadius = '4px';
         citationBar.style.fontSize = '0.9em';
         citationBar.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
         articleElement.appendChild(citationBar);
         insertedPMIDs.add(pmid); // Mark PMID as processed
         injectedCount++;
     });

     // Check for simplified results view
     const simplifiedResults = document.querySelectorAll('.full-docsum.simplified-result');
     if (simplifiedResults.length > 0) {
         console.log('Found simplified results view with', simplifiedResults.length, 'items');
         simplifiedResults.forEach(resultItem => {
             const existingBar = resultItem.querySelector('.citation-bar');
             if (existingBar) {
                 existingBar.remove();
             }
             const pmidElement = resultItem.querySelector('.pmid-inline') || resultItem.querySelector('.docsum-pmid');
             if (!pmidElement) {
                 console.log('No PMID element found in simplified result');
                 return;
             }
             const pmid = pmidElement.textContent.trim().replace(/PMID:\s*/, '');
             if (insertedPMIDs.has(pmid) || document.querySelector(`.citation-bar[data-pmid="${pmid}"]`)) return; // Skip if PMID processed or bar exists
             const data = fullDataSet.find(item => item.PMID === pmid);
             if (!data) {
                 console.log('No data found for PMID:', pmid);
                 return;
             }
             const citationBar = document.createElement('div');
             citationBar.className = 'citation-bar';
             citationBar.setAttribute('data-pmid', pmid); // Add PMID attribute
             citationBar.innerHTML = buildCitationBarHTML(data, pmid);
             citationBar.style.backgroundColor = data.hasRetraction ? '#ffe6e6' : (data.overallColor === 'green' ? '#f0fff0' : '#f0f8ff');
             citationBar.style.color = 'black';
             citationBar.style.padding = '8px';
             citationBar.style.marginTop = '10px';
             citationBar.style.borderRadius = '4px';
             citationBar.style.fontSize = '0.9em';
             citationBar.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
             resultItem.appendChild(citationBar);
             insertedPMIDs.add(pmid); // Mark PMID as processed
             injectedCount++;
         });
     }

     // SORT RESULTS BY OVERALL SCORE
     setTimeout(() => {
         const articles = document.querySelectorAll('article.full-docsum');
         if (articles.length > 0) {
             const container = articles[0].parentElement;
             const articleWithData = Array.from(articles).map(article => {
                 const pmidElement = article.querySelector('span.docsum-pmid');
                 if (!pmidElement) return null;
                 const pmid = pmidElement.textContent.trim();
                 const data = fullDataSet?.find(item => item.PMID === pmid);
                 return {
                     element: article,
                     pmid: pmid,
                     data: data,
                     score: data ? parseFloat(data.overallScore) : -1,
                     citations: data ? parseInt(data.Citations) || 0 : 0
                 };
             }).filter(item => item !== null);
             articleWithData.sort((a, b) => {
                 if (a.data && !b.data) return -1;
                 if (!a.data && b.data) return 1;
                 if (!a.data && !b.data) return 0;
                 if (b.score !== a.score) {
                     return b.score - a.score;
                 }
                 return b.citations - a.citations;
             });
             articles.forEach(article => article.remove());
             articleWithData.forEach(({element}) => {
                 container.appendChild(element);
             });
         }
     }, 50);

     // ---------------------------------------------------------------
     // Export list: modal, handlers, initial paint
     if (!document.getElementById('pcb-export-modal')) {
         const exportModalContainer = document.createElement('div');
         exportModalContainer.id = 'pcb-export-modal';
         exportModalContainer.className = 'pcb-export-modal';
         exportModalContainer.innerHTML = `
             <div class="pcb-export-content">
                 <div class="pcb-export-header">
                     <h3>Export list <span class="pcb-export-total"></span></h3>
                     <button class="pcb-export-btn pcb-export-close">Close</button>
                 </div>
                 <div class="pcb-export-body"></div>
                 <div class="pcb-export-note"></div>
                 <div class="pcb-export-footer">
                     <button class="pcb-export-btn pcb-export-clear">Clear all</button>
                     <button class="pcb-export-btn pcb-export-open" title="View the selected articles as a PubMed search, in a new tab">Open in new tab</button>
                     <button class="pcb-export-btn pcb-export-btn-primary pcb-export-download-ris" title="RIS - EndNote, Mendeley, RefWorks, Papers, Zotero">Download .ris</button>
                     <button class="pcb-export-btn pcb-export-btn-primary pcb-export-download" title="MEDLINE/nbib - PubMed's own format; Zotero and EndNote">Download .nbib</button>
                 </div>
             </div>
         `;
         document.body.appendChild(exportModalContainer);

         const exportModal = document.getElementById('pcb-export-modal');

         exportModal.querySelector('.pcb-export-close').addEventListener('click', () => {
             exportModal.style.display = 'none';
         });

         window.addEventListener('click', (event) => {
             if (event.target === exportModal) exportModal.style.display = 'none';
         });

         exportModal.querySelector('.pcb-export-clear').addEventListener('click', async () => {
             pickState.ids = [];
             pickState.records = {};
             await savePicks();
             paintPicks();
             renderExportList();
         });

         // Built in the page rather than through chrome.downloads, so no new
         // manifest permission is needed.
         function downloadPicks(extension, transform) {
             const blocks = pickState.ids
                 .map(pmid => {
                     const raw = (pickState.records[pmid] || '').trim();
                     if (!raw) return '';
                     return (transform ? transform(raw) : raw).trim();
                 })
                 .filter(Boolean);
             if (blocks.length === 0) return;

             // pubmed-citations-2026-09-12-3-04pm.nbib
             //
             // Date and time both, because people export several times a day
             // and a date-only name means the second download of the morning
             // lands as "(1)" with nothing to say what is in it.
             //
             // Local time, not UTC - this name is read by the person who made
             // the file, and it should match the clock they were looking at.
             // The minute separator is a dash rather than a colon: Windows
             // forbids a colon in a filename, and Chrome would strip it.
             const now = new Date();
             const pad = n => String(n).padStart(2, '0');
             const hour24 = now.getHours();
             const stamp =
                 `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
                 `-${hour24 % 12 === 0 ? 12 : hour24 % 12}-${pad(now.getMinutes())}` +
                 `${hour24 < 12 ? 'am' : 'pm'}`;
             const blob = new Blob([blocks.join('\n\n') + '\n'], { type: 'text/plain;charset=utf-8' });
             const url = URL.createObjectURL(blob);
             const anchor = document.createElement('a');
             anchor.href = url;
             anchor.download = `pubmed-citations-${stamp}.${extension}`;
             document.body.appendChild(anchor);
             anchor.click();
             document.body.removeChild(anchor);
             setTimeout(() => URL.revokeObjectURL(url), 1000);
         }

         exportModal.querySelector('.pcb-export-download').addEventListener('click', () => {
             downloadPicks('nbib', null);
         });

         exportModal.querySelector('.pcb-export-download-ris').addEventListener('click', () => {
             downloadPicks('ris', medlineToRis);
         });

         // A NEW tab, deliberately, and the opposite of what Scan 1,000 does.
         //
         // Scan 1,000 navigates the current tab because it replaces the user's
         // context and Back is their only way home - see the note in
         // insertCitationBar.js about fresh tabs never having a working Back.
         // This opens alongside work still in progress: the user is part-way
         // down a results page with a reading order in their head, and taking
         // that tab away costs them their place. The dead Back button in the
         // new tab does not matter here, because the page it would return to
         // is still sitting in the original tab.
         //
         // window.open is called straight out of the click handler so the
         // popup blocker treats it as user-initiated.
         exportModal.querySelector('.pcb-export-open').addEventListener('click', () => {
             const pmids = pickState.ids.slice(0, PICK_OPEN_LIMIT);
             if (pmids.length === 0) return;
             const url = `https://pubmed.ncbi.nlm.nih.gov/?term=${pmids.join(',')}+%5Bpmid%5D&size=200`;
             window.open(url, '_blank');
         });
     }

     // Rebuilt from scratch on every change - the list is at most a few dozen
     // rows, so there is nothing to gain from patching it in place.
     function renderExportList() {
         const exportModal = document.getElementById('pcb-export-modal');
         if (!exportModal) return;

         const body = exportModal.querySelector('.pcb-export-body');
         const total = exportModal.querySelector('.pcb-export-total');
         const downloadBtn = exportModal.querySelector('.pcb-export-download');
         const downloadRisBtn = exportModal.querySelector('.pcb-export-download-ris');
         const clearBtn = exportModal.querySelector('.pcb-export-clear');
         const openBtn = exportModal.querySelector('.pcb-export-open');
         const note = exportModal.querySelector('.pcb-export-note');

         const isEmpty = pickState.ids.length === 0;
         total.textContent = isEmpty ? '' : `(${pickState.ids.length})`;
         downloadBtn.disabled = isEmpty;
         downloadRisBtn.disabled = isEmpty;
         clearBtn.disabled = isEmpty;
         openBtn.disabled = isEmpty;

         // Said in the modal rather than left to the tooltip: a silently
         // truncated PubMed search looks like a correct one.
         if (pickState.ids.length > PICK_OPEN_LIMIT) {
             note.textContent =
                 `PubMed can only take ${PICK_OPEN_LIMIT} articles in one search, so "Open in new tab" ` +
                 `will show the first ${PICK_OPEN_LIMIT} of your ${pickState.ids.length}. ` +
                 `Both downloads include all ${pickState.ids.length}.`;
             note.style.display = 'block';
         } else {
             note.textContent = '';
             note.style.display = 'none';
         }

         if (pickState.ids.length === 0) {
             body.innerHTML = '<div class="pcb-export-empty">Nothing selected yet. Tick the check on any citation bar to add an article.</div>';
             return;
         }

         // Titles come from fullDataSet where the article is on this page. An
         // article ticked on an earlier page is not in this page's dataset, so
         // it falls back to the PMID rather than showing a blank row.
         body.innerHTML = pickState.ids.map(pmid => {
             const record = fullDataSet.find(item => item.PMID === pmid);
             const title = record && record.Title && record.Title !== '0'
                 ? record.Title
                 : `PMID ${pmid}`;
             const bits = [];
             if (record && record.Journal && record.Journal !== '0') bits.push(record.Journal);
             if (record && record.PublishYear && record.PublishYear !== '1') bits.push(record.PublishYear);
             bits.push(`PMID ${pmid}`);
             return `
                 <div class="pcb-export-row">
                     <button class="pcb-export-remove" data-pmid="${escapePickHTML(pmid)}" title="Remove from list">&#10005;</button>
                     <div>
                         <div>${escapePickHTML(title)}</div>
                         <div class="pcb-export-meta">${bits.map(escapePickHTML).join(' &middot; ')}</div>
                     </div>
                 </div>`;
         }).join('');

         body.querySelectorAll('.pcb-export-remove').forEach(btn => {
             btn.addEventListener('click', async () => {
                 const pmid = btn.getAttribute('data-pmid');
                 pickState.ids = pickState.ids.filter(id => id !== pmid);
                 await savePicks();
                 paintPicks();
                 renderExportList();
             });
         });
     }

     document.querySelectorAll('.pcb-pick').forEach(el => {
         if (!bindOnce(el, 'pcbPick')) return;
         el.addEventListener('click', async () => {
             const pmid = el.getAttribute('data-pmid');
             if (!pmid) return;

             await loadPicks();

             // Unticking keeps the cached record, so re-ticking the same
             // article costs nothing and makes no second request.
             if (pickState.ids.includes(pmid)) {
                 pickState.ids = pickState.ids.filter(id => id !== pmid);
                 await savePicks();
                 paintPicks();
                 renderExportList();
                 return;
             }

             if (pickState.pending.has(pmid)) return;

             if (pickState.records[pmid]) {
                 pickState.ids.push(pmid);
                 await savePicks();
                 paintPicks();
                 renderExportList();
                 return;
             }

             pickState.pending.add(pmid);
             paintPicks();

             try {
                 const text = await pickQueued(() => fetchMedlineRecord(pmid));
                 pickState.records[pmid] = text;
                 if (!pickState.ids.includes(pmid)) pickState.ids.push(pmid);
                 await savePicks();
             } catch (error) {
                 console.warn(`Export list: could not fetch PMID ${pmid} -`, error.message);
                 // Left unticked deliberately. A tick with no record behind it
                 // would export as a silently missing article.
                 alert(`Citation Bar: could not retrieve the PubMed record for PMID ${pmid}.\n\n${error.message}\n\nThe article was not added to the export list. Please try again.`);
             } finally {
                 pickState.pending.delete(pmid);
                 paintPicks();
                 renderExportList();
             }
         });
     });

     document.querySelectorAll('.pcb-picklist').forEach(el => {
         if (!bindOnce(el, 'pcbPickList')) return;
         el.addEventListener('click', async () => {
             await loadPicks();
             renderExportList();
             const exportModal = document.getElementById('pcb-export-modal');
             if (exportModal) exportModal.style.display = 'block';
         });
     });

     // Initial paint: the ticks have to show the stored selection when the
     // page loads, not only after something is clicked.
     loadPicks().then(paintPicks).catch(() => {});

     // Add click handlers for all ab-links after all elements are in the DOM
     document.querySelectorAll('.ab-link').forEach(link => {
         if (!bindOnce(link, 'pcbAb')) return;
         link.addEventListener('click', async function() {
             const pmid = this.getAttribute('data-pmid');
             if (!pmid) return;
             const data = fullDataSet.find(item => item.PMID === pmid);
             if (!data) return;
             const modal = document.getElementById('abstract-modal');
             const titleElem = modal.querySelector('.abstract-title');
             const bodyElem = modal.querySelector('.abstract-body');
             titleElem.textContent = data.Title || `PMID: ${pmid}`;
             
             // Check if abstract is available
             let abstractText = data.Abstract || 'No abstract';
             
             // If abstract is not available, fetch it on-demand using shared helper
             if (!abstractText || abstractText === 'No abstract' || abstractText === 'Error processing abstract') {
                 bodyElem.textContent = 'Loading abstract...';
                 modal.style.display = 'block';
                 
                 const efetchResult = await fetchAbstractOnDemand(pmid);
                 abstractText = efetchResult.abstract;
                 data.Abstract = abstractText; // Cache it
             }
             
             // Decode HTML entities in abstract
             if (abstractText && abstractText !== 'No abstract' && abstractText !== 'Error loading abstract') {
                 const textarea = document.createElement('textarea');
                 textarea.innerHTML = abstractText;
                 abstractText = textarea.value;
             }
             bodyElem.textContent = abstractText;
             modal.style.display = 'block';
         });
     });

     // Add click handlers for all MeSH links
     document.querySelectorAll('.mesh-link').forEach(link => {
         if (!bindOnce(link, 'pcbMesh')) return;
         link.addEventListener('click', async function() {
             const pmid = this.getAttribute('data-pmid');
             if (!pmid) return;
             
             const data = fullDataSet.find(item => item.PMID === pmid);
             const meshModal = document.getElementById('mesh-modal');
             const titleElem = meshModal.querySelector('.mesh-title');
             const bodyElem = meshModal.querySelector('.mesh-body');
             
             titleElem.textContent = data?.Title ? `MeSH Terms: ${data.Title.substring(0, 60)}${data.Title.length > 60 ? '...' : ''}` : `MeSH Terms: PMID ${pmid}`;
             bodyElem.textContent = '';
             meshModal.style.display = 'block';
             
             try {
                 // Fetch MeSH terms from PubMed EFetch API
                 const response = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&rettype=xml&retmode=xml`);
                 
                 if (!response.ok) {
                     throw new Error(`HTTP error! status: ${response.status}`);
                 }
                 
                 const xmlText = await response.text();
                 const parser = new DOMParser();
                 const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
                 
                 // Parse MeSH headings
                 const meshHeadings = xmlDoc.querySelectorAll('MeshHeading');
                 
                 if (meshHeadings.length === 0) {
                     // Build content with Type at top even if no MeSH terms
                     let content = '';
                     
                     if (data.pubType && Array.isArray(data.pubType) && data.pubType.length > 0) {
                         content += `Type: ${data.pubType.join(', ')}\n\n`;
                     }
                     
                     content += 'MeSH Terms\nMeSH terms not yet available';
                     bodyElem.textContent = content;
                     return;
                 }
                 
                 const meshTerms = [];
                 
                 meshHeadings.forEach(heading => {
                     const descriptor = heading.querySelector('DescriptorName');
                     if (!descriptor) return;
                     
                     const descriptorName = descriptor.textContent;
                     const isMajorDescriptor = descriptor.getAttribute('MajorTopicYN') === 'Y';
                     
                     // Get all qualifiers for this descriptor
                     const qualifiers = heading.querySelectorAll('QualifierName');
                     
                     if (qualifiers.length === 0) {
                         // No qualifiers - just show descriptor
                         meshTerms.push({
                             text: descriptorName + (isMajorDescriptor ? '*' : ''),
                             sortKey: descriptorName.toLowerCase()
                         });
                     } else {
                         // Has qualifiers - show each as separate line
                         qualifiers.forEach(qualifier => {
                             const qualifierName = qualifier.textContent;
                             const isMajorQualifier = qualifier.getAttribute('MajorTopicYN') === 'Y';
                             const isMajor = isMajorDescriptor || isMajorQualifier;
                             
                             meshTerms.push({
                                 text: descriptorName + (isMajor ? '*' : '') + ' / ' + qualifierName,
                                 sortKey: descriptorName.toLowerCase()
                             });
                         });
                     }
                 });
                 
                 // Sort alphabetically and display
                 meshTerms.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
                 
                 // Build content with Type at top, then MeSH Terms
                 let content = '';
                 
                 // Add publication type if available
                 if (data.pubType && Array.isArray(data.pubType) && data.pubType.length > 0) {
                     content += `Type: ${data.pubType.join(', ')}\n\n`;
                 }
                 
                 // Add MeSH Terms header and list
                 content += 'MeSH Terms\n';
                 content += meshTerms.map(term => `• ${term.text}`).join('\n');
                 
                 bodyElem.textContent = content;
                 
             } catch (error) {
                 console.error('Error fetching MeSH terms:', error);
                 
                 // Build content with Type at top even if error
                 let content = '';
                 
                 if (data.pubType && Array.isArray(data.pubType) && data.pubType.length > 0) {
                     content += `Type: ${data.pubType.join(', ')}\n\n`;
                 }
                 
                 content += 'MeSH Terms\nError loading MeSH terms';
                 bodyElem.textContent = content;
             }
         });
     });

     // Add click handlers for retraction links
     document.querySelectorAll('.retraction-link').forEach(link => {
         if (!bindOnce(link, 'pcbRetraction')) return;
         link.addEventListener('click', function() {
             const pmid = this.getAttribute('data-pmid');
             const retractionPmid = this.getAttribute('data-retraction-pmid');
             const originalPmid = this.getAttribute('data-original-pmid');
             
             const noticeModal = document.getElementById('notice-modal');
             const titleElem = noticeModal.querySelector('.notice-title');
             const bodyElem = noticeModal.querySelector('.notice-body');
             
             titleElem.textContent = 'Retraction';
             
             let bodyHTML = '';
             if (originalPmid) {
                 // This IS the retraction notice - show original first
                 bodyHTML = '<div class="pmid-line">Original article: PMID ' + originalPmid + '</div>';
                 bodyHTML += '<div class="pmid-line">Retraction notice: PMID ' + pmid + '</div>';
             } else {
                 // This is the original article - show it first
                 bodyHTML = '<div class="pmid-line">Original article: PMID ' + pmid + '</div>';
                 if (retractionPmid) {
                     bodyHTML += '<div class="pmid-line">Retraction notice: PMID ' + retractionPmid + '</div>';
                 }
             }
             bodyElem.innerHTML = bodyHTML;
             
             noticeModal.style.display = 'block';
         });
     });

     // Add click handlers for help icon
     document.querySelectorAll('.citation-help').forEach(helpIcon => {
         if (!bindOnce(helpIcon, 'pcbHelp')) return;
         helpIcon.addEventListener('click', function() {
             const helpModal = document.getElementById('help-modal');
             if (helpModal) {
                 const modalBody = helpModal.querySelector('.help-modal-body');
                 const articleScore = this.getAttribute('data-score');
                 
                 // Remove any existing score display
                 const existingScoreDisplay = modalBody.querySelector('.article-score-display');
                 if (existingScoreDisplay) {
                     existingScoreDisplay.remove();
                 }
                 
                 // Add the score at the top of the modal body
                 if (articleScore && modalBody) {
                     const scoreDisplay = document.createElement('div');
                     scoreDisplay.className = 'article-score-display';
                     scoreDisplay.style.cssText = 'text-align: center; font-size: 18px; font-weight: bold; padding: 15px; background-color: #e8f4f8; margin-bottom: 15px; border-radius: 6px; border: 2px solid #0066cc;';
                     scoreDisplay.innerHTML = `The overall score of this article is <span style="font-size: 24px; color: #0066cc;">${articleScore}</span>`;
                     modalBody.insertBefore(scoreDisplay, modalBody.firstChild);
                 }
                 
                 helpModal.style.display = 'block';
                 // Reset scroll position to top after display is set
                 setTimeout(() => {
                     // Reset all possible scrollable elements
                     helpModal.scrollTop = 0;
                     const modalContent = helpModal.querySelector('.help-modal-content');
                     if (modalBody) {
                         modalBody.scrollTop = 0;
                     }
                     if (modalContent) {
                         modalContent.scrollTop = 0;
                     }
                 }, 10);
             }
         });
     });

     // Add click handlers for erratum links
     document.querySelectorAll('.erratum-link').forEach(link => {
         if (!bindOnce(link, 'pcbErratum')) return;
         link.addEventListener('click', function() {
             const pmid = this.getAttribute('data-pmid');
             const correctionPmid = this.getAttribute('data-correction-pmid');
             const originalPmid = this.getAttribute('data-original-pmid');
             
             const noticeModal = document.getElementById('notice-modal');
             const titleElem = noticeModal.querySelector('.notice-title');
             const bodyElem = noticeModal.querySelector('.notice-body');
             
             titleElem.textContent = 'Erratum';
             
             let bodyHTML = '';
             if (originalPmid) {
                 // This IS the erratum notice - show original first
                 bodyHTML = '<div class="pmid-line">Original article: PMID ' + originalPmid + '</div>';
                 bodyHTML += '<div class="pmid-line">Erratum notice: PMID ' + pmid + '</div>';
             } else if (correctionPmid) {
                 // This is the original article - show both
                 bodyHTML = '<div class="pmid-line">Original article: PMID ' + pmid + '</div>';
                 bodyHTML += '<div class="pmid-line">Erratum notice: PMID ' + correctionPmid + '</div>';
             } else {
                 // Edge case - has correction flag but no linked PMID
                 bodyHTML = '<div class="pmid-line">This article has an associated erratum.</div>';
                 bodyHTML += '<div class="pmid-line">Article: PMID ' + pmid + '</div>';
             }
             bodyElem.innerHTML = bodyHTML;
             
             noticeModal.style.display = 'block';
         });
     });


     // Add click handlers for Connected Papers links
     document.querySelectorAll('.cp-link').forEach(link => {
         if (!bindOnce(link, 'pcbCp')) return;
         link.addEventListener('click', function(e) {
             e.preventDefault();
             const doi = this.getAttribute('data-doi');
             
             if (!doi || doi === '0') {
                 alert('This article has no DOI, which is required for the Connections chart');
             } else {
                 window.open(`https://doilookup.com/?doi=${encodeURIComponent(doi)}&connections=1`, '_blank');
             }
         });
     });

     // Rich hover tooltip for -Con- links: graph preview image + text
     (function() {
         let cpTip = null;
         let cpTipTimer = null;
         let cpShowTimer = null;
         const removeTip = () => {
             if (cpShowTimer) { clearTimeout(cpShowTimer); cpShowTimer = null; }
             if (cpTipTimer) { clearTimeout(cpTipTimer); cpTipTimer = null; }
             if (cpTip) { cpTip.remove(); cpTip = null; }
         };
         // Safety nets: tooltip can never stick around
         if (window.__pcbTipGlobals !== injectToken) {
             window.__pcbTipGlobals = injectToken;
             window.addEventListener('blur', removeTip);              // new tab opened / window lost focus
             document.addEventListener('scroll', removeTip, true);    // page scrolled
         }
         document.querySelectorAll('.cp-link').forEach(link => {
             if (!bindOnce(link, 'pcbCpTip')) return;
             link.addEventListener('mouseenter', function() {
                 removeTip();
                 // Show only after the mouse parks for 1.5s (matches the CSS tooltips);
                 // cancelled by mouseleave/click before it fires.
                 cpShowTimer = setTimeout(() => {
                 cpShowTimer = null;
                 cpTipTimer = setTimeout(removeTip, 5000);        // auto-hide after 5 seconds
                 cpTip = document.createElement('div');
                 cpTip.style.cssText = 'position:fixed; z-index:10000; background-color:#333; color:white; padding:8px 10px; border-radius:4px; font-size:12px; font-weight:normal; text-align:center; max-width:244px; pointer-events:none;';
                 const img = document.createElement('img');
                 img.src = chrome.runtime.getURL('connections-preview.png');
                 img.style.cssText = 'width:220px; display:block; border-radius:3px; margin:0 auto 6px auto;';
                 cpTip.appendChild(img);
                 const txt = document.createElement('div');
                 txt.textContent = 'Connections - visual connections chart, part of doilookup.com';
                 cpTip.appendChild(txt);
                 document.body.appendChild(cpTip);
                 const place = () => {
                     if (!cpTip) return;
                     const rect = link.getBoundingClientRect();
                     const tipRect = cpTip.getBoundingClientRect();
                     let left = rect.left + rect.width / 2 - tipRect.width / 2;
                     left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
                     let top = rect.top - tipRect.height - 6;
                     if (top < 8) top = rect.bottom + 6;
                     cpTip.style.left = left + 'px';
                     cpTip.style.top = top + 'px';
                 };
                 img.onload = place;                       // re-place once image size is known
                 img.onerror = () => { img.remove(); place(); }; // text-only if image missing
                 place();
                 }, 1500);
             });
             link.addEventListener('mouseleave', removeTip);
             link.addEventListener('click', removeTip);
         });
     })();
     // Add click handlers for all citation report links
     document.querySelectorAll('.citation-report-link').forEach(link => {
         if (!bindOnce(link, 'pcbReport')) return;
         link.addEventListener('click', async function() {
             const pmid = this.getAttribute('data-pmid');
             if (!pmid) return;
             const data = fullDataSet.find(item => item.PMID === pmid);
             if (!data) return;
             
             // Show processing state
             const originalText = this.textContent;
             this.textContent = 'Processing...';
             this.disabled = true;
             
             try {
                 await showCitationReport(data, pmid);
             } finally {
                 // Restore original state
                 this.textContent = originalText;
                 this.disabled = false;
             }
         });
     });

     // Add click handlers for all author-links
     document.querySelectorAll('.author-link').forEach(link => {
         if (!bindOnce(link, 'pcbAuthor')) return;
         link.addEventListener('click', async function() {
             const pmid = this.getAttribute('data-pmid');
             if (!pmid) return;
             const data = fullDataSet.find(item => item.PMID === pmid);
             if (!data) return;
             
             // Show processing state
             const originalText = this.textContent;
             this.textContent = 'Processing...';
             this.disabled = true;
             
             try {
                 await showAuthorInfo(data, pmid);
             } finally {
                 // Restore original state
                 this.textContent = originalText;
                 this.disabled = false;
             }
         });
     });

     // Add click handlers for all icite-links after all elements are in the DOM
     document.querySelectorAll('.icite-link').forEach(link => {
         if (!bindOnce(link, 'pcbIcite')) return;
         link.addEventListener('click', async function(e) {
             e.preventDefault();
             const pmid = this.getAttribute('data-pmid');
             if (!pmid) return;
             try {
                 const response = await fetch('https://icite.od.nih.gov/iciterest/store-search', {
                     method: 'POST',
                     headers: {
                         'Content-Type': 'application/json'
                     },
                     body: JSON.stringify({
                         userType: 'app',
                         searchType: 'List of PMIDs input',
                         searchRequest: {
                             pubmedQueryStr: '',
                             uploadedFileName: '',
                             pmids: [pmid],
                             activeTab: 'infl',
                             papersSearch: '',
                             filters: []
                         }
                     })
                 });
                 if (!response.ok) {
                     throw new Error(`HTTP error! status: ${response.status}`);
                 }
                 const data = await response.json();
                 if (data.id) {
                     const iciteUrl = `https://icite.od.nih.gov/results?searchId=${data.id}`;
                     window.open(iciteUrl, '_blank');
                 } else {
                     console.error('No search ID received from iCite');
                 }
             } catch (error) {
                 console.error('Error getting iCite URL:', error);
                 window.open('https://icite.od.nih.gov/analysis', '_blank');
             }
         });
     });

     // Add click handlers for on-demand CrossRef link fetching
     document.querySelectorAll('.crossref-link').forEach(link => {
         if (!bindOnce(link, 'pcbCrossref')) return;
         link.addEventListener('click', async function(e) {
             e.preventDefault();
             const doi = this.getAttribute('data-doi');
             if (!doi) {
                 alert('No DOI available for this article');
                 return;
             }
             
             // Show loading state
             const originalText = this.textContent;
             this.textContent = '...';
             this.style.cursor = 'wait';
             
             try {
                 const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=your@email.com`;
                 const response = await fetch(url);
                 
                 if (!response.ok) {
                     throw new Error(`CrossRef API error: ${response.status}`);
                 }
                 
                 const data = await response.json();
                 const links = data?.message?.link;
                 
                 if (links && links.length > 0) {
                     // Filter out API/text-mining endpoints
                     const cleanLinks = links.filter(link => {
                         const linkUrl = link.URL.toLowerCase();
                         const intendedApp = link['intended-application']?.toLowerCase() || '';
                         return !linkUrl.includes('/api/') && 
                                !linkUrl.includes('httpaccept=') && 
                                !linkUrl.endsWith('.xml') &&
                                !linkUrl.includes('api.elsevier.com') &&
                                !linkUrl.includes('api.springer.com') &&
                                !linkUrl.includes('format=xml') &&
                                !linkUrl.includes('format=json') &&
                                intendedApp !== 'text-mining';
                     });
                     
                     if (cleanLinks.length > 0) {
                         // Prefer PDF link, otherwise use first clean link
                         const pdfLink = cleanLinks.find(link => link['content-type'] === 'application/pdf');
                         const bestLink = pdfLink || cleanLinks[0];
                         window.open(bestLink.URL, '_blank');
                         
                         // Update the link to show it was found
                         this.textContent = 'Link';
                         this.style.cursor = 'pointer';
                         return;
                     }
                 }
                 
                 // No clean links found - try DOI fallback
                 window.open(`https://doi.org/${doi}`, '_blank');
                 this.textContent = 'DOI';
                 this.style.cursor = 'pointer';
                 
             } catch (error) {
                 console.error('Error fetching CrossRef link:', error);
                 // Fallback to DOI link
                 window.open(`https://doi.org/${doi}`, '_blank');
                 this.textContent = 'DOI';
                 this.style.cursor = 'pointer';
             }
         });
     });

     // Add click handlers for DOI ref-lookup links
     document.querySelectorAll('.doi-ref-link').forEach(link => {
         if (!bindOnce(link, 'pcbDoiRef')) return;
         link.addEventListener('click', async function() {
             const doi = this.getAttribute('data-doi');
             if (!doi) return;

             const originalText = this.textContent;
             this.textContent = '...';
             this.style.cursor = 'wait';

             try {
                 const result = await chrome.runtime.sendMessage({
                     action: 'openInRefLookup',
                     doi: doi
                 });

                 if (result && result.status === 'max') {
                     this.textContent = 'Max 15';
                     this.style.color = '#8c6b00';
                     setTimeout(() => {
                         this.textContent = originalText;
                         this.style.color = '#0066cc';
                         this.style.cursor = 'pointer';
                     }, 2000);
                 } else {
                     this.textContent = '✓';
                     this.style.color = '#2a7a2a';
                     setTimeout(() => {
                         this.textContent = originalText;
                         this.style.color = '#0066cc';
                         this.style.cursor = 'pointer';
                     }, 1500);
                 }
             } catch (error) {
                 console.error('Error opening DOI in ref-lookup:', error);
                 window.open(`${REF_LOOKUP_URL}?doi=${encodeURIComponent(doi)}`, '_blank');
                 this.textContent = originalText;
                 this.style.cursor = 'pointer';
             }
         });
     });

     // Add click handlers for Xout exclusion search
     document.querySelectorAll('.xout-trigger').forEach(trigger => {
         if (!bindOnce(trigger, 'pcbXout')) return;
         trigger.addEventListener('click', function(e) {
             e.preventDefault();
             e.stopPropagation();
             const xoutModal = document.getElementById('xout-modal');
             if (xoutModal) {
                 // Re-populate search input from current URL each time modal opens
                 let currentTerm = '';
                 try {
                     const urlParams = new URLSearchParams(window.location.search);
                     const termParam = urlParams.get('term');
                     if (termParam) {
                         currentTerm = decodeURIComponent(termParam);
                     }
                 } catch (e) {}
                 document.getElementById('xout-search-input').value = currentTerm;
                 
                 // Reset copy button state
                 const copyBtn = document.getElementById('xout-copy-btn');
                 copyBtn.textContent = 'Copy Query';
                 copyBtn.classList.remove('xout-btn-copied');
                 
                 // Update preview and show modal
                 document.getElementById('xout-search-input').dispatchEvent(new Event('input'));
                 xoutModal.style.display = 'block';
             }
         });
     });

     // Add click handlers for pR (PubMed Reports) dropdown menu
     document.querySelectorAll('.pr-menu-trigger').forEach(trigger => {
         if (!bindOnce(trigger, 'pcbPr')) return;
         trigger.addEventListener('click', function(e) {
             // If the click was on a dropdown item, open its URL and close menu
             const item = e.target.closest('.pr-dropdown-item');
             if (item) {
                 e.preventDefault();
                 e.stopPropagation();
                 const url = item.getAttribute('data-url');
                 if (url) {
                     window.open(url, '_blank');
                 }
                 document.querySelectorAll('.pr-dropdown-menu.show').forEach(m => m.classList.remove('show'));
                 return;
             }
             
             e.preventDefault();
             e.stopPropagation();
             
             // Close any other open menus
             document.querySelectorAll('.pr-dropdown-menu.show').forEach(m => {
                 if (m.parentElement !== this) m.classList.remove('show');
             });
             
             // Check if dropdown already exists for this trigger
             let menu = this.querySelector('.pr-dropdown-menu');
             if (!menu) {
                 menu = document.createElement('div');
                 menu.className = 'pr-dropdown-menu';
                 menu.innerHTML = `
                     <span class="pr-dropdown-item" data-url="https://tomlaheyh.github.io/citation-bar/pubmed-summary/pubmed-summary.html">PubMed Summary Report</span>
                     <span class="pr-dropdown-item" data-url="https://tomlaheyh.github.io/citation-bar/filters/filters.html">PubMed Filters Report</span>
                     <span class="pr-dropdown-item" data-url="https://tomlaheyh.github.io/citation-bar/mesh/mesh.html">PubMed MeSH Counts</span>
                     <span class="pr-dropdown-item" data-url="https://tomlaheyh.github.io/citation-bar/journal-ranking/journal-ranking.html">PubMed Journal Ranking</span>
                 `;
                 this.style.position = 'relative';
                 this.appendChild(menu);
             }
             
             menu.classList.toggle('show');
         });
     });
     
     // Close pR dropdown when clicking elsewhere
     if (window.__pcbDropdownGlobal !== injectToken) {
         window.__pcbDropdownGlobal = injectToken;
         document.addEventListener('click', function(e) {
             if (!e.target.closest('.pr-menu-trigger')) {
                 document.querySelectorAll('.pr-dropdown-menu.show').forEach(m => m.classList.remove('show'));
             }
         });
     }

     // One-time "What's New" splash after a major update.
     // The pending flag is cleared the moment the splash is shown (not on
     // dismiss), so it can never appear a second time.
     (async () => {
         try {
             const { whatsNewPending } = await chrome.storage.local.get('whatsNewPending');
             if (!whatsNewPending) return;
             if (document.getElementById('pcb-whatsnew-overlay')) return;

             // Marked as seen the moment it is shown, not on a timer.
             //
             // This used to wait 8 seconds, so that the extension's own page
             // reload ~1s after first injection would not count a brief flash as
             // "shown". The cost was that anything interrupting those 8 seconds
             // left the splash armed and it appeared again on the next load.
             //
             // Deliberate trade: clearing immediately means a user can, in an
             // edge case, miss the notes entirely. That is a minor loss - they
             // are release notes, not something the extension needs them to read.
             // Being shown the same splash repeatedly is far more damaging.
             const markShown = async () => {
                 await chrome.storage.local.set({ whatsNewShownFor: whatsNewPending });
                 await chrome.storage.local.remove('whatsNewPending');
             };
             markShown();

             const overlay = document.createElement('div');
             overlay.id = 'pcb-whatsnew-overlay';
             overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:100000; display:flex; justify-content:center; align-items:center;';
             const card = document.createElement('div');
             card.style.cssText = 'background:white; border-radius:8px; padding:20px 24px; max-width:430px; box-shadow:0 4px 16px rgba(0,0,0,0.3); font-size:14px; color:#333;';
             card.innerHTML = `
                 <h3 style="margin:0 0 10px 0; text-align:center;">PubMed Citation Bar &mdash; What's New (Ver ${whatsNewPending})</h3>
                 <div style="line-height:1.45; margin-bottom:14px;">
                     <div style="margin-bottom:7px;"><strong>Send articles to Zotero or EndNote</strong> &mdash; tick the green check at the start of the second row to collect articles as you search, then download the set as .nbib or .ris, or open it as a PubMed search. Your picks hold as you page through results.</div>
                     <div style="margin-bottom:7px;"><strong>Journal figures</strong> &mdash; Medline % is working again, and the bar now also shows the journal's YTD article count and Free full-text %.</div>
                     <div style="margin-bottom:7px;"><strong>Numbered results</strong> &mdash; OpenAlex and ClinicalTrials results are numbered, so you can see where you are in the list.</div>
                     <div style="margin-bottom:7px;"><strong>Expand asks first</strong> &mdash; it lists the tabs it will open and remembers which ones you want, while fetching in the background.</div>
                     <div style="margin-bottom:7px;"><strong>Low memory warning</strong> &mdash; the Memory line in the popup turns red when free memory runs low, with advice on hover.</div>
                     <div style="margin-bottom:7px;"><strong>Reset Extension</strong> &mdash; now gives you a clean tab as well as a clean extension and cache, keeping your current search.</div>
                     <div><strong>Tab resets</strong> &mdash; after the citation bar runs six times, your tab reopens on the same page, clearing the memory it had built up. Your place is kept; the tab's Back history is not.</div>
                 </div>
                 <div style="font-style:italic; color:#555; margin-bottom:14px;">
                     <a href="https://tomlaheyh.github.io/citation-bar/support.html" target="_blank" style="color:#0066cc;">Feedback</a> is always welcome. &mdash; Tom
                 </div>
                 <div style="text-align:center;"><button id="pcb-whatsnew-close">Got it</button></div>
             `;
             overlay.appendChild(card);
             document.body.appendChild(overlay);
             const dismiss = () => {
                 markShown();
                 overlay.style.transition = 'opacity 0.4s';
                 overlay.style.opacity = '0';
                 setTimeout(() => overlay.remove(), 400);
             };
             card.querySelector('#pcb-whatsnew-close').addEventListener('click', dismiss);
             overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
             setTimeout(dismiss, 20000);   // never force a click: auto-dismiss after 20s
         } catch (e) {
             // Never let the splash interfere with the citation bars
         }
     })();

     return { injectedCount };
 } catch (error) {
     console.error('Error in injectCitationBars:', error);
     return { injectedCount: 0 };
 }
}