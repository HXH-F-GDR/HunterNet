/* HunterNet v14.9.0 */
/* v14.9.0 - Campo facoltativo linkDisplay nei post: se presente, la card del
   link mostra quel testo (es. laspina.onion/#titolo) al posto dell'indirizzo
   vero, che resta la destinazione del clic. Usato dai post automatici delle
   redazioni; conservato anche nelle condivisioni. */

/* ── STATO ── */
var hn_tags     = ['#notizie'];
var hn_colors   = ['#c0392b','#e67e22','#f39c12','#27ae60','#16a085','#2980b9','#8e44ad','#2c3e50','#d35400','#1abc9c'];

var hn_user     = null;
var hn_notifs   = [];
var hn_profiles = [];
var hn_posts    = [];
var hn_tab_cur   = 'all';
var hn_filter_user_id = null;
var hn_filter_tag = '';
var hn_search_query = '';
var hn_sel_color = hn_colors[5];
var hn_data_ready = false;
var hn_posts_ready = false;
var hn_profiles_ready = false;

/* Stato di visualizzazione che sopravvive ai re-render */
var hn_open_comments = {};
var hn_open_replies = {};
var hn_comments_shown = {};

/* Notifiche gestite localmente prima della conferma del server (id -> created_at) */
var hn_deleted_notif_ids = {};
var hn_read_notif_ids = {};

var hn_poll_pending = {};

/* Caricamento a blocchi */
var HN_PAGE_STEP = 20;
var hn_page_limit = HN_PAGE_STEP;
var hn_posts_query = null;
var hn_has_more = false;
var hn_loading_more = false;
var hn_extra_posts = {};
var hn_watching = {};
var hn_post_waiters = {};
var hn_single_pid = null;
var hn_user_posts = null;
var hn_user_posts_ref = null;
var hn_profile_posts = {};
var hn_poll_last_check = 0;
var hn_poll_check_busy = false;

/* Immagini del post in scrittura e galleria */
var HN_MAX_IMAGES = 4;
var hn_draft_images = [];
var hn_lb_list = [];
var hn_lb_idx = 0;

