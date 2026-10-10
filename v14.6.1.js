function hnGoHome() {
  hn_tab_cur = 'all';
  hn_filter_user_id = null;
  hn_search_active = false;
  var inp = document.getElementById('hn-search-inp');
  if (inp) inp.value = '';
  var box = document.getElementById('hn-search-users');
  if (box) box.style['display'] = 'none';
  var userTab = document.getElementById('hn-tab-user');
  if (userTab) userTab.style['display'] = 'none';
  var tabs = document.querySelectorAll('.hn-tab');
  for (var i=0;i<tabs.length;i++) tabs[i].classList.remove('hn-active');
  var allTab = tabs[0]; if (allTab) allTab.classList.add('hn-active');
  if (hn_data_ready) {
    hnRenderFeed();
    hnRenderSidebar();
    hnBuildHashtags();
  }
}


function hnCheckPollExpiry() {
  hnCheckPollExpiryRun();
}
function hnCheckPollExpiryRun() {
  var changed = false;
  for (var i=0;i<hn_posts.length;i++) {
    var p = hn_posts[i];
    if (!p.poll || p.poll.closed || p.poll.notified) continue;
    if (!p.poll.deadline) continue;
    if (new Date(p.poll.deadline) > new Date()) continue;
    p.poll.closed = true;
    changed = true;
    var win_opt = null; var win_votes = -1;
    for (var oi=0;oi<p.poll.options.length;oi++) {
      var vc = (p.poll.options[oi].votes||[]).length;
      if (vc > win_votes) { win_votes=vc; win_opt=p.poll.options[oi].text; }
    }
    var voters = {};
    for (var oi=0;oi<p.poll.options.length;oi++) {
      var vs = p.poll.options[oi].votes||[];
      for (var vi=0;vi<vs.length;vi++) voters[vs[vi]]=true;
    }
    for (var uid in voters) {
      hnCreateNotif(uid,'mention',p.id,'Il sondaggio è terminato! Ha vinto: '+(win_opt||'?'));
    }
    p.poll.notified = true;
  }
  if (changed) {
    var to_save = [];
    for (var si=0;si<hn_posts.length;si++) { if(hn_posts[si].poll&&hn_posts[si].poll.notified) to_save.push(hn_posts[si]); }
    for (var ti=0;ti<to_save.length;ti++) hnSavePost_fb(to_save[ti],function(){},function(){});
    setTimeout(hnRenderFeed, 500);
  }
}
/* ── FIREBASE CONFIG ── */
/* Config loaded from window.HN_FB_CONFIG set in HTML */
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
    // Already initialized
    hn_fb_app = firebase.app();
  }
  hn_fb_db = firebase.database();
  if (callback) callback();
}

function hn_fb_ref(path) { return hn_fb_db.ref(path); }

/* Firebase CRUD helpers */
function hn_fb_get(path, ok, fail) {
  hn_fb_ref(path).once('value')
    .then(function(snap) { ok(snap.val()); })
    .catch(fail || function(){});
}
function hn_fb_set(path, data, ok, fail) {
  hn_fb_ref(path).set(data).then(ok||function(){}).catch(fail||function(){});
}
function hn_fb_update(path, data, ok, fail) {
  hn_fb_ref(path).update(data)
    .then(ok || function(){})
    .catch(fail || function(){});
}
function hn_fb_remove(path, ok, fail) {
  hn_fb_ref(path).remove()
    .then(ok || function(){})
    .catch(fail || function(){});
}
function hn_fb_push(path, data, ok, fail) {
  hn_fb_ref(path).push(data)
    .then(ok || function(){})
    .catch(fail || function(){});
}
var hn_tags     = ['#notizie'];
var hn_colors   = ['#c0392b','#e67e22','#f39c12','#27ae60','#16a085','#2980b9','#8e44ad','#2c3e50','#d35400','#1abc9c'];

var hn_user     = null;
var hn_notifs   = [];
var hn_creds    = [];
var hn_profiles = [];
var hn_posts    = [];
var hn_tab_cur   = 'all';
var hn_filter_user_id = null;
var hn_sel_color = hn_colors[5];
var hn_search_active = false;
var hn_online_users = {};
var hn_data_ready = false;


/* ── RICERCA ── */
function hnSearch(query) {
  query = query.trim().toLowerCase();
  if (!query) { hn_search_active = false; if (hn_data_ready) hnRenderFeed(); hnRenderSearchUsers([]); return; }
  hn_search_active = true;
  hnFixLayout();
  var list = document.getElementById('hn-posts');
  var fp = [];
  for (var i=0;i<hn_posts.length;i++) {
    var p = hn_posts[i];
    if (p.text.toLowerCase().indexOf(query)!==-1 ||
        p.authorName.toLowerCase().indexOf(query)!==-1 ||
        p.authorHandle.toLowerCase().indexOf(query)!==-1) {
      fp.push(p);
    }
  }
  if (!fp.length) { list.innerHTML='<div class="hn-msg">Nessun risultato per "'+hnEsc(query)+'".</div>'; }
  else { var html=''; for (var j=0;j<fp.length;j++) html+=hnRenderPost(fp[j]); list.innerHTML=html; }
  var users = [];
  for (var k=0;k<hn_profiles.length;k++) {
    var pr = hn_profiles[k];
    if (pr.name.toLowerCase().indexOf(query)!==-1 || pr.handle.toLowerCase().indexOf(query)!==-1) users.push(pr);
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
    html+='<div class="hn-mention-item" onclick="hnCloseSearch();hnOpenProfile(\''+u.id+'\')">'
      hnAvHtml(u.color,u.avatar||'',u.name,'hn-mention-av',null)+
      '<div style="margin:0!important;">'+
      '<div class="hn-mention-name">'+hnEsc(u.name)+hnVerifiedBadge(u)+'</div>'+
      '<div class="hn-mention-handle">@'+hnEsc(u.handle)+'</div></div></div>';
  }
  box.innerHTML=html;
}

function hnCloseSearch() {
  var inp = document.getElementById('hn-search-inp');
  if (inp) inp.value='';
  var box = document.getElementById('hn-search-users');
  if (box) box.style['display']='none';
  hn_search_active = false;
  if (hn_data_ready) hnRenderFeed();
}


/* ── FIREBASE REALTIME LISTENERS ── */
var hn_fb_posts_listener = null;
var hn_fb_profiles_listener = null;

function hnFbNotifsFlat(d) {
  var out = [];
  for (var uid in d) {
    var user_notifs = d[uid];
    for (var nid in user_notifs) {
      out.push(user_notifs[nid]);
    }
  }
  out.sort(function(a,b){ return new Date(b.created_at) - new Date(a.created_at); });
  return out;
}

var hn_posts_ready = false;
var hn_profiles_ready = false;

function hnUserIsTyping() {
  var active = document.activeElement;
  if (!active) return false;
  var tag = active.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    var id = active.id || '';
    if (id.indexOf('hn-ci-') === 0 || id.indexOf('hn-ri-') === 0 ||
        id.indexOf('hn-re-') === 0 || id.indexOf('hn-ce-') === 0 ||
        id === 'hn-textarea' || id === 'hn-share-text' || id === 'hn-search-inp') {
      return true;
    }
  }
  return false;
}

function hnFbRenderAll() {
  if (!hn_posts_ready || !hn_profiles_ready) return;
  hn_data_ready = true;
  if (!hnUserIsTyping()) {
    hnRenderFeed();
  }
  hnRenderSidebar();
  hnBuildHashtags();
  hnCheckPollExpiry();
}

function hnFbListenPosts() {
  if (hn_fb_posts_listener) return;
  hn_fb_posts_listener = true;
  hn_fb_ref('hunternet/posts').on('value', function(snap) {
    var d = snap.val();
    if (d) {
      var new_posts = Object.values(d);
      new_posts.sort(function(a,b){ return new Date(b.createdAt)-new Date(a.createdAt); });
      hn_posts = new_posts;
      hn_posts_ready = true;
    } else if (!hn_posts_ready) {
      hn_posts = [];
      hn_posts_ready = true;
    }
    // if d is null but hn_posts_ready is already true, keep existing hn_posts
    hnFbRenderAll();
  });
}

function hnFbListenProfiles() {
  if (hn_fb_profiles_listener) return;
  hn_fb_profiles_listener = true;
  hn_fb_ref('hunternet/profiles').on('value', function(snap) {
    var d = snap.val();
    if (d) {
      hn_profiles = Object.values(d);
      hn_profiles_ready = true;
    } else if (!hn_profiles_ready) {
      hn_profiles = [];
      hn_profiles_ready = true;
    }
    hnFbRenderAll();
  });
}

var hn_deleted_notif_ids = {};
var hn_read_notif_ids = {};

function hnFbListenNotifs(uid) {
  hn_fb_ref('hunternet/notifications/'+uid).on('value', function(snap) {
    var d = snap.val();
    var fresh = d ? Object.values(d) : [];
    var merged = [];
    for (var j=0;j<fresh.length;j++) {
      var n = fresh[j];
      if (hn_deleted_notif_ids[n.id]) continue;
      if (hn_read_notif_ids[n.id]) n.read = true;
      var local = null;
      for (var k=0;k<hn_notifs.length;k++) { if (hn_notifs[k].id===n.id){local=hn_notifs[k];break;} }
      merged.push(local || n);
    }
    hn_notifs = merged;
    hn_notifs.sort(function(a,b){ return new Date(b.created_at) - new Date(a.created_at); });
    hnUpdateBadge();
  });
}

function hnIsAdmin() {
  if (!hn_user) return false;
  var prof = hnProfileById(hn_user.id);
  return prof && prof.admin === true;
}

function hnGetPostById(pid) {
  for (var i=0;i<hn_posts.length;i++) { if(hn_posts[i].id===pid) return hn_posts[i]; }
  return null;
}

/* Save a single post by ID (never overwrites other posts) */
function hnSavePost_fb(post, ok, fail) {
  hn_fb_ref('hunternet/posts/'+post.id).set(post).then(ok||function(){}).catch(fail||function(){});
}

/* Delete a single post by ID */
function hnDeletePost_fb(postId, ok, fail) {
  hn_fb_ref('hunternet/posts/'+postId).remove().then(ok||function(){}).catch(fail||function(){});
}

/* Save entire posts array (ONLY for poll expiry bulk update) */
function hnSavePosts(ok, fail) {
  var obj = {};
  for (var i=0;i<hn_posts.length;i++) obj[hn_posts[i].id] = hn_posts[i];
  hn_fb_ref('hunternet/posts').set(obj).then(ok||function(){}).catch(fail||function(){});
}

/* Save single profile by ID */
function hnSaveProfile_fb(prof, ok, fail) {
  hn_fb_ref('hunternet/profiles/'+prof.id).set(prof).then(ok||function(){}).catch(fail||function(){});
}

/* Save entire profiles array - AVOID using this, prefer hnSaveProfile_fb */
function hnSaveProfiles(ok, fail) {
  var obj = {};
  for (var i=0;i<hn_profiles.length;i++) obj[hn_profiles[i].id] = hn_profiles[i];
  hn_fb_ref('hunternet/profiles').set(obj).then(ok||function(){}).catch(fail||function(){});
}

/* Save single credential */
function hnSaveCred_fb(cred, ok, fail) {
  hn_fb_ref('hunternet/credentials/'+cred.id).set(cred).then(ok||function(){}).catch(fail||function(){});
}
/* Save all credentials (legacy - avoid) */
function hnSaveCreds(ok, fail) {
  var obj = {};
  for (var i=0;i<hn_creds.length;i++) obj[hn_creds[i].id] = hn_creds[i];
  hn_fb_ref('hunternet/credentials').set(obj).then(ok||function(){}).catch(fail||function(){});
}

/* Save single notif for a user */
function hnSaveNotif(notif, ok, fail) {
  hn_fb_ref('hunternet/notifications/'+notif.to_id+'/'+notif.id).set(notif).then(ok).catch(fail);
}

/* Delete single notif */
function hnDeleteNotifFb(to_id, nid, ok, fail) {
  hn_fb_remove('hunternet/notifications/'+to_id+'/'+nid, ok, fail);
}

/* Delete all notifs for user */
function hnDeleteAllNotifsFb(uid, ok, fail) {
  hn_fb_remove('hunternet/notifications/'+uid, ok, fail);
}

/* Mark notif as read */
function hnMarkNotifReadFb(to_id, nid) {
  hn_fb_ref('hunternet/notifications/'+to_id+'/'+nid+'/read').set(true).catch(function(){});
}




/* ── COMMENT EDITOR MODAL ── */
var hn_cedit_mode = null;
var hn_cedit_pid  = null;
var hn_cedit_ci   = null;
var hn_cedit_emoji_open = false;

