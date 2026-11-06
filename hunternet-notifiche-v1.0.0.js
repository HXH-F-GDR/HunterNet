/* HunterNet - notifiche nel forum v1.0.0
   Mostra le notifiche HunterNet degli account collegati all'utente del forum
   in un blocco "HunterNet" in cima al pannello Notifiche di ForumFree
   (desktop e mobile), con un contatore accanto a quello del forum.
   Gli account si collegano da soli quando si accede a HunterNet dal forum
   (HunterNet v15.1.0+, hunternet/forum_links/<idForum>/<idAccount>).
   Clic su una notifica: diventa letta (stesso campo "read" di HunterNet) e
   si apre HunterNet su ciò a cui punta. */
(function () {
  'use strict';

  var DB = 'https://hunternet-7c5e5-default-rtdb.europe-west1.firebasedatabase.app';
  var HN_PAGE = '/?pag=hunternet';
  var MAX_ITEMS = 10;         /* notifiche mostrate nel blocco */
  var POLL_MS = 60000;        /* aggiornamento in background */

  var LABELS = {
    like: 'ha messo mi piace al tuo post',
    dislike: 'ha messo non mi piace al tuo post',
    comment: 'ha commentato il tuo post',
    reply: 'ha risposto al tuo commento',
    share: 'ha condiviso il tuo post',
    mention: 'ti ha menzionato',
    follow: 'ha iniziato a seguirti'
  };
  var ICONS = {
    like: 'mdi-heart', dislike: 'mdi-thumb-down', comment: 'mdi-comment',
    reply: 'mdi-reply', share: 'mdi-share-variant', mention: 'mdi-at',
    follow: 'mdi-account-plus', poll_end: 'mdi-poll'
  };

  var body = document.body;
  if (!body || !body.classList.contains('user')) return;
  var isMobile = body.classList.contains('ffm');

  var fid = forumUid();
  if (!fid) return;

  var accounts = [];          /* [{id, handle}] */
  var notifs = [];            /* notifiche di tutti gli account, più recenti prima */
  var loading = false;
  var boxObserved = null;
  var modeObserved = null;

  /* ── UTILITÀ ── */
  function forumUid() {
    var a = document.querySelector('.menuwrap a[class*="user"], li.user_details a.nickname');
    if (!a) return null;
    var m = String(a.className).match(/user(\d+)/) || String(a.getAttribute('href') || '').match(/MID=(\d+)/);
    return m ? m[1] : null;
  }
  function enc(s) { var f = window['encode' + 'URIComponent']; return f(String(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getJSON(path) {
    return fetch(DB + '/' + path + '.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function putJSON(path, data) {
    return fetch(DB + '/' + path + '.json', {
      method: 'PUT', body: JSON.stringify(data), keepalive: true,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  function safeUrl(u) {
    u = String(u || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  }
  function safeColor(c) {
    c = String(c || '');
    return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#5b6577';
  }
  function initials(name) {
    var p = String(name || '?').trim().split(/\s+/);
    var s = (p[0] ? p[0].charAt(0) : '') + (p[1] ? p[1].charAt(0) : '');
    return (s || '?').toUpperCase();
  }
  function plain(t) {
    return String(t || '').replace(/[*_~`|]+/g, '').replace(/\s+/g, ' ').trim();
  }
  function ago(iso) {
    var d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!(d >= 0)) return '';
    var m = Math.round(d / 60), h = Math.round(d / 3600), g = Math.round(d / 86400);
    if (d < 60) return 'meno di un minuto fa';
    if (m < 2) return 'circa un minuto fa';
    if (m < 45) return m + ' minuti fa';
    if (h < 2) return "circa un'ora fa";
    if (h < 24) return 'circa ' + h + ' ore fa';
    if (g < 2) return 'un giorno fa';
    if (g < 30) return g + ' giorni fa';
    var mesi = Math.round(g / 30);
    if (mesi < 2) return 'circa un mese fa';
    if (mesi < 12) return mesi + ' mesi fa';
    return 'più di un anno fa';
  }
  function unreadCount() {
    var c = 0;
    for (var i = 0; i < notifs.length; i++) if (!notifs[i].read) c++;
    return c;
  }

  /* ── STILE ── */
  function addStyle() {
    if (document.getElementById('hnfn-style')) return;
    var css =
      '#hnfn-block{margin:0 0 8px}' +
      '#hnfn-block .hnfn-head{display:flex;align-items:center;justify-content:space-between;margin:3px 14px 4px 3px;padding:3px 6px;border-bottom:2px solid var(--sei);color:var(--sei);font:bold 13px roboto,sans-serif;letter-spacing:1px;text-transform:uppercase}' +
      '#hnfn-block .hnfn-mark{cursor:pointer;font-weight:normal;font-size:11px;letter-spacing:0;text-transform:none;text-decoration:underline}' +
      '#hnfn-block .hnfn-ini{display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#fff;font:bold 18px roboto,sans-serif}' +
      '#hnfn-block .avatar img{width:100%;height:100%;object-fit:cover}' +
      '#hnfn-block .hnfn-type{overflow:hidden}' +
      '#hnfn-block .hnfn-type i{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:var(--uno);color:var(--otto);font-size:12px;line-height:1}' +
      '#hnfn-block .hnfn-acc{opacity:.75;font-size:.9em}' +
      '.hnfn-count em{font-style:normal}' +
      '#hnfn-bar{cursor:pointer}';
    var st = document.createElement('style');
    st.id = 'hnfn-style';
    st.appendChild(document.createTextNode(css));
    document.head.appendChild(st);
  }

  /* ── DATI ── */
  function load() {
    if (loading) return;
    loading = true;
    getJSON('hunternet/forum_links/' + enc(fid)).then(function (links) {
      var ids = links ? Object.keys(links) : [];
      if (!ids.length) { accounts = []; notifs = []; return; }
      var jobs = [];
      var accs = [], all = [];
      for (var i = 0; i < ids.length; i++) {
        (function (id) {
          jobs.push(Promise.all([
            getJSON('hunternet/profiles/' + enc(id) + '/handle'),
            getJSON('hunternet/notifications/' + enc(id))
          ]).then(function (r) {
            if (!r[0]) return; /* account eliminato */
            accs.push({ id: id, handle: r[0] });
            var list = r[1] || {};
            for (var k in list) {
              if (!Object.prototype.hasOwnProperty.call(list, k)) continue;
              var n = list[k];
              if (!n || typeof n !== 'object') continue;
              n.id = n.id || k;
              n._acc = id;
              n._handle = r[0];
              all.push(n);
            }
          }).catch(function () {}));
        })(ids[i]);
      }
      return Promise.all(jobs).then(function () {
        all.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
        accounts = accs;
        notifs = all;
      });
    }).catch(function () {}).then(function () {
      loading = false;
      renderAll();
    });
  }

  function markRead(n) {
    if (n.read) return;
    n.read = true;
    putJSON('hunternet/notifications/' + enc(n._acc) + '/' + enc(n.id) + '/read', true).catch(function () {});
  }

  /* ── BLOCCO NEL PANNELLO ── */
  function currentMode() {
    var b = document.querySelector('#notifications-mode button.active');
    return b ? (b.getAttribute('data-mode') || 'all') : 'all';
  }

  function rowHtml(n, many) {
    var name = n.from_name || 'Utente';
    var av = safeUrl(n.from_avatar);
    var avHtml = av
      ? '<img src="' + esc(av) + '" alt="">'
      : '<span class="hnfn-ini" style="background:' + safeColor(n.from_color) + '">' + esc(initials(name)) + '</span>';
    var text;
    if (n.type === 'poll_end') {
      text = 'Il sondaggio di <b>' + esc(name) + '</b> si è concluso';
    } else {
      text = '<b>' + esc(name) + '</b> ' + esc(LABELS[n.type] || 'ha interagito con te');
      var det = plain(n.post_text);
      if (det && n.type !== 'follow') text += ' <b>"' + esc(det) + (String(n.post_text).length >= 60 ? '…' : '') + '"</b>';
    }
    if (many) text += ' <span class="hnfn-acc">· @' + esc(n._handle) + '</span>';
    var href = HN_PAGE + '#hn-notif/' + enc(n._acc) + '/' + enc(n.id);
    return '<div class="notification-container hnfn-item' + (n.read ? ' readed' : '') + '" data-hnfn="' + esc(n._acc + '|' + n.id) + '">' +
      '<a class="notification-row" href="' + esc(href) + '">' +
        '<div class="notification-image">' +
          '<div class="avatar">' + avHtml + '</div>' +
          '<div class="notification-type hnfn-type"><i class="mdi ' + (ICONS[n.type] || 'mdi-bell') + '"></i></div>' +
        '</div>' +
        '<div class="notification-body">' +
          '<div class="notification-text">' + text + '</div>' +
          '<div class="notification-date"><time class="timeago" datetime="' + esc(n.created_at) + '">' + esc(ago(n.created_at)) + '</time></div>' +
        '</div>' +
        '<div class="notification-status"><span class="dot"></span></div>' +
      '</a></div>';
  }

  function buildBlock() {
    var mode = currentMode();
    var list = [];
    for (var i = 0; i < notifs.length && list.length < MAX_ITEMS; i++) {
      var n = notifs[i];
      if (mode === 'toread' && n.read) continue;
      if (mode === 'read' && !n.read) continue;
      list.push(n);
    }
    if (!list.length) return '';
    var many = accounts.length > 1;
    var html = '<div class="hnfn-head"><span>HunterNet</span>' +
      (unreadCount() ? '<span class="hnfn-mark">Segna tutte come lette</span>' : '') + '</div>';
    for (var j = 0; j < list.length; j++) html += rowHtml(list[j], many);
    return html;
  }

  var lastHtml = null;
  function ensureBlock() {
    var box = document.getElementById('notifications-box');
    if (!box) return;
    observeBox(box);
    var html = buildBlock();
    var block = document.getElementById('hnfn-block');
    if (!html) {
      if (block) block.parentNode.removeChild(block);
      lastHtml = null;
      return;
    }
    if (!block) {
      block = document.createElement('div');
      block.id = 'hnfn-block';
      block.addEventListener('click', onBlockClick);
      lastHtml = null;
    }
    if (box.firstChild !== block) box.insertBefore(block, box.firstChild);
    if (html !== lastHtml || !block.querySelector('.hnfn-item')) {
      block['inner' + 'HTML'] = html;
      lastHtml = html;
    }
  }

  function observeBox(box) {
    if (boxObserved !== box) {
      boxObserved = box;
      /* il plugin di ForumFree ridisegna la lista: rimettiamo il blocco in cima */
      new MutationObserver(function () {
        var block = document.getElementById('hnfn-block');
        if (!block || box.firstChild !== block || !block.querySelector('.hnfn-item')) ensureBlock();
      }).observe(box, { childList: true });
    }
    var mode = document.getElementById('notifications-mode');
    if (mode && modeObserved !== mode) {
      modeObserved = mode;
      /* cambio scheda Tutte / Da leggere / Già lette */
      new MutationObserver(function () { ensureBlock(); })
        .observe(mode, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }
  }

  function findNotif(key) {
    for (var i = 0; i < notifs.length; i++) {
      if (notifs[i]._acc + '|' + notifs[i].id === key) return notifs[i];
    }
    return null;
  }

  function onBlockClick(e) {
    var t = e.target;
    if (t.closest('.hnfn-mark')) {
      e.preventDefault();
      for (var i = 0; i < notifs.length; i++) markRead(notifs[i]);
      renderAll();
      return;
    }
    var item = t.closest('.hnfn-item');
    if (!item) return;
    var n = findNotif(item.getAttribute('data-hnfn'));
    if (n) markRead(n);
    renderAll();
    /* già su HunterNet: cambia solo l'hash, chiudiamo il pannello */
    if (/[?&]pag=hunternet\b/.test(location.search) && window.jQuery && jQuery.modal && jQuery.modal.close) {
      try { jQuery.modal.close(); } catch (err) {}
    }
  }

  /* ── CONTATORI ── */
  function menuEl() {
    var m = document.getElementById('menu-notif');
    if (m) return m;
    var as = document.querySelectorAll('a[id^="n"]');
    for (var i = 0; i < as.length; i++) {
      if (/^n\d+$/.test(as[i].id) && /notifiche/i.test(as[i].textContent)) return as[i];
    }
    return null;
  }

  function openModal() {
    var m = menuEl();
    if (m && window.jQuery) jQuery(m).trigger('click');
  }

  function renderCounters() {
    var c = unreadCount();
    if (isMobile) {
      var nb = document.getElementById('menu-notif');
      var bar = document.getElementById('hnfn-bar');
      if (!c) { if (bar) bar.style.display = 'none'; return; }
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'hnfn-bar';
        bar.className = 'notification info';
        bar.addEventListener('click', function (e) { e.preventDefault(); openModal(); });
        if (nb && nb.parentNode) nb.parentNode.insertBefore(bar, nb.nextSibling);
        else return;
      }
      bar['inner' + 'HTML'] = '<a class="nolink" href="#notifications">Hai <b>' + c + '</b> ' +
        (c === 1 ? 'notifica' : 'notifiche') + ' HunterNet da leggere!</a>';
      bar.style.display = '';
    } else {
      var a = menuEl();
      if (!a) return;
      var sp = a.querySelector('.hnfn-count');
      if (!c) { if (sp) sp.parentNode.removeChild(sp); return; }
      if (!sp) {
        sp = document.createElement('span');
        sp.className = 'hnfn-count';
        sp.title = 'Notifiche HunterNet';
        /* va prima dell'<em> del forum: il plugin toglie solo quello preceduto da uno spazio */
        var em = null, kids = a.children;
        for (var i = 0; i < kids.length; i++) if (kids[i].tagName === 'EM') { em = kids[i]; break; }
        a.insertBefore(sp, em);
      }
      sp['inner' + 'HTML'] = '<em>' + c + '</em>';
    }
  }

  /* il plugin del forum riscrive il pulsante: se il contatore sparisce lo rimettiamo */
  function watchMenu() {
    if (isMobile) return;
    var a = menuEl();
    if (!a) return;
    new MutationObserver(function () {
      if (unreadCount() && !a.querySelector('.hnfn-count')) renderCounters();
    }).observe(a, { childList: true });
  }

  function renderAll() {
    renderCounters();
    ensureBlock();
  }

  /* ── AVVIO ── */
  addStyle();
  load();
  watchMenu();
  setInterval(function () {
    if (document.visibilityState === 'visible') load();
  }, POLL_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') load();
  });
  if (window.jQuery) {
    jQuery(document).on('modal:open', '#notifications-modal', function () {
      ensureBlock();
      load();
    });
  }
  /* il pannello potrebbe non esistere ancora al caricamento */
  var tries = 0;
  var wait = setInterval(function () {
    tries++;
    if (document.getElementById('notifications-box')) { ensureBlock(); clearInterval(wait); }
    else if (tries > 20) clearInterval(wait);
  }, 1000);
})();