var HN_TAG_RE;
try { HN_TAG_RE = new RegExp('#[\\p{L}\\p{N}_]+', 'gu'); }
catch (e) { HN_TAG_RE = /#[a-zA-Z0-9_\u00C0-\u024F]+/g; }

var HN_GROUPS = [
  {handle:'tutti',       name:'@tutti',       color:'#5b9cf6', test:function(p){ return true; }},
  {handle:'hunters',     name:'@hunters',     color:'#5cb878', test:function(p){ return !!p.rank && p.rank.indexOf('Hunter') !== -1; }},
  {handle:'apprendisti', name:'@apprendisti', color:'#c878c8', test:function(p){ return p.rank === 'Apprendista'; }},
  {handle:'civili',      name:'@civili',      color:'#8892a4', test:function(p){ return p.rank === 'Civile'; }},
  {handle:'lottatori',   name:'@lottatori',   color:'#88c4f4', test:function(p){ return p.rank === 'Lottatore Celeste'; }}
];

/* ── FIREBASE ── */
/* Config caricata da window.HN_FB_CONFIG impostato nell'HTML */
var hn_fb_config = window.HN_FB_CONFIG || {};
var hn_fb_app = null;
var hn_fb_db  = null;

function hnFbInit(callback) {
  if (hn_fb_app) { if (callback) callback(); return; }
  if (typeof firebase === 'undefined') {
    setTimeout(function() { hnFbInit(callback); }, 100);
    return;
  }
  try {
    hn_fb_app = firebase.initializeApp(hn_fb_config);
  } catch(e) {
    hn_fb_app = firebase.app();
  }
  hn_fb_db = firebase.database();
  if (callback) callback();
}

function hn_fb_ref(path) { return hn_fb_db.ref(path); }

function hn_fb_get(path, ok, fail) {
  hn_fb_ref(path).once('value')
    .then(function(snap) { ok(snap.val()); })
    .catch(fail || function(){});
}
function hn_fb_set(path, data, ok, fail) {
  hn_fb_ref(path).set(data).then(ok||function(){}).catch(fail||function(){});
}
function hn_fb_update(path, data, ok, fail) {
  hn_fb_ref(path).update(data).then(ok||function(){}).catch(fail||function(){});
}
function hn_fb_remove(path, ok, fail) {
  hn_fb_ref(path).remove().then(ok||function(){}).catch(fail||function(){});
}

/* Modifica un post in modo atomico: se due utenti agiscono insieme, nessuna modifica va persa.
   mutator(post, res) modifica il post; se restituisce false l'operazione viene annullata.
   ok(post, res) riceve il post salvato e l'oggetto res compilato dal mutator. */
function hnMutatePost(pid, mutator, ok, fail) {
  var res = {};
  hn_fb_ref('hunternet/posts/'+pid).transaction(function(cur) {
    if (!cur) return cur;
    res = {};
    hnNormPost(cur);
    if (mutator(cur, res) === false) return;
    return cur;
  }, function(err, committed, snap) {
    if (err || !committed || !snap || !snap.val()) { if (fail) fail(err); return; }
    if (ok) ok(snap.val(), res);
  });
}

/* Salva un post nuovo */
function hnSavePost_fb(post, ok, fail) {
  hn_fb_ref('hunternet/posts/'+post.id).set(post).then(ok||function(){}).catch(fail||function(){});
}
function hnDeletePost_fb(postId, ok, fail) {
  hn_fb_ref('hunternet/posts/'+postId).remove().then(ok||function(){}).catch(fail||function(){});
}
function hnDeleteNotifFb(to_id, nid, ok, fail) {
  hn_fb_remove('hunternet/notifications/'+to_id+'/'+nid, ok, fail);
}
function hnDeleteAllNotifsFb(uid, ok, fail) {
  hn_fb_remove('hunternet/notifications/'+uid, ok, fail);
}
function hnMarkNotifReadFb(to_id, nid) {
  hn_fb_ref('hunternet/notifications/'+to_id+'/'+nid+'/read').set(true).catch(function(){});
}
function hnFetchCreds(ok, fail) {
  hn_fb_get('hunternet/credentials', function(d) {
    var out = [];
    if (d) { for (var k in d) { if (d[k] && d[k].handle) out.push(d[k]); } }
    ok(out);
  }, fail);
}

/* ── HELPER DATI ── */
function hnUid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* Firebase restituisce gli array come oggetti o con buchi: li normalizza sempre ad array */
function hnArr(x) {
  var out = [];
  if (!x) return out;
  if (Array.isArray(x)) { for (var i=0;i<x.length;i++) { if (x[i] !== null && x[i] !== undefined) out.push(x[i]); } return out; }
  if (typeof x === 'object') { for (var k in x) { if (x[k] !== null && x[k] !== undefined) out.push(x[k]); } }
  return out;
}

function hnNormPost(p) {
  if (!p) return p;
  p.text = p.text || '';
  p.likes = hnArr(p.likes);
  p.dislikes = hnArr(p.dislikes);
  p.comments = hnArr(p.comments);
  p.images = hnArr(p.images);
  for (var i=0;i<p.comments.length;i++) p.comments[i].replies = hnArr(p.comments[i].replies);
  if (p.poll) {
    p.poll.options = hnArr(p.poll.options);
    for (var j=0;j<p.poll.options.length;j++) p.poll.options[j].votes = hnArr(p.poll.options[j].votes);
  }
  return p;
}

function hnGetPostById(pid) {
  return hnPostKnown(pid) || null;
}
/* undefined = non ancora caricato, null = non esiste, altrimenti il post */
function hnPostKnown(pid) {
  if (!pid) return null;
  var i;
  for (i=0;i<hn_posts.length;i++) { if (hn_posts[i].id === pid) return hn_posts[i]; }
  if (hn_user_posts) { for (i=0;i<hn_user_posts.length;i++) { if (hn_user_posts[i].id === pid) return hn_user_posts[i]; } }
  if (Object.prototype.hasOwnProperty.call(hn_extra_posts, pid)) return hn_extra_posts[pid];
  return undefined;
}
/* Carica (e tiene aggiornato) un post che non è tra quelli del feed */
function hnEnsurePost(pid, cb) {
  var k = hnPostKnown(pid);
  if (k !== undefined) { if (cb) cb(k); return; }
  if (cb) { if (!hn_post_waiters[pid]) hn_post_waiters[pid] = []; hn_post_waiters[pid].push(cb); }
  if (hn_watching[pid]) return;
  hn_watching[pid] = true;
  hn_fb_ref('hunternet/posts/'+pid).on('value', function(snap) {
    var d = snap.val();
    if (d && typeof d === 'object') { if (!d.id) d.id = pid; hn_extra_posts[pid] = hnNormPost(d); }
    else hn_extra_posts[pid] = null;
    var ws = hn_post_waiters[pid];
    delete hn_post_waiters[pid];
    if (ws) { for (var i=0;i<ws.length;i++) ws[i](hnPostKnown(pid)); }
    hnRefreshSoon();
  });
}
var hn_refresh_timer = null;
function hnRefreshSoon() {
  if (hn_refresh_timer) return;
  hn_refresh_timer = setTimeout(function() {
    hn_refresh_timer = null;
    if (!hn_data_ready) return;
    hnRenderFeed();
    hnPruneNotifs();
    hnUpdateBadge();
  }, 30);
}
/* Lista media di un post: immagini multiple (nuove) o immagine singola (vecchi post) */
function hnMediaList(p) {
  if (!p) return [];
  var imgs = hnArr(p.images);
  if (imgs.length) return imgs;
  return p.imgUrl ? [p.imgUrl] : [];
}
function hnFirstImage(p) {
  var l = hnMediaList(p);
  for (var i=0;i<l.length;i++) { if (hnSafeUrl(l[i]) && !hnYtId(l[i])) return l[i]; }
  return '';
}
function hnProfileById(id) {
  for (var i = 0; i < hn_profiles.length; i++) { if (hn_profiles[i].id === id) return hn_profiles[i]; }
  return null;
}
function hnProfileByHandle(handle) {
  var h = String(handle||'').toLowerCase();
  for (var i = 0; i < hn_profiles.length; i++) { if (hn_profiles[i].handle && hn_profiles[i].handle.toLowerCase() === h) return hn_profiles[i]; }
  return null;
}
function hnGroupByHandle(handle) {
  var h = String(handle||'').toLowerCase();
  for (var i=0;i<HN_GROUPS.length;i++) { if (HN_GROUPS[i].handle === h) return HN_GROUPS[i]; }
  return null;
}
function hnFindComment(post, cId) {
  if (!post) return null;
  var cl = hnArr(post.comments);
  for (var i=0;i<cl.length;i++) { if (String(cl[i].id) === String(cId)) return cl[i]; }
  return null;
}
function hnFindReply(post, cId, rId) {
  var c = hnFindComment(post, cId);
  if (!c) return null;
  var rl = hnArr(c.replies);
  for (var i=0;i<rl.length;i++) { if (String(rl[i].id) === String(rId)) return rl[i]; }
  return null;
}
function hnHasCommentBy(post, uid) {
  var cl = hnArr(post.comments);
  for (var i=0;i<cl.length;i++) {
    if (cl[i].authorId === uid) return true;
    var rl = hnArr(cl[i].replies);
    for (var j=0;j<rl.length;j++) { if (rl[j].authorId === uid) return true; }
  }
  return false;
}

/* Dati autore sempre aggiornati: usa il profilo attuale, non la copia salvata nel post */
function hnAuthorOf(item) {
  var prof = hnProfileById(item.authorId);
  if (prof) return {id:prof.id, name:prof.name, handle:prof.handle, color:prof.color, avatar:prof.avatar||'', rank:prof.rank||'', prof:prof, deleted:false};
  return {id:item.authorId, name:item.authorName||'', handle:item.authorHandle||'', color:item.authorColor, avatar:item.authorAvatar||'', rank:item.authorRank||'', prof:null, deleted:!!item.authorId};
}

function hnIsAdmin() {
  if (!hn_user) return false;
  var prof = hnProfileById(hn_user.id);
  return !!(prof && prof.admin === true);
}
function hnCanModerate(authorId) {
  return !!hn_user && (hn_user.id === authorId || hnIsAdmin());
}

function hnTagsOf(text) {
  var m = String(text||'').match(HN_TAG_RE) || [];
  var out = [];
  for (var i=0;i<m.length;i++) { var t = m[i].toLowerCase(); if (out.indexOf(t) === -1) out.push(t); }
  return out;
}

function hnPollClosed(poll) {
  if (!poll) return true;
  return !!poll.closed || (!!poll.deadline && new Date(poll.deadline) < new Date());
}

/* ── HELPER SICUREZZA E MEDIA ── */
function hnSafeColor(c) {
  return (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) ? c : '#888';
}
function hnSafeUrl(u) {
  if (!u) return '';
  u = String(u).trim();
  return /^https?:\/\//i.test(u) ? u : '';
}
function hnNormUrl(u) {
  if (!u) return '';
  u = String(u).trim();
  if (/^www\./i.test(u)) u = 'https://' + u;
  return hnSafeUrl(u);
}
function hnYtId(url) {
  if (!url) return '';
  var m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : '';
}
function hnIsGif(url) {
  return /tenor\.com|giphy\.com|\.gif(\?|#|$)/i.test(url||'');
}

/* Video incorporato a grandezza piena (post) */
function hnYtFullHtml(id) {
  return '<div style="position:relative!important;padding-bottom:56.25%!important;height:0!important;margin-bottom:8px!important;border-radius:8px!important;overflow:hidden!important;">'+
    '<iframe src="https://www.youtube.com/embed/'+id+'" style="position:absolute!important;top:0!important;left:0!important;width:100%!important;height:100%!important;border:none!important;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>'+
    '</div>';
}
/* Anteprima leggera: carica il video solo al click (commenti e post condivisi) */
function hnYtLiteHtml(id) {
  return '<div class="hn-yt-lite" onclick="event.stopPropagation();hnYtPlay(this,\''+id+'\')" title="Riproduci">'+
    '<img src="https://i.ytimg.com/vi/'+id+'/hqdefault.jpg" alt=""><span>&#9654;</span></div>';
}
function hnYtPlay(el, id) {
  if (el.getAttribute('data-on')) return;
  el.setAttribute('data-on', '1');
  el.innerHTML = '<iframe src="https://www.youtube.com/embed/'+id+'?autoplay=1" style="position:absolute!important;top:0!important;left:0!important;width:100%!important;height:100%!important;border:none!important;" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
}

function hnPostMediaHtml(p) {
  var list = hnMediaList(p), html = '', imgs = [], i;
  for (i=0;i<list.length;i++) {
    var url = hnSafeUrl(list[i]);
    if (!url) continue;
    var yt = hnYtId(url);
    if (yt) html += hnYtFullHtml(yt);
    else imgs.push(url);
  }
  if (imgs.length === 1) {
    var u = imgs[0];
    html += '<img class="hn-pimg" src="'+hnEsc(u)+'" alt=""'+(hnIsGif(u) ? '' : ' onclick="hnOpenGallery(\''+p.id+'\',0)"')+' onerror="this.style.display=\'none\'">';
  } else if (imgs.length > 1) {
    var n = Math.min(imgs.length, HN_MAX_IMAGES);
    html += '<div class="hn-gallery hn-g'+n+'">';
    for (i=0;i<n;i++) html += '<img src="'+hnEsc(imgs[i])+'" alt="" onclick="hnOpenGallery(\''+p.id+'\','+i+')" onerror="this.style.visibility=\'hidden\'">';
    html += '</div>';
  }
  return html;
}
function hnGalleryImages(p) {
  var list = hnMediaList(p), out = [];
  for (var i=0;i<list.length;i++) { var u = hnSafeUrl(list[i]); if (u && !hnYtId(u)) out.push(u); }
  return out;
}
function hnSmallMediaHtml(url, maxH) {
  url = hnSafeUrl(url);
  if (!url) return '';
  var yt = hnYtId(url);
  if (yt) return hnYtLiteHtml(yt);
  return '<img src="'+hnEsc(url)+'" style="max-width:100%!important;max-height:'+(maxH||200)+'px!important;border-radius:6px!important;margin-top:5px!important;display:block!important;cursor:pointer!important;object-fit:cover!important;" onclick="event.stopPropagation();hnOpenLightbox(this.src)" onerror="this.style.display=\'none\'">';
}
function hnLinkCardHtml(linkUrl, linkTitle, linkImage, small, linkDisplay) {
  var url = hnSafeUrl(linkUrl);
  if (!url) return '';
  var img = hnSafeUrl(linkImage);
  return '<a href="'+hnEsc(url)+'" target="_blank" rel="noopener" style="display:block!important;text-decoration:none!important;border:1px solid #313846!important;border-radius:8px!important;overflow:hidden!important;margin-'+(small?'top:5px':'bottom:8px')+'!important;background:#1e2128!important;transition:background 0.1s!important;" onmouseover="this.style.background=\'#252932\'" onmouseout="this.style.background=\'#1e2128\'">'+
    (img ? '<img src="'+hnEsc(img)+'" style="width:100%!important;max-height:'+(small?120:160)+'px!important;object-fit:cover!important;display:block!important;" onerror="this.style.display=\'none\'">' : '')+
    '<div style="padding:'+(small?'8px 10px':'10px 12px')+'!important;">'+
    '<div style="font-size:10px!important;color:#5b6577!important;margin-bottom:3px!important;text-transform:uppercase!important;letter-spacing:0.5px!important;">&#128279; Link</div>'+
    (linkTitle ? '<div style="font-size:'+(small?12:13)+'px!important;font-weight:500!important;color:#e2e8f0!important;margin-bottom:2px!important;">'+hnEsc(linkTitle)+'</div>' : '')+
    '<div style="font-size:11px!important;color:#5b9cf6!important;word-break:break-all!important;">'+hnEsc(linkDisplay || url)+'</div>'+
    '</div></a>';
}

/* ── NAVIGAZIONE ── */
function hnSetActiveTab(el) {
  var tabs = document.querySelectorAll('.hn-tab');
  for (var i=0;i<tabs.length;i++) tabs[i].classList.remove('hn-active');
  if (el) el.classList.add('hn-active');
}
function hnHideFilterChip() {
  var chip = document.getElementById('hn-tab-user');
  if (chip) chip.style['display'] = 'none';
}
function hnShowFilterChip(label) {
  var chip = document.getElementById('hn-tab-user');
  if (!chip) {
    chip = document.createElement('button');
    chip.id = 'hn-tab-user';
    chip.onclick = function() { hnTab('all', document.querySelector('.hn-tab')); };
    document.querySelector('.hn-tabs').appendChild(chip);
  }
  chip.textContent = label + ' \u00d7';
  chip.className = 'hn-tab hn-active';
  chip.style['display'] = 'inline-block';
  hnSetActiveTab(chip);
}
function hnClearSearchInput() {
  hn_search_query = '';
  var inp = document.getElementById('hn-search-inp');
  if (inp) inp.value = '';
  var box = document.getElementById('hn-search-users');
  if (box) box.style['display'] = 'none';
}
function hnResetView() {
  hn_tab_cur = 'all';
  hn_filter_user_id = null;
  hn_filter_tag = '';
  hn_single_pid = null;
  hnStopUserPosts();
  hnClearSearchInput();
  hnHideFilterChip();
  hnSetActiveTab(document.querySelector('.hn-tab'));
}

function hnGoHome() {
  hnResetView();
  if (hn_data_ready) {
    hnRenderFeed();
    hnRenderSidebar();
    hnBuildHashtags();
  }
  var list = document.getElementById('hn-posts');
  if (list) list.scrollTop = 0;
}

function hnScrollToEl(t) {
  var list = document.getElementById('hn-posts');
  if (list && list.scrollHeight > list.clientHeight + 5) {
    var lr = list.getBoundingClientRect(), tr = t.getBoundingClientRect();
    var top = list.scrollTop + (tr.top - lr.top) - 12;
    if (list.scrollTo) list.scrollTo({top: top, behavior: 'smooth'}); else list.scrollTop = top;
    var wrap = document.getElementById('hn-wrap');
    if (wrap) {
      var wr = wrap.getBoundingClientRect();
      if (wr.top < -40 || wr.top > window.innerHeight - 100) wrap.scrollIntoView({behavior:'smooth', block:'start'});
    }
  } else {
    t.scrollIntoView({behavior:'smooth', block:'center'});
  }
}

/* Porta a un post, cambiando filtro se non è visibile, e lo evidenzia */
function hnGoToPost(pid, openComments, replyKey) {
  hnEnsurePost(pid, function(p) {
    if (!p) { alert('Questo post non è più disponibile.'); return; }
    hnShowPost(p, openComments, replyKey);
  });
}
function hnShowPost(p, openComments, replyKey) {
  var pid = p.id;
  hnCloseModal('prof');
  var vis = hnFiltered(), found = false;
  for (var i=0;i<vis.length;i++) { if (vis[i].id === pid) { found = true; break; } }
  if (!found) {
    hnResetView();
    var inFeed = false;
    for (var j=0;j<hn_posts.length;j++) { if (hn_posts[j].id === pid) { inFeed = true; break; } }
    if (!inFeed) {
      hn_tab_cur = 'single';
      hn_single_pid = pid;
      hnShowFilterChip('Post');
    }
  }
  if (openComments) {
    hn_open_comments[pid] = true;
    var total = p.comments.length;
    if (total > (hn_comments_shown[pid] || 3)) hn_comments_shown[pid] = total;
  }
  if (replyKey) hn_open_replies[replyKey] = true;
  hnRenderFeed();
  setTimeout(function() {
    var t = document.getElementById('hn-p-'+pid);
    if (!t) return;
    hnScrollToEl(t);
    t.classList.add('hn-flash');
    setTimeout(function(){ t.classList.remove('hn-flash'); }, 1600);
  }, 60);
}

/* Click sulla parte condivisa di un post: apre l'originale (ma non se si clicca un link, un video, un tag) */
function hnSharedClick(e, pid) {
  var t = e.target;
  while (t && t !== e.currentTarget) {
    if (t.tagName === 'A' || t.tagName === 'IFRAME') return;
    if (t.classList && (t.classList.contains('hn-yt-lite') || t.classList.contains('hn-mention') || t.classList.contains('hn-hi'))) return;
    t = t.parentNode;
  }
  hnGoToPost(pid, false);
}

/* ── RICERCA ── */
function hnSearch(query) {
  query = String(query||'').trim().toLowerCase();
  hn_search_query = query;
  if (hn_data_ready) hnRenderFeed();
  if (!query) { hnRenderSearchUsers([]); return; }
  var users = [];
  for (var k=0;k<hn_profiles.length;k++) {
    var pr = hn_profiles[k];
    if ((pr.name||'').toLowerCase().indexOf(query)!==-1 || (pr.handle||'').toLowerCase().indexOf(query)!==-1) users.push(pr);
  }
  hnRenderSearchUsers(users);
}

function hnRenderSearchUsers(users) {
  var box = document.getElementById('hn-search-users');
  if (!box) return;
  if (!users.length) { box.style['display']='none'; return; }
  var inp = document.getElementById('hn-search-inp');
  if (inp) {
    var rect = inp.getBoundingClientRect();
    box.style['position'] = 'fixed';
    box.style['left'] = rect.left + 'px';
    box.style['top'] = (rect.bottom + 4) + 'px';
    box.style['min-width'] = rect.width + 'px';
    box.style['z-index'] = '99998';
  }
  box.style['display']='block';
  var html='<div style="font-size:11px!important;color:#5b6577!important;padding:6px 12px!important;border-bottom:1px solid #313846!important;text-transform:uppercase!important;">Utenti</div>';
  for (var i=0;i<users.length&&i<5;i++) {
    var u=users[i];
    html+='<div class="hn-mention-item" onmousedown="hnCloseSearch();hnOpenProfile(\''+u.id+'\')">'+
      hnAvHtml(u.color,u.avatar||'',u.name,'hn-mention-av',null)+
      '<div style="margin:0!important;">'+
      '<div class="hn-mention-name">'+hnEsc(u.name)+hnVerifiedBadge(u)+'</div>'+
      '<div class="hn-mention-handle">@'+hnEsc(u.handle)+'</div></div></div>';
  }
  box.innerHTML=html;
}

function hnCloseSearch() {
  hnClearSearchInput();
  if (hn_data_ready) hnRenderFeed();
}

/* ── LISTENER REALTIME ── */
var hn_fb_posts_listener = false;
var hn_fb_profiles_listener = false;
var hn_notif_ref = null;
var hn_notif_uid = null;

function hnFbRenderAll() {
  if (!hn_posts_ready || !hn_profiles_ready) return;
  hn_data_ready = true;
  hnSyncSessionUser();
  hnRenderFeed();
  hnRenderSidebar();
  hnBuildHashtags();
  hnCheckPollExpiry();
  hnPruneNotifs();
  hnUpdateBadge();
}

function hnSnapToPosts(d) {
  var arr = [];
  if (d) {
    for (var k in d) {
      if (!d[k] || typeof d[k] !== 'object') continue;
      if (!d[k].id) d[k].id = k;
      arr.push(hnNormPost(d[k]));
    }
  }
  arr.sort(function(a,b){ return new Date(b.createdAt)-new Date(a.createdAt); });
  return arr;
}

/* Il feed ascolta solo gli ultimi hn_page_limit post; "Carica altri" allarga la finestra */
function hnAttachPostsListener() {
  if (hn_posts_query) hn_posts_query.off();
  var q = hn_fb_ref('hunternet/posts').orderByChild('createdAt').limitToLast(hn_page_limit);
  hn_posts_query = q;
  q.on('value', function(snap) {
    if (q !== hn_posts_query) return;
    var arr = hnSnapToPosts(snap.val());
    hn_has_more = arr.length >= hn_page_limit;
    hn_loading_more = false;
    hn_posts = arr;
    hn_posts_ready = true;
    hnFbRenderAll();
  });
}

function hnFbListenPosts() {
  if (hn_fb_posts_listener) return;
  hn_fb_posts_listener = true;
  hnAttachPostsListener();
}

function hnLoadMore() {
  if (!hn_has_more || hn_loading_more) return;
  hn_loading_more = true;
  hn_page_limit += HN_PAGE_STEP;
  var list = document.getElementById('hn-posts');
  if (list) hnRenderMoreBtn(list);
  hnAttachPostsListener();
}

function hnMaybeAutoLoad() {
  var more = document.getElementById('hn-more');
  if (!more || !hn_has_more || hn_loading_more) return;
  var r = more.getBoundingClientRect();
  var list = document.getElementById('hn-posts');
  var lr = list ? list.getBoundingClientRect() : null;
  var limitBottom = Math.min(window.innerHeight, lr ? lr.bottom : window.innerHeight);
  if (r.top < limitBottom + 150) hnLoadMore();
}

/* Post di un utente (tutti, non solo quelli già caricati nel feed) */
function hnStopUserPosts() {
  if (hn_user_posts_ref) hn_user_posts_ref.off();
  hn_user_posts_ref = null;
  hn_user_posts = null;
}
function hnStartUserPosts(aid) {
  hnStopUserPosts();
  var q = hn_fb_ref('hunternet/posts').orderByChild('authorId').equalTo(aid);
  hn_user_posts_ref = q;
  q.on('value', function(snap) {
    if (q !== hn_user_posts_ref) return;
    hn_user_posts = hnSnapToPosts(snap.val());
    hn_profile_posts[aid] = hn_user_posts;
    if (hn_data_ready) hnRenderFeed();
  });
}

function hnFbListenProfiles() {
  if (hn_fb_profiles_listener) return;
  hn_fb_profiles_listener = true;
  hn_fb_ref('hunternet/profiles').on('value', function(snap) {
    var d = snap.val();
    var arr = [];
    if (d) {
      for (var k in d) {
        if (!d[k] || typeof d[k] !== 'object') continue;
        if (!d[k].id) d[k].id = k;
        d[k].following = hnArr(d[k].following);
        arr.push(d[k]);
      }
    }
    hn_profiles = arr;
    hn_profiles_ready = true;
    hnFbRenderAll();
  });
}

function hnFbListenNotifs(uid) {
  hnFbStopNotifs();
  hn_notif_uid = uid;
  hn_notif_ref = hn_fb_ref('hunternet/notifications/'+uid);
  hn_notif_ref.on('value', function(snap) {
    var d = snap.val();
    var out = [];
    if (d) {
      for (var k in d) {
        var n = d[k];
        if (!n || typeof n !== 'object') continue;
        if (!n.id) n.id = k;
        if (hn_deleted_notif_ids[n.id] && hn_deleted_notif_ids[n.id] === n.created_at) continue;
        if (hn_read_notif_ids[n.id] && hn_read_notif_ids[n.id] === n.created_at) n.read = true;
        out.push(n);
      }
    }
    out.sort(function(a,b){ return new Date(b.created_at) - new Date(a.created_at); });
    hn_notifs = out;
    hnPruneNotifs();
    hnUpdateBadge();
    var drop = document.getElementById('hn-notif-drop');
    if (drop && drop.style['display'] === 'block') hnRenderNotifDrop();
  });
}
function hnFbStopNotifs() {
  if (hn_notif_ref) { hn_notif_ref.off(); hn_notif_ref = null; }
  hn_notif_uid = null;
  hn_notifs = [];
}

/* Tiene la sessione allineata al profilo (modifiche dell'admin, account eliminato) */
function hnSyncSessionUser() {
  if (!hn_user) return;
  var prof = hnProfileById(hn_user.id);
  if (!prof) { hnLogout(); return; }
  var sig = function(u) { return [u.name, u.handle, u.avatar||'', u.color, u.rank].join('|'); };
  var changed = sig(prof) !== sig(hn_user);
  hn_user = prof;
  try { sessionStorage.setItem('hn_user', JSON.stringify(prof)); } catch(e) {}
  if (changed) { hnRenderUserBar(); hnRenderComposeAvatar(); }
}

/* ── COMMENT EDITOR MODAL ── */
var hn_cedit_mode = null;
var hn_cedit_pid  = null;
var hn_cedit_cid  = null;
var hn_cedit_emoji_open = false;
var hn_cedit_link_image = '';

function hnCEditOpen(mode, pid, cid, placeholder, title) {
  hn_cedit_mode = mode;
  hn_cedit_pid  = pid;
  hn_cedit_cid  = cid || null;
  var overlay = document.getElementById('hn-cedit-overlay');
  var ta      = document.getElementById('hn-cedit-textarea');
  var titleEl = document.getElementById('hn-cedit-title');
  if (titleEl) titleEl.textContent = title || 'Scrivi un commento';
  if (ta) { ta.value = ''; ta.placeholder = placeholder || 'Scrivi...'; }
  hnCEditClearImg();
  hnCEditClearLink();
  if (overlay) overlay.classList.add('hn-vis');
  setTimeout(function(){ if (ta) ta.focus(); }, 100);
  var ebtn = document.getElementById('hn-cedit-tbtn-emoji');
  if (ebtn) ebtn.onclick = function(e) { e.stopPropagation(); hnCEditToggleEmoji(); };
  var barbtn = document.getElementById('hn-cedit-tbtn-bar');
  if (barbtn) barbtn.onclick = function() { hnCEditFmt('s'); };
}

function hnCEditClose() {
  var overlay = document.getElementById('hn-cedit-overlay');
  if (overlay) overlay.classList.remove('hn-vis');
  hn_cedit_mode = null; hn_cedit_pid = null; hn_cedit_cid = null;
  hnCEditClearImg(); hnCEditClearLink();
  if (hn_cedit_emoji_open) {
    var wrap = document.getElementById('hn-emoji-picker-wrap');
    if (wrap) wrap.style['display'] = 'none';
    hn_cedit_emoji_open = false;
  }
}

function hnCEditFmt(tag) {
  var ta = document.getElementById('hn-cedit-textarea');
  if (!ta) return;
  var s = ta.selectionStart, e = ta.selectionEnd;
  var sel = ta.value.substring(s, e);
  var open_tag = '['+tag+']', close_tag = '[/'+tag+']';
  if (tag === 's') { open_tag = '[bar]'; close_tag = '[/bar]'; }
  ta.value = ta.value.substring(0,s) + open_tag + sel + close_tag + ta.value.substring(e);
  ta.selectionStart = s + open_tag.length;
  ta.selectionEnd   = s + open_tag.length + sel.length;
  ta.focus();
}

function hnCEditInsertEmoji(emoji) {
  var ta = document.getElementById('hn-cedit-textarea');
  if (!ta) return;
  var s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.substring(0,s) + emoji + ta.value.substring(e);
  ta.selectionStart = ta.selectionEnd = s + emoji.length;
  ta.focus();
}

function hnCEditToggleEmoji() {
  var wrap = document.getElementById('hn-emoji-picker-wrap');
  if (!wrap) return;
  if (hn_cedit_emoji_open) {
    wrap.style['display'] = 'none';
    hn_cedit_emoji_open = false;
    return;
  }
  var btn = document.getElementById('hn-cedit-tbtn-emoji');
  if (btn) {
    var rect = btn.getBoundingClientRect();
    wrap.style['left'] = rect.left + 'px';
    wrap.style['top']  = (rect.bottom + 6) + 'px';
  }
  if (!hnEnsureEmojiPicker(wrap)) return;
  wrap.style['display'] = 'block';
  hn_cedit_emoji_open = true;
  hn_emoji_picker_open = false;
}

function hnCEditToggleImg() {
  var row = document.getElementById('hn-cedit-imgrow');
  if (!row) return;
  if (row.classList.contains('hn-vis')) hnCEditClearImg();
  else { row.classList.add('hn-vis'); var i=document.getElementById('hn-cedit-imgurl'); if(i)i.focus(); }
}

function hnCEditClearImg() {
  var row = document.getElementById('hn-cedit-imgrow');
  var inp = document.getElementById('hn-cedit-imgurl');
  if (row) row.classList.remove('hn-vis');
  if (inp) inp.value = '';
}

function hnCEditToggleLink() {
  var row = document.getElementById('hn-cedit-linkrow');
  if (!row) return;
  if (row.classList.contains('hn-vis')) hnCEditClearLink();
  else {
    row.classList.add('hn-vis');
    var i = document.getElementById('hn-cedit-linkurl');
    if (i) {
      i.focus();
      i.oninput = function() { hnCEditLinkPreviewDebounce(this.value); };
    }
  }
}

function hnCEditClearLink() {
  var row = document.getElementById('hn-cedit-linkrow');
  var url = document.getElementById('hn-cedit-linkurl');
  var tit = document.getElementById('hn-cedit-linktitle');
  var prev = document.getElementById('hn-cedit-link-preview');
  var img = document.getElementById('hn-cedit-link-preview-img');
  if (row) row.classList.remove('hn-vis');
  if (url) { url.value = ''; url.oninput = null; }
  if (tit) tit.value = '';
  if (prev) prev.classList.remove('hn-vis');
  if (img) { img.removeAttribute('src'); img.style['display'] = 'none'; }
  hn_cedit_link_image = '';
  hn_cedit_link_token++;
}

function hnCEditSubmit() {
  var ta = document.getElementById('hn-cedit-textarea');
  if (!ta) return;
  var text = ta.value.trim();
  if (!text) return;
  var imgEl = document.getElementById('hn-cedit-imgurl');
  var urlEl = document.getElementById('hn-cedit-linkurl');
  var titEl = document.getElementById('hn-cedit-linktitle');
  var imgUrl    = hnNormUrl(imgEl ? imgEl.value : '');
  var linkUrl   = hnNormUrl(urlEl ? urlEl.value : '');
  var linkTitle = titEl ? titEl.value.trim() : '';
  var linkImg   = linkUrl ? hn_cedit_link_image : '';
  var mode = hn_cedit_mode;
  var pid  = hn_cedit_pid;
  var cid  = hn_cedit_cid;
  hnCEditClose();
  if (mode === 'comment') {
    hnSubmitCommentFull(pid, text, imgUrl, linkUrl, linkTitle, linkImg);
  } else if (mode === 'reply') {
    hnSubmitReplyFull(pid, cid, text, imgUrl, linkUrl, linkTitle, linkImg);
  }
}

/* ── ANTEPRIMA LINK ── */
var HN_PROXY = 'https://hunternet-proxy.a-f-avvento.workers.dev/?url=';
var hn_cedit_link_preview_timer = null;
var hn_cedit_link_token = 0;
var hn_link_preview_timer = null;
var hn_link_token = 0;

function hnCEditLinkPreviewDebounce(url) {
  if (hn_cedit_link_preview_timer) clearTimeout(hn_cedit_link_preview_timer);
  hn_cedit_link_image = '';
  hn_cedit_link_token++;
  var prev = document.getElementById('hn-cedit-link-preview');
  url = hnNormUrl(url);
  if (!url) { if (prev) prev.classList.remove('hn-vis'); return; }
  hn_cedit_link_preview_timer = setTimeout(function() { hnCEditLinkPreviewFetch(url); }, 800);
}

function hnCEditLinkPreviewFetch(url) {
  var token = ++hn_cedit_link_token;
  var prev    = document.getElementById('hn-cedit-link-preview');
  var spinner = document.getElementById('hn-cedit-link-preview-spinner');
  var img_el  = document.getElementById('hn-cedit-link-preview-img');
  var body_el = document.getElementById('hn-cedit-link-preview-body');
  var title_el = document.getElementById('hn-cedit-link-preview-title');
  var url_el  = document.getElementById('hn-cedit-link-preview-url');
  if (!prev) return;
  prev.classList.add('hn-vis');
  if (spinner) spinner.style['display'] = 'block';
  if (body_el) body_el.style['display'] = 'none';
  if (img_el) img_el.style['display'] = 'none';
  fetch(HN_PROXY + window['encode'+'URIComponent'](url))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (token !== hn_cedit_link_token) return;
      if (spinner) spinner.style['display'] = 'none';
      var fetched_title = data.title || '';
      var fetched_img   = hnSafeUrl(data.image || '');
      if (body_el) body_el.style['display'] = 'block';
      if (title_el) {
        title_el.textContent = fetched_title;
        var title_inp = document.getElementById('hn-cedit-linktitle');
        if (title_inp && !title_inp.value && fetched_title) title_inp.value = fetched_title;
      }
      if (url_el) url_el.textContent = url;
      hn_cedit_link_image = fetched_img;
      if (fetched_img && img_el) {
        img_el.src = fetched_img;
        img_el.hidden = false;
        img_el.style['display'] = 'block';
      }
    })
    .catch(function() {
      if (token !== hn_cedit_link_token) return;
      if (spinner) spinner.style['display'] = 'none';
      if (body_el) body_el.style['display'] = 'block';
      if (title_el) title_el.textContent = '';
      if (url_el) url_el.textContent = url;
    });
}

function hnLinkPreviewDebounce(url) {
  if (hn_link_preview_timer) clearTimeout(hn_link_preview_timer);
  hn_link_image = '';
  hn_link_token++;
  var prev = document.getElementById('hn-link-preview');
  url = hnNormUrl(url);
  if (!url) { if (prev) prev.classList.remove('hn-vis'); return; }
  hn_link_preview_timer = setTimeout(function() { hnLinkPreviewFetch(url); }, 800);
}

function hnLinkPreviewFetch(url) {
  var token = ++hn_link_token;
  var prev = document.getElementById('hn-link-preview');
  var spinner = document.getElementById('hn-link-preview-spinner');
  var img_el = document.getElementById('hn-link-preview-img');
  var body_el = document.getElementById('hn-link-preview-body');
  var title_el = document.getElementById('hn-link-preview-title');
  var url_el = document.getElementById('hn-link-preview-url');
  if (!prev) return;
  prev.classList.add('hn-vis');
  if (spinner) spinner.style['display'] = 'block';
  if (body_el) body_el.style['display'] = 'none';
  if (img_el) img_el.style['display'] = 'none';
  fetch(HN_PROXY + window['encode'+'URIComponent'](url))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (token !== hn_link_token) return;
      if (spinner) spinner.style['display'] = 'none';
      var fetched_title = data.title || '';
      var fetched_img = hnSafeUrl(data.image || '');
      if (body_el) body_el.style['display'] = 'block';
      if (title_el) {
        title_el.textContent = fetched_title;
        var title_inp = document.getElementById('hn-linktitle');
        if (title_inp && !title_inp.value && fetched_title) {
          title_inp.value = fetched_title;
          hn_link_title = fetched_title;
        }
      }
      if (url_el) url_el.textContent = url;
      hn_link_image = fetched_img;
      if (fetched_img && img_el) {
        img_el.src = fetched_img;
        img_el.style['display'] = 'block';
      }
    })
    .catch(function() {
      if (token !== hn_link_token) return;
      if (spinner) spinner.style['display'] = 'none';
      if (body_el) body_el.style['display'] = 'block';
      if (title_el) title_el.textContent = '';
      if (url_el) url_el.textContent = url;
    });
}

