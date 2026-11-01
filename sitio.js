/* Claudina Pastelera: arma la página pública a partir de datos.js.
   El panel admin (/admin) usa este mismo archivo para la vista previa. */
(function(){
  var TINTS = [['#3A1E19','#F2C9D2'],['#E8D3B9','#6B4423'],['#F6E7A8','#5E4F10'],['#F2C9D2','#7A0F39'],['#E7B7C6','#6E1232'],['#D9E8DC','#2F5A3B']];

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function waDigits(s){var d=String(s||'').replace(/\D/g,'');if(!d)return '';if(d.indexOf('54')!==0)d='549'+d.replace(/^0/,'').replace(/^(\d{2,4})15/,'$1');return d;}
  /* Una foto es una foto recién subida (data:) o un archivo de la carpeta fotos/ */
  function imgSrc(s){
    if(typeof s!=='string') return '';
    if(/^data:image\/(webp|jpeg|png);base64,/.test(s)) return s;
    if(/^fotos\/[A-Za-z0-9_-]+\.(webp|jpe?g|png)$/.test(s)) return (window.SITIO_BASE||'')+s;
    return '';
  }
  function pic(src,label,cls,tint){
    tint = tint || ['#F2C9D2','#7A0F39'];
    var u = imgSrc(src);
    if(u) return '<div class="pic has '+cls+'"><img src="'+u+'" alt="'+esc(label)+'" loading="lazy"></div>';
    return '<div class="pic '+cls+'" style="background:'+tint[0]+';color:'+tint[1]+'">Foto: '+esc(label)+'</div>';
  }
  function out(href){return href.charAt(0)==='#'?'':' target="_blank" rel="noopener"';}

  function render(s){
    var wa=waDigits(s.contacto.whatsapp), waHref = wa ? 'https://wa.me/'+wa : '#contacto', t=out(waHref);
    var ig = String(s.contacto.instagram||'').replace(/^@/,'');
    var h = '';
    h += '<header class="nav"><div class="wrap"><a class="logo" href="#inicio">'+esc(s.marca)+'</a>'
      + '<nav class="links" aria-label="Secciones"><a href="#tortas">Tortas</a><a href="#como-pedir">Cómo pedir</a><a href="#eventos">Eventos</a><a href="#contacto">Contacto</a></nav>'
      + '<a class="btn btn-main btn-sm" href="'+waHref+'"'+t+'>Hacé tu pedido</a></div></header>';
    h += '<section id="inicio"><div class="wrap hero"><div class="hero-txt"><p class="eyebrow">'+esc(s.eyebrow)+'</p>'
      + '<h1 class="disp">'+esc(s.hero.titulo)+'</h1><p class="lead">'+esc(s.hero.texto)+'</p>'
      + '<div class="row"><a class="btn btn-main" href="'+waHref+'"'+t+'>Pedí por WhatsApp</a><a class="btn btn-line" href="#tortas">Ver tortas</a></div></div>'
      + '<div class="hero-pics">'+pic(s.hero.foto,'torta principal','big')+pic(s.hero.foto2,'detalle de relleno','sq',['#E8D3B9','#6B4423'])+pic(s.hero.foto3,'Claudina en la cocina','sq',['#3A1E19','#F2C9D2'])+'</div></div></section>';
    h += '<section id="tortas" class="band band-white"><div class="wrap"><div class="sec-head"><div><h2 class="disp">'+esc(s.tortasIntro.titulo)+'</h2><p class="muted">'+esc(s.tortasIntro.texto)+'</p></div>'
      + '<a class="btn btn-line" href="'+waHref+'"'+t+'>Consultar otro tamaño</a></div><div class="grid-cakes">';
    s.tortas.forEach(function(x,i){
      h += '<article class="cake">'+pic(x.foto,x.nombre,'',TINTS[i%TINTS.length])
        + '<div class="cake-top"><h3>'+esc(x.nombre)+'</h3>'+(x.precio?'<span class="price">$ '+esc(String(x.precio).replace(/^\$\s*/,''))+'</span>':'')+'</div>'
        + '<p>'+esc(x.desc)+'</p></article>';
    });
    h += '</div></div></section>';
    h += '<section id="como-pedir" class="band"><div class="wrap"><div class="sec-head"><div><h2 class="disp">'+esc(s.pasosTitulo)+'</h2></div></div><div class="cards3">';
    s.pasos.forEach(function(p,i){h+='<div class="card"><span class="step-n">'+(i+1)+'</span><h3>'+esc(p.titulo)+'</h3><p>'+esc(p.texto)+'</p></div>';});
    h += '</div></div></section>';
    h += '<section id="eventos" class="band band-dark"><div class="wrap ev">'+pic(s.eventos.foto,'mesa dulce de evento','',['#5C3B34','#F2C9D2'])
      + '<div class="ev-txt"><h2 class="disp">'+esc(s.eventos.titulo)+'</h2><p>'+esc(s.eventos.texto)+'</p><div><a class="btn btn-soft" href="'+waHref+'"'+t+'>Contanos tu idea</a></div></div></div></section>';
    h += '<section id="contacto" class="band"><div class="wrap"><div class="sec-head"><div><h2 class="disp">'+esc(s.contacto.titulo)+'</h2></div></div><div class="cards3">'
      + '<div class="card"><span class="c-label">WhatsApp</span><span class="c-val">'+esc(s.contacto.whatsapp)+'</span>'+(wa?'<a href="'+waHref+'"'+t+'>Abrir chat</a>':'')+'</div>'
      + '<div class="card"><span class="c-label">Instagram</span>'+(ig?'<a class="c-val" style="text-decoration:none" href="https://www.instagram.com/'+encodeURIComponent(ig)+'/" target="_blank" rel="noopener">@'+esc(ig)+'</a>':'<span class="c-val">—</span>')+'</div>'
      + '<div class="card"><span class="c-label">Retiro y horarios</span><span class="c-val" style="font-size:18px;font-weight:600">'+esc(s.contacto.horarios)+'</span></div></div></div></section>';
    h += '<footer><div class="wrap"><span class="logo" style="font-size:20px">'+esc(s.marca)+'</span><span>'+esc(s.pie)+'</span></div></footer>';
    return h;
  }

  window.Sitio = {render:render, esc:esc, imgSrc:imgSrc};

  var root = document.getElementById('root');
  if(root && root.hasAttribute('data-sitio') && window.DATOS){
    document.title = window.DATOS.nombre || 'Claudina Pastelera';
    root.innerHTML = render(window.DATOS);
    if(location.hash){var el=document.getElementById(location.hash.slice(1));if(el)el.scrollIntoView();}
  }
})();
