/* Redazioni AutoPost v1.2.0
   Quando qualcuno pubblica un nuovo articolo in una delle tre redazioni,
   pubblica un post su HunterNet a nome della testata.

   v1.2.0 - Stesso file per desktop e mobile (il bundle mobile ne contiene una copia;
            se girano entrambe, ne parte una sola).
          - Invio riconosciuto dai campi del form (act=Post, CODE=01, f=sezione) come in
            hxh-avvisi-quest: funziona con qualunque form, anche quello mobile, e ignora
            le anteprime.
          - Articolo riconosciuto dal titolo oppure, se il titolo non torna, dalla sezione
            piu' il primo post scritto dall'utente stesso (Commons.location).
          - Dal titolo del post e dell'indirizzo finto vengono tolti la rubrica iniziale
            tra quadre (es. [Errata corrige]) e gli eventuali tag di formattazione.
          - Se HunterNetAutoPost non c'e', il modulo viene caricato da jsDelivr.
   v1.1.0 - Indirizzo finto della testata nella card del link (linkDisplay).

   Funzionamento
   - Invio di una nuova discussione in una redazione: salva in localStorage titolo,
     firma e prima immagine dell'articolo.
   - Primo caricamento dell'articolo appena creato (entro 15 minuti): pubblica il post
     con chiave art_<idTopic>, quindi lo stesso articolo non viene mai annunciato due volte.
*/
(function() {
  if (window.__hxhRedazioniAutopost) return;
  window.__hxhRedazioniAutopost = true;

  var MODULO_URL = 'https://cdn.jsdelivr.net/gh/HXH-F-GDR/HunterNet@main/hunternet-autopost-v1.1.0.js';
  var STORE = 'hn_art_pending';
  var MAX_ETA = 15 * 60 * 1000;

  var TESTATE = {
    '65121577': { profilo: 'LaSpina', nome: 'La Spina', dominio: 'laspina.onion' },
    '65121578': { profilo: 'YorkShinTimes', nome: 'York Shin Times', dominio: 'yorkshintimes.yr' },
    '65121579': { profilo: 'SwardaniPost', nome: 'Swardani Post', dominio: 'swardanipost.as' }
  };

  /* Testi dei post. {t} = titolo, {f} = ", di Nome" oppure vuoto.
     Il testo viene scelto in base all'id del topic: sempre lo stesso
     per lo stesso articolo, ma diverso da un articolo all'altro. */
  var TESTI = {
    'LaSpina': [
      'Qualcuno doveva pur dirlo, e ovviamente tocca a noi: «{t}»{f}. Leggetelo prima che diventi vero. #LaSpina',
      'Fermi tutti, nuovo pezzo in pagina: «{t}»{f}. Potete fingere di averlo letto, o leggerlo davvero. #LaSpina',
      'La notizia che nessuno ha chiesto ma di cui tutti avevano bisogno: «{t}»{f}. #LaSpina',
      'Mettete giù quel caffè: «{t}»{f}. Poi non dite che non vi avevamo avvisato. #LaSpina'
    ],
    'YorkShinTimes': [
      'Nuovo articolo sul York Shin Times: «{t}»{f}. Leggi il pezzo completo sul nostro sito. #YorkShinTimes',
      'In pubblicazione oggi: «{t}»{f}. L\'articolo completo è disponibile sul York Shin Times. #YorkShinTimes'
    ],
    'SwardaniPost': [
      'Pubblicato sullo Swardani Post: «{t}»{f}. Leggi l\'articolo completo. #SwardaniPost',
      'Da oggi in edicola online: «{t}»{f}. Approfondimento completo sullo Swardani Post. #SwardaniPost'
    ]
  };

  function leggiPending() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; }
  }
  function salvaPending(d) {
    try { localStorage.setItem(STORE, JSON.stringify(d)); } catch (e) {}
  }
  function cancellaPending() {
    try { localStorage.removeItem(STORE); } catch (e) {}
  }
  function norm(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function campo(form, nome) {
    var el = form && form.elements ? form.elements[nome] : null;
    if (el && el.length !== undefined && el.value === undefined) el = el[0];
    return el && el.value !== undefined ? String(el.value) : '';
  }

  /* Titolo senza tag di formattazione ne' rubrica iniziale [Rubrica] */
  function pulisciTitolo(t) {
    t = String(t || '').replace(/­/g, '');
    t = t.replace(/<[^>]*>/g, '');
    t = t.replace(/\[\/?(b|i|u|s|color|size|font)(=[^\]]*)?\]/gi, '');
    t = t.replace(/^\s*\[[^\]]+\]\s*/, '');
    return t.replace(/\s+/g, ' ').trim();
  }
  /* Titolo per l'indirizzo finto: minuscolo, senza accenti,
     tutto cio' che non e' lettera o numero diventa "_" */
  function slug(titolo) {
    var t = String(titolo || '').toLowerCase();
    if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
    t = t.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (t.length > 60) t = t.slice(0, 60).replace(/_[^_]*$/, '');
    return t || 'articolo';
  }
  /* Firma: prima riga "Firma: Nome" scritta da redazioni-firme */
  function estraiFirma(testo) {
    var m = String(testo).match(/^\s*Firma:\s*(.+)$/im);
    return m ? m[1].replace(/\[[^\]]*\]/g, '').replace(/<[^>]*>/g, '').trim() : '';
  }
  /* Prima immagine: bbcode [img] oppure tag <img src> */
  function estraiImmagine(testo) {
    var m = String(testo).match(/\[img[^\]]*\]\s*(https?:\/\/[^\s\[]+)\s*\[\/img\]/i) ||
            String(testo).match(/<img[^>]+src\s*=\s*["']?(https?:\/\/[^"'\s>]+)/i);
    return m ? m[1] : '';
  }

  /* 1. Invio del modulo "Nuova discussione" */
  function segnaInvio(form, pulsante) {
    try {
      if (!form || campo(form, 'act').toLowerCase() !== 'post') return;
      if (campo(form, 'CODE') !== '01') return;
      if (pulsante && /preview|anteprima/i.test((pulsante.name || '') + ' ' + (pulsante.value || ''))) return;
      var sez = campo(form, 'f');
      if (!TESTATE[sez]) return;
      var titolo = pulisciTitolo(campo(form, 'TopicTitle'));
      if (!titolo) return;
      var testo = campo(form, 'Post');
      salvaPending({
        sez: sez,
        titolo: titolo,
        firma: estraiFirma(testo),
        img: estraiImmagine(testo),
        ts: Date.now()
      });
    } catch (e) {}
  }
  document.addEventListener('submit', function(ev) { segnaInvio(ev.target, ev.submitter); }, true);
  /* invio fatto da script: form.submit() non genera l'evento submit */
  var submitPrima = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function() {
    segnaInvio(this, null);
    return submitPrima.apply(this, arguments);
  };

  /* 2. Arrivo nell'articolo appena creato */
  function idTopic() {
    var m = location.search.match(/[?&]t=(\d+)/) || (document.body.className || '').match(/\bt(\d+)\b/);
    return m ? m[1] : '';
  }
  function sezionePagina() {
    var loc = window.Commons && window.Commons.location;
    if (loc && loc.section && loc.section.id) return String(loc.section.id);
    var m = (document.body.className || '').match(/\bf(\d+)\b/);
    return m ? m[1] : '';
  }
  function titoloPagina() {
    var loc = window.Commons && window.Commons.location;
    var out = [document.title];
    if (loc && loc.topic && loc.topic.title) out.push(loc.topic.title);
    var cand = document.querySelectorAll('h1, h2, .title, .topic-title, .article-title, #nav-title');
    for (var i = 0; i < cand.length; i++) out.push(cand[i].textContent);
    return norm(out.join(' | '));
  }
  function primoPostDellUtente() {
    var c = window.Commons || {};
    var loc = c.location, u = c.user;
    if (!loc || !u || !u.id || loc.isFirstPage === false) return false;
    var primo = loc.posts && loc.posts[0];
    return !!(primo && primo.author && String(primo.author.id) === String(u.id));
  }
  function aspettaModulo(cb) {
    if (typeof window.HunterNetAutoPost === 'function') { cb(); return; }
    if (!window.__hxhAutopostLoading) {
      window.__hxhAutopostLoading = true;
      var sc = document.createElement('script');
      sc.src = MODULO_URL;
      (document.head || document.documentElement).appendChild(sc);
    }
    var tentativi = 40;
    (function prova() {
      if (typeof window.HunterNetAutoPost === 'function') { cb(); return; }
      if (--tentativi <= 0) { console.warn('Redazioni AutoPost: HunterNetAutoPost non caricato'); return; }
      setTimeout(prova, 250);
    })();
  }
  function controllaArticolo() {
    var p = leggiPending();
    if (!p) return;
    if (Date.now() - (p.ts || 0) > MAX_ETA) { cancellaPending(); return; }
    var topic = idTopic();
    if (!topic) return;
    if (sezionePagina() !== p.sez) return;
    var titoloOk = titoloPagina().indexOf(norm(p.titolo)) !== -1;
    if (!titoloOk && !primoPostDellUtente()) return;
    var testata = TESTATE[p.sez];
    if (!testata) { cancellaPending(); return; }

    cancellaPending();
    var titolo = p.titolo.length > 120 ? p.titolo.slice(0, 119) + '…' : p.titolo;
    var lista = TESTI[testata.profilo];
    var testo = lista[parseInt(topic, 10) % lista.length]
      .replace('{t}', titolo)
      .replace('{f}', p.firma ? ', di ' + p.firma : '');

    aspettaModulo(function() {
      window.HunterNetAutoPost(testata.profilo, {
        text: testo,
        linkUrl: location.protocol + '//' + location.host + '/?t=' + topic,
        linkTitle: testata.nome + ' - ' + p.titolo,
        linkImage: p.img,
        linkDisplay: testata.dominio + '/#' + slug(p.titolo),
        key: 'art_' + topic
      }).catch(function(e) { console.warn('Redazioni AutoPost:', e && e.message); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', controllaArticolo);
  else controllaArticolo();
})();