function hnLinkPreviewSetTitle(val) {
  var title_el = document.getElementById('hn-link-preview-title');
  if (title_el) title_el.textContent = val;
}

function hnClearLinkPreview() {
  var prev = document.getElementById('hn-link-preview');
  var img_el = document.getElementById('hn-link-preview-img');
  var body_el = document.getElementById('hn-link-preview-body');
  var title_el = document.getElementById('hn-link-preview-title');
  var url_el = document.getElementById('hn-link-preview-url');
  if (prev) prev.classList.remove('hn-vis');
  if (img_el) { img_el.removeAttribute('src'); img_el.style['display'] = 'none'; }
  if (body_el) body_el.style['display'] = 'none';
  if (title_el) title_el.textContent = '';
  if (url_el) url_el.textContent = '';
  hn_link_image = '';
  hn_link_token++;
}

/* ── ADMIN ── */
function hnAdminEditProfile(aid) {
  if (!hnIsAdmin()) return;
  if (!hnProfileById(aid)) return;
  hnOpenEditProfileFor(aid);
}

function hnAdminDeleteAccount(aid) {
  if (!hnIsAdmin()) return;
  var prof = hnProfileById(aid);
  if (!prof) return;
  if (!confirm('ADMIN: Eliminare l\'account di @' + prof.handle + '?\nQuesta azione è irreversibile.')) return;
  hn_fb_remove('hunternet/profiles/'+aid);
  hn_fb_remove('hunternet/credentials/'+aid);
  hn_fb_remove('hunternet/notifications/'+aid);
  hnCloseModal('prof');
  alert('Account @' + prof.handle + ' eliminato.');
}

/* ── ELIMINA ACCOUNT ── */
function hnConfirmDeleteAccount() {
  if (!hn_user) return;
  if (!confirm('Vuoi davvero eliminare il tuo account?\nQuesta azione è IRREVERSIBILE.\n\nVerranno eliminati: profilo, credenziali e notifiche.\nI tuoi post rimarranno visibili ma senza autore.')) return;
  var confirm2 = prompt('Scrivi il tuo nickname (@'+hn_user.handle+') per confermare:');
  if (!confirm2 || confirm2.trim().replace('@','') !== hn_user.handle) {
    alert('Nickname non corrispondente. Eliminazione annullata.');
    return;
  }
  hnDeleteAccount();
}

function hnDeleteAccount() {
  if (!hn_user) return;
  var uid = hn_user.id;
  var handle = hn_user.handle;
  var btn = document.querySelector('#hn-profcontent button[onclick*="hnConfirmDeleteAccount"]');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  var done = 0;
  function onDone() {
    done++;
    if (done < 3) return;
    hnCloseModal('prof');
    hnLogout();
    alert('Account eliminato. Ciao ' + handle + '!');
  }
  hnFbStopNotifs();
  hn_fb_ref('hunternet/profiles/'+uid).remove().then(onDone).catch(onDone);
  hn_fb_ref('hunternet/credentials/'+uid).remove().then(onDone).catch(onDone);
  hn_fb_ref('hunternet/notifications/'+uid).remove().then(onDone).catch(onDone);
}

/* ── MOOD ── */
var hn_post_mood = '';

function hnToggleMoodCompose() {
  var mc = document.getElementById('hn-mood-compose');
  if (!mc) return;
  if (mc.getAttribute('data-open') === '1') {
    hnClearMood();
  } else {
    mc.style['display'] = 'flex';
    mc.setAttribute('data-open', '1');
  }
}

function hnMoodSelect(val) {
  var preview = document.getElementById('hn-mood-preview');
  hn_post_mood = val;
  if (preview) preview.textContent = val ? ('Mood: ' + val) : '';
}

function hnClearMood() {
  hn_post_mood = '';
  var mc = document.getElementById('hn-mood-compose');
  var sel = document.getElementById('hn-mood-select');
  var preview = document.getElementById('hn-mood-preview');
  if (mc) { mc.style['display'] = 'none'; mc.setAttribute('data-open', '0'); }
  if (sel) sel.value = '';
  if (preview) preview.textContent = '';
}

/* ── EMOJI PICKER ── */
var hn_emoji_picker_el = null;
var hn_emoji_picker_open = false;

function hnEnsureEmojiPicker(wrap) {
  if (hn_emoji_picker_el) return true;
  if (typeof EmojiMart === 'undefined') {
    alert('Emoji picker non disponibile. Riprova tra un momento.');
    return false;
  }
  hn_emoji_picker_el = new EmojiMart.Picker({
    locale: 'it',
    theme: 'dark',
    set: 'native',
    onEmojiSelect: function(emoji) {
      if (hn_cedit_emoji_open) hnCEditInsertEmoji(emoji.native);
      else hnInsertEmoji(emoji.native);
      wrap.style['display'] = 'none';
      hn_emoji_picker_open = false;
      hn_cedit_emoji_open = false;
    },
    onClickOutside: function() {
      wrap.style['display'] = 'none';
      hn_emoji_picker_open = false;
      hn_cedit_emoji_open = false;
    }
  });
  wrap.appendChild(hn_emoji_picker_el);
  return true;
}

function hnInitEmojiPicker() {
  var btn = document.getElementById('hn-tbtn-emoji');
  if (btn) {
    btn.onclick = function(e) {
      e.stopPropagation();
      hnToggleEmojiPicker();
    };
  }
}

function hnToggleEmojiPicker() {
  var wrap = document.getElementById('hn-emoji-picker-wrap');
  if (!wrap) return;
  if (hn_emoji_picker_open) {
    wrap.style['display'] = 'none';
    hn_emoji_picker_open = false;
    return;
  }
  var btn = document.getElementById('hn-tbtn-emoji');
  if (btn) {
    var rect = btn.getBoundingClientRect();
    wrap.style['left'] = rect.left + 'px';
    wrap.style['top'] = (rect.bottom + 6) + 'px';
  }
  if (!hnEnsureEmojiPicker(wrap)) return;
  wrap.style['display'] = 'block';
  hn_emoji_picker_open = true;
  hn_cedit_emoji_open = false;
}

function hnInsertEmoji(emoji) {
  var ta = document.getElementById('hn-textarea');
  if (!ta) return;
  var start = ta.selectionStart;
  var end = ta.selectionEnd;
  ta.value = ta.value.substring(0, start) + emoji + ta.value.substring(end);
  var pos = start + emoji.length;
  ta.setSelectionRange(pos, pos);
  ta.focus();
  hnUpdateChar();
}