function hnCEditOpen(mode, pid, ci, placeholder, title) {
  hn_cedit_mode = mode;
  hn_cedit_pid  = pid;
  hn_cedit_ci   = (ci !== undefined && ci !== null) ? ci : null;
  var overlay = document.getElementById('hn-cedit-overlay');
  var ta      = document.getElementById('hn-cedit-textarea');
  var titleEl = document.getElementById('hn-cedit-title');
  var sendBtn = document.getElementById('hn-cedit-send');
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
  hn_cedit_mode = null; hn_cedit_pid = null; hn_cedit_ci = null;
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
  if (!hn_emoji_picker_el) {
    if (typeof EmojiMart === 'undefined') return;
    hn_emoji_picker_el = new EmojiMart.Picker({
      locale:'it', theme:'dark', set:'native',
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
  }
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
  if (row) row.classList.remove('hn-vis');
  if (url) { url.value = ''; url.oninput = null; }
  if (tit) tit.value = '';
  if (prev) prev.classList.remove('hn-vis');
}

function hnCEditSubmit() {
  var ta = document.getElementById('hn-cedit-textarea');
  if (!ta) return;
  var text = ta.value.trim();
  if (!text) return;
  var imgUrl    = document.getElementById('hn-cedit-imgurl') ? document.getElementById('hn-cedit-imgurl').value.trim() : '';
  var linkUrl   = document.getElementById('hn-cedit-linkurl') ? document.getElementById('hn-cedit-linkurl').value.trim() : '';
  var linkTitle = document.getElementById('hn-cedit-linktitle') ? document.getElementById('hn-cedit-linktitle').value.trim() : '';
  var linkImg   = document.getElementById('hn-cedit-link-preview-img') ? document.getElementById('hn-cedit-link-preview-img').src : '';
  var mode = hn_cedit_mode;
  var pid  = hn_cedit_pid;
  var ci   = hn_cedit_ci;
  hnCEditClose();
  if (mode === 'comment') {
    hnSubmitCommentFull(pid, text, imgUrl, linkUrl, linkTitle, linkImg);
  } else if (mode === 'reply') {
    hnSubmitReplyFull(pid, ci, text, imgUrl, linkUrl, linkTitle, linkImg);
  }
}


var hn_cedit_link_preview_timer = null;

function hnCEditLinkPreviewDebounce(url) {
  if (hn_cedit_link_preview_timer) clearTimeout(hn_cedit_link_preview_timer);
  var prev = document.getElementById('hn-cedit-link-preview');
  if (!url || url.indexOf('http') !== 0) {
    if (prev) prev.classList.remove('hn-vis');
    return;
  }
  hn_cedit_link_preview_timer = setTimeout(function() { hnCEditLinkPreviewFetch(url); }, 800);
}

function hnCEditLinkPreviewFetch(url) {
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
  var api = 'https://hunternet-proxy.a-f-avvento.workers.dev/?url=' + encodeURIComponent(url);
  fetch(api)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (spinner) spinner.style['display'] = 'none';
      var fetched_title = data.title || '';
      var fetched_img   = data.image || '';
      if (body_el) body_el.style['display'] = 'block';
      if (title_el) {
        title_el.textContent = fetched_title;
        var title_inp = document.getElementById('hn-cedit-linktitle');
        if (title_inp && !title_inp.value && fetched_title) {
          title_inp.value = fetched_title;
        }
      }
      if (url_el) url_el.textContent = url;
      if (fetched_img && img_el) {
        img_el.src = fetched_img;
        img_el.style['display'] = 'block';
      }
    })
    .catch(function() {
      if (spinner) spinner.style['display'] = 'none';
      if (body_el) body_el.style['display'] = 'block';
      if (title_el) title_el.textContent = '';
      if (url_el) url_el.textContent = url;
    });
}

/* ── LINK PREVIEW ── */
var hn_link_preview_timer = null;

function hnLinkPreviewDebounce(url) {
  if (hn_link_preview_timer) clearTimeout(hn_link_preview_timer);
  var prev = document.getElementById('hn-link-preview');
  if (!url || url.indexOf('http') !== 0) {
    if (prev) prev.classList.remove('hn-vis');
    return;
  }
  hn_link_preview_timer = setTimeout(function() { hnLinkPreviewFetch(url); }, 800);
}

