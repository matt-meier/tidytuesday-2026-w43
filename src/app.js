(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var CACHE_KEY = 'ikea_price_index_2026_w43_v1';
  var KEY_MARKETS = {
    MX: true, MA: true, IL: true, JO: true, CO: true, US: true,
    CH: true, GB: true, SE: true, CA: true, PL: true, MY: true,
    KR: true, PH: true, JP: true, TH: true
  };
  var PROOF_MARKETS = [
    { code: 'MX', note: 'Highest' },
    { code: 'SE', note: 'Home market' },
    { code: 'US', note: 'Pre-tax' },
    { code: 'TH', note: 'Lowest index' },
    { code: 'JP', note: 'Lowest price' }
  ];

  var state = {
    rows: [],
    activeRegion: 'ALL',
    highlightSet: null,
    selectedCountry: null,
    showIqr: false
  };

  var els = {
    status: document.getElementById('statusBanner'),
    svg: document.getElementById('indexChart'),
    priceGrid: document.getElementById('priceTagGrid'),
    proofCompare: document.getElementById('proofCompare'),
    tooltip: document.getElementById('tooltip'),
    iqrToggle: document.getElementById('iqrToggle'),
    regionPills: Array.prototype.slice.call(document.querySelectorAll('.pill')),
    calloutCards: Array.prototype.slice.call(document.querySelectorAll('.callout-card'))
  };

  function createSvgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        el.setAttribute(k, String(attrs[k]));
      });
    }
    return el;
  }

  function formatPct(val) {
    var num = Number(val);
    var prefix = num > 0 ? '+' : '';
    return prefix + num.toFixed(1) + '%';
  }

  function formatUsd(val) {
    if (val === null || val === undefined || isNaN(Number(val))) {
      return 'Not listed';
    }
    return '$' + Math.round(Number(val)).toLocaleString('en-US');
  }

  function formatLocalPrice(val, currency) {
    if (val === null || val === undefined || isNaN(Number(val))) {
      return 'Not listed';
    }
    return Math.round(Number(val)).toLocaleString('en-US') + ' ' + currency;
  }

  function setStatus(msg, isError) {
    if (!msg) {
      els.status.textContent = '';
      els.status.classList.add('is-hidden');
      els.status.classList.remove('is-error');
      return;
    }
    els.status.textContent = msg;
    els.status.classList.remove('is-hidden');
    if (isError) {
      els.status.classList.add('is-error');
    } else {
      els.status.classList.remove('is-error');
    }
  }

  function fetchWithTimeout(url, timeoutMs) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
    var opts = controller ? { signal: controller.signal, cache: 'default' } : {};

    return fetch(url, opts).then(function (res) {
      if (timer) {
        clearTimeout(timer);
      }
      if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' while loading ' + url);
      }
      return res.json();
    }).catch(function (err) {
      if (timer) {
        clearTimeout(timer);
      }
      throw err;
    });
  }

  function loadDataset() {
    try {
      var cached = window.sessionStorage ? window.sessionStorage.getItem(CACHE_KEY) : null;
      if (cached) {
        var parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return Promise.resolve(parsed);
        }
      }
    } catch (e) {
      // Ignore storage access errors in restricted iframes
    }

    return fetchWithTimeout('./data.json', 8000).then(function (data) {
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Dataset format invalid: expected a non-empty JSON array.');
      }
      try {
        if (window.sessionStorage) {
          window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
        }
      } catch (e) {
        // Ignore storage quota or sandbox restrictions
      }
      return data;
    });
  }

  function isRowHighlighted(row) {
    if (state.selectedCountry) {
      return row.country === state.selectedCountry;
    }
    if (state.highlightSet) {
      return Boolean(state.highlightSet[row.country]);
    }
    if (state.activeRegion !== 'ALL') {
      return row.region === state.activeRegion;
    }
    return true;
  }

  function updateHighlightClasses() {
    var groups = els.svg.querySelectorAll('.row-group');
    Array.prototype.forEach.call(groups, function (g) {
      var code = g.getAttribute('data-country');
      var row = state.rows.find(function (r) { return r.country === code; });
      if (!row) {
        return;
      }
      var active = isRowHighlighted(row);
      g.classList.toggle('is-muted', !active);
      g.classList.toggle('is-selected', state.selectedCountry === code);
    });

    var tags = els.priceGrid.querySelectorAll('.price-tag');
    Array.prototype.forEach.call(tags, function (t) {
      var code = t.getAttribute('data-country');
      t.classList.toggle('is-active', state.selectedCountry === code);
    });

    updateProofCompare();
  }

  function updateProofCompare(hoverRow) {
    var target = hoverRow || (state.selectedCountry
      ? state.rows.find(function (r) { return r.country === state.selectedCountry; })
      : null);

    if (!target) {
      els.proofCompare.innerHTML = '49 markets &middot; Global median $413';
      return;
    }

    if (target.klippan_usd === null || target.klippan_usd === undefined) {
      els.proofCompare.innerHTML = 'Selected: <strong>' + target.country_name + '</strong> (KLIPPAN 403.993.14 not listed)';
      return;
    }

    els.proofCompare.innerHTML =
      'Selected: <strong>' + target.country_name + ' ' + formatUsd(target.klippan_usd) + '</strong> (' +
      formatLocalPrice(target.klippan_local, target.currency) + ')';
  }

  function showTooltip(evt, row) {
    var direction = row.median_pct > 0.05
      ? 'above'
      : (row.median_pct < -0.05 ? 'below' : 'at');
    var summaryText = direction === 'at'
      ? 'Prices sit right at the global median (0.0%) across ' + row.shared_skus + ' shared SKUs.'
      : 'Prices run ' + formatPct(row.median_pct) + ' ' + direction + ' the global median across ' + row.shared_skus + ' shared SKUs.';

    var klippanLine = row.klippan_usd !== null && row.klippan_usd !== undefined
      ? 'KLIPPAN 2-seat sofa: ' + formatUsd(row.klippan_usd) + ' (' + formatLocalPrice(row.klippan_local, row.currency) + ').'
      : 'KLIPPAN 2-seat sofa (403.993.14) is not listed in this market.';

    els.tooltip.innerHTML =
      '<div class="tooltip-title">#' + row.rank + ' ' + row.country_name + ' (' + row.region + ')</div>' +
      '<p class="tooltip-line">' + summaryText + '</p>' +
      '<p class="tooltip-line tooltip-muted">Typical SKU range (25th to 75th percentile): ' +
      formatPct(row.p25_pct) + ' to ' + formatPct(row.p75_pct) + '.</p>' +
      '<p class="tooltip-line">' + klippanLine + '</p>';

    els.tooltip.hidden = false;
    moveTooltip(evt);
  }

  function moveTooltip(evt) {
    if (els.tooltip.hidden) {
      return;
    }
    var pad = 14;
    var tipRect = els.tooltip.getBoundingClientRect();
    var x = evt.clientX + pad;
    var y = evt.clientY - tipRect.height / 2;

    if (x + tipRect.width > window.innerWidth - 10) {
      x = evt.clientX - tipRect.width - pad;
    }
    if (x < 8) {
      x = 8;
    }
    if (y < 8) {
      y = 8;
    }
    if (y + tipRect.height > window.innerHeight - 8) {
      y = window.innerHeight - tipRect.height - 8;
    }

    els.tooltip.style.left = x + 'px';
    els.tooltip.style.top = y + 'px';
  }

  function hideTooltip() {
    els.tooltip.hidden = true;
  }

  function renderChart(rows) {
    els.svg.innerHTML = '';

    var topPad = 24;
    var rowStep = 13.6;
    var barH = 9.4;
    var x0 = 298;
    var scale = 4.9;
    var chartBottom = topPad + rows.length * rowStep;

    // Top axis ticks
    var ticks = [-30, -20, -10, 0, 20, 40, 60];
    var axisGroup = createSvgEl('g', { class: 'axis-layer' });

    ticks.forEach(function (t) {
      var tx = x0 + t * scale;
      var labelStr = t > 0 ? ('+' + t + '%') : (t + '%');
      var txt = createSvgEl('text', {
        x: tx,
        y: 13,
        'text-anchor': 'middle',
        class: t === 0 ? 'zero-axis-label' : 'axis-tick-text'
      });
      txt.textContent = labelStr;
      axisGroup.appendChild(txt);

      if (t !== 0) {
        axisGroup.appendChild(createSvgEl('line', {
          x1: tx,
          y1: 18,
          x2: tx,
          y2: 22,
          stroke: '#B9B2A5',
          'stroke-width': 1
        }));
      }
    });

    // Global median vertical centerline
    axisGroup.appendChild(createSvgEl('line', {
      x1: x0,
      y1: 19,
      x2: x0,
      y2: chartBottom + 2,
      stroke: '#3A3A3A',
      'stroke-width': 1.25
    }));

    // Subtle vertical label beside upper centerline (strictly in empty left channel)
    var zeroTitle = createSvgEl('text', {
      x: x0 - 10,
      y: topPad + 165,
      'text-anchor': 'middle',
      transform: 'rotate(-90 ' + (x0 - 10) + ' ' + (topPad + 165) + ')',
      class: 'zero-axis-label'
    });
    zeroTitle.textContent = 'GLOBAL MEDIAN (0%)';
    axisGroup.appendChild(zeroTitle);

    els.svg.appendChild(axisGroup);

    // Subtle desktop leader lines anchored strictly in open lower-right whitespace
    var leadersGroup = createSvgEl('g', { class: 'leaders-layer' });
    // Leader for Sweden (row index 25, rank 26)
    var swedenY = topPad + 25 * rowStep + barH / 2;
    leadersGroup.appendChild(createSvgEl('line', {
      x1: x0 + 6,
      y1: swedenY,
      x2: 472,
      y2: swedenY,
      class: 'callout-leader'
    }));
    leadersGroup.appendChild(createSvgEl('circle', {
      cx: x0 + 6,
      cy: swedenY,
      r: 2.2,
      fill: '#1E1E1E',
      class: 'callout-leader'
    }));

    // Bracket + leader for bottom 5 Asia-Pacific markets (ranks 46 to 50)
    var apacTopY = topPad + 45 * rowStep + 2;
    var apacBotY = topPad + 49 * rowStep + barH - 1;
    var apacMidY = (apacTopY + apacBotY) / 2;
    leadersGroup.appendChild(createSvgEl('path', {
      d: 'M ' + (x0 + 8) + ' ' + apacTopY +
         ' L ' + (x0 + 16) + ' ' + apacTopY +
         ' L ' + (x0 + 16) + ' ' + apacBotY +
         ' L ' + (x0 + 8) + ' ' + apacBotY +
         ' M ' + (x0 + 16) + ' ' + apacMidY +
         ' L 472 ' + apacMidY,
      class: 'callout-leader'
    }));
    els.svg.appendChild(leadersGroup);

    // Bars and direct labels
    var barsGroup = createSvgEl('g', { class: 'bars-layer' });

    rows.forEach(function (row, idx) {
      var y = topPad + idx * rowStep;
      var val = Number(row.median_pct);
      var isSweden = row.country === 'SE';
      var isPositive = val >= 0;
      var barW = Math.max(Math.abs(val) * scale, isSweden ? 4.5 : 2.2);
      var barX = isPositive ? x0 : (x0 - barW);
      var barColor = isSweden ? '#1E1E1E' : (isPositive ? '#D98200' : '#0058A3');

      var g = createSvgEl('g', {
        class: 'row-group',
        'data-country': row.country,
        tabindex: '0',
        role: 'button',
        'aria-label': 'Rank ' + row.rank + ', ' + row.country_name + ', ' + formatPct(val) + ' versus global median'
      });

      // Row hover background band
      g.appendChild(createSvgEl('rect', {
        x: 0,
        y: y - 1.5,
        width: isPositive ? 778 : x0 + 2,
        height: rowStep - 1,
        rx: 2,
        class: 'row-hover-bg'
      }));

      // Optional SKU interquartile spread whisker (25th to 75th percentile)
      if (state.showIqr) {
        var xLow = x0 + Number(row.p25_pct) * scale;
        var xHigh = x0 + Number(row.p75_pct) * scale;
        var cy = y + barH / 2;
        g.appendChild(createSvgEl('line', {
          x1: xLow,
          y1: cy,
          x2: xHigh,
          y2: cy,
          stroke: barColor,
          class: 'iqr-line'
        }));
        g.appendChild(createSvgEl('line', {
          x1: xLow,
          y1: cy - 2.6,
          x2: xLow,
          y2: cy + 2.6,
          stroke: barColor,
          class: 'iqr-cap'
        }));
        g.appendChild(createSvgEl('line', {
          x1: xHigh,
          y1: cy - 2.6,
          x2: xHigh,
          y2: cy + 2.6,
          stroke: barColor,
          class: 'iqr-cap'
        }));
      }

      // Main diverging bar
      g.appendChild(createSvgEl('rect', {
        x: barX,
        y: y,
        width: barW,
        height: barH,
        rx: 1.4,
        fill: barColor,
        class: 'bar-rect'
      }));

      // Country rank, name, and percentage label
      var labelX = isPositive ? (barX + barW + 6) : (barX - 6);
      var anchor = isPositive ? 'start' : 'end';
      var lblClass = 'country-label';
      if (isSweden) {
        lblClass += ' is-sweden';
      } else if (KEY_MARKETS[row.country]) {
        lblClass += ' is-key';
      }

      var lbl = createSvgEl('text', {
        x: labelX,
        y: y + barH - 1.2,
        'text-anchor': anchor,
        class: lblClass
      });
      lbl.textContent = row.rank + '. ' + row.country_name + '  ' + formatPct(val);
      g.appendChild(lbl);

      // Interaction handlers
      g.addEventListener('mouseenter', function (evt) {
        showTooltip(evt, row);
        updateProofCompare(row);
      });
      g.addEventListener('mousemove', moveTooltip);
      g.addEventListener('mouseleave', function () {
        hideTooltip();
        updateProofCompare();
      });
      g.addEventListener('click', function () {
        state.highlightSet = null;
        clearCalloutActive();
        state.selectedCountry = state.selectedCountry === row.country ? null : row.country;
        updateHighlightClasses();
      });
      g.addEventListener('keydown', function (evt) {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault();
          state.highlightSet = null;
          clearCalloutActive();
          state.selectedCountry = state.selectedCountry === row.country ? null : row.country;
          updateHighlightClasses();
        }
      });

      barsGroup.appendChild(g);
    });

    els.svg.appendChild(barsGroup);
    updateHighlightClasses();
  }

  function renderPriceTags(rows) {
    els.priceGrid.innerHTML = '';
    var lookup = {};
    rows.forEach(function (r) { lookup[r.country] = r; });

    PROOF_MARKETS.forEach(function (spec) {
      var row = lookup[spec.code];
      if (!row) {
        return;
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'price-tag';
      btn.setAttribute('data-country', row.country);
      btn.setAttribute('role', 'listitem');
      btn.setAttribute('aria-label', row.country_name + ' KLIPPAN price ' + formatUsd(row.klippan_usd));

      btn.innerHTML =
        '<span class="tag-country">' + row.country_name + '</span>' +
        '<span class="tag-usd">' + formatUsd(row.klippan_usd) + '</span>' +
        '<span class="tag-sub">' + formatLocalPrice(row.klippan_local, row.currency) + ' &middot; ' + spec.note + '</span>';

      btn.addEventListener('click', function () {
        state.highlightSet = null;
        clearCalloutActive();
        state.selectedCountry = state.selectedCountry === row.country ? null : row.country;
        updateHighlightClasses();
      });

      els.priceGrid.appendChild(btn);
    });
  }

  function clearCalloutActive() {
    els.calloutCards.forEach(function (c) { c.classList.remove('is-active'); });
  }

  function bindControls() {
    els.regionPills.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var region = btn.getAttribute('data-region');
        state.activeRegion = region;
        state.selectedCountry = null;
        state.highlightSet = null;
        clearCalloutActive();

        els.regionPills.forEach(function (p) {
          var isOn = p === btn;
          p.classList.toggle('is-active', isOn);
          p.setAttribute('aria-pressed', String(isOn));
        });

        updateHighlightClasses();
      });
    });

    els.iqrToggle.addEventListener('change', function () {
      state.showIqr = Boolean(els.iqrToggle.checked);
      renderChart(state.rows);
    });

    els.calloutCards.forEach(function (card) {
      function toggleCard() {
        var alreadyActive = card.classList.contains('is-active');
        clearCalloutActive();
        state.selectedCountry = null;

        if (alreadyActive) {
          state.highlightSet = null;
        } else {
          card.classList.add('is-active');
          var codes = (card.getAttribute('data-highlight') || '').split(',');
          var map = {};
          codes.forEach(function (c) {
            if (c) {
              map[c.trim()] = true;
            }
          });
          state.highlightSet = map;
        }
        updateHighlightClasses();
      }

      card.addEventListener('click', toggleCard);
      card.addEventListener('keydown', function (evt) {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault();
          toggleCard();
        }
      });
    });

    document.addEventListener('keydown', function (evt) {
      if (evt.key === 'Escape') {
        state.selectedCountry = null;
        state.highlightSet = null;
        clearCalloutActive();
        updateHighlightClasses();
      }
    });
  }

  function init() {
    bindControls();
    loadDataset().then(function (rows) {
      state.rows = rows.slice().sort(function (a, b) { return a.rank - b.rank; });
      setStatus('', false);
      renderChart(state.rows);
      renderPriceTags(state.rows);
    }).catch(function (err) {
      setStatus(
        'Unable to load data.json (' + err.message + '). If testing locally, serve this folder over HTTP (for example: python -m http.server 8000).',
        true
      );
    });
  }

  init();
})();