/* ── HELPER UI ── */
function hnShowErr(id, msg) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}
function hnHideErr(id) {
  var el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
function hnVerifiedBadge(prof) {
  if (!prof || !prof.verified) return '';
  return '<span class="mdi mdi-check-decagram" style="color:#5b9cf6!important;font-size:14px!important;vertical-align:middle!important;" title="Utente verificato"></span>';
}
function hnInitials(name) {
  if (!name) return '?';
  var parts = String(name).trim().split(/\s+/); var r = '';
  for (var i = 0; i < parts.length; i++) if (parts[i]) r += parts[i].charAt(0).toUpperCase();
  return r.slice(0,2) || '?';
}
function hnEsc(s) {
  if (!s) return '';
  s = String(s);
  var amp = '\u0026amp;', lt = '\u0026lt;', gt = '\u0026gt;', qt = '\u0026quot;';
  return s.split('\u0026').join(amp).split('<').join(lt).split('>').join(gt).split('"').join(qt);
}
function hnEscVal(s) {
  if (!s) return '';
  return String(s).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
}
function hnEscAttr(s) {
  if (!s) return '';
  return String(s).split('&').join('&amp;').split('"').join('&quot;').split("'").join('&#39;').split('<').join('&lt;').split('>').join('&gt;');
}
function hnAgo(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var diff = Date.now() - d.getTime();
  var m = Math.floor(diff/60000);
  var rel;
  if (m < 1) rel = 'adesso';
  else if (m < 60) rel = m+'m';
  else if (m < 1440) rel = Math.floor(m/60)+'h';
  else rel = Math.floor(m/1440)+'g';
  var pad = function(n){ return n < 10 ? '0'+n : ''+n; };
  var exact = pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+d.getFullYear()+' '+pad(d.getHours())+':'+pad(d.getMinutes());
  return '<span title="'+exact+'" style="cursor:default!important;">'+rel+'</span>';
}
function hnRankClass(rank) {
  if (!rank) return 'hn-rdef';
  if (rank.indexOf('\u2605\u2605\u2605') !== -1) return 'hn-r1';
  if (rank.indexOf('\u2605\u2605') !== -1) return 'hn-r2';
  if (rank.indexOf('\u2605') !== -1) return 'hn-r3';
  if (rank === 'Apprendista') return 'hn-rapp';
  if (rank === 'Lottatore Celeste') return 'hn-rlc';
  if (rank.indexOf('Hunter') !== -1) return 'hn-rpro';
  return 'hn-rdef';
}
function hnAvHtml(color, avatarUrl, name, cls, size) {
  var st = 'background:' + hnSafeColor(color) + ';';
  if (size) st += 'width:' + size + 'px;height:' + size + 'px;';
  var ini = hnEsc(hnInitials(name));
  var url = hnSafeUrl(avatarUrl);
  if (url) {
    return '<div class="' + cls + '" style="' + st + '"><img src="' + hnEsc(url) + '" alt="" data-i="' + ini + '" onerror="this.parentNode.textContent=this.getAttribute(\'data-i\')"></div>';
  }
  return '<div class="' + cls + '" style="' + st + '">' + ini + '</div>';
}

/* ── INIT ── */
function hnInit() {
  hnBuildHashtags();
  hnBuildColorPicker();
  document.getElementById('hn-mention-drop').style['display'] = 'none';
  document.getElementById('hn-tooltip').style['display'] = 'none';
  document.getElementById('hn-notif-drop').style['display'] = 'none';
  document.getElementById('hn-poll-compose').style['display'] = 'none';
  document.getElementById('hn-linkurl-row').style['display'] = 'none';
  document.getElementById('hn-bell-badge').style['display'] = 'none';
  var bar_btn = document.getElementById('hn-tbtn-bar');
  if (bar_btn) bar_btn.onclick = function() { hnApplyFormat('s'); };
  hnInitEmojiPicker();
  var mood_btn = document.getElementById('hn-tbtn-mood');
  if (mood_btn) mood_btn.onclick = function() { hnToggleMoodCompose(); };
  function hnAttachBrand() {
    var b = document.getElementById('hn-brand') || document.querySelector('.hn-brand');
    if (b) {
      b.onclick = function() { hnGoHome(); };
      b.style['cursor'] = 'pointer';
    }
  }
  hnAttachBrand();
  setTimeout(hnAttachBrand, 1000);
  setTimeout(hnAttachBrand, 3000);
  document.getElementById('hn-bar').style['z-index'] = '99';
  document.getElementById('hn-layout').style['margin'] = '0';
  document.getElementById('hn-layout').style['padding'] = '0';
  document.getElementById('hn-bar').style['display'] = 'flex';
  document.getElementById('hn-bar').style['justify-content'] = 'space-between';
  document.getElementById('hn-bar').style['text-align'] = 'left';
  document.getElementById('hn-lbanner').style['display'] = 'flex';
  document.getElementById('hn-lbanner').style['justify-content'] = 'space-between';
  document.getElementById('hn-lbanner').style['text-align'] = 'left';
  var mids = ['hn-modal-auth','hn-modal-reg','hn-modal-prof','hn-modal-share'];
  for (var i = 0; i < mids.length; i++) {
    var m = document.getElementById(mids[i]);
    if (m) m.style['z-index'] = '99999';
  }
  document.getElementById('hn-lightbox').style['z-index'] = '99999';
  var img_inp = document.getElementById('hn-imgurl');
  if (img_inp) img_inp.onkeydown = function(e) { if (e.key === 'Enter') { e.preventDefault(); hnAddDraftImage(false); } };
  hnRenderDraftThumbs();
  var posts_box = document.getElementById('hn-posts');
  if (posts_box) posts_box.addEventListener('scroll', hnMaybeAutoLoad, {passive:true});
  window.addEventListener('scroll', hnMaybeAutoLoad, {passive:true});
  hnFbInit(function() {
    hnRestoreSession();
    hnFbListenPosts();
    hnFbListenProfiles();
  });
}

function hnRestoreSession() {
  var s = null;
  try { s = sessionStorage.getItem('hn_user'); } catch(e) {}
  if (!s) return;
  try {
    var u = JSON.parse(s);
    if (u && u.id) hnLoginAs(u);
  } catch(e) {}
}

/* ── PASSWORD TOGGLE ── */
function hnTogglePw(inputId, btn) {
  var inp = document.getElementById(inputId);
  if (!inp) return;
  var isHidden = inp.type === 'password';
  inp.type = isHidden ? 'text' : 'password';
  var ico = btn.querySelector('svg');
  if (ico) {
    if (isHidden) {
      ico.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
    } else {
      ico.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
  }
}

/* ── AUTH ── */
function hnLoginAs(prof) {
  hn_user = prof;
  try { sessionStorage.setItem('hn_user', JSON.stringify(prof)); } catch(e) {}
  hnFbListenNotifs(prof.id);
  hnSetLoggedIn();
  hnUpdatePresence();
  if (hn_data_ready) hnRenderFeed();
}

function hnDoLogin() {
  hnHideErr('hn-lerr');
  var handle = document.getElementById('hn-lhandle').value.trim().toLowerCase().replace('@','');
  var pass   = document.getElementById('hn-lpass').value;
  if (!handle || !pass) return hnShowErr('hn-lerr','Compila tutti i campi.');
  var btn = document.querySelector('#hn-modal-auth .hn-dbtn');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  function reset() { if (btn) { btn.disabled = false; btn.textContent = 'Accedi'; } }
  hnFetchCreds(function(creds) {
    var cred = null;
    for (var i = 0; i < creds.length; i++) {
      if (String(creds[i].handle).toLowerCase() === handle) { cred = creds[i]; break; }
    }
    if (!cred) { reset(); return hnShowErr('hn-lerr','Nickname non trovato.'); }
    if (cred.password !== pass) { reset(); return hnShowErr('hn-lerr','Password non corretta.'); }
    hn_fb_get('hunternet/profiles/'+cred.id, function(prof) {
      reset();
      if (!prof) return hnShowErr('hn-lerr','Profilo non trovato. Contatta un admin.');
      if (!prof.id) prof.id = cred.id;
      prof.following = hnArr(prof.following);
      document.getElementById('hn-lpass').value = '';
      hnCloseModal('auth');
      hnLoginAs(prof);
    }, function() { reset(); hnShowErr('hn-lerr','Errore di connessione. Riprova.'); });
  }, function() { reset(); hnShowErr('hn-lerr','Errore di connessione. Riprova.'); });
}

function hnDoRegister() {
  hnHideErr('hn-rerr');
  var name   = document.getElementById('hn-rname').value.trim();
  var handle = document.getElementById('hn-rhandle').value.trim().replace('@','');
  var rank   = document.getElementById('hn-rrank').value;
  var bio    = document.getElementById('hn-rbio').value.trim();
  var avatar = hnNormUrl(document.getElementById('hn-ravatar').value);
  var pass   = document.getElementById('hn-rpass').value;
  if (!name || !handle || !rank || !pass) return hnShowErr('hn-rerr','Compila tutti i campi obbligatori.');
  if (handle.length < 3) return hnShowErr('hn-rerr','Nickname troppo corto (min 3 caratteri).');
  if (!/^[a-zA-Z0-9_]+$/.test(handle)) return hnShowErr('hn-rerr','Nickname: solo lettere, numeri e _.');
  if (hnGroupByHandle(handle)) return hnShowErr('hn-rerr','Questo nickname è riservato.');
  if (pass.length < 4) return hnShowErr('hn-rerr','La password deve essere di almeno 4 caratteri.');
  var btn = document.querySelector('#hn-modal-reg .hn-dbtn');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  function reset() { if (btn) { btn.disabled = false; btn.textContent = 'Crea Profilo'; } }

  hnFetchCreds(function(creds) {
    for (var i = 0; i < creds.length; i++) {
      if (String(creds[i].handle).toLowerCase() === handle.toLowerCase()) { reset(); return hnShowErr('hn-rerr','Nickname già in uso.'); }
    }
    var id = String(Date.now());
    var newProf = { id:id, name:name, handle:handle, rank:rank, bio:bio,
      color:hn_sel_color, avatar:avatar||'', createdAt:new Date().toISOString() };
    var saved = 0, errored = false;
    function onSaved() {
      saved++;
      if (saved < 2) return;
      reset();
      if (errored) {
        hn_fb_remove('hunternet/profiles/'+id);
        hn_fb_remove('hunternet/credentials/'+id);
        hnShowErr('hn-rerr','Errore durante la registrazione. Riprova.');
        return;
      }
      document.getElementById('hn-rpass').value = '';
      hnCloseModal('reg');
      hnLoginAs(newProf);
    }
    function onErr() { errored = true; onSaved(); }
    hn_fb_set('hunternet/credentials/'+id, {id:id, handle:handle, password:pass}, onSaved, onErr);
    hn_fb_set('hunternet/profiles/'+id, newProf, onSaved, onErr);
  }, function() { reset(); hnShowErr('hn-rerr','Errore di connessione. Riprova.'); });
}

function hnRenderComposeAvatar() {
  if (!hn_user) return;
  var av = document.getElementById('hn-cav');
  if (!av) return;
  av.style.background = hnSafeColor(hn_user.color);
  var url = hnSafeUrl(hn_user.avatar);
  if (url) av.innerHTML = '<img src="' + hnEsc(url) + '" alt="" onerror="this.style.display=\'none\'">';
  else av.textContent = hnInitials(hn_user.name);
}

function hnRenderUserBar() {
  if (!hn_user) return;
  var br = document.getElementById('hn-bar-right');
  if (!br) return;
  var avHtml = hnAvHtml(hn_user.color, hn_user.avatar, hn_user.name, 'hn-miniav', null);
  var my_dot = '<span style="position:absolute!important;bottom:0!important;right:0!important;width:8px!important;height:8px!important;border-radius:50%!important;background:#5cb878!important;border:1px solid #252932!important;"></span>';
  br.innerHTML = '<div id="hn-upill" onclick="hnOpenProfile(\'' + hn_user.id + '\')">' +
    '<div style="position:relative!important;display:inline-block!important;">' + avHtml + my_dot + '</div>' +
    '<span class="hn-pillname">@' + hnEsc(hn_user.handle) + '</span></div>' +
    '<button class="hn-gbtn" onclick="hnLogout()">Esci</button>';
}

function hnSetLoggedIn() {
  document.getElementById('hn-lbanner').style['display'] = 'none';
  document.getElementById('hn-compose').classList.add('hn-vis');
  hnBellShow();
  var followTab = document.getElementById('hn-tab-following');
  if (followTab) followTab.style['display'] = 'inline-block';
  hnRenderComposeAvatar();
  hnRenderUserBar();
}

function hnLogout() {
  hn_user = null;
  try { sessionStorage.removeItem('hn_user'); } catch(e) {}
  hnFbStopNotifs();
  document.getElementById('hn-lbanner').style['display'] = 'flex';
  document.getElementById('hn-compose').classList.remove('hn-vis');
  document.getElementById('hn-bar-right').innerHTML =
    '<button class="hn-gbtn" onclick="hnOpenModal(\'auth\')">Accedi</button>' +
    '<button class="hn-dbtn" onclick="hnOpenModal(\'reg\')">Registrati</button>';
  hnBellHide();
  var followTab = document.getElementById('hn-tab-following');
  if (followTab) followTab.style['display'] = 'none';
  if (hn_tab_cur === 'following') hnResetView();
  if (hn_data_ready) hnRenderFeed();
}

/* ── AVATAR PREVIEW ── */
function hnPreviewAvatar() {
  var url = hnNormUrl(document.getElementById('hn-ravatar').value);
  var prev = document.getElementById('hn-av-preview');
  prev.style.background = hn_sel_color;
  if (url) {
    prev.innerHTML = '<img src="'+hnEsc(url)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentNode.textContent=\'?\'">';
  } else {
    prev.textContent = hnInitials(document.getElementById('hn-rname').value) || '?';
  }
}

/* ── FORMATTAZIONE TESTO ── */
function hnUnescHtml(s) {
  return s.split('&quot;').join('"').split('&lt;').join('<').split('&gt;').join('>').split('&amp;').join('&');
}
function hnFormatText(text) {
  if (!text) return '';
  var t = String(text).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');
  var links = [];
  t = t.replace(/(?:https?:\/\/|www\.)[^\s<>"\[\]]+/gi, function(m) {
    var trail = '';
    var cut = m.search(/&(?:lt|gt|quot);/);
    if (cut !== -1) { trail = m.slice(cut); m = m.slice(0, cut); }
    while (m.length && /[.,;:!?)'*]$/.test(m) && !/&[a-z]+;$/.test(m)) { trail = m.slice(-1) + trail; m = m.slice(0, -1); }
    if (!m || /^(?:https?:\/\/|www\.)$/i.test(m)) return m + trail;
    var href = /^www\./i.test(m) ? 'https://' + m : m;
    var plain = hnUnescHtml(m).replace(/^https?:\/\//i, '');
    if (plain.length > 45) plain = plain.slice(0, 42) + '\u2026';
    links.push('<a href="'+href+'" target="_blank" rel="noopener" class="hn-tlink" onclick="event.stopPropagation()">'+hnEsc(plain)+'</a>');
    return '\u0001' + (links.length - 1) + '\u0001' + trail;
  });
  t = hnBBReplace(t, 'b', 'hn-fmt-b');
  t = hnBBReplace(t, 'i', 'hn-fmt-i');
  t = hnBBReplace(t, 'u', 'hn-fmt-u');
  t = hnBBReplace(t, 'bar', 'hn-fmt-s');
  t = t.replace(HN_TAG_RE, function(tag) {
    return '<span class="hn-hi" style="cursor:pointer!important;" onclick="event.stopPropagation();hnFilterTag(\'' + tag + '\')">' + tag + '</span>';
  });
  t = t.replace(/@([a-zA-Z0-9_]+)/g, function(match, handle) {
    if (hnGroupByHandle(handle)) return '<span class="hn-mention">@' + handle + '</span>';
    var prof = hnProfileByHandle(handle);
    if (prof) return '<span class="hn-mention" onclick="event.stopPropagation();hnOpenProfile(\'' + prof.id + '\')">@' + handle + '</span>';
    return match;
  });
  t = t.replace(/\u0001(\d+)\u0001/g, function(m, i) { return links[+i] || ''; });
  return t.split('\n').join('<br>');
}

function hnBBReplace(t, tag, cls) {
  var open = '[' + tag + ']';
  var close = '[/' + tag + ']';
  var result = '';
  var pos = 0;
  while (pos < t.length) {
    var start = t.indexOf(open, pos);
    if (start === -1) { result += t.substring(pos); break; }
    var end = t.indexOf(close, start + open.length);
    if (end === -1) { result += t.substring(pos); break; }
    result += t.substring(pos, start);
    result += '<span class="' + cls + '">' + t.substring(start + open.length, end) + '</span>';
    pos = end + close.length;
  }
  return result;
}

function hnRenderCommentMedia(item) {
  return hnSmallMediaHtml(item.imgUrl, 200) + hnLinkCardHtml(item.linkUrl, item.linkTitle, item.linkImage, true);
}

/* ── COMPOSE ── */
function hnApplyFormat(fmt) {
  var ta = document.getElementById('hn-textarea');
  if (!ta) return;
  var start = ta.selectionStart;
  var end = ta.selectionEnd;
  var sel = ta.value.substring(start, end);
  var before = ta.value.substring(0, start);
  var after = ta.value.substring(end);
  var open_tag = fmt === 's' ? '[bar]' : '[' + fmt + ']';
  var close_tag = fmt === 's' ? '[/bar]' : '[/' + fmt + ']';
  ta.value = before + open_tag + sel + close_tag + after;
  if (sel) {
    ta.setSelectionRange(start + open_tag.length, start + open_tag.length + sel.length);
  } else {
    var cursor = start + open_tag.length;
    ta.setSelectionRange(cursor, cursor);
  }
  ta.focus();
  hnUpdateChar();
}

function hnBuildHashtags() {
  var counts = {};
  for (var i = 0; i < hn_posts.length; i++) {
    var tags = hnTagsOf(hn_posts[i].text);
    for (var j = 0; j < tags.length; j++) {
      if (tags[j] !== '#notizie') counts[tags[j]] = (counts[tags[j]] || 0) + 1;
    }
  }
  var sorted = [];
  for (var k in counts) sorted.push([k, counts[k]]);
  sorted.sort(function(a,b){ return b[1]-a[1]; });
  var dynamic = [];
  for (var d = 0; d < sorted.length && dynamic.length < 9; d++) dynamic.push(sorted[d][0]);
  var allTags = ['#notizie'].concat(dynamic);
  var html = '';
  for (var ti = 0; ti < allTags.length; ti++)
    html += '<button class="hn-htag" onclick="hnInsertTag(\''+allTags[ti]+'\')">'+allTags[ti]+'</button>';
  var row = document.getElementById('hn-hrow');
  if (row && row._hnHtml !== html) { row.innerHTML = html; row._hnHtml = html; }
}
function hnInsertTag(tag) {
  var ta = document.getElementById('hn-textarea');
  var v = ta.value;
  ta.value = v + (v && v.charAt(v.length-1) !== ' ' ? ' ' : '') + tag + ' ';
  ta.focus(); hnUpdateChar();
}
function hnUpdateChar() {
  var ta = document.getElementById('hn-textarea');
  var rem = 280 - ta.value.length;
  var cc = document.getElementById('hn-chars');
  cc.textContent = rem;
  cc.className = rem < 20 ? 'hn-warn' : '';
  document.getElementById('hn-postbtn').disabled = ta.value.trim().length === 0 || ta.value.length > 280;
}
function hnToggleImgRow() {
  var row = document.getElementById('hn-imgurl-row');
  if (row.classList.contains('hn-vis')) hnClearImg();
  else { row.classList.add('hn-vis'); var i = document.getElementById('hn-imgurl'); if (i) i.focus(); }
}
function hnClearImg() {
  document.getElementById('hn-imgurl').value = '';
  document.getElementById('hn-imgurl-row').classList.remove('hn-vis');
  hn_draft_images = [];
  hnRenderDraftThumbs();
}
function hnAddDraftImage(silent) {
  var inp = document.getElementById('hn-imgurl');
  if (!inp) return true;
  var raw = inp.value.trim();
  if (!raw) return true;
  var url = hnNormUrl(raw);
  if (!url) { if (!silent) alert('Inserisci un indirizzo valido (deve iniziare con http:// o https://).'); return false; }
  if (hn_draft_images.length >= HN_MAX_IMAGES) { if (!silent) alert('Puoi aggiungere al massimo '+HN_MAX_IMAGES+' contenuti per post.'); return false; }
  if (hn_draft_images.indexOf(url) === -1) hn_draft_images.push(url);
  inp.value = '';
  hnRenderDraftThumbs();
  return true;
}
function hnRemoveDraftImage(i) {
  hn_draft_images.splice(i, 1);
  hnRenderDraftThumbs();
}
function hnRenderDraftThumbs() {
  var box = document.getElementById('hn-imgthumbs');
  if (!box) return;
  var html = '';
  for (var i=0;i<hn_draft_images.length;i++) {
    var u = hn_draft_images[i], yt = hnYtId(u);
    var src = yt ? 'https://i.ytimg.com/vi/'+yt+'/default.jpg' : u;
    html += '<div class="hn-imgthumb" title="'+hnEsc(u)+'"><img src="'+hnEsc(src)+'" alt="" onerror="this.style.visibility=\'hidden\'">'+
      '<button type="button" onclick="hnRemoveDraftImage('+i+')" title="Rimuovi">&#10005;</button></div>';
  }
  box.innerHTML = html;
  var inp = document.getElementById('hn-imgurl');
  if (inp) inp.placeholder = hn_draft_images.length >= HN_MAX_IMAGES ? 'Limite di '+HN_MAX_IMAGES+' raggiunto' : 'URL immagine, GIF o YouTube (fino a '+HN_MAX_IMAGES+')...';
}

function hnResetCompose() {
  var ta = document.getElementById('hn-textarea');
  if (ta) ta.value = '';
  hnClearImg();
  hnClearMood();
  hn_poll_options = [];
  hn_poll_deadline_val = '';
  var pc = document.getElementById('hn-poll-compose');
  if (pc) { pc.style['display'] = 'none'; pc.innerHTML = ''; }
  hn_link_url = ''; hn_link_title = '';
  var lr = document.getElementById('hn-linkurl-row'); if (lr) lr.style['display'] = 'none';
  var li = document.getElementById('hn-linkurl'); if (li) li.value = '';
  var lt = document.getElementById('hn-linktitle'); if (lt) lt.value = '';
  hnClearLinkPreview();
  hnUpdateChar();
}

function hnSubmitPost() {
  if (!hn_user) return;
  var ta   = document.getElementById('hn-textarea');
  var text = ta.value.trim();
  if (!text) return;
  if (ta.value.length > 280) { alert('Il post supera il limite di 280 caratteri.'); return; }
  if (!hnAddDraftImage(false)) return;
  var images = hn_draft_images.slice();
  var link_inp = document.getElementById('hn-linkurl');
  var link_url = hnNormUrl(link_inp ? link_inp.value : '');
  var link_title_inp = document.getElementById('hn-linktitle');
  var link_title = link_title_inp ? link_title_inp.value.trim() : '';
  var poll_data = null;
  if (hn_poll_options.length >= 2) {
    var valid_opts = [];
    for (var pi=0;pi<hn_poll_options.length;pi++) {
      var sync_inp = document.getElementById('hn-poll-opt-'+pi);
      var opt_val = sync_inp ? sync_inp.value.trim() : String(hn_poll_options[pi]).trim();
      if (opt_val) valid_opts.push({text:opt_val, votes:[]});
    }
    var dl_inp = document.getElementById('hn-poll-deadline');
    var deadline = dl_inp && dl_inp.value ? new Date(dl_inp.value) : null;
    if (deadline && deadline <= new Date()) { alert('La scadenza del sondaggio deve essere nel futuro.'); return; }
    if (valid_opts.length >= 2) poll_data = {options: valid_opts, deadline: deadline ? deadline.toISOString() : null, closed: false, notified: false};
  }
  var btn = document.getElementById('hn-postbtn');
  btn.disabled = true; btn.textContent = '...';
  var post = { id:hnUid(), authorId:hn_user.id, authorName:hn_user.name,
    authorHandle:hn_user.handle, authorColor:hn_user.color, authorAvatar:hn_user.avatar||'',
    authorRank:hn_user.rank, text:text, imgUrl:images[0]||'', images:images.length > 1 ? images : [],
    likes:[], dislikes:[], comments:[], poll:poll_data,
    linkUrl:link_url||'', linkTitle:link_url ? link_title : '', linkImage:link_url ? (hn_link_image||'') : '',
    mood:hn_post_mood||'', createdAt:new Date().toISOString() };
  hnSavePost_fb(post,
    function(){
      btn.textContent='Pubblica';
      hnResetCompose();
      hnNotifMentionsAll(text, post.id, text, null, '');
    },
    function(){ alert('Errore durante la pubblicazione.'); btn.disabled=false; btn.textContent='Pubblica'; }
  );
}

/* ── FEED ── */
function hnTab(tab, el) {
  hn_tab_cur = tab;
  hn_filter_user_id = null;
  hn_filter_tag = '';
  hn_single_pid = null;
  hnStopUserPosts();
  hnClearSearchInput();
  hnHideFilterChip();
  hnSetActiveTab(el);
  if (hn_data_ready) hnRenderFeed();
}

function hnFiltered() {
  var out = [];
  if (hn_tab_cur === 'single' && !hn_search_query) {
    var one = hnGetPostById(hn_single_pid);
    return one ? [one] : [];
  }
  if (hn_tab_cur === 'user' && hn_user_posts && !hn_search_query) return hn_user_posts.slice();
  if (hn_search_query) {
    var q = hn_search_query;
    for (var s = 0; s < hn_posts.length; s++) {
      var sp = hn_posts[s];
      var sa = hnAuthorOf(sp);
      if (sp.text.toLowerCase().indexOf(q) !== -1 ||
          String(sa.name).toLowerCase().indexOf(q) !== -1 ||
          String(sa.handle).toLowerCase().indexOf(q) !== -1) out.push(sp);
    }
    return out;
  }
  var following = [];
  if (hn_tab_cur === 'following' && hn_user) {
    var my_prof = hnProfileById(hn_user.id);
    following = my_prof ? hnArr(my_prof.following) : [];
  }
  for (var i = 0; i < hn_posts.length; i++) {
    var p = hn_posts[i];
    if (hn_tab_cur === 'hunters') {
      var rank = hnAuthorOf(p).rank;
      if (!rank || rank.indexOf('Hunter') === -1) continue;
    }
    if (hn_tab_cur === 'news' && hnTagsOf(p.text).indexOf('#notizie') === -1) continue;
    if (hn_tab_cur === 'following' && following.indexOf(p.authorId) === -1) continue;
    if (hn_tab_cur === 'user' && hn_filter_user_id && p.authorId !== hn_filter_user_id) continue;
    if (hn_tab_cur === 'tag' && hn_filter_tag && hnTagsOf(p.text).indexOf(hn_filter_tag) === -1) continue;
    out.push(p);
  }
  return out;
}

function hnEmptyMsg() {
  if (hn_search_query) return 'Nessun risultato per "'+hnEsc(hn_search_query)+'"'+(hn_has_more ? ' tra i post caricati.' : '.');
  if (hn_tab_cur === 'single') return 'Questo post non è più disponibile.';
  if (hn_tab_cur === 'user' && !hn_user_posts) return '<div class="hn-spin"></div>';
  if (hn_tab_cur === 'tag') return 'Nessun post con questo tag.';
  if (hn_tab_cur === 'user') return 'Questo utente non ha ancora postato.';
  if (hn_tab_cur === 'following') return 'Chi segui non ha ancora postato.';
  return 'Nessun post ancora. Sii il primo a scrivere!';
}

function hnFilterUser(aid) {
  var prof = hnProfileById(aid);
  hnClearSearchInput();
  hn_tab_cur = 'user';
  hn_filter_user_id = aid;
  hn_filter_tag = '';
  hn_single_pid = null;
  hnStartUserPosts(aid);
  hnShowFilterChip(prof ? prof.name : 'Utente');
  if (hn_data_ready) hnRenderFeed();
  document.getElementById('hn-posts').scrollTop = 0;
}

function hnFilterTag(tag) {
  hnCloseModal('prof');
  hnClearSearchInput();
  hn_tab_cur = 'tag';
  hn_filter_tag = String(tag).toLowerCase();
  hn_filter_user_id = null;
  hn_single_pid = null;
  hnStopUserPosts();
  hnShowFilterChip(hn_filter_tag);
  if (hn_data_ready) hnRenderFeed();
  document.getElementById('hn-posts').scrollTop = 0;
}

function hnFixLayout() {
  var els = ['hn-layout','hn-feed','hn-posts'];
  for (var i=0;i<els.length;i++) {
    var el = document.getElementById(els[i]);
    if (!el) continue;
    el.style['margin'] = '0';
    el.style['padding'] = '0';
    el.style['width'] = '100%';
    el.style['box-sizing'] = 'border-box';
  }
  var layout = document.getElementById('hn-layout');
  if (layout && !(document.body && document.body.classList.contains('ffm'))) {
    layout.style['display'] = 'grid';
    layout.style['grid-template-columns'] = 'minmax(0,1fr) 281px';
  }
  var feed = document.getElementById('hn-feed');
  if (feed) {
    feed.style['min-width'] = '0';
    feed.style['overflow'] = 'hidden';
  }
}

/* Il feed viene aggiornato pezzo per pezzo: si ridisegna solo la parte del post che è cambiata.
   Così un video in un post non si ricarica quando qualcuno interagisce con altri post (o con lo stesso). */
function hnRenderFeed() {
  hnFixLayout();
  var list = document.getElementById('hn-posts');
  if (!list) return;
  if (!hn_data_ready) {
    list.innerHTML = '<div class="hn-msg"><div class="hn-spin"></div></div>';
    list._hnKeyed = false;
    return;
  }
  var fp = hnFiltered();
  if (!fp.length) {
    list.innerHTML = '<div class="hn-msg">'+hnEmptyMsg()+'</div>';
    list._hnKeyed = false;
    hnRenderMoreBtn(list);
    return;
  }
  if (!list._hnKeyed) { list.innerHTML = ''; list._hnKeyed = true; }

  var wanted = {}, i;
  for (i = 0; i < fp.length; i++) wanted[fp[i].id] = true;
  var existing = {};
  for (i = list.children.length - 1; i >= 0; i--) {
    var ch = list.children[i];
    if (ch.id === 'hn-more') continue;
    if (!ch._hnPid || !wanted[ch._hnPid]) list.removeChild(ch);
    else existing[ch._hnPid] = ch;
  }

  var tmp = document.createElement('div');
  var prev = null;
  for (i = 0; i < fp.length; i++) {
    var p = fp[i];
    var parts = hnRenderPostParts(p);
    var el = existing[p.id];
    if (el) {
      hnPatchPost(el, parts);
    } else {
      tmp.innerHTML = hnPostShell(p, parts);
      el = tmp.firstChild;
      el._hnPid = p.id;
      el._hnParts = parts;
    }
    var want = prev ? prev.nextSibling : list.firstChild;
    if (want !== el) list.insertBefore(el, want);
    prev = el;
  }
  hnRenderMoreBtn(list);
  hnAttachMentionListeners();
}

function hnRenderMoreBtn(list) {
  var more = document.getElementById('hn-more');
  var show = hn_has_more && hn_tab_cur !== 'single' && !(hn_tab_cur === 'user' && hn_user_posts && !hn_search_query);
  if (!show) { if (more && more.parentNode) more.parentNode.removeChild(more); return; }
  if (!more) { more = document.createElement('div'); more.id = 'hn-more'; more.className = 'hn-more'; }
  var html = hn_loading_more ? '<div class="hn-spin"></div>' : '<button class="hn-gbtn" onclick="hnLoadMore()">Carica altri post</button>';
  if (more._hnHtml !== html) { more.innerHTML = html; more._hnHtml = html; }
  if (list.lastChild !== more) list.appendChild(more);
}

function hnPatchPost(el, parts) {
  var cache = el._hnParts || {};
  var tmp = document.createElement('div');
  for (var k in parts) {
    if (cache[k] === parts[k]) continue;
    if (el._hnEditing && (k === 'text' || k === 'comments')) continue;
    var old = el.querySelector('[data-hnpart="'+k+'"]');
    tmp.innerHTML = parts[k];
    var nn = tmp.firstChild;
    if (old && nn) old.parentNode.replaceChild(nn, old);
    cache[k] = parts[k];
  }
  el._hnParts = cache;
}

function hnPostShell(p, parts) {
  return '<div class="hn-post" id="hn-p-'+p.id+'"><div class="hn-phead">'+parts.avatar+
    '<div class="hn-pbody">'+parts.meta+parts.text+parts.mood+parts.media+parts.shared+parts.poll+parts.actions+parts.comments+'</div>'+
    '</div></div>';
}

function hnAttachMentionListeners() {
  var container = document.getElementById('hn-posts');
  if (!container || container._cedit_listener) return;
  container._cedit_listener = true;
  container.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el !== container) {
      if (el.getAttribute && el.getAttribute('data-cedit')) {
        var mode = el.getAttribute('data-cedit');
        var pid  = el.getAttribute('data-pid');
        var cid  = el.getAttribute('data-cid');
        var title = mode === 'comment' ? 'Commenta' : 'Rispondi';
        var ph    = mode === 'comment' ? 'Scrivi un commento...' : 'Scrivi una risposta...';
        hnCEditOpen(mode, pid, cid || null, ph, title);
        e.stopPropagation();
        return;
      }
      el = el.parentNode;
    }
  });
}

function hnRenderPostParts(p) {
  var parts = {};
  var a = hnAuthorOf(p);
  var uid = hn_user ? hn_user.id : null;

  /* avatar */
  var dot = '';
  if (a.prof) {
    dot = '<span style="position:absolute!important;bottom:0!important;right:0!important;width:13px!important;height:13px!important;border-radius:50%!important;background:'+(hnIsOnline(a.prof)?'#5cb878':'#5b6577')+'!important;border:2px solid #252932!important;display:block!important;"></span>';
  }
  var av = a.deleted ? '<div class="hn-av" style="background:#5b6577!important;flex-shrink:0!important;">?</div>' : hnAvHtml(a.color, a.avatar, a.name, 'hn-av', null);
  parts.avatar = '<div data-hnpart="avatar" style="position:relative!important;flex-shrink:0!important;">'+av+dot+'</div>';

  /* intestazione */
  var ownerActions = hnCanModerate(p.authorId) ?
    '<div class="hn-owner-actions">'+
    '<button class="hn-edit-btn" onclick="hnEditPost(\''+p.id+'\')">Modifica</button>'+
    '<button class="hn-del-btn" onclick="hnDeletePost(\''+p.id+'\')">Elimina</button>'+
    '</div>' : '';
  parts.meta = '<div class="hn-pmeta" data-hnpart="meta">'+
    (a.deleted ?
      '<span class="hn-pname" style="color:#5b6577!important;cursor:default!important;">Utente Cancellato</span>' :
      '<span class="hn-pname" onclick="hnOpenProfile(\''+a.id+'\')">'+hnEsc(a.name)+'</span>'+hnVerifiedBadge(a.prof)+
      '<span class="hn-phandle">@'+hnEsc(a.handle)+'</span>'+
      (a.rank ? '<span class="hn-rank '+hnRankClass(a.rank)+'">'+hnEsc(a.rank)+'</span>' : ''))+
    '<span class="hn-ptime">'+hnAgo(p.createdAt)+'</span>'+(p.edited ? '<span class="hn-edited">· modificato</span>' : '')+ownerActions+
    '</div>';

  /* testo */
  parts.text = p.text ?
    '<div class="hn-ptext" id="hn-pt-'+p.id+'" data-hnpart="text">'+hnFormatText(p.text)+'</div>' :
    '<div id="hn-pt-'+p.id+'" data-hnpart="text"></div>';

  /* mood */
  parts.mood = p.mood ?
    '<div class="hn-post-mood" data-hnpart="mood"><strong style="color:#5b9cf6!important;">Mood:</strong> '+hnEsc(p.mood)+'</div>' :
    '<div data-hnpart="mood"></div>';

  /* media e link */
  parts.media = '<div data-hnpart="media">'+hnPostMediaHtml(p)+hnLinkCardHtml(p.linkUrl, p.linkTitle, p.linkImage, false, p.linkDisplay)+'</div>';

  /* post condiviso */
  parts.shared = '<div data-hnpart="shared">'+hnSharedHtml(p)+'</div>';

  /* sondaggio */
  parts.poll = '<div data-hnpart="poll">'+hnPollHtml(p)+'</div>';

  /* azioni */
  var liked = !!uid && p.likes.indexOf(uid) !== -1;
  var disliked = !!uid && p.dislikes.indexOf(uid) !== -1;
  parts.actions = '<div class="hn-pactions" data-hnpart="actions">'+
    '<button class="'+(liked?'hn-abtn hn-liked':'hn-abtn')+'" onclick="hnToggleLike(\''+p.id+'\')" onmouseenter="hnShowTooltip(event,\''+p.id+'\',\'likes\')" onmouseleave="hnHideTooltip()">'+
    '<svg viewBox="0 0 24 24" fill="'+(liked?'currentColor':'none')+'" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>'+p.likes.length+'</button>'+
    (hn_user ? '<button class="'+(disliked?'hn-abtn hn-disliked':'hn-abtn')+'" onclick="hnToggleDislike(\''+p.id+'\')" onmouseenter="hnShowTooltip(event,\''+p.id+'\',\'dislikes\')" onmouseleave="hnHideTooltip()">'+
      '<svg viewBox="0 0 24 24" fill="'+(disliked?'currentColor':'none')+'" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>'+p.dislikes.length+'</button>' : '')+
    '<button class="hn-abtn" onclick="hnToggleComments(\''+p.id+'\')">'+
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'+p.comments.length+'</button>'+
    (hn_user ? '<button class="hn-abtn" onclick="hnOpenShare(\''+p.id+'\')" onmouseenter="hnShowTooltip(event,\''+p.id+'\',\'shares\')" onmouseleave="hnHideTooltip()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'+hnShareCount(p.id)+'</button>' : '')+
    '</div>';

  /* commenti */
  var cf = hn_user ? '<div class="hn-ccompose"><input type="text" placeholder="Rispondi..." id="hn-ci-'+p.id+'" readonly data-cedit="comment" data-pid="'+p.id+'" style="cursor:pointer!important;"><button class="hn-csend" data-cedit="comment" data-pid="'+p.id+'">Commenta</button></div>' : '';
  parts.comments = '<div class="hn-comments'+(hn_open_comments[p.id]?' hn-open':'')+'" id="hn-cs-'+p.id+'" data-hnpart="comments">'+hnRenderComments(p)+cf+'</div>';

  return parts;
}

function hnSharedHtml(p) {
  if (!p.sharedPost) return '';
  var sp = p.sharedPost;
  var live = hnPostKnown(sp.id);
  if (live === null) {
    return '<div class="hn-shared-preview" style="cursor:default!important;"><div class="hn-shared-removed">Il post originale non è più disponibile.</div></div>';
  }
  var src, a;
  if (live) { src = live; a = hnAuthorOf(live); }
  else {
    hnEnsurePost(sp.id);
    src = {id:sp.id, text:sp.text, imgUrl:sp.imgUrl, images:sp.images, linkUrl:sp.linkUrl, linkTitle:sp.linkTitle, linkImage:sp.linkImage, linkDisplay:sp.linkDisplay};
    a = hnAuthorOf({authorId:sp.authorId, authorName:sp.authorName, authorHandle:sp.authorHandle});
  }
  var nested = '';
  if (live && live.sharedPost) {
    var inner = hnGetPostById(live.sharedPost.id);
    var innerName = inner ? hnAuthorOf(inner).name : (live.sharedPost.authorName || '');
    nested = '<div class="hn-shared-meta">&#8618; Condivide un post'+(innerName ? ' di '+hnEsc(innerName) : '')+'</div>';
  }
  var media = hnMediaList(src);
  var extra = media.length > 1 ? '<div class="hn-shared-meta">&#128247; +'+(media.length-1)+' '+(media.length === 2 ? 'altro contenuto' : 'altri contenuti')+'</div>' : '';
  return '<div class="hn-shared-preview" onclick="hnSharedClick(event,\''+sp.id+'\')" title="Apri il post originale">'+
    '<div class="hn-shared-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> Post originale'+(live ? ' · '+hnAgo(live.createdAt) : '')+'</div>'+
    '<div class="hn-shared-author">'+(a.deleted ? 'Utente Cancellato' : hnEsc(a.name)+' <span style="color:#5b6577!important;">@'+hnEsc(a.handle)+'</span>')+'</div>'+
    (src.text ? '<div class="hn-shared-text">'+hnFormatText(src.text)+'</div>' : '')+
    hnSmallMediaHtml(media[0], 180)+extra+
    hnLinkCardHtml(src.linkUrl, src.linkTitle, src.linkImage, true, src.linkDisplay)+
    (live && live.poll ? '<div class="hn-shared-meta">&#128202; Contiene un sondaggio</div>' : '')+
    nested+
    '</div>';
}

function hnPollHtml(p) {
  if (!p.poll || !p.poll.options.length) return '';
  var opts = p.poll.options;
  var total_votes = 0, pi;
  for (pi = 0; pi < opts.length; pi++) total_votes += opts[pi].votes.length;
  var is_closed = hnPollClosed(p.poll);
  var html = '<div class="hn-poll">';
  if (p.poll.deadline) {
    var dl = new Date(p.poll.deadline);
    var dl_str = is_closed ? 'Sondaggio chiuso' : 'Scade: ' + dl.toLocaleDateString('it-IT') + ' ' + dl.getHours() + ':' + (dl.getMinutes()<10?'0':'')+dl.getMinutes();
    html += '<div style="font-size:10px!important;color:#5b6577!important;padding:4px 12px!important;border-bottom:1px solid #313846!important;">' + dl_str + '</div>';
  } else if (is_closed) {
    html += '<div style="font-size:10px!important;color:#5b6577!important;padding:4px 12px!important;border-bottom:1px solid #313846!important;">Sondaggio chiuso</div>';
  }
  for (pi = 0; pi < opts.length; pi++) {
    var opt = opts[pi];
    var pct = total_votes > 0 ? Math.round(opt.votes.length/total_votes*100) : 0;
    var user_voted = hn_user && opt.votes.indexOf(hn_user.id) !== -1;
    html += '<div class="hn-poll-option'+(user_voted?' hn-poll-voted':'')+'" '+(is_closed?'style="cursor:default!important;"':'onclick="hnVotePoll(\''+p.id+'\','+pi+')"')+'>'+
      '<div class="hn-poll-bar" style="width:'+pct+'%!important;"></div>'+
      '<div class="hn-poll-label">'+hnEsc(opt.text)+'</div>'+
      '<div class="hn-poll-pct">'+pct+'%</div></div>';
  }
  html += '<div class="hn-poll-total">'+total_votes+' vot'+(total_votes===1?'o':'i')+'</div></div>';
  return html;
}

function hnNameHtml(a, cls) {
  if (a.deleted) return '<span class="'+cls+'" style="color:#5b6577!important;">Utente Cancellato</span>';
  return '<span class="'+cls+'" style="cursor:pointer!important;" onclick="hnOpenProfile(\''+a.id+'\')">'+hnEsc(a.name)+hnVerifiedBadge(a.prof)+'</span>';
}

function hnRenderComments(p) {
  var html = '';
  var cl = p.comments;
  var shown = hn_comments_shown[p.id] || 3;
  var total = cl.length;
  var limit = Math.min(shown, total);
  for (var ci = 0; ci < limit; ci++) {
    var c = cl[ci];
    var key = p.id + '_' + c.id;
    var ca = hnAuthorOf(c);
    var replies = c.replies || [];
    var repliesHtml = '';
    for (var ri = 0; ri < replies.length; ri++) {
      var r = replies[ri];
      var rkey = key + '_' + r.id;
      var ra = hnAuthorOf(r);
      var replyOwnerHtml = hnCanModerate(r.authorId) ?
        '<div class="hn-owner-actions" style="margin-top:2px!important;">'+
        '<button class="hn-edit-btn" onclick="hnEditReply(\''+p.id+'\',\''+c.id+'\',\''+r.id+'\')">Modifica</button>'+
        '<button class="hn-del-btn" onclick="hnDeleteReply(\''+p.id+'\',\''+c.id+'\',\''+r.id+'\')">Elimina</button>'+
        '</div>' : '';
      repliesHtml += '<div class="hn-ritem" id="hn-rid-'+rkey+'">'+hnAvHtml(ra.color,ra.avatar,ra.name,'hn-rav',null)+
        '<div class="hn-rbody"><div class="hn-rmeta">'+hnNameHtml(ra,'hn-rname')+'<span class="hn-rtime">'+hnAgo(r.createdAt)+'</span>'+(r.edited?'<span class="hn-edited">· modificato</span>':'')+'</div>'+
        '<div class="hn-rtext" id="hn-rt-'+rkey+'">'+hnFormatText(r.text)+'</div>'+hnRenderCommentMedia(r)+replyOwnerHtml+'</div></div>';
    }
    var commentOwnerHtml = hnCanModerate(c.authorId) ?
      '<button class="hn-edit-btn" onclick="hnEditComment(\''+p.id+'\',\''+c.id+'\')">Modifica</button>'+
      '<button class="hn-del-btn" onclick="hnDeleteComment(\''+p.id+'\',\''+c.id+'\')">Elimina</button>' : '';
    var replyForm = hn_user ? '<div class="hn-reply-compose"><input type="text" placeholder="Rispondi..." id="hn-ri-'+key+'" readonly data-cedit="reply" data-pid="'+p.id+'" data-cid="'+c.id+'" style="cursor:pointer!important;"><button class="hn-rsend" data-cedit="reply" data-pid="'+p.id+'" data-cid="'+c.id+'">Invia</button></div>' : '';
    var repliesBlock = '<div class="hn-replies'+(hn_open_replies[key]?' hn-open':'')+'" id="hn-rep-'+key+'">'+repliesHtml+replyForm+'</div>';
    var replyCount = replies.length ? ' ('+replies.length+')' : '';
    var showRepliesBtn = (hn_user || replies.length) ? '<button class="hn-cabtn" onclick="hnToggleReplies(\''+key+'\')">'+(hn_user ? 'Rispondi' : 'Risposte')+replyCount+'</button>' : '';
    html += '<div class="hn-citem" id="hn-cid-'+key+'">'+hnAvHtml(ca.color,ca.avatar,ca.name,'hn-cav',null)+
      '<div class="hn-cbody">'+
      '<div class="hn-cmeta">'+hnNameHtml(ca,'hn-cname')+'<span class="hn-ctime">'+hnAgo(c.createdAt)+'</span>'+(c.edited?'<span class="hn-edited">· modificato</span>':'')+'</div>'+
      '<div class="hn-ctext" id="hn-ct-'+key+'">'+hnFormatText(c.text)+'</div>'+hnRenderCommentMedia(c)+
      '<div class="hn-cactions-row">'+showRepliesBtn+commentOwnerHtml+'</div>'+
      repliesBlock+
      '</div></div>';
  }
  if (total > shown) {
    html += '<button class="hn-abtn" style="margin:4px 0 8px!important;font-size:12px!important;color:#5b9cf6!important;" onclick="hnShowMoreComments(\''+p.id+'\')">'+
      'Mostra altri commenti ('+(total - shown)+')</button>';
  }
  return html;
}

function hnShowMoreComments(pid) {
  hn_comments_shown[pid] = (hn_comments_shown[pid] || 3) + 3;
  hn_open_comments[pid] = true;
  hnRenderFeed();
}

function hnToggleComments(pid) {
  hn_open_comments[pid] = !hn_open_comments[pid];
  var cs = document.getElementById('hn-cs-'+pid);
  if (cs) { if (hn_open_comments[pid]) cs.classList.add('hn-open'); else cs.classList.remove('hn-open'); }
}

function hnToggleReplies(key) {
  hn_open_replies[key] = !hn_open_replies[key];
  var el = document.getElementById('hn-rep-'+key);
  if (el) { if (hn_open_replies[key]) el.classList.add('hn-open'); else el.classList.remove('hn-open'); }
}

/* ── LIKE / NON MI PIACE ── */
function hnToggleLike(pid) { hnToggleReaction(pid, 'likes', 'dislikes', 'like', 'dislike'); }
function hnToggleDislike(pid) { hnToggleReaction(pid, 'dislikes', 'likes', 'dislike', 'like'); }

function hnToggleReaction(pid, field, other, type, otherType) {
  if (!hn_user) { hnOpenModal('auth'); return; }
  var uid = hn_user.id;
  hnMutatePost(pid, function(post, res) {
    var idx = post[field].indexOf(uid);
    res.authorId = post.authorId;
    res.text = post.text;
    if (idx === -1) {
      post[field].push(uid);
      var oi = post[other].indexOf(uid);
      if (oi !== -1) { post[other].splice(oi, 1); res.removedOther = true; }
      res.added = true;
    } else {
      post[field].splice(idx, 1);
      res.added = false;
    }
  }, function(post, res) {
    if (res.authorId === uid) return;
    if (res.added) hnCreateNotif(res.authorId, type, pid, res.text, {id: type+'_'+pid+'_'+uid});
    else hnRemoveNotif(res.authorId, type+'_'+pid+'_'+uid);
    if (res.removedOther) hnRemoveNotif(res.authorId, otherType+'_'+pid+'_'+uid);
  }, function() { alert('Errore: il post potrebbe essere stato eliminato.'); });
}

/* ── COMMENTI E RISPOSTE ── */
function hnSubmitCommentFull(pid, text, imgUrl, linkUrl, linkTitle, linkImg) {
  if (!hn_user) { hnOpenModal('auth'); return; }
  var cmt = {id:hnUid(), authorId:hn_user.id, authorName:hn_user.name,
    authorHandle:hn_user.handle, authorColor:hn_user.color, authorAvatar:hn_user.avatar||'',
    text:text, imgUrl:imgUrl||'', linkUrl:linkUrl||'', linkTitle:linkUrl ? (linkTitle||'') : '', linkImage:linkUrl ? (linkImg||'') : '',
    createdAt:new Date().toISOString()};
  hn_open_comments[pid] = true;
  hnMutatePost(pid, function(post, res) {
    post.comments.push(cmt);
    res.authorId = post.authorId;
    res.text = post.text;
    res.total = post.comments.length;
  }, function(post, res) {
    if (res.total > (hn_comments_shown[pid] || 3)) { hn_comments_shown[pid] = res.total; hnRenderFeed(); }
    if (res.authorId !== hn_user.id) hnCreateNotif(res.authorId, 'comment', pid, res.text, {ref:{c:cmt.id}});
    hnNotifMentionsAll(text, pid, res.text, {c:cmt.id}, '');
  }, function() { alert('Errore commento: il post potrebbe essere stato eliminato.'); });
}

function hnSubmitReplyFull(pid, cId, text, imgUrl, linkUrl, linkTitle, linkImg) {
  if (!hn_user) { hnOpenModal('auth'); return; }
  var reply = {
    id: hnUid(),
    authorId: hn_user.id, authorName: hn_user.name,
    authorHandle: hn_user.handle, authorColor: hn_user.color,
    authorAvatar: hn_user.avatar || '',
    text: text, imgUrl: imgUrl||'', linkUrl: linkUrl||'', linkTitle: linkUrl ? (linkTitle||'') : '', linkImage: linkUrl ? (linkImg||'') : '',
    createdAt: new Date().toISOString()
  };
  hn_open_comments[pid] = true;
  hn_open_replies[pid+'_'+cId] = true;
  hnMutatePost(pid, function(post, res) {
    var c = hnFindComment(post, cId);
    if (!c) return false;
    c.replies.push(reply);
    res.commentAuthor = c.authorId;
    res.text = post.text;
  }, function(post, res) {
    if (res.commentAuthor !== hn_user.id) hnCreateNotif(res.commentAuthor, 'reply', pid, text, {ref:{c:cId, r:reply.id}});
    hnNotifMentionsAll(text, pid, text, {c:cId, r:reply.id}, '');
  }, function() { alert('Errore: il commento potrebbe essere stato eliminato.'); });
}

/* ── SIDEBAR ── */
function hnRenderSidebar() { if (!hn_data_ready) return; hnRenderTrend(); hnRenderHunters(); }
function hnRenderTrend() {
  var counts={};
  for (var i=0;i<hn_posts.length;i++) {
    var tags=hnTagsOf(hn_posts[i].text);
    for (var j=0;j<tags.length;j++) counts[tags[j]]=(counts[tags[j]]||0)+1;
  }
  var sorted=[];
  for (var t in counts) sorted.push([t,counts[t]]);
  sorted.sort(function(a,b){return b[1]-a[1];}); sorted=sorted.slice(0,5);
  var el=document.getElementById('hn-trending');
  if (!el) return;
  if (!sorted.length){el.innerHTML='<div style="font-size:12px;color:#a09a93;padding:4px 0;">Nessun trend ancora.</div>';return;}
  var html='';
  for (var k=0;k<sorted.length;k++)
    html+='<div class="hn-trend" onclick="hnFilterTag(\''+sorted[k][0]+'\')"><div class="hn-ttag">'+sorted[k][0]+'</div><div class="hn-tcount">'+sorted[k][1]+' post</div></div>';
  el.innerHTML=html;
}
function hnRenderHunters() {
  var el=document.getElementById('hn-hunters');
  if (!el) return;
  var seen={}; var recent=[];
  for (var i=0;i<hn_posts.length;i++) {
    var prof = hnProfileById(hn_posts[i].authorId);
    if (!prof || seen[prof.id]) continue;
    seen[prof.id]=true; recent.push(prof);
    if (recent.length>=5) break;
  }
  if (!recent.length){el.innerHTML='<div style="font-size:12px;color:#a09a93;padding:4px 0;">Nessun cacciatore ancora.</div>';return;}
  var html='';
  for (var j=0;j<recent.length;j++) {
    var r=recent[j];
    html+='<div class="hn-hunter" onclick="hnOpenProfile(\''+r.id+'\')">'+
      hnAvHtml(r.color,r.avatar||'',r.name,'hn-hav',null)+
      '<div style="margin:0!important;text-align:left!important;"><div class="hn-hname">'+hnEsc(r.name)+hnVerifiedBadge(r)+hnOnlineDot(r)+'</div><div class="hn-htag2">@'+hnEsc(r.handle)+'</div></div></div>';
  }
  el.innerHTML=html;
}

/* ── PROFILO ── */
function hnFollowersOf(aid) {
  var out = [];
  for (var i=0;i<hn_profiles.length;i++) {
    if (hnArr(hn_profiles[i].following).indexOf(aid) !== -1) out.push(hn_profiles[i]);
  }
  return out;
}

function hnOpenProfile(aid, fromFetch) {
  var prof = hnProfileById(aid);
  if (!prof) return;
  if (!fromFetch) {
    hn_fb_ref('hunternet/posts').orderByChild('authorId').equalTo(aid).once('value').then(function(snap) {
      hn_profile_posts[aid] = hnSnapToPosts(snap.val());
      var pc = document.getElementById('hn-profcontent');
      var modal = document.getElementById('hn-modal-prof');
      if (pc && modal && modal.style.display !== 'none' && pc.getAttribute('data-prof') === aid) hnOpenProfile(aid, true);
    }).catch(function(){});
  }
  var src = hn_profile_posts[aid];
  if (!src) { src = []; for (var w=0;w<hn_posts.length;w++) { if (hn_posts[w].authorId===aid) src.push(hn_posts[w]); } }
  var up=[]; var tl=0;
  for (var j=0;j<src.length;j++) { up.push(src[j]); tl+=src[j].likes.length; }
  var scrollBox = document.getElementById('hn-prof-scroll');
  var keepScroll = fromFetch && scrollBox ? scrollBox.scrollTop : 0;
  var activeTab = fromFetch ? document.querySelector('#hn-profcontent .hn-prof-tab.hn-active') : null;
  var activeIdx = 0;
  if (activeTab) { var all = document.querySelectorAll('#hn-profcontent .hn-prof-tab'); for (var t=0;t<all.length;t++) { if (all[t] === activeTab) activeIdx = t; } }
  var is_me = !!hn_user && hn_user.id === aid;
  var my_prof = hn_user ? hnProfileById(hn_user.id) : null;
  var is_following = !!my_prof && hnArr(my_prof.following).indexOf(aid) !== -1;
  var followers = hnFollowersOf(aid);
  var follow_btn = (hn_user && !is_me) ?
    '<button class="hn-follow-btn'+(is_following?' hn-following':'')+'" onclick="hnToggleFollow(\''+aid+'\')">'+
    (is_following?'Segui già':'Segui')+'</button>' : '';
  var rh='';
  var sl=up.slice(0,5);
  for (var k=0;k<sl.length;k++)
    rh+='<div style="padding:0.75rem 0;border-bottom:1px solid #313846;margin:0;cursor:pointer;" onclick="hnGoToPost(\''+sl[k].id+'\',false)" title="Vai al post">'+
      '<div class="hn-ptext" style="margin:0;">'+(sl[k].text ? hnFormatText(sl[k].text) : '<span style="color:#5b6577;">&#8618; Post condiviso</span>')+'</div>'+
      (hnFirstImage(sl[k]) ? '<img src="'+hnEsc(hnFirstImage(sl[k]))+'" style="max-width:100%;max-height:120px;border-radius:6px;margin-top:6px;object-fit:cover;display:block;" onerror="this.style.display=\'none\'">' : '')+
      '<div style="font-size:11px;color:#5b6577;margin-top:4px;">'+hnAgo(sl[k].createdAt)+' \u00b7 '+sl[k].likes.length+' like</div></div>';
  var prof_following_existing = [];
  var pf_list = hnArr(prof.following);
  for (var pfi=0;pfi<pf_list.length;pfi++) { var pf2 = hnProfileById(pf_list[pfi]); if (pf2) prof_following_existing.push(pf2); }
  var following_html = '';
  for (var fi=0;fi<prof_following_existing.length;fi++) {
    var f2 = prof_following_existing[fi];
    following_html+='<div class="hn-fitem" onclick="hnCloseModal(\'prof\');hnOpenProfile(\''+f2.id+'\')">'+
      hnAvHtml(f2.color,f2.avatar||'',f2.name,'hn-hav',null)+
      '<div style="margin:0!important;"><div class="hn-fitem-name">'+hnEsc(f2.name)+'</div><div class="hn-fitem-handle">@'+hnEsc(f2.handle)+'</div></div></div>';
  }
  var followers_html = '';
  for (var fri=0;fri<followers.length;fri++) {
    var fr=followers[fri];
    followers_html+='<div class="hn-fitem" onclick="hnCloseModal(\'prof\');hnOpenProfile(\''+fr.id+'\')">'+
      hnAvHtml(fr.color,fr.avatar||'',fr.name,'hn-hav',null)+
      '<div style="margin:0!important;"><div class="hn-fitem-name">'+hnEsc(fr.name)+'</div><div class="hn-fitem-handle">@'+hnEsc(fr.handle)+'</div></div></div>';
  }
  var edit_btn = is_me ?
    '<div style="display:flex!important;flex-direction:column!important;gap:6px!important;margin-left:auto!important;">'+
    '<button class="hn-follow-btn" onclick="hnOpenEditProfile()">Modifica</button>'+
    '<button class="hn-follow-btn" style="border-color:#e57373!important;color:#e57373!important;font-size:11px!important;" onclick="hnConfirmDeleteAccount()">Elimina account</button>'+
    '</div>' :
    (hnIsAdmin() ?
    '<div style="display:flex!important;flex-direction:column!important;gap:4px!important;">'+
    '<button class="hn-follow-btn" style="font-size:11px!important;" onclick="hnAdminEditProfile(\''+aid+'\')">&#9881; Modifica</button>'+
    '<button class="hn-follow-btn" style="border-color:#e57373!important;color:#e57373!important;font-size:11px!important;" onclick="hnAdminDeleteAccount(\''+aid+'\')">&#9881; Elimina account</button>'+
    '</div>' : '');
  var dot_c = hnIsOnline(prof) ? '#5cb878' : '#5b6577';
  document.getElementById('hn-profcontent').innerHTML=
    '<div class="hn-profhead"><div style="position:relative!important;flex-shrink:0!important;">'+hnAvHtml(prof.color,prof.avatar||'',prof.name,'hn-profav',null)+
    '<span style="position:absolute!important;bottom:2px!important;right:2px!important;width:12px!important;height:12px!important;border-radius:50%!important;background:'+dot_c+'!important;border:2px solid #252932!important;display:block!important;"></span>'+
    '</div>'+
    '<div class="hn-profinfo"><h2 style="cursor:pointer!important;" title="Mostra tutti i post" onclick="hnCloseModal(\'prof\');hnFilterUser(\''+aid+'\')">'+hnEsc(prof.name)+hnVerifiedBadge(prof)+'</h2><div class="hn-profhandle">@'+hnEsc(prof.handle)+'</div>'+
    '<div style="margin-top:6px;"><span class="hn-rank '+hnRankClass(prof.rank)+'">'+hnEsc(prof.rank||'')+'</span></div></div>'+
    (is_me ? edit_btn : (hnIsAdmin() ? '<div style="display:flex!important;flex-direction:column!important;gap:6px!important;margin-left:auto!important;">'+follow_btn+edit_btn+'</div>' : follow_btn))+'</div>'+
    (prof.bio?'<p class="hn-profbio">'+hnEsc(prof.bio)+'</p>':'')+
    '<div class="hn-profstats">'+
    '<div class="hn-pstat"><span class="hn-pnum">'+up.length+'</span><span class="hn-plbl">Post</span></div>'+
    '<div class="hn-pstat"><span class="hn-pnum" title="'+(tl*HN_LIKE_MULT).toLocaleString('it-IT')+'">'+hnFmtCount(tl*HN_LIKE_MULT)+'</span><span class="hn-plbl">Like ricevuti</span></div>'+
    '<div class="hn-pstat"><span class="hn-pnum">'+prof_following_existing.length+'</span><span class="hn-plbl">Seguiti</span></div>'+
    '<div class="hn-pstat"><span class="hn-pnum" title="'+(followers.length*HN_FOLLOWER_MULT).toLocaleString('it-IT')+'">'+hnFmtCount(followers.length*HN_FOLLOWER_MULT)+'</span><span class="hn-plbl">Follower</span></div>'+
    '</div>'+
    '<div class="hn-prof-tabs">'+
    '<button class="hn-prof-tab hn-active" onclick="hnProfTab(\'posts\',this)">Post recenti</button>'+
    '<button class="hn-prof-tab" onclick="hnProfTab(\'following\',this)">Seguiti ('+prof_following_existing.length+')</button>'+
    '<button class="hn-prof-tab" onclick="hnProfTab(\'followers\',this)">Follower ('+hnFmtCount(followers.length*HN_FOLLOWER_MULT)+')</button>'+
    '</div>'+
    '<div id="hn-prof-scroll">'+
    '<div id="hn-prof-posts">'+
    (rh||'<div style="font-size:13px;color:#5b6577;padding:0.5rem 0;">Nessun post ancora.</div>')+
    '</div>'+
    '<div id="hn-prof-following" style="display:none;">'+
    '<div class="hn-flist">'+(following_html||'<div style="font-size:13px;color:#5b6577;padding:0.5rem 0;">Non segue ancora nessuno.</div>')+'</div>'+
    '</div>'+
    '<div id="hn-prof-followers" style="display:none;">'+
    '<div class="hn-flist">'+(followers_html||'<div style="font-size:13px;color:#5b6577;padding:0.5rem 0;">Nessun follower ancora.</div>')+'</div>'+
    '</div>'+
    '</div>';
  document.getElementById('hn-profcontent').setAttribute('data-prof', aid);
  if (fromFetch) {
    var tabs = document.querySelectorAll('#hn-profcontent .hn-prof-tab');
    if (activeIdx && tabs[activeIdx]) hnProfTab(['posts','following','followers'][activeIdx], tabs[activeIdx]);
    var sb = document.getElementById('hn-prof-scroll');
    if (sb) sb.scrollTop = keepScroll;
    return;
  }
  hnOpenModal('prof');
}

function hnProfTab(tab, el) {
  var tabs = document.querySelectorAll('.hn-prof-tab');
  for (var i=0;i<tabs.length;i++) tabs[i].classList.remove('hn-active');
  el.classList.add('hn-active');
  var sections = ['posts','following','followers'];
  for (var s=0;s<sections.length;s++) {
    var sec = document.getElementById('hn-prof-'+sections[s]);
    if (sec) sec.style['display'] = sections[s]===tab ? 'block' : 'none';
  }
}

function hnOpenEditProfile() {
  if (!hn_user) return;
  hnOpenEditProfileFor(hn_user.id);
}

var hn_edit_color = '';

function hnOpenEditProfileFor(target_id) {
  var prof = hnProfileById(target_id);
  if (!prof) return;
  var ranks = ['★★★ Hunter','★★ Hunter','★ Hunter','Hunter','Apprendista','Lottatore Celeste','Civile'];
  var rank_opts = '';
  for (var r = 0; r < ranks.length; r++) {
    rank_opts += '<option value="'+hnEsc(ranks[r])+'"'+(prof.rank===ranks[r]?' selected':'')+'>'+hnEsc(ranks[r])+'</option>';
  }
  var colors_html = '';
  for (var c = 0; c < hn_colors.length; c++) {
    colors_html += '<div class="hn-swatch'+(hn_colors[c]===prof.color?' hn-sel':'')+'" style="background:'+hn_colors[c]+'!important;" onclick="hnEditPickColor(\''+hn_colors[c]+'\',this)"></div>';
  }
  var av_url = hnSafeUrl(prof.avatar);
  document.getElementById('hn-profcontent').removeAttribute('data-prof');
  document.getElementById('hn-profcontent').innerHTML =
    '<h2 style="margin-bottom:4px!important;">Modifica profilo</h2>'+
    '<p class="hn-msub">Le modifiche saranno visibili subito, anche sui post già pubblicati.</p>'+
    '<div class="hn-avrow">'+
      '<div id="hn-edit-av-preview" class="hn-avpreview" style="background:'+hnSafeColor(prof.color)+'!important;">'+
        (av_url ? '<img src="'+hnEsc(av_url)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display=\'none\'">' : hnEsc(hnInitials(prof.name)))+
      '</div>'+
      '<div class="hn-field" style="flex:1!important;margin:0!important;">'+
        '<label>URL AVATAR</label>'+
        '<input id="hn-edit-avatar" type="text" value="'+hnEscAttr(prof.avatar||'')+'" placeholder="https://..." oninput="hnEditPreviewAvatar()">'+
      '</div>'+
    '</div>'+
    '<div class="hn-field"><label>COLORE AVATAR</label><div class="hn-cpicker" id="hn-edit-cpicker">'+colors_html+'</div></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'+
      '<div class="hn-field"><label>NOME / COGNOME</label><input id="hn-edit-name" type="text" value="'+hnEscAttr(prof.name)+'"></div>'+
      '<div class="hn-field"><label>NICKNAME (@unico)</label><input id="hn-edit-handle" type="text" value="'+hnEscAttr(prof.handle)+'"></div>'+
    '</div>'+
    '<div class="hn-field"><label>RANK</label>'+
      '<select id="hn-edit-rank">'+rank_opts+'</select>'+
    '</div>'+
    '<div class="hn-field"><label>BIO</label><textarea id="hn-edit-bio" style="min-height:60px!important;">'+hnEscVal(prof.bio||'')+'</textarea></div>'+
    '<div class="hn-field"><label>NUOVA PASSWORD (lascia vuoto per non cambiare)</label>'+
      '<div class="hn-pwrap">'+
        '<input id="hn-edit-pw" type="password" placeholder="Nuova password...">'+
        '<button class="hn-peye" onclick="hnTogglePw(\'hn-edit-pw\',this)" title="Mostra/nascondi">'+
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'+
        '</button>'+
      '</div>'+
    '</div>'+
    '<div class="hn-errmsg" id="hn-edit-err"></div>'+
    '<div class="hn-mactions">'+
      '<button class="hn-gbtn" onclick="hnOpenProfile(\''+prof.id+'\')">Annulla</button>'+
      '<button class="hn-dbtn" onclick="hnSaveProfileFor(\''+prof.id+'\')">Salva</button>'+
    '</div>';
  hn_edit_color = hnSafeColor(prof.color);
}

function hnEditPickColor(c, el) {
  hn_edit_color = c;
  var sw = document.querySelectorAll('#hn-edit-cpicker .hn-swatch');
  for (var i = 0; i < sw.length; i++) sw[i].classList.remove('hn-sel');
  el.classList.add('hn-sel');
  var prev = document.getElementById('hn-edit-av-preview');
  if (prev) prev.style['background'] = c;
}

function hnEditPreviewAvatar() {
  var url = hnNormUrl(document.getElementById('hn-edit-avatar').value);
  var prev = document.getElementById('hn-edit-av-preview');
  if (!prev) return;
  prev.style['background'] = hn_edit_color;
  if (url) {
    prev.innerHTML = '<img src="'+hnEsc(url)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display=\'none\'">';
  } else {
    var name_el = document.getElementById('hn-edit-name');
    prev.textContent = hnInitials(name_el ? name_el.value : '');
  }
}

function hnSaveProfile() {
  if (!hn_user) return;
  hnSaveProfileFor(hn_user.id);
}

function hnSaveProfileFor(target_id) {
  hnHideErr('hn-edit-err');
  var name   = document.getElementById('hn-edit-name').value.trim();
  var handle = document.getElementById('hn-edit-handle').value.trim().replace('@','');
  var rank   = document.getElementById('hn-edit-rank').value;
  var bio    = document.getElementById('hn-edit-bio').value.trim();
  var avatar = hnNormUrl(document.getElementById('hn-edit-avatar').value);
  var new_pw = document.getElementById('hn-edit-pw').value;

  if (!name || !handle || !rank) return hnShowErr('hn-edit-err','Compila tutti i campi obbligatori.');
  if (handle.length < 3) return hnShowErr('hn-edit-err','Nickname troppo corto (min 3 caratteri).');
  if (!/^[a-zA-Z0-9_]+$/.test(handle)) return hnShowErr('hn-edit-err','Nickname: solo lettere, numeri e _.');
  if (hnGroupByHandle(handle)) return hnShowErr('hn-edit-err','Questo nickname è riservato.');
  if (new_pw && new_pw.length < 4) return hnShowErr('hn-edit-err','La password deve essere di almeno 4 caratteri.');
  if (!hnProfileById(target_id)) return;

  var btn = document.querySelector('#hn-profcontent .hn-dbtn');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  function reset() { if (btn) { btn.disabled = false; btn.textContent = 'Salva'; } }

  hnFetchCreds(function(creds) {
    var has_cred = false;
    for (var i = 0; i < creds.length; i++) {
      if (String(creds[i].handle).toLowerCase() === handle.toLowerCase() && creds[i].id !== target_id) { reset(); return hnShowErr('hn-edit-err','Nickname già in uso.'); }
      if (creds[i].id === target_id) has_cred = true;
    }
    var saved = 0, need = has_cred ? 2 : 1, failed = false;
    function onDone() {
      saved++;
      if (saved < need) return;
      reset();
      if (failed) return hnShowErr('hn-edit-err','Errore nel salvataggio.');
      hnOpenProfile(target_id);
    }
    function onFail() { failed = true; onDone(); }
    hn_fb_update('hunternet/profiles/'+target_id, {name:name, handle:handle, rank:rank, bio:bio, avatar:avatar||'', color:hn_edit_color}, onDone, onFail);
    if (has_cred) {
      var cupd = {handle:handle};
      if (new_pw) cupd.password = new_pw;
      hn_fb_update('hunternet/credentials/'+target_id, cupd, onDone, onFail);
    }
  }, function() { reset(); hnShowErr('hn-edit-err','Errore di connessione. Riprova.'); });
}

/* ── SONDAGGI ── */
function hnVotePoll(pid, opt_idx) {
  if (!hn_user) { hnOpenModal('auth'); return; }
  var lp = hnGetPostById(pid);
  if (!lp || !lp.poll) return;
  if (hnPollClosed(lp.poll)) { alert('Il sondaggio è chiuso.'); return; }
  var uid = hn_user.id;
  hnMutatePost(pid, function(post) {
    if (!post.poll || !post.poll.options[opt_idx] || hnPollClosed(post.poll)) return false;
    var had = post.poll.options[opt_idx].votes.indexOf(uid) !== -1;
    for (var i=0;i<post.poll.options.length;i++) {
      var vi = post.poll.options[i].votes.indexOf(uid);
      if (vi !== -1) post.poll.options[i].votes.splice(vi, 1);
    }
    if (!had) post.poll.options[opt_idx].votes.push(uid);
  }, null, function() { alert('Errore nel voto: il sondaggio potrebbe essere chiuso.'); });
}

/* Chiude i sondaggi scaduti e avvisa chi ha votato e l'autore (una sola volta, anche con più utenti online) */
function hnPollDue(p) {
  return !!p && !!p.poll && !p.poll.notified && !!p.poll.deadline && new Date(p.poll.deadline) <= new Date() && !hn_poll_pending[p.id];
}
function hnCheckPollExpiry() {
  if (!hn_user || !hn_data_ready) return;
  for (var i=0;i<hn_posts.length;i++) { if (hnPollDue(hn_posts[i])) hnClosePoll(hn_posts[i].id); }
  var now = Date.now();
  if (hn_poll_check_busy || now - hn_poll_last_check < 55000) return;
  hn_poll_last_check = now;
  hn_poll_check_busy = true;
  hn_fb_ref('hunternet/posts').orderByChild('poll/notified').equalTo(false).once('value').then(function(snap) {
    hn_poll_check_busy = false;
    var arr = hnSnapToPosts(snap.val());
    for (var j=0;j<arr.length;j++) { if (hnPollDue(arr[j])) hnClosePoll(arr[j].id); }
  }).catch(function() { hn_poll_check_busy = false; });
}
function hnClosePoll(pid) {
  hn_poll_pending[pid] = true;
  hnMutatePost(pid, function(post, res) {
    if (!post.poll || post.poll.notified) return false;
    post.poll.closed = true;
    post.poll.notified = true;
    res.authorId = post.authorId;
    var best = -1, wins = [], voters = {};
    for (var oi=0;oi<post.poll.options.length;oi++) {
      var opt = post.poll.options[oi];
      var vc = opt.votes.length;
      if (vc > best) { best = vc; wins = [opt.text]; } else if (vc === best) wins.push(opt.text);
      for (var vi=0;vi<opt.votes.length;vi++) voters[opt.votes[vi]] = true;
    }
    voters[post.authorId] = true;
    res.voters = voters;
    res.msg = best <= 0 ? 'Nessun voto ricevuto.' : (wins.length > 1 ? 'Pareggio: ' + wins.join(', ') : 'Ha vinto: ' + wins[0]);
  }, function(post, res) {
    delete hn_poll_pending[pid];
    var author = hnProfileById(res.authorId);
    var from = author ? author : {id:res.authorId, name:post.authorName, handle:post.authorHandle, color:post.authorColor, avatar:post.authorAvatar};
    for (var uid in res.voters) {
      hnCreateNotif(uid, 'poll_end', pid, res.msg, {id:'poll_'+pid+'_'+uid, allowSelf:true, from:from});
    }
  }, function() { delete hn_poll_pending[pid]; });
}

/* ── SEGUI ── */
function hnToggleFollow(aid) {
  if (!hn_user) { hnOpenModal('auth'); return; }
  var my_prof = hnProfileById(hn_user.id);
  if (!my_prof) return;
  var list = hnArr(my_prof.following).slice();
  var idx = list.indexOf(aid);
  var was_following = idx !== -1;
  if (was_following) list.splice(idx, 1); else list.push(aid);
  hn_fb_set('hunternet/profiles/'+hn_user.id+'/following', list,
    function() {
      if (was_following) hnRemoveNotif(aid, 'follow_'+hn_user.id);
      else hnCreateNotif(aid, 'follow', '', '', {id:'follow_'+hn_user.id});
      hnOpenProfile(aid);
    },
    function() { alert('Errore nel salvataggio.'); }
  );
}

/* ── COLOR PICKER ── */
function hnBuildColorPicker() {
  var html='';
  for (var i=0;i<hn_colors.length;i++)
    html+='<div class="hn-swatch'+(hn_colors[i]===hn_sel_color?' hn-sel':'')+'" style="background:'+hn_colors[i]+';" onclick="hnPickColor(\''+hn_colors[i]+'\',this)"></div>';
  document.getElementById('hn-cpicker').innerHTML=html;
}
function hnPickColor(c,el) {
  hn_sel_color=c;
  var sw=document.querySelectorAll('#hn-cpicker .hn-swatch');
  for (var i=0;i<sw.length;i++) sw[i].classList.remove('hn-sel');
  el.classList.add('hn-sel');
  hnPreviewAvatar();
}

/* ── MODALI ── */
function hnOpenModal(id) {
  var el=document.getElementById('hn-modal-'+id);
  if (!el) return;
  el.style.display='flex'; el.style['z-index']='99999';
}
function hnCloseModal(id) {
  var el=document.getElementById('hn-modal-'+id);
  if (el) el.style.display='none';
}
document.addEventListener('click',function(e){
  var cedit_overlay=document.getElementById('hn-cedit-overlay');
  if (cedit_overlay && cedit_overlay.classList.contains('hn-vis') && e.target===cedit_overlay) hnCEditClose();
  var epw=document.getElementById('hn-emoji-picker-wrap');
  var ebtn=document.getElementById('hn-tbtn-emoji');
  if (epw&&ebtn&&!epw.contains(e.target)&&e.target!==ebtn&&!hn_cedit_emoji_open) {
    epw.style['display']='none'; hn_emoji_picker_open=false;
  }
  var drop=document.getElementById('hn-notif-drop');
  var bell=document.getElementById('hn-bell-btn');
  if (drop&&bell&&e.target!==bell&&!bell.contains(e.target)&&!drop.contains(e.target)) drop.style['display']='none';
  var ids=['auth','reg','prof','share'];
  for (var i=0;i<ids.length;i++) {
    var m=document.getElementById('hn-modal-'+ids[i]);
    if (m&&e.target===m) hnCloseModal(ids[i]);
  }
});

/* ── LIGHTBOX ── */
function hnOpenLightbox(src) {
  hnOpenLightboxList([src], 0);
}
function hnOpenGallery(pid, i) {
  var p = hnGetPostById(pid);
  if (!p) return;
  var imgs = hnGalleryImages(p);
  if (!imgs.length) return;
  hnOpenLightboxList(imgs, i);
}
function hnLightboxSetup() {
  var lb = document.getElementById('hn-lightbox');
  if (!lb || lb._hnNav) return;
  lb._hnNav = true;
  var prev = document.createElement('button');
  prev.className = 'hn-lb-nav hn-lb-prev'; prev.id = 'hn-lb-prev'; prev.innerHTML = '&#8249;';
  prev.onclick = function(e) { e.stopPropagation(); hnLightboxStep(-1); };
  var next = document.createElement('button');
  next.className = 'hn-lb-nav hn-lb-next'; next.id = 'hn-lb-next'; next.innerHTML = '&#8250;';
  next.onclick = function(e) { e.stopPropagation(); hnLightboxStep(1); };
  var cnt = document.createElement('div');
  cnt.className = 'hn-lb-count'; cnt.id = 'hn-lb-count';
  lb.appendChild(prev); lb.appendChild(next); lb.appendChild(cnt);
  var img = document.getElementById('hn-lb-img');
  if (img) img.onclick = function(e) { if (hn_lb_list.length > 1) { e.stopPropagation(); hnLightboxStep(1); } };
  document.addEventListener('keydown', function(e) {
    if (!lb.classList.contains('hn-open')) return;
    if (e.key === 'ArrowRight') hnLightboxStep(1);
    else if (e.key === 'ArrowLeft') hnLightboxStep(-1);
    else if (e.key === 'Escape') hnCloseLightbox();
  });
}
function hnOpenLightboxList(list, i) {
  hnLightboxSetup();
  hn_lb_list = list;
  hn_lb_idx = Math.max(0, Math.min(i || 0, list.length - 1));
  hnLightboxShow();
  var lb = document.getElementById('hn-lightbox');
  lb.classList.add('hn-open');
  lb.style['z-index'] = '99999';
}
function hnLightboxStep(d) {
  if (hn_lb_list.length < 2) return;
  hn_lb_idx = (hn_lb_idx + d + hn_lb_list.length) % hn_lb_list.length;
  hnLightboxShow();
}
function hnLightboxShow() {
  document.getElementById('hn-lb-img').src = hn_lb_list[hn_lb_idx] || '';
  var multi = hn_lb_list.length > 1;
  var ids = ['hn-lb-prev', 'hn-lb-next', 'hn-lb-count'];
  for (var k=0;k<ids.length;k++) {
    var el = document.getElementById(ids[k]);
    if (el) el.style.setProperty('display', multi ? (k < 2 ? 'flex' : 'block') : 'none', 'important');
  }
  var c = document.getElementById('hn-lb-count');
  if (c) c.textContent = (hn_lb_idx + 1) + ' / ' + hn_lb_list.length;
}
function hnCloseLightbox() {
  document.getElementById('hn-lightbox').classList.remove('hn-open');
}

/* ── NOTIFICHE ── */
var HN_NOTIF_LABELS = {
  like:'ha messo mi piace al tuo post',
  dislike:'ha messo non mi piace al tuo post',
  comment:'ha commentato il tuo post',
  reply:'ha risposto al tuo commento',
  share:'ha condiviso il tuo post',
  mention:'ti ha menzionato',
  follow:'ha iniziato a seguirti',
  poll_end:''
};

function hnUpdateBadge() {
  var badge = document.getElementById('hn-bell-badge');
  if (!badge) return;
  if (!hn_user) { badge.style['display'] = 'none'; return; }
  var count = 0;
  for (var i = 0; i < hn_notifs.length; i++) { if (!hn_notifs[i].read) count++; }
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.style['display'] = 'flex';
  } else {
    badge.style['display'] = 'none';
  }
}