function hnLinkPreviewFetch(url) {
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

  // Use Cloudflare Worker proxy
  var api = 'https://hunternet-proxy.a-f-avvento.workers.dev/?url=' + encodeURIComponent(url);
  fetch(api)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (spinner) spinner.style['display'] = 'none';
      var fetched_title = data.title || '';
      var fetched_img = data.image || '';
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
      hn_link_image = fetched_img || '';
      if (fetched_img && img_el) {
        img_el.src = fetched_img;
        img_el.style['display'] = 'block';
      }
    })
    .catch(function() {
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
  if (img_el) { img_el.src = ''; img_el.style['display'] = 'none'; }
  if (body_el) body_el.style['display'] = 'none';
  if (title_el) title_el.textContent = '';
  if (url_el) url_el.textContent = '';
}



/* ── ADMIN ── */
function hnAdminEditProfile(aid) {
  if (!hnIsAdmin()) return;
  var prof = hnProfileById(aid);
  if (!prof) return;
  hnOpenEditProfileFor(aid);
}

function hnAdminDeleteAccount(aid) {
  if (!hnIsAdmin()) return;
  var prof = hnProfileById(aid);
  if (!prof) return;
  if (!confirm('ADMIN: Eliminare l\'account di @' + prof.handle + '?\nQuesta azione è irreversibile.')) return;
  var uid = prof.id;
  // Remove from local arrays
  for (var di=hn_profiles.length-1;di>=0;di--) { if(hn_profiles[di].id===uid) { hn_profiles.splice(di,1); break; } }
  for (var di=hn_creds.length-1;di>=0;di--) { if(hn_creds[di].id===uid) { hn_creds.splice(di,1); break; } }
  // Delete from Firebase
  hn_fb_ref('hunternet/profiles/'+uid).remove();
  hn_fb_ref('hunternet/credentials/'+uid).remove();
  hn_fb_ref('hunternet/notifications/'+uid).remove();
  hnCloseModal('prof');
  alert('Account @' + prof.handle + ' eliminato.');
}

/* ── DELETE ACCOUNT ── */
function hnConfirmDeleteAccount() {
  if (!hn_user) return;
  if (!confirm('Sei sicura di voler eliminare il tuo account?\nQuesta azione è IRREVERSIBILE.\n\nVerranno eliminati: profilo, credenziali e notifiche.\nI tuoi post rimarranno visibili ma senza autore.')) return;
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
  var total = 3;
  function onDone() {
    done++;
    if (done < total) return;
    // Log out and clean up session
    var bye_handle = handle;
    // Remove from local arrays
    for (var di=hn_profiles.length-1;di>=0;di--) { if(hn_profiles[di].id===uid) { hn_profiles.splice(di,1); break; } }
    for (var di=hn_creds.length-1;di>=0;di--) { if(hn_creds[di].id===uid) { hn_creds.splice(di,1); break; } }
    hn_notifs = [];
    hn_deleted_notif_ids = {};
    hn_read_notif_ids = {};
    hnCloseModal('prof');
    hnLogout();
    alert('Account eliminato. Ciao ' + bye_handle + '!');
  }

  // Delete profile
  hn_fb_ref('hunternet/profiles/'+uid).remove().then(onDone).catch(onDone);
  // Delete credentials
  hn_fb_ref('hunternet/credentials/'+uid).remove().then(onDone).catch(onDone);
  // Delete notifications
  hn_fb_ref('hunternet/notifications/'+uid).remove().then(onDone).catch(onDone);
}

/* ── MOOD ── */
var hn_post_mood = '';

function hnToggleMoodCompose() {
  var mc = document.getElementById('hn-mood-compose');
  if (!mc) return;
  var is_open = mc.getAttribute('data-open') === '1';
  if (is_open) {
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
  // Position near the toolbar button
  var btn = document.getElementById('hn-tbtn-emoji');
  if (btn) {
    var rect = btn.getBoundingClientRect();
    wrap.style['left'] = rect.left + 'px';
    wrap.style['top'] = (rect.bottom + 6) + 'px';
  }
  // Create picker if not exists
  if (!hn_emoji_picker_el) {
    if (typeof EmojiMart === 'undefined') {
      alert('Emoji picker non disponibile. Riprova tra un momento.');
      return;
    }
    hn_emoji_picker_el = new EmojiMart.Picker({
      locale: 'it',
      theme: 'dark',
      set: 'native',
      onEmojiSelect: function(emoji) {
        hnInsertEmoji(emoji.native);
        wrap.style['display'] = 'none';
        hn_emoji_picker_open = false;
      },
      onClickOutside: function() {
        wrap.style['display'] = 'none';
        hn_emoji_picker_open = false;
      }
    });
    wrap.appendChild(hn_emoji_picker_el);
  }
  wrap.style['display'] = 'block';
  hn_emoji_picker_open = true;
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

/* ── HELPERS ── */
function hnHashPw(pw) { return pw; }


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
/* Legacy hnGET/hnPUT removed - Firebase used directly */
function hnVerifiedBadge(prof) {
  if (!prof || !prof.verified) return '';
  return '<span class="mdi mdi-check-decagram" style="color:#5b9cf6!important;font-size:14px!important;vertical-align:middle!important;" title="Utente verificato"></span>';
}

function hnInitials(name) {
  if (!name) return '?';
  var parts = name.trim().split(/\s+/); var r = '';
  for (var i = 0; i < parts.length; i++) if (parts[i]) r += parts[i].charAt(0).toUpperCase();
  return r.slice(0,2);
}
function hnEsc(s) {
  if (!s) return '';
  var amp = '\u0026amp;', lt = '\u0026lt;', gt = '\u0026gt;', qt = '\u0026quot;';
  return s.split('\u0026').join(amp).split('<').join(lt).split('>').join(gt).split('"').join(qt);
}
function hnAgo(iso) {
  var d = new Date(iso);
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
  var st = 'background:' + (color||'#888') + ';';
  if (size) st += 'width:' + size + 'px;height:' + size + 'px;';
  if (avatarUrl) {
    return '<div class="' + cls + '" style="' + st + '"><img src="' + hnEsc(avatarUrl) + '" alt="" onerror="this.style.display=\'none\'"></div>';
  }
  return '<div class="' + cls + '" style="' + st + '">' + hnInitials(name) + '</div>';
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
  hnFbInit(function() {
  var n = 0; var hasErr = false;
  function tryDone() {
    n++;
    if (n < 2) return;
    hnRestoreSession(); hnBuildHashtags();
    hnFbListenPosts();
    hnFbListenProfiles();
  }
  hn_fb_get('hunternet/credentials', function(d) {
    hn_creds = d ? Object.values(d) : [];
    tryDone();
  }, function(){ hasErr=true; tryDone(); });
  hn_fb_get('hunternet/notifications', function(d) {
    hn_notifs = d ? hnFbNotifsFlat(d) : [];
    tryDone();
  }, function(){ hn_notifs=[]; tryDone(); });
  }); // end hnFbInit callback
}

function hnRestoreSession() {
  var s = sessionStorage.getItem('hn_user');
  if (!s) return;
  try { hn_user = JSON.parse(s); hn_fb_get('hunternet/notifications/'+hn_user.id, function(d){ hn_notifs = d ? Object.values(d) : []; hn_notifs.sort(function(a,b){ return new Date(b.created_at) - new Date(a.created_at); }); hnUpdateBadge(); }, function(){}); hnFbListenNotifs(hn_user.id); hnSetLoggedIn(); if (hn_data_ready) hnRenderFeed(); } catch(e) {}
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
function hnDoLogin() {
  hnHideErr('hn-lerr');
  var handle = document.getElementById('hn-lhandle').value.trim().toLowerCase().replace('@','');
  var pass   = document.getElementById('hn-lpass').value;
  if (!handle || !pass) return hnShowErr('hn-lerr','Compila tutti i campi.');
  var cred = null;
  for (var i = 0; i < hn_creds.length; i++) {
    if (hn_creds[i].handle.toLowerCase() === handle) { cred = hn_creds[i]; break; }
  }
  if (!cred) return hnShowErr('hn-lerr','Nickname non trovato.');
  if (cred.password !== hnHashPw(pass)) return hnShowErr('hn-lerr','Codice non corretto.');
  var prof = null;
  for (var j = 0; j < hn_profiles.length; j++) {
    if (hn_profiles[j].id === cred.id) { prof = hn_profiles[j]; break; }
  }
  if (!prof) return hnShowErr('hn-lerr','Profilo non trovato. Contatta un admin.');
  hn_user = prof;
  sessionStorage.setItem('hn_user', JSON.stringify(hn_user));
  hn_fb_get('hunternet/notifications/'+prof.id, function(d) {
    hn_notifs = d ? Object.values(d) : [];
    hn_notifs.sort(function(a,b){ return new Date(b.created_at) - new Date(a.created_at); });
    hnUpdateBadge();
  }, function(){});
  hnFbListenNotifs(prof.id);
  hnCloseModal('auth');
  hnSetLoggedIn();
}

function hnDoRegister() {
  hnHideErr('hn-rerr');
  var name   = document.getElementById('hn-rname').value.trim();
  var handle = document.getElementById('hn-rhandle').value.trim().replace('@','');
  var rank   = document.getElementById('hn-rrank').value;
  var bio    = document.getElementById('hn-rbio').value.trim();
  var avatar = document.getElementById('hn-ravatar').value.trim();
  var pass   = document.getElementById('hn-rpass').value;
  if (!name || !handle || !rank || !pass) return hnShowErr('hn-rerr','Compila tutti i campi obbligatori.');
  if (handle.length < 3) return hnShowErr('hn-rerr','Nickname troppo corto (min 3 caratteri).');
  var hn_ok = true;
  for (var ci = 0; ci < handle.length; ci++) {
    var ch = handle.charCodeAt(ci);
    var isLower = ch >= 97 && ch <= 122;
    var isUpper = ch >= 65 && ch <= 90;
    var isDigit = ch >= 48 && ch <= 57;
    var isUnder = ch === 95;
    if (!isLower && !isUpper && !isDigit && !isUnder) { hn_ok = false; break; }
  }
  if (!hn_ok) return hnShowErr('hn-rerr','Nickname: solo lettere, numeri e _.');
  for (var i = 0; i < hn_creds.length; i++) {
    if (hn_creds[i].handle.toLowerCase() === handle.toLowerCase()) return hnShowErr('hn-rerr','Nickname già in uso.');
  }
  if (pass.length < 4) return hnShowErr('hn-rerr','Il codice deve essere di almeno 4 caratteri.');

  var id = String(Date.now());
  var pwHash = hnHashPw(pass);

  var newCred = { id:id, handle:handle, password:pwHash };
  var newProf = { id:id, name:name, handle:handle, rank:rank, bio:bio,
    color:hn_sel_color, avatar:avatar||'', createdAt:new Date().toISOString() };

  hn_creds.push(newCred);
  hn_profiles.push(newProf);

  var saved = 0; var errored = false;
  function onSaved() {
    saved++;
    if (saved < 2) return;
    if (errored) {
      hn_creds.pop(); hn_profiles.pop();
      hnShowErr('hn-rerr','Errore durante la registrazione. Riprova.');
      return;
    }
    hn_user = newProf;
    sessionStorage.setItem('hn_user', JSON.stringify(hn_user));
    hnCloseModal('reg'); hnSetLoggedIn(); hnRenderSidebar();
  }
  function onErr() { errored=true; onSaved(); }

  hnSaveCred_fb({id:id, handle:handle, password:pass}, onSaved, onErr);
  hnSaveProfile_fb(newProf, onSaved, onErr);
}

function hnSetLoggedIn() {
  hnUpdatePresence();
  document.getElementById('hn-lbanner').style['display'] = 'none';
  document.getElementById('hn-compose').classList.add('hn-vis');
  hnBellShow();
  var followTab = document.getElementById('hn-tab-following');
  if (followTab) followTab.style['display'] = 'inline-block';
  var av = document.getElementById('hn-cav');
  av.style.background = hn_user.color || '#888';
  if (hn_user.avatar) {
    av.innerHTML = '<img src="' + hnEsc(hn_user.avatar) + '" alt="" onerror="this.style.display=\'none\'">';
  } else {
    av.textContent = hnInitials(hn_user.name);
  }
  var br = document.getElementById('hn-bar-right');
  var avHtml = hnAvHtml(hn_user.color, hn_user.avatar, hn_user.name, 'hn-miniav', null);
  var my_dot = '<span style="position:absolute!important;bottom:0!important;right:0!important;width:8px!important;height:8px!important;border-radius:50%!important;background:#5cb878!important;border:1px solid #252932!important;"></span>';
  br.innerHTML = '<div id="hn-upill" onclick="hnOpenProfile(\'' + hn_user.id + '\')">' +
    '<div style="position:relative!important;display:inline-block!important;">' + avHtml + my_dot + '</div>' + '<span class="hn-pillname">@' + hn_user.handle + '</span></div>' +
    '<button class="hn-gbtn" onclick="hnLogout()">Esci</button>';
}

function hnLogout() {
  hn_user = null;
  sessionStorage.removeItem('hn_user');
  document.getElementById('hn-lbanner').style['display'] = 'flex';
  document.getElementById('hn-compose').classList.remove('hn-vis');
  document.getElementById('hn-bar-right').innerHTML =
    '<button class="hn-gbtn" onclick="hnOpenModal(\'auth\')">Accedi</button>' +
    '<button class="hn-dbtn" onclick="hnOpenModal(\'reg\')">Registrati</button>';
  hnBellHide();
  var followTab = document.getElementById('hn-tab-following');
  if (followTab) followTab.style['display'] = 'none';
  if (hn_tab_cur === 'following') { hn_tab_cur = 'all'; }
  if (hn_data_ready) hnRenderFeed();
}

/* ── AVATAR PREVIEW ── */
function hnPreviewAvatar() {
  var url = document.getElementById('hn-ravatar').value.trim();
  var prev = document.getElementById('hn-av-preview');
  prev.style.background = hn_sel_color;
  if (url) {
    prev.innerHTML = '<img src="'+hnEsc(url)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentNode.innerHTML=\'?\'">';
  } else {
    prev.innerHTML = hnInitials(document.getElementById('hn-rname').value) || '?';
  }
}

/* ── COMPOSE ── */
function hnFormatText(text) {
  if (!text) return '';
  var t = text.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');
  t = hnBBReplace(t, 'b', 'hn-fmt-b');
  t = hnBBReplace(t, 'i', 'hn-fmt-i');
  t = hnBBReplace(t, 'u', 'hn-fmt-u');
  t = hnBBReplace(t, 'bar', 'hn-fmt-s');
  t = t.replace(/(#[a-zA-Z0-9_]+)/g,'<span class="hn-hi" style="cursor:pointer!important;" onclick="hnFilterTag(\'$1\')">$1</span>');
  var group_handles = ['tutti','hunters','apprendisti','civili','lottatori'];
  t = t.replace(/@([a-zA-Z0-9_]+)/g, function(match, handle) {
    var hl = handle.toLowerCase();
    for (var gi = 0; gi < group_handles.length; gi++) {
      if (hl === group_handles[gi]) return '<span class="hn-mention">@' + handle + '</span>';
    }
    for (var i = 0; i < hn_profiles.length; i++) {
      if (hn_profiles[i].handle.toLowerCase() === hl)
        return '<span class="hn-mention" onclick="hnOpenProfileByHandle(\'' + handle + '\')">@' + handle + '</span>';
    }
    return match;
  });
  return t;
}

function hnRenderCommentMedia(item) {
  var html = '';
  if (item.imgUrl) {
    var yt = item.imgUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (yt) {
      html += '<div style="position:relative!important;padding-bottom:56.25%!important;height:0!important;margin-top:5px!important;border-radius:6px!important;overflow:hidden!important;"><iframe src="https://www.youtube.com/embed/'+yt[1]+'" style="position:absolute!important;top:0!important;left:0!important;width:100%!important;height:100%!important;border:none!important;" allowfullscreen></iframe></div>';
    } else {
      html += '<img src="'+hnEsc(item.imgUrl)+'" style="max-width:100%!important;max-height:200px!important;border-radius:6px!important;margin-top:5px!important;display:block!important;cursor:pointer!important;" onclick="hnOpenLightbox(this.src)" onerror="this.hidden=true">';
    }
  }
  if (item.linkUrl) {
    html += '<a href="'+hnEsc(item.linkUrl)+'" target="_blank" rel="noopener" style="display:block!important;text-decoration:none!important;border:1px solid #313846!important;border-radius:8px!important;overflow:hidden!important;margin-top:5px!important;background:#1e2128!important;transition:background 0.1s!important;">'+
      (item.linkImage ? '<img src="'+hnEsc(item.linkImage)+'" style="width:100%!important;max-height:120px!important;object-fit:cover!important;display:block!important;" onerror="this.hidden=true">' : '')+
      '<div style="padding:8px 10px!important;">'+
      '<div style="font-size:10px!important;color:#5b6577!important;margin-bottom:3px!important;text-transform:uppercase!important;letter-spacing:0.5px!important;">&#128279; Link</div>'+
      (item.linkTitle ? '<div style="font-size:12px!important;font-weight:500!important;color:#e2e8f0!important;margin-bottom:2px!important;">'+hnEsc(item.linkTitle)+'</div>' : '')+
      '<div style="font-size:11px!important;color:#5b9cf6!important;word-break:break-all!important;">'+hnEsc(item.linkUrl)+'</div>'+
      '</div></a>';
  }
  return html;
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
    var tags = hn_posts[i].text.match(/#[a-zA-Z0-9_]+/g) || [];
    for (var j = 0; j < tags.length; j++) {
      var t = tags[j].toLowerCase();
      if (t !== '#notizie') counts[t] = (counts[t] || 0) + 1;
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
  document.getElementById('hn-hrow').innerHTML = html;
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
  if (row.classList.contains('hn-vis')) { row.classList.remove('hn-vis'); document.getElementById('hn-imgurl').value=''; }
  else row.classList.add('hn-vis');
}
function hnClearImg() {
  document.getElementById('hn-imgurl').value = '';
  document.getElementById('hn-imgurl-row').classList.remove('hn-vis');
}

function hnSubmitPost() {
  if (!hn_user) return;
  var ta   = document.getElementById('hn-textarea');
  var text = ta.value.trim();
  if (!text) return;
  if (ta.value.length > 280) { alert('Il post supera il limite di 280 caratteri.'); return; }
  var imgUrl = document.getElementById('hn-imgurl').value.trim();
  var link_inp = document.getElementById('hn-linkurl'); var link_url = link_inp ? link_inp.value.trim() : '';
  var link_title_inp = document.getElementById('hn-linktitle'); var link_title = link_title_inp ? link_title_inp.value.trim() : '';
  var btn = document.getElementById('hn-postbtn');
  btn.disabled = true; btn.textContent = '...';
  var poll_data = null;
  if (hn_poll_options.length >= 2) {
    var valid_opts = [];
    for (var pi=0;pi<hn_poll_options.length;pi++) {
      var sync_inp = document.getElementById('hn-poll-opt-'+pi);
      var opt_val = sync_inp ? sync_inp.value.trim() : hn_poll_options[pi].trim();
      if (opt_val) valid_opts.push({text:opt_val, votes:[]});
    }
    var dl_inp = document.getElementById('hn-poll-deadline');
    var deadline = dl_inp && dl_inp.value ? new Date(dl_inp.value).toISOString() : null;
    if (valid_opts.length >= 2) poll_data = {options: valid_opts, deadline: deadline, closed: false, notified: false};
  }
  var post = { id:String(Date.now()), authorId:hn_user.id, authorName:hn_user.name,
    authorHandle:hn_user.handle, authorColor:hn_user.color, authorAvatar:hn_user.avatar||'',
    authorRank:hn_user.rank, text:text, imgUrl:imgUrl||'',
    likes:[], dislikes:[], comments:[], poll:poll_data, linkUrl:link_url||'', linkTitle:link_title||'', linkImage:hn_link_image||'', mood:hn_post_mood||'', createdAt:new Date().toISOString() };
  hn_posts.unshift(post);
  hnSavePost_fb(post,
    function(){ ta.value=''; hnClearImg(); hnUpdateChar(); hnClearMood(); btn.disabled=false; btn.textContent='Pubblica'; hnNotifMentions(text, post.id, text); hnNotifGroupTags(text, post.id, text); hn_poll_options=[]; hn_poll_deadline_val=''; var pc=document.getElementById('hn-poll-compose'); if(pc)pc.style['display']='none'; hn_link_url=''; hn_link_title=''; hn_link_image=''; var lr=document.getElementById('hn-linkurl-row'); if(lr)lr.style['display']='none'; var li2=document.getElementById('hn-linkurl'); if(li2)li2.value=''; var lt2=document.getElementById('hn-linktitle'); if(lt2)lt2.value=''; },
    function(){ hn_posts.shift(); alert('Errore durante la pubblicazione.'); btn.disabled=false; btn.textContent='Pubblica'; }
  );
}

/* ── FEED ── */
function hnTab(tab, el) {
  hn_tab_cur = tab;
  hn_filter_user_id = null;
  var tabs = document.querySelectorAll('.hn-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('hn-active');
  el.classList.add('hn-active');
  var userTab = document.getElementById('hn-tab-user');
  if (userTab) userTab.style['display'] = 'none';
  if (hn_data_ready && hn_posts_ready) hnRenderFeed();
}
function hnFiltered() {
  var out = [];
  var following = [];
  if (hn_tab_cur === 'following' && hn_user) {
    var my_prof = null;
    for (var f = 0; f < hn_profiles.length; f++) { if (hn_profiles[f].id === hn_user.id) { my_prof = hn_profiles[f]; break; } }
    following = (my_prof && my_prof.following) ? my_prof.following : [];
  }
  for (var i = 0; i < hn_posts.length; i++) {
    var p = hn_posts[i];
    if (hn_tab_cur === 'hunters' && (!p.authorRank || p.authorRank.indexOf('Hunter') === -1)) continue;
    if (hn_tab_cur === 'news' && p.text.indexOf('#notizie') === -1) continue;
    if (hn_tab_cur === 'following') {
      var inFollowing = false;
      for (var fi = 0; fi < following.length; fi++) { if (following[fi] === p.authorId) { inFollowing = true; break; } }
      if (!inFollowing) continue;
    }
    if (hn_tab_cur === 'user' && hn_filter_user_id && p.authorId !== hn_filter_user_id) continue;
    out.push(p);
  }
  return out;
}
function hnFilterUser(aid, name) {
  hn_tab_cur = 'user';
  hn_filter_user_id = aid;
  var tabs = document.querySelectorAll('.hn-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('hn-active');
  var userTab = document.getElementById('hn-tab-user');
  if (!userTab) {
    userTab = document.createElement('button');
    userTab.id = 'hn-tab-user';
    userTab.className = 'hn-tab hn-active';
    userTab.onclick = function() { hnTab('all', document.querySelector('.hn-tab')); };
    document.querySelector('.hn-tabs').appendChild(userTab);
  }
  userTab.textContent = name + ' \u00d7';
  userTab.className = 'hn-tab hn-active';
  userTab.style['display'] = 'inline-block';
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
  if (layout) {
    layout.style['display'] = 'grid';
    layout.style['grid-template-columns'] = 'minmax(0,1fr) 281px';
  }
  var feed = document.getElementById('hn-feed');
  if (feed) {
    feed.style['min-width'] = '0';
    feed.style['overflow'] = 'hidden';
  }
}

function hnRenderFeed() {
  hnFixLayout();
  var list = document.getElementById('hn-posts');
  if (!hn_data_ready) {
    list.innerHTML='<div class="hn-msg"><div class="hn-spin"></div></div>';
    return;
  }
  var fp = hnFiltered();
  if (!fp.length) { list.innerHTML='<div class="hn-msg">Nessun post ancora. Sii il primo a scrivere!</div>'; return; }
  var html='';
  for (var i=0;i<fp.length;i++) html+=hnRenderPost(fp[i]);
  list.innerHTML=html;
  hnAttachMentionListeners();
}

function hnAttachMentionListeners() {
  // Event delegation — single listener on container handles all current and future elements
  var container = document.getElementById('hn-posts');
  if (!container || container._cedit_listener) return;
  container._cedit_listener = true;
  container.addEventListener('click', function(e) {
    var el = e.target;
    // Walk up to find data-cedit element
    while (el && el !== container) {
      if (el.getAttribute && el.getAttribute('data-cedit')) {
        var mode = el.getAttribute('data-cedit');
        var pid  = el.getAttribute('data-pid');
        var ci   = el.getAttribute('data-ci');
        var title = mode === 'comment' ? 'Commenta' : 'Rispondi';
        var ph    = mode === 'comment' ? 'Scrivi un commento...' : 'Scrivi una risposta...';
        hnCEditOpen(mode, pid, ci !== null && ci !== '' ? parseInt(ci) : null, ph, title);
        e.stopPropagation();
        return;
      }
      el = el.parentNode;
    }
  });
}
function hnRenderPost(p) {
  var lc = p.likes ? p.likes.length : 0;
  var dc = p.dislikes ? p.dislikes.length : 0;
  var cc = p.comments ? p.comments.length : 0;
  var liked = false; var disliked = false;
  if (hn_user&&p.likes) { for (var i=0;i<p.likes.length;i++) { if(p.likes[i]===hn_user.id){liked=true;break;} } }
  if (hn_user&&p.dislikes) { for (var i=0;i<p.dislikes.length;i++) { if(p.dislikes[i]===hn_user.id){disliked=true;break;} } }
  var author_prof = hnProfileById(p.authorId);
  var is_deleted_user = !author_prof && p.authorId;
  var th = hnFormatText(p.text);
  th = th.split('\n').join('<br>');
  var imgHtml = '';
  if (p.imgUrl) {
    var yt_match = p.imgUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    var tenor_match = p.imgUrl.match(/tenor\.com.*\/([a-zA-Z0-9_-]+\.gif)/);
    if (yt_match) {
      imgHtml = '<div style="position:relative!important;padding-bottom:56.25%!important;height:0!important;margin-bottom:8px!important;border-radius:8px!important;overflow:hidden!important;">'+
        '<iframe src="https://www.youtube.com/embed/'+yt_match[1]+'" style="position:absolute!important;top:0!important;left:0!important;width:100%!important;height:100%!important;border:none!important;" allowfullscreen></iframe>'+
        '</div>';
    } else if (tenor_match || p.imgUrl.indexOf('.gif') !== -1) {
      imgHtml = '<img class="hn-pimg" src="'+hnEsc(p.imgUrl)+'" alt="" onerror="this.style.display=\'none\'">';
    } else {
      imgHtml = '<img class="hn-pimg" src="'+hnEsc(p.imgUrl)+'" alt="" onclick="hnOpenLightbox(this.src)" onerror="this.style.display=\'none\'">';
    }
  }
  var sharedHtml = '';
  if (p.sharedPost) {
    var sp = p.sharedPost;
    var sth = sp.text ? sp.text.replace(/(#\w+)/g,'<span class="hn-hi">$1</span>') : '';
    sharedHtml = '<div class="hn-shared-preview">'+
      '<div class="hn-shared-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> Condiviso da '+hnEsc(sp.authorName)+'</div>'+
      '<div class="hn-shared-author">'+hnEsc(sp.authorName)+' <span style="color:#5b6577!important;">@'+hnEsc(sp.authorHandle)+'</span></div>'+
      '<div class="hn-shared-text">'+sth+'</div>'+
      (sp.imgUrl?'<img src="'+hnEsc(sp.imgUrl)+'" style="max-width:100%;max-height:150px;border-radius:6px;margin-top:6px;object-fit:cover;display:block;" onerror="this.style.display=\'none\'">':'')+
      '</div>';
  }
  var linkHtml = '';
  if (p.linkUrl) {
    linkHtml = '<a href="'+hnEsc(p.linkUrl)+'" target="_blank" rel="noopener" style="display:block!important;text-decoration:none!important;border:1px solid #313846!important;border-radius:8px!important;overflow:hidden!important;margin-bottom:8px!important;background:#1e2128!important;transition:background 0.1s!important;" onmouseover="this.style.background=\'#252932\'" onmouseout="this.style.background=\'#1e2128\'">'+
      (p.linkImage ? '<img src="'+hnEsc(p.linkImage)+'" style="width:100%!important;max-height:160px!important;object-fit:cover!important;display:block!important;" onerror="this.style.display=\'none\'">' : '')+
      '<div style="padding:10px 12px!important;">'+
      '<div style="font-size:10px!important;color:#5b6577!important;margin-bottom:4px!important;text-transform:uppercase!important;letter-spacing:0.5px!important;">&#128279; Link</div>'+
      (p.linkTitle ? '<div style="font-size:13px!important;font-weight:500!important;color:#e2e8f0!important;margin-bottom:2px!important;">'+hnEsc(p.linkTitle)+'</div>' : '')+
      '<div style="font-size:11px!important;color:#5b9cf6!important;word-break:break-all!important;">'+hnEsc(p.linkUrl)+'</div>'+
      '</div></a>';
  }
  var pollHtml = '';
  if (p.poll) {
    var total_votes = 0;
    for (var pi = 0; pi < p.poll.options.length; pi++) total_votes += (p.poll.options[pi].votes||[]).length;
    var is_closed = p.poll.closed || (p.poll.deadline && new Date(p.poll.deadline) < new Date());
    pollHtml = '<div class="hn-poll">';
    if (p.poll.deadline) {
      var dl = new Date(p.poll.deadline);
      var dl_str = is_closed ? 'Sondaggio chiuso' : 'Scade: ' + dl.toLocaleDateString('it-IT') + ' ' + dl.getHours() + ':' + (dl.getMinutes()<10?'0':'')+dl.getMinutes();
      pollHtml += '<div style="font-size:10px!important;color:#5b6577!important;padding:4px 12px!important;border-bottom:1px solid #313846!important;">' + dl_str + '</div>';
    }
    for (var pi = 0; pi < p.poll.options.length; pi++) {
      var opt = p.poll.options[pi];
      var opt_votes = (opt.votes||[]).length;
      var pct = total_votes > 0 ? Math.round(opt_votes/total_votes*100) : 0;
      var user_voted = hn_user && (opt.votes||[]).indexOf(hn_user.id) !== -1;
      pollHtml += '<div class="hn-poll-option'+(user_voted?' hn-poll-voted':'')+'" '+(is_closed?'style="cursor:default!important;"':'onclick="hnVotePoll(\''+p.id+'\','+pi+')"')+'>'+
        '<div class="hn-poll-bar" style="width:'+pct+'%!important;"></div>'+
        '<div class="hn-poll-label">'+hnEsc(opt.text)+'</div>'+
        '<div class="hn-poll-pct">'+pct+'%</div></div>';
    }
    pollHtml += '<div class="hn-poll-total">'+total_votes+' vot'+(total_votes===1?'o':'i')+'</div></div>';
  }
  var cl = p.comments||[];
  var commHtml = hnRenderComments(cl, 3, p.id);
  var cf = hn_user ? '<div class="hn-ccompose"><input type="text" placeholder="Rispondi..." id="hn-ci-'+p.id+'" readonly data-cedit="comment" data-pid="'+p.id+'" style="cursor:pointer!important;"><button class="hn-csend" data-cedit="comment" data-pid="'+p.id+'">Commenta</button></div>' : '';
  var shareBtn = hn_user ? '<button class="hn-abtn" onclick="hnOpenShare(\''+p.id+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'+hnShareCount(p.id)+'</button>' : '';
  var isOwner = hn_user && hn_user.id === p.authorId;
  var isAdmin = hnIsAdmin();
  var ownerActions = (isOwner || isAdmin) ?
    '<div class="hn-owner-actions">'+
    '<button class="hn-edit-btn" onclick="hnEditPost(\''+p.id+'\')">Modifica</button>'+
    '<button class="hn-del-btn" onclick="hnDeletePost(\''+p.id+'\')">Elimina</button>'+
    '</div>' : '';
  var editedLabel = p.edited ? '<span class="hn-edited">· modificato</span>' : '';
  var online_dot_html = '';
  if (author_prof) {
    var dot_color = hnIsOnline(author_prof) ? '#5cb878' : '#5b6577';
    online_dot_html = '<span style="position:absolute!important;bottom:0!important;right:0!important;width:13px!important;height:13px!important;border-radius:50%!important;background:'+dot_color+'!important;border:2px solid #252932!important;display:block!important;"></span>';
  }
  var post_avatar = is_deleted_user ?
    '<div class="hn-av" style="background:#5b6577!important;flex-shrink:0!important;">?</div>' :
    hnAvHtml(p.authorColor,p.authorAvatar||'',p.authorName,'hn-av',null);
  return '<div class="hn-post" id="hn-p-'+p.id+'"><div class="hn-phead">'+
    '<div style="position:relative!important;flex-shrink:0!important;">'+post_avatar+online_dot_html+'</div>'+
    '<div class="hn-pbody"><div class="hn-pmeta">'+
    (is_deleted_user ?
      '<span class="hn-pname" style="color:#5b6577!important;cursor:default!important;">Utente Cancellato</span>' :
      '<span class="hn-pname" onclick="hnOpenProfile(\''+p.authorId+'\')">'+hnEsc(p.authorName)+'</span>'+hnVerifiedBadge(author_prof)+
      '<span class="hn-phandle">@'+hnEsc(p.authorHandle)+'</span>'+
      '<span class="hn-rank '+hnRankClass(p.authorRank)+'">'+hnEsc(p.authorRank||'')+'</span>')+
    '<span class="hn-ptime">'+hnAgo(p.createdAt)+'</span>'+editedLabel+ownerActions+'</div>'+
    '<div class="hn-ptext" id="hn-pt-'+p.id+'">'+th+'</div>'+
    (p.mood ? '<div class="hn-post-mood"><strong style="color:#5b9cf6!important;">Mood:</strong> '+hnEsc(p.mood)+'</div>' : '')+
    imgHtml+linkHtml+sharedHtml+pollHtml+
    '<div class="hn-pactions">'+
    '<button class="'+(liked?'hn-abtn hn-liked':'hn-abtn')+'" onclick="hnToggleLike(\''+p.id+'\')" onmouseenter="hnShowTooltip(event,\''+p.id+'\',\'likes\')" onmouseleave="hnHideTooltip()">'+
    '<svg viewBox="0 0 24 24" fill="'+(liked?'currentColor':'none')+'" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>'+lc+'</button>'+
    (hn_user ? '<button class="'+(disliked?'hn-abtn hn-disliked':'hn-abtn')+'" onclick="hnToggleDislike(\''+p.id+'\')" onmouseenter="hnShowTooltip(event,\''+p.id+'\',\'dislikes\')" onmouseleave="hnHideTooltip()">'+'<svg viewBox="0 0 24 24" fill="'+(disliked?'currentColor':'none')+'" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>'+dc+'</button>' : '')+
    '<button class="hn-abtn" onclick="hnToggleComments(\''+p.id+'\')">'+
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'+cc+'</button>'+

    (hn_user ? '<button class="hn-abtn" onclick="hnOpenShare(\''+p.id+'\')" onmouseenter="hnShowTooltip(event,\''+p.id+'\',\'shares\')" onmouseleave="hnHideTooltip()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'+hnShareCount(p.id)+'</button>' : '')+
    '</div>'+
    '<div class="hn-comments" id="hn-cs-'+p.id+'">'+commHtml+cf+'</div>'+
    '</div></div></div>';
}

function hnRenderComments(cl, shown, pid) {
  var html = '';
  var total = cl.length;
  var limit = Math.min(shown, total);
  for (var ci = 0; ci < limit; ci++) {
    var c = cl[ci];
    var cid = pid + '_' + ci;
    var replies = c.replies || [];
    var repliesHtml = '';
    for (var ri = 0; ri < replies.length; ri++) {
      var r = replies[ri];
      var rid = cid + '_' + ri;
      var isReplyOwner = (hn_user && hn_user.id === r.authorId) || hnIsAdmin();
      var replyOwnerHtml = isReplyOwner ?
        '<div class="hn-owner-actions" style="margin-top:2px!important;">'+
        '<button class="hn-edit-btn" onclick="hnEditReply(\''+pid+'\','+ci+','+ri+')">Modifica</button>'+
        '<button class="hn-del-btn" onclick="hnDeleteReply(\''+pid+'\','+ci+','+ri+')">Elimina</button>'+
        '</div>' : '';
      var replyEditedLabel = r.edited ? '<span class="hn-edited">· modificato</span>' : '';
      repliesHtml += '<div class="hn-ritem" id="hn-rid-'+rid+'">'+hnAvHtml(r.authorColor,r.authorAvatar||'',r.authorName,'hn-rav',null)+
        '<div class="hn-rbody"><div class="hn-rmeta"><span class="hn-rname" style="cursor:pointer!important;" onclick="hnOpenProfileByHandle(\''+hnEsc(r.authorHandle)+'\')">'+(r.authorHandle?hnEsc(r.authorName)+hnVerifiedBadge(hnProfileById(r.authorId)):hnEsc(r.authorName))+'</span><span class="hn-rtime">'+hnAgo(r.createdAt)+'</span>'+replyEditedLabel+'</div>'+
        '<div class="hn-rtext" id="hn-rt-'+rid+'">'+hnMentionify(hnFormatText(r.text))+'</div>'+hnRenderCommentMedia(r)+replyOwnerHtml+'</div></div>';
    }
    var isCommentOwner = (hn_user && hn_user.id === c.authorId) || hnIsAdmin();
    var commentOwnerHtml = isCommentOwner ?
      '<button class="hn-edit-btn" onclick="hnEditComment(\''+pid+'\','+ci+')">Modifica</button>'+
      '<button class="hn-del-btn" onclick="hnDeleteComment(\''+pid+'\','+ci+')">Elimina</button>' : '';
    var commentEditedLabel = c.edited ? '<span class="hn-edited">· modificato</span>' : '';
    var replyForm = hn_user ? '<div class="hn-reply-compose"><input type="text" placeholder="Rispondi..." id="hn-ri-'+cid+'" readonly data-cedit="reply" data-pid="'+pid+'" data-ci="'+ci+'" style="cursor:pointer!important;"><button class="hn-rsend" data-cedit="reply" data-pid="'+pid+'" data-ci="'+ci+'">Invia</button></div>' : '';
    var repliesBlock = '<div class="hn-replies" id="hn-rep-'+cid+'">'+repliesHtml+replyForm+'</div>';
    var replyCount = replies.length ? ' ('+replies.length+')' : '';
    html += '<div class="hn-citem" id="hn-cid-'+cid+'">'+hnAvHtml(c.authorColor,c.authorAvatar||'',c.authorName,'hn-cav',null)+
      '<div class="hn-cbody">'+
      '<div class="hn-cmeta"><span class="hn-cname" style="cursor:pointer!important;" onclick="hnOpenProfileByHandle(\''+hnEsc(c.authorHandle)+'\')">'+(c.authorHandle?hnEsc(c.authorName)+hnVerifiedBadge(hnProfileById(c.authorId)):hnEsc(c.authorName))+'</span><span class="hn-ctime">'+hnAgo(c.createdAt)+'</span>'+commentEditedLabel+'</div>'+
      '<div class="hn-ctext" id="hn-ct-'+cid+'">'+hnMentionify(hnFormatText(c.text))+'</div>'+hnRenderCommentMedia(c)+
      '<div class="hn-cactions-row">'+
      (hn_user ? '<button class="hn-cabtn" onclick="hnToggleReplies(\''+cid+'\')">Rispondi'+replyCount+'</button>' : '')+
      commentOwnerHtml+
      '</div>'+
      repliesBlock+
      '</div></div>';
  }
  if (total > shown) {
    var remaining = total - shown;
    html += '<button class="hn-abtn" style="margin:4px 0 8px!important;font-size:12px!important;color:#5b9cf6!important;" onclick="hnShowMoreComments(\''+pid+'\','+shown+')">'+
      'Mostra altre risposte ('+remaining+')</button>';
  }
  return html;
}

function hnShowMoreComments(pid, currentShown) {
  var post = null;
  for (var i = 0; i < hn_posts.length; i++) { if (hn_posts[i].id === pid) { post = hn_posts[i]; break; } }
  if (!post) return;
  var cs = document.getElementById('hn-cs-'+pid);
  if (!cs) return;
  var newShown = currentShown + 3;
  var cl = post.comments || [];
  var cf = hn_user ? '<div class="hn-ccompose"><input type="text" placeholder="Rispondi..." id="hn-ci-'+pid+'" readonly data-cedit="comment" data-pid="'+pid+'" style="cursor:pointer!important;"><button class="hn-csend" data-cedit="comment" data-pid="'+pid+'">Commenta</button></div>' : '';
  cs.innerHTML = hnRenderComments(cl, newShown, pid) + cf;
  cs.classList.add('hn-open');
  hnAttachMentionListeners();
}

/* ── LIKE / COMMENTI ── */
function hnToggleLike(pid) {
  if (!hn_user) { hnOpenModal('auth'); return; }
  var post=null; for (var i=0;i<hn_posts.length;i++) { if(hn_posts[i].id===pid){post=hn_posts[i];break;} }
  if (!post) {
    hn_fb_get('hunternet/posts/'+pid, function(d) {
      if (d) { for(var x=0;x<hn_posts.length;x++){if(hn_posts[x].id===pid){return;}} hn_posts.push(d); hnToggleLike(pid); }
    }, function(){});
    return;
  }
  if (!post.likes) post.likes=[];
  var idx=post.likes.indexOf(hn_user.id);
  var liked_now = idx===-1;
  if (liked_now) {
    post.likes.push(hn_user.id);
    if (!post.dislikes) post.dislikes=[];
    var di=post.dislikes.indexOf(hn_user.id);
    if (di!==-1) post.dislikes.splice(di,1);
  } else {
    post.likes.splice(idx,1);
  }
  hnSavePost_fb(post,function(){
    if (liked_now && post.authorId !== hn_user.id) {
      hnCreateNotif(post.authorId,'like',post.id,post.text);
    }
  },function(){alert('Errore like.');});
}
function hnToggleDislike(pid) {
  if (!hn_user) { hnOpenModal('auth'); return; }
  var post=null; for (var i=0;i<hn_posts.length;i++) { if(hn_posts[i].id===pid){post=hn_posts[i];break;} }
  if (!post) {
    hn_fb_get('hunternet/posts/'+pid, function(d) {
      if (d) { for(var x=0;x<hn_posts.length;x++){if(hn_posts[x].id===pid){return;}} hn_posts.push(d); hnToggleDislike(pid); }
    }, function(){});
    return;
  }
  if (!post.dislikes) post.dislikes=[];
  var idx = post.dislikes.indexOf(hn_user.id);
  var adding = idx===-1;
  if (adding) {
    post.dislikes.push(hn_user.id);
    var li = post.likes ? post.likes.indexOf(hn_user.id) : -1;
    if (li !== -1) post.likes.splice(li,1);
  } else {
    post.dislikes.splice(idx,1);
  }
  hnSavePost_fb(post,function(){
    if (adding && post.authorId !== hn_user.id) hnCreateNotif(post.authorId,'like',post.id,post.text);
  },function(){alert('Errore dislike.');});
}

function hnToggleComments(pid) {
  var cs=document.getElementById('hn-cs-'+pid);
  if (!cs) return;
  if (cs.classList.contains('hn-open')) cs.classList.remove('hn-open'); else cs.classList.add('hn-open');
}
function hnSubmitComment(pid) {
  if (!hn_user) { hnOpenModal('auth'); return; }
  var inp=document.getElementById('hn-ci-'+pid);
  if (!inp) return;
  var text=inp.value.trim(); if (!text) return;
  var post=null; for (var i=0;i<hn_posts.length;i++) { if(hn_posts[i].id===pid){post=hn_posts[i];break;} }
  if (!post) {
    hn_fb_get('hunternet/posts/'+pid, function(d) {
      if (d) { hn_posts.push(d); hnSubmitComment(pid); }
    }, function(){});
    return;
  }
  if (!post.comments) post.comments=[];
  var cmt={id:String(Date.now()),authorId:hn_user.id,authorName:hn_user.name,
    authorHandle:hn_user.handle,authorColor:hn_user.color,authorAvatar:hn_user.avatar||'',
    text:text,createdAt:new Date().toISOString()};
  post.comments.push(cmt);
  hnSavePost_fb(post,
    function(){
      setTimeout(function(){var cs=document.getElementById('hn-cs-'+pid);if(cs)cs.classList.add('hn-open');},300);
      if (post.authorId !== hn_user.id) hnCreateNotif(post.authorId,'comment',post.id,post.text);
      hnNotifMentions(text,post.id,post.text); hnNotifGroupTags(text,post.id,post.text);
    },
    function(){ post.comments.pop(); alert('Errore commento.'); }
  );
}

/* ── SIDEBAR ── */
function hnRenderSidebar() { if (!hn_posts_ready) return; hnRenderTrend(); hnRenderHunters(); }
function hnRenderTrend() {
  var counts={};
  for (var i=0;i<hn_posts.length;i++) {
    var tags=hn_posts[i].text.match(/#\w+/g)||[];
    for (var j=0;j<tags.length;j++) counts[tags[j]]=(counts[tags[j]]||0)+1;
  }
  var sorted=[];
  for (var t in counts) sorted.push([t,counts[t]]);
  sorted.sort(function(a,b){return b[1]-a[1];}); sorted=sorted.slice(0,5);
  var el=document.getElementById('hn-trending');
  if (!sorted.length){el.innerHTML='<div style="font-size:12px;color:#a09a93;padding:4px 0;">Nessun trend ancora.</div>';return;}
  var html='';
  for (var k=0;k<sorted.length;k++)
    html+='<div class="hn-trend" onclick="hnFilterTag(\''+sorted[k][0]+'\')"><div class="hn-ttag">'+sorted[k][0]+'</div><div class="hn-tcount">'+sorted[k][1]+' post</div></div>';
  el.innerHTML=html;
}
function hnRenderHunters() {
  var el=document.getElementById('hn-hunters');
  var seen={}; var recent=[];
  for (var i=0;i<hn_posts.length;i++) {
    var p=hn_posts[i];
    if (!seen[p.authorId]){seen[p.authorId]=true;recent.push(p);}
    if (recent.length>=5) break;
  }
  if (!recent.length){el.innerHTML='<div style="font-size:12px;color:#a09a93;padding:4px 0;">Nessun cacciatore ancora.</div>';return;}
  var html='';
  for (var j=0;j<recent.length;j++) {
    var r=recent[j];
    html+='<div class="hn-hunter" onclick="hnOpenProfile(\''+r.authorId+'\')">'+
      hnAvHtml(r.authorColor,r.authorAvatar||'',r.authorName,'hn-hav',null)+
      '<div style="margin:0!important;text-align:left!important;"><div class="hn-hname">'+hnEsc(r.authorName)+hnVerifiedBadge(hnProfileById(r.authorId))+hnOnlineDot(hnProfileById(r.authorId))+'</div><div class="hn-htag2">@'+hnEsc(r.authorHandle)+'</div></div></div>';
  }
  el.innerHTML=html;
}
function hnFilterTag(tag) {
  hn_tab_cur='tag';
  var tabs=document.querySelectorAll('.hn-tab');
  for (var i=0;i<tabs.length;i++) tabs[i].classList.remove('hn-active');
  var fp=[]; var list=document.getElementById('hn-posts');
  for (var j=0;j<hn_posts.length;j++){if(hn_posts[j].text.indexOf(tag)!==-1)fp.push(hn_posts[j]);}
  if(!fp.length){list.innerHTML='<div class="hn-msg">Nessun post con questo tag.</div>';return;}
  var html=''; for (var k=0;k<fp.length;k++) html+=hnRenderPost(fp[k]);
  list.innerHTML=html;
}

/* ── PROFILE ── */
function hnOpenProfile(aid) {
  var prof=null; for(var i=0;i<hn_profiles.length;i++){if(hn_profiles[i].id===aid){prof=hn_profiles[i];break;}}
  if(!prof) return;
  var up=[]; var tl=0;
  for(var j=0;j<hn_posts.length;j++){if(hn_posts[j].authorId===aid){up.push(hn_posts[j]);tl+=(hn_posts[j].likes||[]).length;}}
  var is_me = hn_user && hn_user.id === aid;
  var my_prof = null;
  if (hn_user) { for(var m=0;m<hn_profiles.length;m++){if(hn_profiles[m].id===hn_user.id){my_prof=hn_profiles[m];break;}} }
  var my_following = (my_prof && my_prof.following) ? my_prof.following : [];
  var is_following = false;
  for(var fi=0;fi<my_following.length;fi++){if(my_following[fi]===aid){is_following=true;break;}}
  var followers = [];
  for(var fp=0;fp<hn_profiles.length;fp++){
    var pf=hn_profiles[fp]; var pff=pf.following||[];
    for(var ff=0;ff<pff.length;ff++){if(pff[ff]===aid){followers.push(pf);break;}}
  }
  var follow_btn = (hn_user && !is_me) ?
    '<button class="hn-follow-btn'+(is_following?' hn-following':'')+'" onclick="hnToggleFollow(\''+aid+'\')">'+
    (is_following?'Segui già':'Segui')+'</button>' : '';
  var rh='';
  var sl=up.slice(0,5);
  for(var k=0;k<sl.length;k++)
    rh+='<div style="padding:0.75rem 0;border-bottom:1px solid #313846;margin:0;">'+
      '<div class="hn-ptext" style="margin:0;">'+hnFormatText(sl[k].text)+'</div>'+
      (sl[k].imgUrl?'<img src="'+hnEsc(sl[k].imgUrl)+'" style="max-width:100%;max-height:120px;border-radius:6px;margin-top:6px;object-fit:cover;display:block;" onerror="this.style.display=\'none\'">':'')+
      '<div style="font-size:11px;color:#5b6577;margin-top:4px;">'+hnAgo(sl[k].createdAt)+' \u00b7 '+(sl[k].likes||[]).length+' like</div></div>';
  var prof_following = prof.following || [];
  var prof_following_existing = prof_following.filter(function(fid) { return hnProfileById(fid) !== null; });
  var following_html = '';
  for(var pfi=0;pfi<prof_following.length;pfi++){
    var pf2=null; for(var pp=0;pp<hn_profiles.length;pp++){if(hn_profiles[pp].id===prof_following[pfi]){pf2=hn_profiles[pp];break;}}
    if(!pf2) continue;
    following_html+='<div class="hn-fitem" onclick="hnCloseModal(\'prof\');hnOpenProfile(\''+pf2.id+'\')">'+
      hnAvHtml(pf2.color,pf2.avatar||'',pf2.name,'hn-hav',null)+
      '<div style="margin:0!important;"><div class="hn-fitem-name">'+hnEsc(pf2.name)+'</div><div class="hn-fitem-handle">@'+hnEsc(pf2.handle)+'</div></div></div>';
  }
  var followers_html = '';
  for(var fri=0;fri<followers.length;fri++){
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
    (hnIsAdmin() && !is_me ?
    '<div style="display:flex!important;flex-direction:column!important;gap:4px!important;">'+
    '<button class="hn-follow-btn" style="font-size:11px!important;" onclick="hnAdminEditProfile(\''+aid+'\')">&#9881; Modifica</button>'+
    '<button class="hn-follow-btn" style="border-color:#e57373!important;color:#e57373!important;font-size:11px!important;" onclick="hnAdminDeleteAccount(\''+aid+'\')">&#9881; Elimina account</button>'+
    '</div>' : '');
  document.getElementById('hn-profcontent').innerHTML=
    '<div class="hn-profhead"><div style="position:relative!important;flex-shrink:0!important;">'+hnAvHtml(prof.color,prof.avatar||'',prof.name,'hn-profav',null)+
    (function(){ var dc='#'+(hnIsOnline(prof)?'5cb878':'5b6577'); return '<span style="position:absolute!important;bottom:2px!important;right:2px!important;width:12px!important;height:12px!important;border-radius:50%!important;background:'+dc+'!important;border:2px solid #252932!important;display:block!important;"></span>'; }())+
    '</div>'+
    '<div class="hn-profinfo"><h2 style="cursor:pointer!important;" onclick="hnCloseModal(\'prof\');hnFilterUser(\''+aid+'\',\''+hnEsc(prof.name)+'\')">'+hnEsc(prof.name)+'</h2><div class="hn-profhandle">@'+hnEsc(prof.handle)+'</div>'+
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

function hnOpenEditProfileFor(target_id) {
  var prof = null;
  for (var i = 0; i < hn_profiles.length; i++) { if (hn_profiles[i].id === target_id) { prof = hn_profiles[i]; break; } }
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
  document.getElementById('hn-profcontent').innerHTML =
    '<h2 style="margin-bottom:4px!important;">Modifica profilo</h2>'+
    '<p class="hn-msub">Le modifiche saranno visibili subito.</p>'+
    '<div class="hn-avrow">'+
      '<div id="hn-edit-av-preview" class="hn-avpreview" style="background:'+prof.color+'!important;">'+
        (prof.avatar ? '<img src="'+hnEsc(prof.avatar)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display=\'none\'">' : hnInitials(prof.name))+
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
  hn_edit_color = prof.color;
}

var hn_edit_color = '';

function hnEditPickColor(c, el) {
  hn_edit_color = c;
  var sw = document.querySelectorAll('#hn-edit-cpicker .hn-swatch');
  for (var i = 0; i < sw.length; i++) sw[i].classList.remove('hn-sel');
  el.classList.add('hn-sel');
  var prev = document.getElementById('hn-edit-av-preview');
  if (prev) prev.style['background'] = c;
}

function hnEditPreviewAvatar() {
  var url = document.getElementById('hn-edit-avatar').value.trim();
  var prev = document.getElementById('hn-edit-av-preview');
  if (!prev) return;
  prev.style['background'] = hn_edit_color;
  if (url) {
    prev.innerHTML = '<img src="'+hnEsc(url)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display=\'none\'">';
  } else {
    var name_el = document.getElementById('hn-edit-name');
    prev.innerHTML = hnInitials(name_el ? name_el.value : hn_user.name);
  }
}

function hnSaveProfile() {
  if (!hn_user) return;
  hnSaveProfileFor(hn_user.id);
}

function hnSaveProfileFor(target_id) {
  var name   = document.getElementById('hn-edit-name').value.trim();
  var handle = document.getElementById('hn-edit-handle').value.trim().replace('@','');
  var rank   = document.getElementById('hn-edit-rank').value;
  var bio    = document.getElementById('hn-edit-bio').value.trim();
  var avatar = document.getElementById('hn-edit-avatar').value.trim();
  var new_pw = document.getElementById('hn-edit-pw').value;

  if (!name || !handle || !rank) return hnShowErr('hn-edit-err','Compila tutti i campi obbligatori.');
  if (handle.length < 3) return hnShowErr('hn-edit-err','Nickname troppo corto (min 3 caratteri).');

  var hn_ok = true;
  for (var ci = 0; ci < handle.length; ci++) {
    var ch = handle.charCodeAt(ci);
    if (!((ch>=65&&ch<=90)||(ch>=97&&ch<=122)||(ch>=48&&ch<=57)||ch===95)) { hn_ok=false; break; }
  }
  if (!hn_ok) return hnShowErr('hn-edit-err','Nickname: solo lettere, numeri e _.');

  for (var i = 0; i < hn_creds.length; i++) {
    if (hn_creds[i].handle.toLowerCase() === handle.toLowerCase() && hn_creds[i].id !== target_id)
      return hnShowErr('hn-edit-err','Nickname già in uso.');
  }

  var prof_idx = -1;
  for (var j = 0; j < hn_profiles.length; j++) { if (hn_profiles[j].id === target_id) { prof_idx = j; break; } }
  if (prof_idx === -1) return;

  var cred_idx = -1;
  for (var k = 0; k < hn_creds.length; k++) { if (hn_creds[k].id === target_id) { cred_idx = k; break; } }

  hn_profiles[prof_idx].name   = name;
  hn_profiles[prof_idx].handle = handle;
  hn_profiles[prof_idx].rank   = rank;
  hn_profiles[prof_idx].bio    = bio;
  hn_profiles[prof_idx].avatar = avatar;
  hn_profiles[prof_idx].color  = hn_edit_color;

  if (cred_idx !== -1) {
    hn_creds[cred_idx].handle = handle;
    if (new_pw && new_pw.length >= 4) hn_creds[cred_idx].password = new_pw;
    else if (new_pw && new_pw.length > 0) return hnShowErr('hn-edit-err','La password deve essere di almeno 4 caratteri.');
  }

  // Update session only if editing own profile
  if (hn_user && hn_user.id === target_id) {
    hn_user = hn_profiles[prof_idx];
    sessionStorage.setItem('hn_user', JSON.stringify(hn_user));
  }

  var btn = document.querySelector('#hn-profcontent .hn-dbtn');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  var saved = 0;
  function onDone() {
    saved++;
    if (saved < 2) return;
    if (hn_user && hn_user.id === target_id) hnSetLoggedIn();
    hnOpenProfile(target_id);
  }
  hnSaveProfile_fb(hn_profiles[prof_idx], onDone, function(){ hnShowErr('hn-edit-err','Errore nel salvataggio.'); });
  if (cred_idx !== -1) {
    hnSaveCred_fb(hn_creds[cred_idx], onDone, function(){ hnShowErr('hn-edit-err','Errore nel salvataggio.'); });
  } else { onDone(); }
}
function hnVotePoll(pid, opt_idx) {
  if (!hn_user) { hnOpenModal('auth'); return; }
  var post=null; for (var i=0;i<hn_posts.length;i++) { if(hn_posts[i].id===pid){post=hn_posts[i];break;} }
  if (!post||!post.poll) return;
  for (var pi=0;pi<post.poll.options.length;pi++) {
    if (!post.poll.options[pi].votes) post.poll.options[pi].votes=[];
    var vi = post.poll.options[pi].votes.indexOf(hn_user.id);
    if (vi!==-1) post.poll.options[pi].votes.splice(vi,1);
  }
  if (!post.poll.options[opt_idx].votes) post.poll.options[opt_idx].votes=[];
  var now_closed = post.poll.closed || (post.poll.deadline && new Date(post.poll.deadline) < new Date());
  if (now_closed) { alert('Il sondaggio è chiuso.'); return; }
  post.poll.options[opt_idx].votes.push(hn_user.id);
  hnSavePost_fb(post,function(){},function(){alert('Errore nel voto.');});
}

function hnToggleFollow(aid) {
  if (!hn_user) { hnOpenModal('auth'); return; }
  var my_prof = null;
  for(var i=0;i<hn_profiles.length;i++){if(hn_profiles[i].id===hn_user.id){my_prof=hn_profiles[i];break;}}
  if (!my_prof) return;
  if (!my_prof.following) my_prof.following = [];
  var idx = -1;
  for(var j=0;j<my_prof.following.length;j++){if(my_prof.following[j]===aid){idx=j;break;}}
  if (idx === -1) my_prof.following.push(aid);
  else my_prof.following.splice(idx,1);
  hn_user.following = my_prof.following;
  sessionStorage.setItem('hn_user', JSON.stringify(hn_user));
  var was_following = idx !== -1;
  hnSaveProfile_fb(my_prof,
    function(){ if(!was_following) hnCreateNotif(aid,'follow','',''); hnUpdateBadge(); hnOpenProfile(aid); },
    function(){ if(idx===-1)my_prof.following.pop();else my_prof.following.splice(idx,0,aid); alert('Errore nel salvataggio.'); }
  );
}

/* ── COLOR PICKER ── */
function hnBuildColorPicker() {
  var html='';
  for(var i=0;i<hn_colors.length;i++)
    html+='<div class="hn-swatch'+(hn_colors[i]===hn_sel_color?' hn-sel':'')+'" style="background:'+hn_colors[i]+';" onclick="hnPickColor(\''+hn_colors[i]+'\',this)"></div>';
  document.getElementById('hn-cpicker').innerHTML=html;
}
function hnPickColor(c,el) {
  hn_sel_color=c;
  var sw=document.querySelectorAll('.hn-swatch');
  for(var i=0;i<sw.length;i++) sw[i].classList.remove('hn-sel');
  el.classList.add('hn-sel');
  hnPreviewAvatar();
}

/* ── MODALS ── */
function hnOpenModal(id) {
  var el=document.getElementById('hn-modal-'+id);
  if(!el) return;
  el.style.display='flex'; el.style['z-index']='99999';
}
function hnCloseModal(id) {
  var el=document.getElementById('hn-modal-'+id);
  if(el) el.style.display='none';
}
document.addEventListener('click',function(e){
  var cedit_overlay=document.getElementById('hn-cedit-overlay');
  var cedit_box=document.getElementById('hn-cedit-box');
  var emoji_wrap=document.getElementById('hn-emoji-picker-wrap');
  if(cedit_overlay&&cedit_overlay.classList.contains('hn-vis')&&cedit_box&&!cedit_box.contains(e.target)&&!(emoji_wrap&&emoji_wrap.contains(e.target))){
    hnCEditClose();
  }
  var epw=document.getElementById('hn-emoji-picker-wrap');
  var ebtn=document.getElementById('hn-tbtn-emoji');
  if(epw&&ebtn&&!epw.contains(e.target)&&e.target!==ebtn){
    epw.style['display']='none'; hn_emoji_picker_open=false;
  }
  var drop=document.getElementById('hn-notif-drop');
  var bell=document.getElementById('hn-bell-btn');
  if(drop&&bell&&e.target!==bell&&!bell.contains(e.target)&&!drop.contains(e.target)){drop.style['display']='none';}
  var ids=['auth','reg','prof'];
  for(var i=0;i<ids.length;i++){
    var m=document.getElementById('hn-modal-'+ids[i]);
    if(m&&e.target===m) hnCloseModal(ids[i]);
  }
});

/* ── LIGHTBOX ── */
function hnOpenLightbox(src) {
  var lb=document.getElementById('hn-lightbox');
  document.getElementById('hn-lb-img').src=src;
  lb.classList.add('hn-open');
  lb.style['z-index']='99999';
}
function hnCloseLightbox() {
  document.getElementById('hn-lightbox').classList.remove('hn-open');
}

/* ── NOTIFICHE ── */
function hnUpdateBadge() {
  if (!hn_user) return;
  var count = 0;
  for (var i = 0; i < hn_notifs.length; i++) {
    if (hn_notifs[i].to_id === hn_user.id && !hn_notifs[i].read) count++;
  }
  var badge = document.getElementById('hn-bell-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.style['display'] = 'flex';
  } else {
    badge.style['display'] = 'none';
  }
}

function hnCreateNotif(to_id, type, post_id, post_text) {
  if (!hn_user) return;
  if (to_id === hn_user.id) return;
  var notif = {
    id: String(Date.now()),
    to_id: to_id,
    from_id: hn_user.id,
    from_name: hn_user.name,
    from_handle: hn_user.handle,
    from_color: hn_user.color,
    from_avatar: hn_user.avatar || '',
    type: type,
    post_id: post_id || '',
    post_text: post_text ? post_text.substring(0, 60) : '',
    read: false,
    created_at: new Date().toISOString()
  };
  hn_notifs.unshift(notif);
  hnSaveNotif(notif, function(){}, function(){ hn_notifs.shift(); });
}

function hnNotifGroupTags(text, post_id, post_text) {
  var lower = text.toLowerCase();
  var notified = {};
  var group_tags = {
    '@tutti': function(p) { return true; },
    '@hunters': function(p) { return p.rank && p.rank.indexOf('Hunter') !== -1; },
    '@apprendisti': function(p) { return p.rank === 'Apprendista'; },
    '@civili': function(p) { return p.rank === 'Civile'; },
    '@lottatori': function(p) { return p.rank === 'Lottatore Celeste'; }
  };
  for (var tag in group_tags) {
    if (lower.indexOf(tag) !== -1) {
      for (var i = 0; i < hn_profiles.length; i++) {
        var p = hn_profiles[i];
        if (!notified[p.id] && group_tags[tag](p) && p.id !== hn_user.id) {
          notified[p.id] = true;
          hnCreateNotif(p.id, 'mention', post_id, post_text);
        }
      }
    }
  }
}

function hnNotifMentions(text, post_id, post_text) {
  var found = {};
  var i = 0;
  while (i < text.length) {
    if (text.charAt(i) === '@') {
      var handle = '';
      var j = i + 1;
      while (j < text.length) {
        var code = text.charCodeAt(j);
        var ok = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95;
        if (ok) { handle += text.charAt(j); j++; } else break;
      }
      if (handle && !found[handle.toLowerCase()]) {
        found[handle.toLowerCase()] = true;
        for (var k = 0; k < hn_profiles.length; k++) {
          if (hn_profiles[k].handle.toLowerCase() === handle.toLowerCase()) {
            hnCreateNotif(hn_profiles[k].id, 'mention', post_id, post_text);
            break;
          }
        }
      }
      i = j;
    } else { i++; }
  }
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
    // On mobile (body.ffm) align to left edge of button, on desktop align to right
    if (document.body && document.body.classList.contains('ffm')) {
      drop.style['left'] = Math.max(4, rect.left) + 'px';
      drop.style['right'] = 'auto';
      // Clamp width so it doesn't overflow viewport
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
  var mine = [];
  for (var i = 0; i < hn_notifs.length; i++) {
    if (hn_notifs[i].to_id === hn_user.id) mine.push(hn_notifs[i]);
  }
  var labels = { like:'ha messo like al tuo post', comment:'ha commentato il tuo post', share:'ha condiviso il tuo post', mention:'ti ha menzionato', follow:'ha iniziato a seguirti' };
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
      var label = labels[n.type] || n.type;
      var unread = !n.read ? ' hn-unread' : '';
      html += '<div class="hn-notif-item' + unread + '" onclick="hnNotifClick(\'' + n.id + '\',\'' + (n.post_id||'') + '\',\'' + (n.from_id||'') + '\',\'' + n.type + '\')">' +
        hnAvHtml(n.from_color, n.from_avatar, n.from_name, 'hn-notif-icon', null) +
        '<div class="hn-notif-body">' +
        '<div class="hn-notif-text"><strong>' + hnEsc(n.from_name) + '</strong> ' + label +
        (n.post_text ? '<br><span style="color:#5b6577!important;font-size:11px!important;">' + hnFormatText(n.post_text) + (n.post_text.length >= 60 ? '...' : '') + '</span>' : '') +
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
  var to_id = null;
  for (var i = 0; i < hn_notifs.length; i++) {
    if (hn_notifs[i].id === nid) { to_id = hn_notifs[i].to_id; hn_notifs.splice(i, 1); break; }
  }
  hn_deleted_notif_ids[nid] = true;
  hnUpdateBadge();
  hnRenderNotifDrop();
  if (to_id) hnDeleteNotifFb(to_id, nid);
}

function hnDeleteAllNotifs() {
  if (!hn_user) return;
  var remaining = [];
  for (var i = 0; i < hn_notifs.length; i++) {
    if (hn_notifs[i].to_id !== hn_user.id) remaining.push(hn_notifs[i]);
    else hn_deleted_notif_ids[hn_notifs[i].id] = true;
  }
  hn_notifs = remaining;
  hnUpdateBadge();
  hnRenderNotifDrop();
  hnDeleteAllNotifsFb(hn_user.id);
}

function hnNotifClick(nid, post_id, from_id, type) {
  hnMarkRead(nid);
  document.getElementById('hn-notif-drop').style['display'] = 'none';
  if (type === 'follow') {
    if (from_id) hnOpenProfile(from_id);
  } else if (post_id) {
    if (hn_tab_cur !== 'all') {
      hn_tab_cur = 'all';
      var tabs = document.querySelectorAll('.hn-tab');
      for (var i=0;i<tabs.length;i++) tabs[i].classList.remove('hn-active');
      var allTab = tabs[0]; if(allTab) allTab.classList.add('hn-active');
      if (hn_data_ready) hnRenderFeed();
    }
    setTimeout(function() {
      var target = document.getElementById('hn-p-' + post_id);
      if (target) {
        target.scrollIntoView({behavior:'smooth', block:'center'});
        target.style['background'] = '#243448';
        setTimeout(function(){ target.style['background'] = ''; }, 1500);
        var cs = document.getElementById('hn-cs-' + post_id);
        if (cs) cs.classList.add('hn-open');
      }
    }, 100);
  }
}

function hnMarkRead(nid) {
  for (var i = 0; i < hn_notifs.length; i++) {
    if (hn_notifs[i].id === nid) { hn_notifs[i].read = true; break; }
  }
  hn_read_notif_ids[nid] = true;
  hnUpdateBadge();
  if (hn_user) hnMarkNotifReadFb(hn_user.id, nid);
}

function hnMarkAllRead() {
  if (!hn_user) return;
  for (var i = 0; i < hn_notifs.length; i++) {
    if (hn_notifs[i].to_id === hn_user.id) {
      hn_notifs[i].read = true;
      hn_read_notif_ids[hn_notifs[i].id] = true;
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

/* ── TOOLTIP LIKES/SHARES ── */
function hnShowTooltip(e, pid, type) {
  var post = null;
  for (var i=0;i<hn_posts.length;i++){if(hn_posts[i].id===pid){post=hn_posts[i];break;}}
  if (!post) return;
  var tip = document.getElementById('hn-tooltip');
  var names = [];
  if (type === 'likes') {
    var likes = post.likes || [];
    for (var j=0;j<likes.length;j++){
      for (var k=0;k<hn_profiles.length;k++){if(hn_profiles[k].id===likes[j]){names.push(hnEsc(hn_profiles[k].name));break;}}
    }
    tip.innerHTML = names.length ? '<strong style="color:#5b6577;font-size:10px;display:block;margin-bottom:4px;">MI PIACE</strong>'+names.join('<br>') : 'Nessun like ancora.';
  } else if (type === 'dislikes') {
    var dislikes = post.dislikes || [];
    for (var j=0;j<dislikes.length;j++){
      for (var k=0;k<hn_profiles.length;k++){if(hn_profiles[k].id===dislikes[j]){names.push(hnEsc(hn_profiles[k].name));break;}}
    }
    tip.innerHTML = names.length ? '<strong style="color:#5b6577;font-size:10px;display:block;margin-bottom:4px;">NON MI PIACE</strong>'+names.join('<br>') : 'Nessun dislike ancora.';
  } else {
    var shares = [];
    for (var s=0;s<hn_posts.length;s++){
      if (hn_posts[s].sharedPost && hn_posts[s].sharedPost.id===pid) shares.push(hnEsc(hn_posts[s].authorName));
    }
    tip.innerHTML = shares.length ? '<strong style="color:#5b6577;font-size:10px;display:block;margin-bottom:4px;">CONDIVISIONI</strong>'+shares.join('<br>') : 'Nessuna condivisione ancora.';
  }
  tip.style['display'] = 'block';
  tip.style['z-index'] = '99998';
  var rect = e.target.getBoundingClientRect();
  tip.style['left'] = rect.left + 'px';
  tip.style['top'] = (rect.bottom + 6) + 'px';
}
function hnHideTooltip() {
  var tip = document.getElementById('hn-tooltip');
  if (tip) tip.style['display'] = 'none';
}
function hnEditPost(pid) {
  var post = null;
  for (var i = 0; i < hn_posts.length; i++) { if (hn_posts[i].id === pid) { post = hn_posts[i]; break; } }
  if (!post) return;
  var el = document.getElementById('hn-pt-'+pid);
  if (!el) return;
  el.innerHTML = '<textarea class="hn-inline-edit" id="hn-pe-'+pid+'" oninput="hnMentionCheck(this);" onkeydown="hnMentionKey(event,this);" onblur="setTimeout(hnMentionHide,150);">'+hnEscVal(post.text)+'</textarea>'+
    '<div class="hn-edit-row">'+
    '<button class="hn-cancel-btn" onclick="if(hn_data_ready)hnRenderFeed()">Annulla</button>'+
    '<button class="hn-save-btn" onclick="hnSavePost(\''+pid+'\')">Salva</button>'+
    '</div>';
}
function hnSavePost(pid) {
  var ta = document.getElementById('hn-pe-'+pid);
  if (!ta) return;
  var text = ta.value.trim();
  if (!text) return;
  var post_to_save = null;
  for (var i = 0; i < hn_posts.length; i++) {
    if (hn_posts[i].id === pid) { hn_posts[i].text = text; hn_posts[i].edited = true; post_to_save = hn_posts[i]; break; }
  }
  if (!post_to_save) return;
  hnSavePost_fb(post_to_save, function(){}, function(){ alert('Errore nel salvataggio.'); });
}
function hnDeletePost(pid) {
  if (!confirm('Eliminare questo post?')) return;
  for (var i = 0; i < hn_posts.length; i++) { if (hn_posts[i].id === pid) { hn_posts.splice(i,1); break; } }
  hnDeletePost_fb(pid, function(){}, function(){ alert('Errore nell\'eliminazione.'); });
}

function hnEditComment(pid, ci) {
  var post = null;
  for (var i = 0; i < hn_posts.length; i++) { if (hn_posts[i].id === pid) { post = hn_posts[i]; break; } }
  if (!post || !post.comments[ci]) return;
  var cid = pid + '_' + ci;
  var el = document.getElementById('hn-ct-'+cid);
  if (!el) return;
  el.innerHTML = '<input class="hn-inline-edit-small" id="hn-ce-'+cid+'" type="text" value="'+hnEscAttr(post.comments[ci].text)+'" oninput="hnMentionCheck(this);" onkeydown="hnMentionKey(event,this);if(event.key===\'Enter\')hnSaveComment(\''+pid+'\','+ci+')" onblur="setTimeout(hnMentionHide,150);">'+
    '<div class="hn-edit-row">'+
    '<button class="hn-cancel-btn" onclick="if(hn_data_ready)hnRenderFeed()">Annulla</button>'+
    '<button class="hn-save-btn" onclick="hnSaveComment(\''+pid+'\','+ci+')">Salva</button>'+
    '</div>';
}
function hnSaveComment(pid, ci) {
  var cid = pid + '_' + ci;
  var inp = document.getElementById('hn-ce-'+cid);
  if (!inp) return;
  var text = inp.value.trim(); if (!text) return;
  for (var i = 0; i < hn_posts.length; i++) {
    if (hn_posts[i].id === pid) { hn_posts[i].comments[ci].text = text; hn_posts[i].comments[ci].edited = true; break; }
  }
  hnSavePost_fb(hnGetPostById(pid),
    function(){ setTimeout(function(){ var cs=document.getElementById('hn-cs-'+pid); if(cs)cs.classList.add('hn-open'); },300); },
    function(){ alert('Errore nel salvataggio.'); }
  );
}
function hnDeleteComment(pid, ci) {
  if (!confirm('Eliminare questo commento?')) return;
  for (var i = 0; i < hn_posts.length; i++) {
    if (hn_posts[i].id === pid) { hn_posts[i].comments.splice(ci,1); break; }
  }
  hnSavePost_fb(hnGetPostById(pid),
    function(){ setTimeout(function(){ var cs=document.getElementById('hn-cs-'+pid); if(cs)cs.classList.add('hn-open'); },300); },
    function(){ alert('Errore nell\'eliminazione.'); }
  );
}

function hnEditReply(pid, ci, ri) {
  var post = null;
  for (var i = 0; i < hn_posts.length; i++) { if (hn_posts[i].id === pid) { post = hn_posts[i]; break; } }
  if (!post || !post.comments[ci] || !post.comments[ci].replies[ri]) return;
  var cid = pid + '_' + ci;
  var rid = cid + '_' + ri;
  var el = document.getElementById('hn-rt-'+rid);
  if (!el) return;
  el.innerHTML = '<input class="hn-inline-edit-small" id="hn-re-'+rid+'" type="text" value="'+hnEscAttr(post.comments[ci].replies[ri].text)+'" oninput="hnMentionCheck(this);" onkeydown="hnMentionKey(event,this);if(event.key===\'Enter\')hnSaveReply(\''+pid+'\','+ci+','+ri+')" onblur="setTimeout(hnMentionHide,150);">'+
    '<div class="hn-edit-row">'+
    '<button class="hn-cancel-btn" onclick="if(hn_data_ready)hnRenderFeed()">Annulla</button>'+
    '<button class="hn-save-btn" onclick="hnSaveReply(\''+pid+'\','+ci+','+ri+')">Salva</button>'+
    '</div>';
}
function hnSaveReply(pid, ci, ri) {
  var cid = pid + '_' + ci;
  var rid = cid + '_' + ri;
  var inp = document.getElementById('hn-re-'+rid);
  if (!inp) return;
  var text = inp.value.trim(); if (!text) return;
  for (var i = 0; i < hn_posts.length; i++) {
    if (hn_posts[i].id === pid) { hn_posts[i].comments[ci].replies[ri].text = text; hn_posts[i].comments[ci].replies[ri].edited = true; break; }
  }
  hnSavePost_fb(hnGetPostById(pid),
    function(){
      setTimeout(function(){
        var cs = document.getElementById('hn-cs-'+pid); if(cs) cs.classList.add('hn-open');
        var rep = document.getElementById('hn-rep-'+pid+'_'+ci); if(rep) rep.classList.add('hn-open');
      },300);
    },
    function(){ alert('Errore nel salvataggio.'); }
  );
}
function hnDeleteReply(pid, ci, ri) {
  if (!confirm('Eliminare questa risposta?')) return;
  for (var i = 0; i < hn_posts.length; i++) {
    if (hn_posts[i].id === pid) { hn_posts[i].comments[ci].replies.splice(ri,1); break; }
  }
  hnSavePost_fb(hnGetPostById(pid),
    function(){
      setTimeout(function(){
        var cs = document.getElementById('hn-cs-'+pid); if(cs) cs.classList.add('hn-open');
        var rep = document.getElementById('hn-rep-'+pid+'_'+ci); if(rep) rep.classList.add('hn-open');
      },300);
    },
    function(){ alert('Errore nell\'eliminazione.'); }
  );
}

function hnEscVal(s) {
  if (!s) return '';
  return s.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
}
function hnEscAttr(s) {
  if (!s) return '';
  return s.split('&').join('&amp;').split('"').join('&quot;').split("'").join('&#39;').split('<').join('&lt;').split('>').join('&gt;');
}

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
  }
}
function hnTogglePollCompose() {
  var pc = document.getElementById('hn-poll-compose');
  if (!pc) return;
  if (pc.style['display'] === 'none' || pc.style['display'] === '') {
    pc.style['display'] = 'block';
    hn_poll_options = ['',''];
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
    var idx = i;
    html += '<div style="display:flex!important;gap:4px!important;margin-bottom:4px!important;">'+
      '<input type="text" id="hn-poll-opt-'+idx+'" value="'+hnEscAttr(hn_poll_options[idx])+'" placeholder="Opzione '+(idx+1)+'..." '+
      'style="flex:1!important;font-family:DM Sans,sans-serif!important;font-size:12px!important;border:1px solid #313846!important;border-radius:6px!important;padding:4px 8px!important;background:#1e2128!important;color:#e2e8f0!important;outline:none!important;" '+
      'oninput="hn_poll_options['+idx+']=this.value">'+
      (hn_poll_options.length>2?'<button onclick="hnRemovePollOpt('+idx+')" style="background:none!important;border:none!important;color:#5b6577!important;cursor:pointer!important;font-size:14px!important;">×</button>':'')+
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
var hn_mention_target = null;
var hn_mention_sel = -1;

function hnMentionify(text) {
  return text.replace(/@([a-zA-Z0-9_]+)/g, function(match, handle) {
    var found = false;
    for (var i = 0; i < hn_profiles.length; i++) {
      if (hn_profiles[i].handle.toLowerCase() === handle.toLowerCase()) { found = true; break; }
    }
    if (found) return '<span class="hn-mention" onclick="hnOpenProfileByHandle(\''+handle+'\')">@'+hnEsc(handle)+'</span>';
    return match;
  });
}

function hnProfileById(id) {
  for (var i = 0; i < hn_profiles.length; i++) { if (hn_profiles[i].id === id) return hn_profiles[i]; }
  return null;
}

function hnOpenProfileByHandle(handle) {
  for (var i = 0; i < hn_profiles.length; i++) {
    if (hn_profiles[i].handle.toLowerCase() === handle.toLowerCase()) {
      hnOpenProfile(hn_profiles[i].id); return;
    }
  }
}

/* mention handlers are inline on elements */

function hnMentionCheck(el) {
  var val = el.value;
  var pos = el.selectionStart;
  var before = val.substring(0, pos);
  var query = '';
  var foundAt = false;
  for (var i = before.length - 1; i >= 0; i--) {
    var ch = before.charAt(i);
    var code = before.charCodeAt(i);
    var isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    var isDigit  = (code >= 48 && code <= 57);
    var isUnder  = (code === 95);
    if (isLetter || isDigit || isUnder) {
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
  for (var j = 0; j < hn_profiles.length; j++) {
    var p = hn_profiles[j];
    if (p.handle.toLowerCase().indexOf(q) === 0 || p.name.toLowerCase().indexOf(q) === 0) {
      results.push(p);
    }
    if (results.length >= 5) break;
  }
  var groups = [
    {name:'@tutti', handle:'tutti', color:'#5b9cf6', desc:'Tutti gli utenti'},
    {name:'@hunters', handle:'hunters', color:'#5cb878', desc:'Tutti i Hunters'},
    {name:'@apprendisti', handle:'apprendisti', color:'#c878c8', desc:'Apprendisti'},
    {name:'@civili', handle:'civili', color:'#8892a4', desc:'Civili'},
    {name:'@lottatori', handle:'lottatori', color:'#88c4f4', desc:'Lottatori Celesti'}
  ];
  for (var gi=0; gi<groups.length; gi++) {
    if (groups[gi].handle.toLowerCase().indexOf(q) === 0) {
      results.push({id:'__group__'+groups[gi].handle, name:groups[gi].name, handle:groups[gi].handle, color:groups[gi].color, avatar:'', _isGroup:true});
    }
    if (results.length >= 5) break;
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
  drop.style['display'] = 'none';
  hn_mention_target = null;
  hn_mention_sel = -1;
}

function hnMentionPick(handle) {
  if (handle.indexOf('__group__') === 0) handle = handle.replace('__group__','');
  if (!hn_mention_target) return;
  var el = hn_mention_target;
  var val = el.value;
  var pos = el.selectionStart;
  var before = val.substring(0, pos);
  var after = val.substring(pos);
  var atIdx = -1;
  for (var i = before.length - 1; i >= 0; i--) {
    var code = before.charCodeAt(i);
    var isLetterDigitUnder = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || (code === 95);
    if (isLetterDigitUnder) continue;
    if (before.charAt(i) === '@') { atIdx = i; break; }
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
  if (drop.style['display'] === 'none') return;
  var items = drop.querySelectorAll('.hn-mention-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    hn_mention_sel = Math.min(hn_mention_sel + 1, items.length - 1);
    for (var i = 0; i < items.length; i++) {
      if (i === hn_mention_sel) items[i].classList.add('hn-msel');
      else items[i].classList.remove('hn-msel');
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    hn_mention_sel = Math.max(hn_mention_sel - 1, 0);
    for (var i = 0; i < items.length; i++) {
      if (i === hn_mention_sel) items[i].classList.add('hn-msel');
      else items[i].classList.remove('hn-msel');
    }
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    if (hn_mention_sel >= 0 && items[hn_mention_sel]) {
      e.preventDefault();
      hnMentionPick(items[hn_mention_sel].getAttribute('data-handle'));
    }
  } else if (e.key === 'Escape') {
    hnMentionHide();
  }
}

function hnOpenShare(pid) {
  if (!hn_user) { hnOpenModal('auth'); return; }
  hn_share_pid = pid;
  var post = null;
  for (var i = 0; i < hn_posts.length; i++) { if (hn_posts[i].id === pid) { post = hn_posts[i]; break; } }
  if (!post) return;
  document.getElementById('hn-share-text').value = '';
  var sth = post.text.replace(/(#\w+)/g,'<span class="hn-hi">$1</span>');
  document.getElementById('hn-share-preview').innerHTML =
    '<div class="hn-shared-label">Post di '+hnEsc(post.authorName)+'</div>'+
    '<div class="hn-shared-author">'+hnEsc(post.authorName)+' <span style="color:#5b6577!important;">@'+hnEsc(post.authorHandle)+'</span></div>'+
    '<div class="hn-shared-text">'+sth+'</div>'+
    (post.imgUrl?'<img src="'+hnEsc(post.imgUrl)+'" style="max-width:100%;max-height:120px;border-radius:6px;margin-top:6px;object-fit:cover;display:block;" onerror="this.style.display=\'none\'">':'');
  document.getElementById('hn-share-err').style['display'] = 'none';
  hnOpenModal('share');
}

function hnDoShare() {
  if (!hn_user || !hn_share_pid) return;
  var orig = null;
  for (var i = 0; i < hn_posts.length; i++) { if (hn_posts[i].id === hn_share_pid) { orig = hn_posts[i]; break; } }
  if (!orig) return;
  var text = document.getElementById('hn-share-text').value.trim();
  var btn = document.querySelector('#hn-modal-share .hn-dbtn');
  btn.disabled = true; btn.textContent = '...';
  var newPost = {
    id: String(Date.now()),
    authorId: hn_user.id, authorName: hn_user.name,
    authorHandle: hn_user.handle, authorColor: hn_user.color,
    authorAvatar: hn_user.avatar || '', authorRank: hn_user.rank,
    text: text, imgUrl: '', likes: [], comments: [],
    sharedPost: {
      id: orig.id, authorId: orig.authorId,
      authorName: orig.authorName, authorHandle: orig.authorHandle,
      text: orig.text, imgUrl: orig.imgUrl || ''
    },
    createdAt: new Date().toISOString()
  };
  hn_posts.unshift(newPost);
  hnSavePost_fb(newPost,
    function() {
      hnCloseModal('share'); btn.disabled=false; btn.textContent='Condividi';
      if (orig.authorId !== hn_user.id) hnCreateNotif(orig.authorId,'share',orig.id,orig.text);
      if (text) hnNotifMentions(text,newPost.id,text);
    },
    function() { hn_posts.shift(); hnShowErr('hn-share-err','Errore nella condivisione. Riprova.'); btn.disabled=false; btn.textContent='Condividi'; }
  );
}

function hnToggleReplies(cid) {
  var el = document.getElementById('hn-rep-'+cid);
  if (!el) return;
  if (el.classList.contains('hn-open')) el.classList.remove('hn-open');
  else el.classList.add('hn-open');
}

function hnSubmitReply(pid, commentIndex) {
  if (!hn_user) { hnOpenModal('auth'); return; }
  var cid = pid + '_' + commentIndex;
  var inp = document.getElementById('hn-ri-'+cid);
  if (!inp) return;
  var text = inp.value.trim(); if (!text) return;
  var post = null;
  for (var i = 0; i < hn_posts.length; i++) { if (hn_posts[i].id === pid) { post = hn_posts[i]; break; } }
  if (!post || !post.comments || !post.comments[commentIndex]) return;
  var comment = post.comments[commentIndex];
  if (!comment.replies) comment.replies = [];
  var reply = {
    id: String(Date.now()),
    authorId: hn_user.id, authorName: hn_user.name,
    authorHandle: hn_user.handle, authorColor: hn_user.color,
    authorAvatar: hn_user.avatar || '',
    text: text, createdAt: new Date().toISOString()
  };
  comment.replies.push(reply);
  hnSavePost_fb(hnGetPostById(pid),
    function() {
      hnNotifMentions(text, pid, text); hnNotifGroupTags(text, pid, text);
      if (comment.authorId !== hn_user.id) hnCreateNotif(comment.authorId, 'comment', pid, text);
      setTimeout(function() {
        var cs = document.getElementById('hn-cs-'+pid);
        if (cs) cs.classList.add('hn-open');
        var rep = document.getElementById('hn-rep-'+cid);
        if (rep) rep.classList.add('hn-open');
      }, 300);
    },
    function() { comment.replies.pop(); alert('Errore nel salvataggio della risposta.'); }
  );
}

function hnSubmitCommentFull(pid, text, imgUrl, linkUrl, linkTitle, linkImg) {
  if (!hn_user) { hnOpenModal('auth'); return; }
  var post=null; for (var i=0;i<hn_posts.length;i++) { if(hn_posts[i].id===pid){post=hn_posts[i];break;} }
  if (!post) {
    hn_fb_get('hunternet/posts/'+pid, function(d) {
      if (d) { hn_posts.push(d); hnSubmitCommentFull(pid, text, imgUrl, linkUrl, linkTitle); }
    }, function(){});
    return;
  }
  if (!post.comments) post.comments=[];
  var cmt={id:String(Date.now()),authorId:hn_user.id,authorName:hn_user.name,
    authorHandle:hn_user.handle,authorColor:hn_user.color,authorAvatar:hn_user.avatar||'',
    text:text, imgUrl:imgUrl||'', linkUrl:linkUrl||'', linkTitle:linkTitle||'', linkImage:linkImg||'',
    createdAt:new Date().toISOString()};
  post.comments.push(cmt);
  hnSavePost_fb(post,
    function(){
      setTimeout(function(){var cs=document.getElementById('hn-cs-'+pid);if(cs)cs.classList.add('hn-open');},300);
      if (post.authorId !== hn_user.id) hnCreateNotif(post.authorId,'comment',post.id,post.text);
      hnNotifMentions(text,post.id,post.text); hnNotifGroupTags(text,post.id,post.text);
    },
    function(){ post.comments.pop(); alert('Errore commento.'); }
  );
}

function hnSubmitReplyFull(pid, commentIndex, text, imgUrl, linkUrl, linkTitle, linkImg) {
  if (!hn_user) { hnOpenModal('auth'); return; }
  var post = null;
  for (var i = 0; i < hn_posts.length; i++) { if (hn_posts[i].id === pid) { post = hn_posts[i]; break; } }
  if (!post || !post.comments || !post.comments[commentIndex]) return;
  var comment = post.comments[commentIndex];
  if (!comment.replies) comment.replies = [];
  var reply = {
    id: String(Date.now()),
    authorId: hn_user.id, authorName: hn_user.name,
    authorHandle: hn_user.handle, authorColor: hn_user.color,
    authorAvatar: hn_user.avatar || '',
    text: text, imgUrl: imgUrl||'', linkUrl: linkUrl||'', linkTitle: linkTitle||'', linkImage: linkImg||'',
    createdAt: new Date().toISOString()
  };
  comment.replies.push(reply);
  var cid = pid + '_' + commentIndex;
  hnSavePost_fb(hnGetPostById(pid),
    function() {
      hnNotifMentions(text, pid, text); hnNotifGroupTags(text, pid, text);
      if (comment.authorId !== hn_user.id) hnCreateNotif(comment.authorId, 'comment', pid, text);
      setTimeout(function() {
        var cs = document.getElementById('hn-cs-'+pid);
        if (cs) cs.classList.add('hn-open');
        var rep = document.getElementById('hn-rep-'+cid);
        if (rep) rep.classList.add('hn-open');
      }, 300);
    },
    function() { comment.replies.pop(); alert('Errore nel salvataggio della risposta.'); }
  );
}


function hnUpdatePresence() {
  if (!hn_user) return;
  var now = new Date().toISOString();
  hn_user.last_seen = now;
  sessionStorage.setItem('hn_user', JSON.stringify(hn_user));
  for (var i = 0; i < hn_profiles.length; i++) {
    if (hn_profiles[i].id === hn_user.id) {
      hn_profiles[i].last_seen = now;
      break;
    }
  }
  hn_fb_ref('hunternet/profiles/'+hn_user.id+'/last_seen').set(now).catch(function(){});
}

function hnIsOnline(prof) {
  if (!prof || !prof.last_seen) return false;
  return (Date.now() - new Date(prof.last_seen).getTime()) < 2100000; // 35 minuti
}

/* Follower fittizi: ogni follower reale vale HN_FOLLOWER_MULT */
var HN_FOLLOWER_MULT = 10000;
var HN_LIKE_MULT = 3756; /* solo per il totale "Like ricevuti" nel profilo */
function hnFmtCount(n) {
  if (n >= 1000000) return String(parseFloat((n/1000000).toFixed(1))).replace('.', ',') + 'M';
  if (n >= 1000)    return String(parseFloat((n/1000).toFixed(1))).replace('.', ',') + 'K';
  return String(n);
}

/* Condivisioni: contate dai post che condividono pid (stessa fonte del tooltip) */
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

/* Presence updated at login and every 30 minutes.
   Poll expiry checked every 5 minutes. */
setInterval(function() {
  if (!hn_user) return;
  hnUpdatePresence();
}, 1800000); // 30 minuti

setInterval(function() {
  hnCheckPollExpiry();
}, 300000); // 5 minuti
hnInit();
