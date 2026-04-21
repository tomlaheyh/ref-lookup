(function() {
  // ── Configuration: all pages in the nav ──
  var pages = [
    { title: 'Awesome DOI-Ref-Lookup', href: '/' },
    { title: 'Clinical Guidelines',    href: '/med/guidelines.html' },
    { title: 'Topic Search',           href: '/search/search.html' },
    { title: 'Nutrition Reference', href: '/nutrition/nutrition.html' }
  ];

  // ── Inject CSS (only once) ──
  var styleId = 'siteNavStyles';
  if (!document.getElementById(styleId)) {
    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      '#site-nav-bar {',
      '  background: #f4f3ef;',
      '  border-bottom: 2px solid #d8d5cc;',
      '  padding: 12px 24px;',
      '  font-family: "IBM Plex Mono", monospace;',
      '  position: relative;',
      '  z-index: 10000;',
      '}',
      '#site-nav-bar .site-nav-inner {',
      '  max-width: 1400px;',
      '  margin: 0 auto;',
      '  position: relative;',
      '  text-align: center;',
      '}',
      '#site-nav-bar .site-nav-title {',
      '  font-size: 22px;',
      '  font-weight: 600;',
      '  letter-spacing: -0.5px;',
      '  color: #005a8c;',
      '  cursor: pointer;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  user-select: none;',
      '  transition: color 0.15s;',
      '  margin: 0;',
      '  padding: 0;',
      '  background: none;',
      '  border: none;',
      '  font-family: inherit;',
      '}',
      '#site-nav-bar .site-nav-title:hover { color: #004470; }',
      '#site-nav-bar .site-nav-arrow {',
      '  font-size: 13px;',
      '  color: #005a8c;',
      '  transition: transform 0.25s;',
      '}',
      '#site-nav-bar .site-nav-hint {',
      '  font-size: 12px;',
      '  font-weight: 400;',
      '  color: #888880;',
      '  margin-left: 40px;',
      '  letter-spacing: 0;',
      '}',
      '#site-nav-bar .site-nav-menu {',
      '  display: none;',
      '  position: absolute;',
      '  top: calc(100% + 14px);',
      '  left: 50%;',
      '  transform: translateX(-50%);',
      '  background: #fff;',
      '  border: 1.5px solid #d8d5cc;',
      '  box-shadow: 0 6px 20px rgba(0,0,0,0.12);',
      '  z-index: 10001;',
      '  min-width: 290px;',
      '  overflow: hidden;',
      '}',
      '#site-nav-bar.open .site-nav-menu { display: block; }',
      '#site-nav-bar .site-nav-menu a {',
      '  display: block;',
      '  padding: 10px 16px;',
      '  font-family: "IBM Plex Mono", monospace;',
      '  font-size: 13px;',
      '  font-weight: 400;',
      '  color: #1a1a18;',
      '  text-decoration: none;',
      '  border-bottom: 1px solid #d8d5cc;',
      '  transition: background 0.1s, color 0.1s;',
      '  white-space: nowrap;',
      '}',
      '#site-nav-bar .site-nav-menu a:last-child { border-bottom: none; }',
      '#site-nav-bar .site-nav-menu a:hover { background: #005a8c; color: #fff; }',
      '#site-nav-bar .site-nav-menu a.current {',
      '  color: #005a8c;',
      '  font-weight: 600;',
      '  pointer-events: none;',
      '}',
      '#site-nav-bar .site-nav-menu a.current::before { content: "\\25B8 "; }'
    ].join('\n');
    document.head.appendChild(style);

    // Load IBM Plex Mono if not already present
    if (!document.querySelector('link[href*="IBM+Plex+Mono"]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&display=swap';
      document.head.appendChild(link);
    }
  }

  // ── Detect current page ──
  var path = window.location.pathname;
  if (path === '/index.html') path = '/';
  var pathClean = path.replace(/\/+$/, '') || '/';

  function isCurrent(href) {
    var h = href.replace(/\/+$/, '') || '/';
    return h === pathClean;
  }

  var currentTitle = pages[0].title;
  for (var i = 0; i < pages.length; i++) {
    if (isCurrent(pages[i].href)) {
      currentTitle = pages[i].title;
      break;
    }
  }

  // ── Build the nav bar ──
  var bar = document.createElement('div');
  bar.id = 'site-nav-bar';

  var inner = document.createElement('div');
  inner.className = 'site-nav-inner';

  var title = document.createElement('button');
  title.className = 'site-nav-title';
  title.innerHTML = '<span class="site-nav-arrow">\u25B6</span> ' + currentTitle + ' <span class="site-nav-arrow">\u25C0</span><span class="site-nav-hint">more pages</span>';
  title.addEventListener('click', function(e) {
    e.stopPropagation();
    bar.classList.toggle('open');
  });

  var menu = document.createElement('div');
  menu.className = 'site-nav-menu';

  for (var i = 0; i < pages.length; i++) {
    var a = document.createElement('a');
    a.href = pages[i].href;
    a.textContent = pages[i].title;
    if (isCurrent(pages[i].href)) a.className = 'current';
    menu.appendChild(a);
  }

  inner.appendChild(title);
  inner.appendChild(menu);
  bar.appendChild(inner);

  // ── Close on outside click ──
  document.addEventListener('click', function() {
    bar.classList.remove('open');
  });

  // ── Insert at very top of body ──
  function inject() {
    document.body.insertBefore(bar, document.body.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