/* extra: {id, ref, allowSelf, from} */
function hnCreateNotif(to_id, type, post_id, post_text, extra) {
  if (!hn_user || !to_id) return;
  extra = extra || {};
  if (to_id === hn_user.id && !extra.allowSelf) return;
  var from = extra.from || hn_user;
  var notif = {
    id: extra.id || hnUid(),
    to_id: to_id,
    from_id: from.id,
    from_name: from.name || '',
    from_handle: from.handle || '',
    from_color: from.color || '',
    from_avatar: from.avatar || '',
    type: type,
    post_id: post_id || '',
    post_text: post_text ? String(post_text).substring(0, 60) : '',
    read: false,
    created_at: new Date().toISOString()
  };
  if (extra.ref) notif.ref = extra.ref;
  hn_fb_set('hunternet/notifications/'+to_id+'/'+notif.id, notif);
}

function hnRemoveNotif(to_id, nid) {
  if (!to_id || !nid) return;
  hn_fb_remove('hunternet/notifications/'+to_id+'/'+nid);
}

/* Chi viene menzionato in un testo (utenti e gruppi) */
function hnMentionTargets(text) {
  var out = {};
  if (!text) return out;
  var re = /@([a-zA-Z0-9_]+)/g, m;
  while ((m = re.exec(text)) !== null) {
    var g = hnGroupByHandle(m[1]);
    if (g) {
      for (var i=0;i<hn_profiles.length;i++) { if (g.test(hn_profiles[i])) out[hn_profiles[i].id] = true; }
    } else {
      var p = hnProfileByHandle(m[1]);
      if (p) out[p.id] = true;
    }
  }
  return out;
}

