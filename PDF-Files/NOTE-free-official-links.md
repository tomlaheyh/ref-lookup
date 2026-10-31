# PDF-Files: free official links (working note)

Started 2026-10-31. Not linked from the website.

## Why

All 30 PDFs in this folder are tracked in git. If the host serves the whole repo,
they are publicly downloadable at doilookup.com/PDF-Files/... That is publisher
copyright material, and adds roughly 200 MB to the site.

Hiding the download button does not fix this: a browser has to download a PDF to
show it, and public display of the full text is the copyright issue either way.

Plan: link each guideline to its free official copy instead of hosting it.
The two review .md files are our own work and can stay.

## Link list (18 guidelines behind the 30 files)

| # | Guideline | Official free copy | Status |
|---|---|---|---|
| 1 | 2023 ESC Acute coronary syndromes | https://doi.org/10.1093/eurheartj/ehad191 | ESC: free |
| 2 | 2023 ESC CVD in patients with diabetes | https://doi.org/10.1093/eurheartj/ehad192 | ESC: free |
| 3 | 2023 ESC Heart failure focused update | https://doi.org/10.1093/eurheartj/ehad195 | ESC: free |
| 4 | 2024 ESC Atrial fibrillation | https://doi.org/10.1093/eurheartj/ehae176 | ESC: free |
| 5 | 2024 ESC Chronic coronary syndromes | https://doi.org/10.1093/eurheartj/ehae177 | ESC: free |
| 6 | 2024 ESC Elevated BP and hypertension | https://doi.org/10.1093/eurheartj/ehae178 | ESC: free |
| 7 | 2024 ESC Peripheral arterial and aortic diseases | https://doi.org/10.1093/eurheartj/ehae179 | ESC: free |
| 8 | 2025 ESC/EAS Dyslipidaemias focused update | https://doi.org/10.1093/eurheartj/ehaf190 | ESC: free |
| 9 | 2025 ESC/EACTS Valvular heart disease | https://doi.org/10.1093/eurheartj/ehaf194 | ESC: free |
| 10 | 2023 ACC/AHA Atrial fibrillation | https://pmc.ncbi.nlm.nih.gov/articles/PMC11095842/ | Verified: in PMC |
| 11 | 2024 ACC/AHA Lower-extremity PAD | https://pmc.ncbi.nlm.nih.gov/articles/PMC12782132/ | Verified: in PMC |
| 12 | ADA Standards of Care 2026: Introduction and Methodology | https://pmc.ncbi.nlm.nih.gov/articles/PMC12690168/ | Verified: in PMC |
| 13 | AHA CKM Syndrome synopsis (scientific statement) | https://doi.org/10.1161/CIR.0000000000001186 | Verified: full text loads without login |
| 14 | AHA CKM Health presidential advisory | https://doi.org/10.1161/CIR.0000000000001184 | Not checked (likely free) |
| 15 | 2026 ACC/AHA Dyslipidemia | https://doi.org/10.1161/CIR.0000000000001423 | Not checked (likely free) |
| 16 | KDIGO 2024 CKD | https://doi.org/10.1016/j.kint.2023.10.018 | Not checked |
| 17 | Obesity diagnosis/staging framework (Nat Med 2024) | https://doi.org/10.1038/s41591-024-03095-3 | Not checked |
| 18 | EASO obesity pharmacotherapy framework (Nat Med 2025) | https://doi.org/10.1038/s41591-025-03765-w | Not checked |

Status key:
- "ESC: free" = the ESC states access to its guidelines is free; individual
  article pages not opened.
- "Verified" = confirmed on 2026-10-31.
- "Not checked" = publisher site refused automated requests; check in a browser.

## File map

- Rows 1-9: `10.1093eurheartjehad191.pdf` ... `10.1093eurheartjehaf194.pdf`
- Row 10: `10.1161CIR.0000000000001193.pdf`
- Row 11: `10.1161CIR.0000000000001251.pdf`
- Row 12: `10.2337dc26-SINT.pdf` (only the introduction chapter, not the full Standards)
- Row 13: `10.1161CIR.0000000000001186.pdf`
- Row 14: `10.1161CIR.0000000000001184.pdf`
- Row 15: `10.1161CIR.0000000000001423.pdf` plus the 10 split files `-p01-10` ... `-p91-100`
- Row 16: `10.1016j.kint.2023.10.018.pdf`
- Rows 17-18: `10.1038s41591-024-03095-3.pdf`, `10.1038s41591-025-03765-w.pdf`

Sources: PubMed records 41824552, 41039115, 40878295, 40878289, 39210723,
39210722, 39210715, 39210710, 38969880, 38490803, 37807924, 37807920, 37622666,
37622663, 37622654, 38033089, 38743805, 41358883; ESC guidelines presentation
page (escardio.org).

## To do

- [ ] Check rows 14-18 in a browser for free-access labels.
- [ ] Decide where the link list lives on the site (e.g. med/guidelines.html).
- [ ] Untrack the PDFs (add `PDF-Files/*.pdf` to .gitignore, `git rm --cached`) - Windows shell.
