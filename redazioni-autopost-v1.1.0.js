/* Redazioni AutoPost v1.1.0

   v1.1.0 - La card del link mostra un indirizzo finto della testata
            (es. laspina.onion/#titolo_articolo) al posto di quello di ForumFree,
            che resta la destinazione del clic. Richiede hunternet-autopost v1.1.0
            e HunterNet v14.9.0.

   Quando qualcuno pubblica un nuovo articolo in una delle tre redazioni,
   pubblica un post su HunterNet a nome della testata.

   Funzionamento
   - Pagina "Nuova discussione" di una redazione: all'invio del form salva
     in localStorage titolo, firma e prima immagine dell'articolo.
   - Primo caricamento della pagina dell'articolo appena creato (titolo
     uguale, entro 15 minuti): pubblica il post con chiave art_<idTopic>,
     quindi lo stesso articolo non viene mai annunciato due volte.

   Richiede hunternet-autopost-v1.1.0.js caricato prima (o dopo: lo script
   aspetta fino a 10 secondi che HunterNetAutoPost sia disponibile).
   Non tocca firme, HTML delle sezioni o lo script redazioni-firme.
*/
(function() {
  var STORE = 'hn_art_pending';
  var MAX_ETA = 15 * 60 * 1000;

  var TESTATE = {
    '65121577': { profilo: 'LaSpina', nome: 'La Spina', tag: '#LaSpina', dominio: 'laspina.onion', tono: 'sarcastico' },
    '65121578': { profilo: 'YorkShinTimes', nome: 'York Shin Times', tag: '#YorkShinTimes', dominio: 'yorkshintimes.yr', tono: 'professionale' },
    '65121579': { profilo: 'SwardaniPost', nome: 'Swardani Post', tag: '#SwardaniPost', dominio: 'swardanipost.as', tono: 'professionale' }
  };

  /* Testi dei post. {t} = titolo, {f} = " di Nome" oppure vuoto.
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
  function paramUrl(nome) {
    var m = location.search.match(new RegExp('[?&]' + nome + '=(\\d+)'));
    return m ? m[1] : '';
  }
  function classeNum(prefisso) {
    var m = (' ' + document.body.className + ' ').match(new RegExp('\\s' + prefisso + '(\\d+)\\s'));
    return m ? m[1] : '';
  }

  /* Firma: prima riga "Firma: Nome" scritta da redazioni-firme */
  function estraiFirma(testo) {
    var m = String(testo).match(/^\s*Firma:\s*(.+)$/im);
    return m ? m[1].replace(/\[[^\]]*\]/g, '').trim() : '';
  }
  /* Prima immagine: bbcode [img] oppure tag <img src> */
  function estraiImmagine(testo) {
    var m = String(testo).match(/\[img[^\]]*\]\s*(https?:\/\/[^\s\[]+)\s*\[\/img\]/i) ||
            String(testo).match(/<img[^>]+src\s*=\s*["']?(https?:\/\/[^"'\s>]+)/i);
    return m ? m[1] : '';
  }

  /* Titolo per l'indirizzo finto: minuscolo, senza accenti,
     tutto cio' che non e' lettera o numero diventa "_" */
  function slug(titolo) {
    var t = String(titolo || '').toLowerCase();
    if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    t = t.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (t.length > 60) t = t.slice(0, 60).replace(/_[^_]*$/, '');
    return t || 'articolo';
  }

  /* 1. Pagina "Nuova discussione" */
  function agganciaForm() {
    var sez = classeNum('f') || paramUrl('f');
    if (!TESTATE[sez]) return;
    var form = document.forms.REPLIER;
    if (!form || !form.TopicTitle || !form.Post) return;
    form.addEventListener('submit', function() {
      var titolo = String(form.TopicTitle.value || '').trim();
      if (!titolo) return;
      salvaPending({
        sez: sez,
        titolo: titolo,
        firma: estraiFirma(form.Post.value),
        img: estraiImmagine(form.Post.value),
        ts: Date.now()
      });
    });
  }

  /* 2. Pagina dell'articolo appena creato */
  function titoloPagina() {
    var cand = document.querySelectorAll('h1, h2, .title, .topic-title, .article-title');
    var out = [document.title];
    for (var i = 0; i < cand.length; i++) out.push(cand[i].textContent);
    return norm(out.join(' | '));
  }
  function aspettaModulo(cb, tentativi) {
    if (typeof window.HunterNetAutoPost === 'function') { cb(); return; }
    if (tentativi <= 0) { console.warn('Redazioni AutoPost: HunterNetAutoPost non caricato'); return; }
    setTimeout(function() { aspettaModulo(cb, tentativi - 1); }, 250);
  }
  function controllaArticolo() {
    var p = leggiPending();
    if (!p) return;
    if (Date.now() - (p.ts || 0) > MAX_ETA) { cancellaPending(); return; }
    var topic = classeNum('t') || paramUrl('t');
    if (!topic) return;
    if (titoloPagina().indexOf(norm(p.titolo)) === -1) return;
    var testata = TESTATE[p.sez];
    if (!testata) { cancellaPending(); return; }

    cancellaPending();
    var titolo = p.titolo.length > 120 ? p.titolo.slice(0, 119) + '…' : p.titolo;
    var lista = TESTI[testata.profilo];
    var testo = lista[parseInt(topic, 10) % lista.length]
      .replace('{t}', titolo)
      .replace('{f}', p.firma ? ', di ' + p.firma : '');
    var link = location.protocol + '//' + location.host + '/?t=' + topic;

    aspettaModulo(function() {
      window.HunterNetAutoPost(testata.profilo, {
        text: testo,
        linkUrl: link,
        linkTitle: testata.nome + ' - ' + p.titolo,
        linkImage: p.img,
        linkDisplay: testata.dominio + '/#' + slug(p.titolo),
        key: 'art_' + topic
      }).catch(function(e) { console.warn('Redazioni AutoPost:', e && e.message); });
    }, 40);
  }

  function avvio() {
    if (/\bnew-topic\b/.test(document.body.className) || /act=Post/i.test(location.search)) agganciaForm();
    else controllaArticolo();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvio);
  else avvio();
})();