/* Notifica le menzioni una sola volta per persona (anche se citata sia per nome che con un gruppo).
   old_text: in caso di modifica, chi era già menzionato non riceve una seconda notifica. */
function hnNotifMentionsAll(text, post_id, post_text, ref, old_text) {
  if (!hn_user) return;
  var now = hnMentionTargets(text);
  var before = hnMentionTargets(old_text || '');
  var key = ref ? (ref.r || ref.c) : post_id;
  for (var uid in now) {
    if (before[uid] || uid === hn_user.id) continue;
    hnCreateNotif(uid, 'mention', post_id, post_text, {id:'mention_'+key+'_'+uid, ref:ref||null});
  }
}

/* Post condiviso a cui punta una notifica di condivisione */
function hnNotifShareTarget(n) {
  if (n.ref && n.ref.orig) return n.post_id;
  var best = null;
  for (var i=0;i<hn_posts.length;i++) {
    var p = hn_posts[i];
    if (p.sharedPost && p.sharedPost.id === n.post_id && p.authorId === n.from_id) { best = p; break; }
  }
  return best ? best.id : '';
}

/* Una notifica è valida solo se ciò che l'ha generata esiste ancora */
function hnNotifValid(n) {
  var p = null;
  if (n.post_id) {
    p = hnPostKnown(n.post_id);
    if (p === undefined) { hnEnsurePost(n.post_id); return undefined; }
  }
  var ref = n.ref || null;
  switch (n.type) {
    case 'like': return !!p && p.likes.indexOf(n.from_id) !== -1;
    case 'dislike': return !!p && p.dislikes.indexOf(n.from_id) !== -1;
    case 'comment':
      if (!p) return false;
      if (ref && ref.c) return !!hnFindComment(p, ref.c);
      return hnHasCommentBy(p, n.from_id);
    case 'reply':
      if (!p) return false;
      if (ref && ref.c && ref.r) return !!hnFindReply(p, ref.c, ref.r);
      return hnHasCommentBy(p, n.from_id);
    case 'mention':
      if (!p) return false;
      if (ref && ref.r) return !!hnFindReply(p, ref.c, ref.r);
      if (ref && ref.c) return !!hnFindComment(p, ref.c);
      return true;
    case 'share':
      if (ref && ref.orig) return !!p && p.authorId === n.from_id;
      return hnNotifShareTarget(n) ? true : undefined;
    case 'follow':
      var fp = hnProfileById(n.from_id);
      return !!fp && hnArr(fp.following).indexOf(n.to_id) !== -1;
    case 'poll_end': return !!p;
  }
  return true;
}

