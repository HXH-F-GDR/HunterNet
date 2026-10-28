/* HunterNet AutoPost v1.1.0
   Permette ad altri script del forum (HeavensBet, giornali...) di pubblicare un post su HunterNet
   a nome di un profilo HunterNet esistente.

   v1.1.0 - Nuovo campo facoltativo linkDisplay: testo mostrato nella card del link al posto
            dell'indirizzo vero, che resta la destinazione del clic (richiede HunterNet v14.9.0).

   Uso:
     HunterNetAutoPost('nickname_profilo', {
       text: 'Testo del post (max 280 caratteri, supporta #tag e @menzioni)',
       images: ['https://...'],          opzionale, fino a 4 (immagini, GIF o YouTube)
       linkUrl: 'https://...',           opzionale
       linkTitle: 'Titolo del link',     opzionale
       linkImage: 'https://...',         opzionale, immagine dell'anteprima del link
       linkDisplay: 'sito.it/#pagina',   opzionale, indirizzo mostrato nella card del link
       key: 'hb_apertura_123'            opzionale: chiave unica, impedisce di pubblicare due volte lo stesso post
     }).then(function(post) { ... }).catch(function(err) { ... });
*/
(function() {
  var DB = 'https://hunternet-7c5e5-default-rtdb.europe-west1.firebasedatabase.app';
  var MAX_TEXT = 280;
  var MAX_IMAGES = 4;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function safeKey(k) {
    var out = String(k).replace(/[.#$\[\]\/\s]/g, '_');
    return out.slice(0, 120);
  }
  function safeUrl(u) {
    if (!u) return '';
    u = String(u).trim();
    if (/^www\./i.test(u)) u = 'https://' + u;
    return /^https?:\/\//i.test(u) ? u : '';
  }
  function getJSON(path) {
    return fetch(DB + '/' + path + '.json').then(function(r) {
      if (!r.ok) throw new Error('HunterNet: errore ' + r.status + ' leggendo ' + path);
      return r.json();
    });
  }
  function putJSON(path, data) {
    return fetch(DB + '/' + path + '.json', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data)
    }).then(function(r) {
      if (!r.ok) throw new Error('HunterNet: errore ' + r.status + ' scrivendo ' + path);
      return r.json();
    });
  }
  function findProfile(handle) {
    var h = String(handle || '').replace('@', '').toLowerCase();
    return getJSON('hunternet/profiles').then(function(d) {
      if (d) {
        for (var k in d) {
          if (d[k] && d[k].handle && String(d[k].handle).toLowerCase() === h) {
            if (!d[k].id) d[k].id = k;
            return d[k];
          }
        }
      }
      throw new Error('HunterNet: nessun profilo con nickname @' + h);
    });
  }

  window.HunterNetAutoPost = function(handle, data) {
    data = data || {};
    var text = String(data.text || '').trim();
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT - 1) + '…';
    var images = [];
    var src = data.images || (data.imgUrl ? [data.imgUrl] : []);
    for (var i = 0; i < src.length && images.length < MAX_IMAGES; i++) {
      var u = safeUrl(src[i]);
      if (u) images.push(u);
    }
    var linkUrl = safeUrl(data.linkUrl);
    if (!text && !images.length && !linkUrl) return Promise.reject(new Error('HunterNet: post vuoto'));
    var id = data.key ? 'auto_' + safeKey(data.key) : uid();

    var exists = data.key ? getJSON('hunternet/posts/' + id) : Promise.resolve(null);
    return exists.then(function(found) {
      if (found) return found;
      return findProfile(handle).then(function(prof) {
        var post = {
          id: id,
          authorId: prof.id,
          authorName: prof.name || '',
          authorHandle: prof.handle || '',
          authorColor: prof.color || '',
          authorAvatar: prof.avatar || '',
          authorRank: prof.rank || '',
          text: text,
          imgUrl: images[0] || '',
          images: images.length > 1 ? images : [],
          linkUrl: linkUrl,
          linkTitle: linkUrl ? String(data.linkTitle || '') : '',
          linkImage: linkUrl ? safeUrl(data.linkImage) : '',
          linkDisplay: linkUrl ? String(data.linkDisplay || '').slice(0, 150) : '',
          mood: '',
          likes: [], dislikes: [], comments: [],
          poll: null,
          auto: true,
          createdAt: new Date().toISOString()
        };
        return putJSON('hunternet/posts/' + id, post).then(function() { return post; });
      });
    });
  };
})();