function hnPruneNotifs() {
  if (!hn_notif_uid || !hn_data_ready) return;
  var keep = [];
  for (var i=0;i<hn_notifs.length;i++) {
    var n = hn_notifs[i];
    var fresh = (Date.now() - new Date(n.created_at).getTime()) < 60000;
    if (fresh || hnNotifValid(n) !== false) keep.push(n);
    else {
      hn_deleted_notif_ids[n.id] = n.created_at;
      hnDeleteNotifFb(hn_notif_uid, n.id);
    }
  }
  hn_notifs = keep;
}

function hnToggleNotifDrop() {
  var drop = document.getElementById('hn-notif-drop');
  if (!drop) return;
  if (drop.style['display'] === 'none' || drop.style['display'] === '') {
    hnRenderNotifDrop();
    var btn = document.getElementById('hn-bell-btn');
    var rect = btn.getBoundingClientRect();
    drop.style['top'] = (rect.bottom + 6) + 'px';
    drop.style['z-index'] = '99999';
    if (document.body && document.body.classList.contains('ffm')) {
      drop.style['left'] = Math.max(4, rect.left) + 'px';
      drop.style['right'] = 'auto';
      drop.style['width'] = Math.min(320, window.innerWidth - 8) + 'px';
    } else {
      drop.style['right'] = (window.innerWidth - rect.right) + 'px';
      drop.style['left'] = 'auto';
      drop.style['width'] = '';
    }
    drop.style['display'] = 'block';
  } else {
    drop.style['display'] = 'none';
  }
}

function hnRenderNotifDrop() {
  if (!hn_user) return;
  var drop = document.getElementById('hn-notif-drop');
  var mine = hn_notifs;
  var html = '<div class="hn-notif-header"><span class="hn-notif-title">Notifiche</span>' +
    '<div style="display:flex!important;gap:8px!important;align-items:center!important;">' +
    (mine.length ? '<button class="hn-notif-clear" onclick="hnMarkAllRead()">Segna tutte come lette</button>' : '') +
    (mine.length ? '<button class="hn-notif-clear" style="color:#e57373!important;" onclick="hnDeleteAllNotifs()">Elimina tutte</button>' : '') +
    '</div></div>';
  if (!mine.length) {
    html += '<div class="hn-notif-empty">Nessuna notifica ancora.</div>';
  } else {
    for (var j = 0; j < mine.length; j++) {
      var n = mine[j];
      var fp = hnProfileById(n.from_id);
      var fname = fp ? fp.name : (n.from_name || 'Utente');
      var label = HN_NOTIF_LABELS[n.type] || '';
      var unread = !n.read ? ' hn-unread' : '';
      var detail = n.type === 'poll_end' ? hnEsc(n.post_text) : (n.post_text ? hnFormatText(n.post_text) + (n.post_text.length >= 60 ? '...' : '') : '');
      var head = n.type === 'poll_end' ?
        'Il sondaggio di <strong>' + hnEsc(fname) + '</strong> si è concluso' :
        '<strong>' + hnEsc(fname) + '</strong> ' + label;
      html += '<div class="hn-notif-item' + unread + '" onclick="hnNotifClick(\'' + n.id + '\')">' +
        hnAvHtml(fp ? fp.color : n.from_color, fp ? fp.avatar : n.from_avatar, fname, 'hn-notif-icon', null) +
        '<div class="hn-notif-body">' +
        '<div class="hn-notif-text">' + head +
        (detail ? '<br><span style="color:#5b6577!important;font-size:11px!important;">' + detail + '</span>' : '') +
        '</div>' +
        '<span class="hn-notif-time">' + hnAgo(n.created_at) + '</span>' +
        '</div>' +
        '<button onclick="event.stopPropagation();hnDeleteNotif(\'' + n.id + '\')" style="background:none!important;border:none!important;cursor:pointer!important;color:#5b6577!important;font-size:14px!important;padding:4px!important;flex-shrink:0!important;line-height:1!important;" title="Elimina">\u00d7</button>' +
        '</div>';
    }
  }
  drop.innerHTML = html;
}

function hnDeleteNotif(nid) {
  if (!hn_user) return;
  for (var i = 0; i < hn_notifs.length; i++) {
    if (hn_notifs[i].id === nid) { hn_deleted_notif_ids[nid] = hn_notifs[i].created_at; hn_notifs.splice(i, 1); break; }
  }
  hnUpdateBadge();
  hnRenderNotifDrop();
  hnDeleteNotifFb(hn_user.id, nid);
}

function hnDeleteAllNotifs() {
  if (!hn_user) return;
  for (var i = 0; i < hn_notifs.length; i++) hn_deleted_notif_ids[hn_notifs[i].id] = hn_notifs[i].created_at;
  hn_notifs = [];
  hnUpdateBadge();
  hnRenderNotifDrop();
  hnDeleteAllNotifsFb(hn_user.id);
}

function hnNotifClick(nid) {
  var n = null;
  for (var i=0;i<hn_notifs.length;i++) { if (hn_notifs[i].id === nid) { n = hn_notifs[i]; break; } }
  hnMarkRead(nid);
  document.getElementById('hn-notif-drop').style['display'] = 'none';
  if (!n) return;
  var ref = n.ref || {};
  if (n.type === 'follow') {
    if (n.from_id) hnOpenProfile(n.from_id);
  } else if (n.type === 'share') {
    var target = hnNotifShareTarget(n);
    if (target) { hnGoToPost(target, false); return; }
    hn_fb_ref('hunternet/posts').orderByChild('authorId').equalTo(n.from_id).once('value').then(function(snap) {
      var arr = hnSnapToPosts(snap.val());
      for (var i=0;i<arr.length;i++) {
        if (arr[i].sharedPost && arr[i].sharedPost.id === n.post_id) { hn_extra_posts[arr[i].id] = arr[i]; hnGoToPost(arr[i].id, false); return; }
      }
      alert('Questo post non è più disponibile.');
    }).catch(function() { alert('Errore di connessione. Riprova.'); });
  } else if (n.post_id) {
    var withComments = n.type === 'comment' || n.type === 'reply' || !!ref.c;
    hnGoToPost(n.post_id, withComments, ref.r ? n.post_id+'_'+ref.c : null);
  }
}

function hnMarkRead(nid) {
  for (var i = 0; i < hn_notifs.length; i++) {
    if (hn_notifs[i].id === nid) { hn_notifs[i].read = true; hn_read_notif_ids[nid] = hn_notifs[i].created_at; break; }
  }
  hnUpdateBadge();
  if (hn_user) hnMarkNotifReadFb(hn_user.id, nid);
}

function hnMarkAllRead() {
  if (!hn_user) return;
  for (var i = 0; i < hn_notifs.length; i++) {
    if (!hn_notifs[i].read) {
      hn_notifs[i].read = true;
      hn_read_notif_ids[hn_notifs[i].id] = hn_notifs[i].created_at;
      hnMarkNotifReadFb(hn_user.id, hn_notifs[i].id);
    }
  }
  hnUpdateBadge();
  hnRenderNotifDrop();
}

function hnBellShow() {
  var w = document.getElementById('hn-bell-wrap');
  if (w) w.classList.add('hn-vis');
  hnUpdateBadge();
}
function hnBellHide() {
  var w = document.getElementById('hn-bell-wrap');
  if (w) w.classList.remove('hn-vis');
  var drop = document.getElementById('hn-notif-drop');
  if (drop) drop.style['display'] = 'none';
}

/* ── TOOLTIP LIKE/CONDIVISIONI ── */
function hnShowTooltip(e, pid, type) {
  var post = hnGetPostById(pid);
  if (!post) return;
  var tip = document.getElementById('hn-tooltip');
  var names = [], j, pr;
  if (type === 'likes' || type === 'dislikes') {
    var ids = post[type];
    for (j=0;j<ids.length;j++) { pr = hnProfileById(ids[j]); if (pr) names.push(hnEsc(pr.name)); }
    var title = type === 'likes' ? 'MI PIACE' : 'NON MI PIACE';
    tip.innerHTML = names.length ? '<strong style="color:#5b6577;font-size:10px;display:block;margin-bottom:4px;">'+title+'</strong>'+names.join('<br>') : (type === 'likes' ? 'Nessun like ancora.' : 'Nessun dislike ancora.');
  } else {
    for (j=0;j<hn_posts.length;j++) {
      if (hn_posts[j].sharedPost && hn_posts[j].sharedPost.id===pid) names.push(hnEsc(hnAuthorOf(hn_posts[j]).name || 'Utente Cancellato'));
    }
    tip.innerHTML = names.length ? '<strong style="color:#5b6577;font-size:10px;display:block;margin-bottom:4px;">CONDIVISIONI</strong>'+names.join('<br>') : 'Nessuna condivisione ancora.';
  }
  tip.style['display'] = 'block';
  tip.style['z-index'] = '99998';
  var rect = (e.currentTarget || e.target).getBoundingClientRect();
  tip.style['left'] = rect.left + 'px';
  tip.style['top'] = (rect.bottom + 6) + 'px';
}
function hnHideTooltip() {
  var tip = document.getElementById('hn-tooltip');
  if (tip) tip.style['display'] = 'none';
}

/* ── MODIFICA / ELIMINA ── */
function hnMarkEditing(pid) {
  var el = document.getElementById('hn-p-'+pid);
  if (!el) return;
  el._hnEditing = true;
  if (el._hnParts) { delete el._hnParts.text; delete el._hnParts.comments; }
}
function hnEndEdit(pid) {
  var el = document.getElementById('hn-p-'+pid);
  if (el) {
    el._hnEditing = false;
    if (el._hnParts) { delete el._hnParts.text; delete el._hnParts.comments; }
  }
  hnRenderFeed();
}
function hnEditRowHtml(pid, saveCall) {
  return '<div class="hn-edit-row">'+
    '<button class="hn-cancel-btn" onclick="hnEndEdit(\''+pid+'\')">Annulla</button>'+
    '<button class="hn-save-btn" onclick="'+saveCall+'">Salva</button>'+
    '</div>';
}

function hnEditPost(pid) {
  var post = hnGetPostById(pid);
  if (!post) return;
  var el = document.getElementById('hn-pt-'+pid);
  if (!el) return;
  hnMarkEditing(pid);
  el.innerHTML = '<textarea class="hn-inline-edit" id="hn-pe-'+pid+'" maxlength="280" oninput="hnMentionCheck(this);" onkeydown="hnMentionKey(event,this);" onblur="setTimeout(hnMentionHide,150);">'+hnEscVal(post.text)+'</textarea>'+
    hnEditRowHtml(pid, 'hnSavePost(\''+pid+'\')');
}
function hnSavePost(pid) {
  var ta = document.getElementById('hn-pe-'+pid);
  if (!ta) return;
  var text = ta.value.trim();
  var cur = hnGetPostById(pid);
  if (!text && !(cur && cur.sharedPost)) return;
  if (text.length > 280) { alert('Il post supera il limite di 280 caratteri.'); return; }
  hnMutatePost(pid, function(post, res) {
    res.old = post.text;
    post.text = text;
    post.edited = true;
  }, function(post, res) {
    hnEndEdit(pid);
    hnNotifMentionsAll(text, pid, text, null, res.old);
  }, function() { alert('Errore nel salvataggio.'); });
}
function hnDeletePost(pid) {
  if (!confirm('Eliminare questo post?')) return;
  hnDeletePost_fb(pid, function(){}, function(){ alert('Errore nell\'eliminazione.'); });
}

function hnEditComment(pid, cId) {
  var c = hnFindComment(hnGetPostById(pid), cId);
  if (!c) return;
  var key = pid + '_' + cId;
  var el = document.getElementById('hn-ct-'+key);
  if (!el) return;
  hnMarkEditing(pid);
  el.innerHTML = '<textarea class="hn-inline-edit-small" id="hn-ce-'+key+'" style="resize:vertical!important;min-height:34px!important;" oninput="hnMentionCheck(this);" onkeydown="hnMentionKey(event,this);" onblur="setTimeout(hnMentionHide,150);">'+hnEscVal(c.text)+'</textarea>'+
    hnEditRowHtml(pid, 'hnSaveComment(\''+pid+'\',\''+cId+'\')');
}
function hnSaveComment(pid, cId) {
  var inp = document.getElementById('hn-ce-'+pid+'_'+cId);
  if (!inp) return;
  var text = inp.value.trim(); if (!text) return;
  hnMutatePost(pid, function(post, res) {
    var c = hnFindComment(post, cId);
    if (!c) return false;
    res.old = c.text; res.ptext = post.text;
    c.text = text; c.edited = true;
  }, function(post, res) {
    hnEndEdit(pid);
    hnNotifMentionsAll(text, pid, res.ptext, {c:cId}, res.old);
  }, function() { alert('Errore nel salvataggio.'); });
}
function hnDeleteComment(pid, cId) {
  if (!confirm('Eliminare questo commento?')) return;
  hnMutatePost(pid, function(post) {
    for (var i=0;i<post.comments.length;i++) { if (String(post.comments[i].id) === String(cId)) { post.comments.splice(i,1); return; } }
    return false;
  }, null, function() { alert('Errore nell\'eliminazione.'); });
}

function hnEditReply(pid, cId, rId) {
  var r = hnFindReply(hnGetPostById(pid), cId, rId);
  if (!r) return;
  var key = pid + '_' + cId + '_' + rId;
  var el = document.getElementById('hn-rt-'+key);
  if (!el) return;
  hnMarkEditing(pid);
  el.innerHTML = '<textarea class="hn-inline-edit-small" id="hn-re-'+key+'" style="resize:vertical!important;min-height:34px!important;" oninput="hnMentionCheck(this);" onkeydown="hnMentionKey(event,this);" onblur="setTimeout(hnMentionHide,150);">'+hnEscVal(r.text)+'</textarea>'+
    hnEditRowHtml(pid, 'hnSaveReply(\''+pid+'\',\''+cId+'\',\''+rId+'\')');
}
function hnSaveReply(pid, cId, rId) {
  var inp = document.getElementById('hn-re-'+pid+'_'+cId+'_'+rId);
  if (!inp) return;
  var text = inp.value.trim(); if (!text) return;
  hnMutatePost(pid, function(post, res) {
    var r = hnFindReply(post, cId, rId);
    if (!r) return false;
    res.old = r.text;
    r.text = text; r.edited = true;
  }, function(post, res) {
    hnEndEdit(pid);
    hnNotifMentionsAll(text, pid, text, {c:cId, r:rId}, res.old);
  }, function() { alert('Errore nel salvataggio.'); });
}
function hnDeleteReply(pid, cId, rId) {
  if (!confirm('Eliminare questa risposta?')) return;
  hnMutatePost(pid, function(post) {
    var c = hnFindComment(post, cId);
    if (!c) return false;
    for (var i=0;i<c.replies.length;i++) { if (String(c.replies[i].id) === String(rId)) { c.replies.splice(i,1); return; } }
    return false;
  }, null, function() { alert('Errore nell\'eliminazione.'); });
}

/* ── COMPOSE: LINK E SONDAGGIO ── */
var hn_share_pid = null;
var hn_link_url = '';
var hn_link_title = '';
var hn_link_image = '';
var hn_poll_options = [];
var hn_poll_deadline_val = '';

function hnToggleLinkRow() {
  var row = document.getElementById('hn-linkurl-row');
  if (!row) return;
  if (row.style['display'] === 'none' || row.style['display'] === '') {
    row.style['display'] = 'flex';
  } else {
    row.style['display'] = 'none';
    hn_link_url = '';
    hn_link_title = '';
    var li = document.getElementById('hn-linkurl');
    var lt = document.getElementById('hn-linktitle');
    if (li) li.value = '';
    if (lt) lt.value = '';
    hnClearLinkPreview();
  }
}
function hnTogglePollCompose() {
  var pc = document.getElementById('hn-poll-compose');
  if (!pc) return;
  if (pc.style['display'] === 'none' || pc.style['display'] === '') {
    pc.style['display'] = 'block';
    hn_poll_options = ['',''];
    hn_poll_deadline_val = '';
    hnRenderPollCompose();
  } else {
    pc.style['display'] = 'none';
    hn_poll_options = [];
    hn_poll_deadline_val = '';
  }
}

function hnRenderPollCompose() {
  var pc = document.getElementById('hn-poll-compose');
  if (!pc) return;
  var dl_cur = document.getElementById('hn-poll-deadline');
  if (dl_cur) hn_poll_deadline_val = dl_cur.value;
  var html = '<div style="font-size:11px!important;color:#8892a4!important;margin-bottom:6px!important;">Opzioni sondaggio:</div>';
  for (var i=0;i<hn_poll_options.length;i++) {
    html += '<div style="display:flex!important;gap:4px!important;margin-bottom:4px!important;">'+
      '<input type="text" id="hn-poll-opt-'+i+'" value="'+hnEscAttr(hn_poll_options[i])+'" placeholder="Opzione '+(i+1)+'..." maxlength="80" '+
      'style="flex:1!important;font-family:DM Sans,sans-serif!important;font-size:12px!important;border:1px solid #313846!important;border-radius:6px!important;padding:4px 8px!important;background:#1e2128!important;color:#e2e8f0!important;outline:none!important;" '+
      'oninput="hn_poll_options['+i+']=this.value">'+
      (hn_poll_options.length>2?'<button onclick="hnRemovePollOpt('+i+')" style="background:none!important;border:none!important;color:#5b6577!important;cursor:pointer!important;font-size:14px!important;">×</button>':'')+
      '</div>';
  }
  if (hn_poll_options.length < 8) {
    html += '<button onclick="hnAddPollOpt()" style="font-size:11px!important;color:#5b9cf6!important;background:none!important;border:none!important;cursor:pointer!important;padding:0!important;">+ Aggiungi opzione</button>';
  }
  html += '<div style="margin-top:8px!important;font-size:11px!important;color:#8892a4!important;margin-bottom:4px!important;">Scadenza (opzionale):</div>';
  html += '<input type="datetime-local" id="hn-poll-deadline" style="width:100%!important;font-family:DM Sans,sans-serif!important;font-size:12px!important;border:1px solid #313846!important;border-radius:6px!important;padding:4px 8px!important;background:#1e2128!important;color:#e2e8f0!important;outline:none!important;">';
  pc.innerHTML = html;
  var dl_el = document.getElementById('hn-poll-deadline');
  if (dl_el && hn_poll_deadline_val) dl_el.value = hn_poll_deadline_val;
}

function hnAddPollOpt() {
  if (hn_poll_options.length >= 8) return;
  hn_poll_options.push('');
  hnRenderPollCompose();
}

function hnRemovePollOpt(idx) {
  hn_poll_options.splice(idx,1);
  hnRenderPollCompose();
}

/* ── MENZIONI (autocompletamento) ── */
var hn_mention_target = null;
var hn_mention_sel = -1;

function hnOpenProfileByHandle(handle) {
  var p = hnProfileByHandle(handle);
  if (p) hnOpenProfile(p.id);
}

function hnMentionCheck(el) {
  var val = el.value;
  var pos = el.selectionStart;
  var before = val.substring(0, pos);
  var query = '';
  var foundAt = false;
  for (var i = before.length - 1; i >= 0; i--) {
    var ch = before.charAt(i);
    if (/[a-zA-Z0-9_]/.test(ch)) {
      query = ch + query;
    } else if (ch === '@') {
      foundAt = true;
      break;
    } else {
      break;
    }
  }
  if (!foundAt) { hnMentionHide(); return; }
  var q = query.toLowerCase();
  var results = [];
  for (var j = 0; j < hn_profiles.length && results.length < 5; j++) {
    var p = hn_profiles[j];
    if ((p.handle||'').toLowerCase().indexOf(q) === 0 || (p.name||'').toLowerCase().indexOf(q) === 0) results.push(p);
  }
  for (var gi=0; gi<HN_GROUPS.length && results.length < 7; gi++) {
    if (HN_GROUPS[gi].handle.indexOf(q) === 0) results.push({name:HN_GROUPS[gi].name, handle:HN_GROUPS[gi].handle, color:HN_GROUPS[gi].color, avatar:''});
  }
  if (!results.length) { hnMentionHide(); return; }
  hn_mention_target = el;
  hn_mention_sel = -1;
  hnMentionShow(results, el);
}

function hnMentionShow(results, el) {
  var drop = document.getElementById('hn-mention-drop');
  var html = '';
  for (var i = 0; i < results.length; i++) {
    var p = results[i];
    html += '<div class="hn-mention-item" data-handle="'+hnEsc(p.handle)+'" onmousedown="hnMentionPick(\''+hnEsc(p.handle)+'\')">'+
      hnAvHtml(p.color, p.avatar||'', p.name, 'hn-mention-av', null)+
      '<div style="margin:0!important;text-align:left!important;">'+
      '<div class="hn-mention-name">'+hnEsc(p.name)+'</div>'+
      '<div class="hn-mention-handle">@'+hnEsc(p.handle)+'</div>'+
      '</div></div>';
  }
  drop.innerHTML = html;
  var rect = el.getBoundingClientRect();
  drop.style['position'] = 'fixed';
  drop.style['left'] = rect.left + 'px';
  drop.style['top'] = (rect.bottom + 4) + 'px';
  drop.style['display'] = 'block';
  drop.style['z-index'] = '99999';
}

function hnMentionHide() {
  var drop = document.getElementById('hn-mention-drop');
  if (drop) drop.style['display'] = 'none';
  hn_mention_target = null;
  hn_mention_sel = -1;
}

function hnMentionPick(handle) {
  if (!hn_mention_target) return;
  var el = hn_mention_target;
  var val = el.value;
  var pos = el.selectionStart;
  var before = val.substring(0, pos);
  var after = val.substring(pos);
  var atIdx = -1;
  for (var i = before.length - 1; i >= 0; i--) {
    var ch = before.charAt(i);
    if (/[a-zA-Z0-9_]/.test(ch)) continue;
    if (ch === '@') { atIdx = i; break; }
    break;
  }
  if (atIdx === -1) { hnMentionHide(); return; }
  var newBefore = before.substring(0, atIdx) + '@' + handle + ' ';
  el.value = newBefore + after;
  el.focus();
  el.setSelectionRange(newBefore.length, newBefore.length);
  hnMentionHide();
  if (el.id === 'hn-textarea') hnUpdateChar();
}

function hnMentionKey(e, el) {
  var drop = document.getElementById('hn-mention-drop');
  if (!drop || drop.style['display'] === 'none') return;
  var items = drop.querySelectorAll('.hn-mention-item');
  if (!items.length) return;
  var i;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    hn_mention_sel = Math.min(hn_mention_sel + 1, items.length - 1);
    for (i = 0; i < items.length; i++) { if (i === hn_mention_sel) items[i].classList.add('hn-msel'); else items[i].classList.remove('hn-msel'); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    hn_mention_sel = Math.max(hn_mention_sel - 1, 0);
    for (i = 0; i < items.length; i++) { if (i === hn_mention_sel) items[i].classList.add('hn-msel'); else items[i].classList.remove('hn-msel'); }
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    if (hn_mention_sel >= 0 && items[hn_mention_sel]) {
      e.preventDefault();
      hnMentionPick(items[hn_mention_sel].getAttribute('data-handle'));
    }
  } else if (e.key === 'Escape') {
    hnMentionHide();
  }
}

/* ── CONDIVISIONE ── */
/* Ricondividere una condivisione "vuota" (senza testo proprio) condivide direttamente l'originale */
function hnShareTarget(post) {
  if (post.sharedPost && !post.text && !post.imgUrl && !post.linkUrl && !post.poll) {
    var root = hnGetPostById(post.sharedPost.id);
    if (root) return root;
  }
  return post;
}

function hnOpenShare(pid) {
  if (!hn_user) { hnOpenModal('auth'); return; }
  var post = hnGetPostById(pid);
  if (!post) return;
  var target = hnShareTarget(post);
  hn_share_pid = target.id;
  var a = hnAuthorOf(target);
  var first = hnMediaList(target)[0] || '';
  var yt = hnYtId(first);
  var img = hnSafeUrl(first);
  document.getElementById('hn-share-text').value = '';
  document.getElementById('hn-share-preview').innerHTML =
    '<div class="hn-shared-label">Post di '+hnEsc(a.name)+'</div>'+
    '<div class="hn-shared-author">'+hnEsc(a.name)+' <span style="color:#5b6577!important;">@'+hnEsc(a.handle)+'</span></div>'+
    (target.text ? '<div class="hn-shared-text">'+hnFormatText(target.text)+'</div>' : '')+
    (yt ? '<img src="https://i.ytimg.com/vi/'+yt+'/hqdefault.jpg" style="max-width:100%;max-height:120px;border-radius:6px;margin-top:6px;object-fit:cover;display:block;" alt="">' :
      (img ? '<img src="'+hnEsc(img)+'" style="max-width:100%;max-height:120px;border-radius:6px;margin-top:6px;object-fit:cover;display:block;" onerror="this.style.display=\'none\'">' : ''))+
    (hnSafeUrl(target.linkUrl) ? '<div class="hn-shared-meta">&#128279; '+hnEsc(target.linkTitle || target.linkDisplay || target.linkUrl)+'</div>' : '');
  document.getElementById('hn-share-err').style['display'] = 'none';
  hnOpenModal('share');
}

function hnDoShare() {
  if (!hn_user || !hn_share_pid) return;
  var orig = hnGetPostById(hn_share_pid);
  if (!orig) return hnShowErr('hn-share-err','Il post non è più disponibile.');
  var text = document.getElementById('hn-share-text').value.trim();
  if (text.length > 280) return hnShowErr('hn-share-err','Il commento supera il limite di 280 caratteri.');
  var btn = document.querySelector('#hn-modal-share .hn-dbtn');
  btn.disabled = true; btn.textContent = '...';
  var a = hnAuthorOf(orig);
  var newPost = {
    id: hnUid(),
    authorId: hn_user.id, authorName: hn_user.name,
    authorHandle: hn_user.handle, authorColor: hn_user.color,
    authorAvatar: hn_user.avatar || '', authorRank: hn_user.rank,
    text: text, imgUrl: '', linkUrl: '', linkTitle: '', linkImage: '', mood: '',
    likes: [], dislikes: [], comments: [],
    sharedPost: {
      id: orig.id, authorId: orig.authorId,
      authorName: a.name, authorHandle: a.handle,
      text: orig.text || '', imgUrl: orig.imgUrl || '', images: hnArr(orig.images),
      linkUrl: orig.linkUrl || '', linkTitle: orig.linkTitle || '', linkImage: orig.linkImage || '',
      linkDisplay: orig.linkDisplay || ''
    },
    createdAt: new Date().toISOString()
  };
  hnSavePost_fb(newPost,
    function() {
      hnCloseModal('share'); btn.disabled=false; btn.textContent='Condividi';
      if (orig.authorId !== hn_user.id) hnCreateNotif(orig.authorId, 'share', newPost.id, orig.text, {ref:{orig:orig.id}});
      if (text) hnNotifMentionsAll(text, newPost.id, text, null, '');
      hnGoToPost(newPost.id, false);
    },
    function() { hnShowErr('hn-share-err','Errore nella condivisione. Riprova.'); btn.disabled=false; btn.textContent='Condividi'; }
  );
}

/* ── PRESENZA ── */
function hnUpdatePresence() {
  if (!hn_user) return;
  var now = new Date().toISOString();
  hn_user.last_seen = now;
  hn_fb_ref('hunternet/profiles/'+hn_user.id+'/last_seen').set(now).catch(function(){});
}

function hnIsOnline(prof) {
  if (!prof || !prof.last_seen) return false;
  return (Date.now() - new Date(prof.last_seen).getTime()) < 2100000; /* 35 minuti */
}

/* Follower fittizi: ogni follower reale vale HN_FOLLOWER_MULT */
var HN_FOLLOWER_MULT = 10000;
var HN_LIKE_MULT = 3756; /* solo per il totale "Like ricevuti" nel profilo */
function hnFmtCount(n) {
  if (n >= 1000000) return String(parseFloat((n/1000000).toFixed(1))).replace('.', ',') + 'M';
  if (n >= 1000)    return String(parseFloat((n/1000).toFixed(1))).replace('.', ',') + 'K';
  return String(n);
}

function hnShareCount(pid) {
  var n = 0;
  for (var i = 0; i < hn_posts.length; i++) {
    if (hn_posts[i].sharedPost && hn_posts[i].sharedPost.id === pid) n++;
  }
  return n;
}

function hnOnlineDot(prof) {
  var online = hnIsOnline(prof);
  return '<span style="display:inline-block!important;width:8px!important;height:8px!important;border-radius:50%!important;background:'+(online?'#5cb878':'#5b6577')+'!important;margin-left:3px!important;vertical-align:middle!important;" title="'+(online?'Online':'Offline')+'"></span>';
}

/* Presenza aggiornata al login e ogni 30 minuti; sondaggi scaduti controllati ogni minuto */
setInterval(function() {
  if (!hn_user) return;
  hnUpdatePresence();
}, 1800000);

setInterval(function() {
  hnCheckPollExpiry();
}, 60000);

hnInit();
