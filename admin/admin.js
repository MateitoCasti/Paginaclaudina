/* Panel admin de Claudina Pastelera (/admin).
   Pide la contraseña, deja editar todo y al tocar "Guardar y publicar"
   manda los cambios a /api/guardar, que los sube a GitHub. Cloudflare
   actualiza la página sola en 1 o 2 minutos. */
(function(){
  var S = window.Sitio, esc = S.esc, imgSrc = S.imgSrc;
  var root = document.getElementById('root');
  var KEY = 'Merlina1406.', DRAFT = 'claudina-borrador';
  var saved = JSON.stringify(window.DATOS || {});
  var state = JSON.parse(saved);
  var local = {};
  var clave = '', logged = false, dirty = false, saving = false, preview = false, confirmDel = null, msg = '', okMsg = '';

  function getPath(o,p){return p.split('.').reduce(function(a,k){return a==null?a:a[k];},o);}
  function setPath(o,p,v){var ks=p.split('.'),last=ks.pop();var t=ks.reduce(function(a,k){return a[k];},o);t[last]=v;}

  /* ---------- Login ---------- */
  function renderLogin(){
    return '<div class="wrap login"><form class="panel login-card" id="login">'
      + '<h1 class="disp" style="font-size:34px;color:var(--accent)">'+esc(state.marca||'Claudina')+'</h1>'
      + '<p class="hint">Panel admin. Ingresá la contraseña para editar la página.</p>'
      + (msg?'<p class="note">'+esc(msg)+'</p>':'')
      + '<label class="f"><span>Contraseña</span><input id="clave" type="password" autocomplete="current-password" required></label>'
      + '<button class="btn btn-main" type="submit"'+(saving?' disabled':'')+'>'+(saving?'Entrando…':'Entrar')+'</button>'
      + '<a href="../" class="hint">Volver a la página</a></form></div>';
  }

  function api(body){
    return fetch('../api/guardar',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Clave':clave},body:JSON.stringify(body)})
      .then(function(r){return r.json().catch(function(){return {};}).then(function(j){j._status=r.status;return j;});});
  }

  function login(c){
    clave=c; saving=true; msg=''; render();
    api({verificar:true}).then(function(j){
      saving=false;
      if(j._status===200&&j.ok){logged=true;try{sessionStorage.setItem(KEY,clave);}catch(e){}loadDraft();}
      else if(j._status===401){msg='Contraseña incorrecta.';clave='';}
      else if(j._status===404){msg='Falta configurar el guardado en Cloudflare (no se encontró /api/guardar).';clave='';}
      else if(j.error==='config'){msg='Falta configurar la contraseña en Cloudflare (variable ADMIN_CLAVE).';clave='';}
      else{msg='No se pudo conectar. Probá de nuevo.';clave='';}
      render();
    }).catch(function(){saving=false;msg='No se pudo conectar. Revisá tu internet.';render();});
  }

  /* ---------- Panel ---------- */
  function field(label,path,multi){
    var v = getPath(state,path);
    return '<label class="f"><span>'+esc(label)+'</span>'+(multi?'<textarea data-path="'+path+'">'+esc(v)+'</textarea>':'<input type="text" data-path="'+path+'" value="'+esc(v)+'">')+'</label>';
  }
  function photo(label,path){
    var v = getPath(state,path), u = local[v] || imgSrc(v), has=!!u;
    return '<div class="photo"><div class="thumb'+(has?' has':'')+'">'+(has?'<img src="'+u+'" alt="">':'Sin foto')+'</div>'
      + '<div class="photo-ctrl"><span class="lbl">'+esc(label)+'</span><div class="row">'
      + '<span class="btn btn-soft btn-sm file-btn">'+(has?'Cambiar foto':'Subir foto')+'<input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" data-photo="'+path+'" aria-label="'+esc(label)+'"></span>'
      + (has?'<button type="button" class="btn btn-line btn-sm" data-act="clear" data-path="'+path+'">Quitar</button>':'')+'</div></div></div>';
  }
  function statusText(){return saving?'Publicando…':dirty?'Cambios sin publicar':'Todo publicado';}
  function bar(){
    return '<div class="abar"><div class="wrap"><div class="abar-title"><b>Panel admin</b>'
      + '<span class="status '+(dirty?'dirty':'saved')+'" role="status">'+statusText()+'</span></div>'
      + '<div class="row"><button type="button" class="btn btn-line btn-sm" data-act="preview">'+(preview?'Volver a editar':'Vista previa')+'</button>'
      + '<button type="button" class="btn btn-main btn-sm" data-act="save"'+((!dirty||saving)?' disabled':'')+'>Guardar y publicar</button>'
      + '<button type="button" class="btn btn-line btn-sm" data-act="logout">Salir</button></div></div></div>';
  }
  function renderPanel(){
    var s=state, h=bar();
    if(preview) return h + S.render(s);
    h += '<div class="wrap admin">';
    if(okMsg) h += '<p class="note ok">'+esc(okMsg)+'</p>';
    if(msg) h += '<p class="note">'+esc(msg)+'</p>';

    h += '<div class="panel"><h2>General</h2><div class="fgrid">'+field('Nombre del sitio (pestaña del navegador)','nombre')+field('Logo (texto)','marca')+'</div>'
      + field('Frase chica arriba del título','eyebrow')+field('Texto del pie de página','pie')+'</div>';
    h += '<div class="panel"><h2>Inicio</h2>'+field('Título principal','hero.titulo')+field('Texto','hero.texto',true)
      + '<div class="fgrid">'+photo('Foto principal (grande)','hero.foto')+photo('Foto chica 1','hero.foto2')+photo('Foto chica 2','hero.foto3')+'</div></div>';

    h += '<div class="panel"><h2>Tortas <button type="button" class="btn btn-main btn-sm" data-act="add">Agregar torta</button></h2>'
      + '<div class="fgrid">'+field('Título de la sección','tortasIntro.titulo')+'</div>'+field('Texto de la sección','tortasIntro.texto',true);
    if(!s.tortas.length) h += '<p class="empty">Todavía no hay tortas. Tocá "Agregar torta" para cargar la primera.</p>';
    s.tortas.forEach(function(t,i){
      var p='tortas.'+i;
      h += '<div class="cake-ed"><div class="cake-ed-top"><strong>'+esc(t.nombre||'Torta sin nombre')+'</strong><div class="row">'
        + '<button type="button" class="btn btn-line btn-sm" data-act="up" data-i="'+i+'"'+(i===0?' disabled':'')+'>Subir</button>'
        + '<button type="button" class="btn btn-line btn-sm" data-act="down" data-i="'+i+'"'+(i===s.tortas.length-1?' disabled':'')+'>Bajar</button>'
        + (confirmDel===t.id
            ? '<button type="button" class="btn btn-danger btn-sm" data-act="del" data-i="'+i+'">Sí, eliminar</button><button type="button" class="btn btn-line btn-sm" data-act="nodel">Cancelar</button>'
            : '<button type="button" class="btn btn-danger btn-sm" data-act="askdel" data-i="'+i+'">Eliminar</button>')
        + '</div></div><div class="fgrid">'+field('Nombre',p+'.nombre')+field('Precio',p+'.precio')+'</div>'+field('Descripción',p+'.desc',true)+photo('Foto de la torta',p+'.foto')+'</div>';
    });
    h += '</div>';

    h += '<div class="panel"><h2>Cómo pedir</h2>'+field('Título de la sección','pasosTitulo');
    s.pasos.forEach(function(x,i){h+='<div class="fgrid">'+field('Paso '+(i+1)+': título','pasos.'+i+'.titulo')+field('Paso '+(i+1)+': texto','pasos.'+i+'.texto',true)+'</div>';});
    h += '</div>';
    h += '<div class="panel"><h2>Eventos</h2>'+field('Título','eventos.titulo')+field('Texto','eventos.texto',true)+photo('Foto de eventos','eventos.foto')+'</div>';
    h += '<div class="panel"><h2>Contacto</h2><div class="fgrid">'+field('Título de la sección','contacto.titulo')+field('WhatsApp (ej: 11 2345-6789)','contacto.whatsapp')+field('Usuario de Instagram (sin @)','contacto.instagram')+'</div>'
      + field('Retiro y horarios','contacto.horarios')+'</div>';
    h += '</div>';
    return h;
  }

  function render(){
    var y=window.scrollY;
    root.innerHTML = logged ? renderPanel() : renderLogin();
    if(logged) window.scrollTo(0,y);
    else { var c=document.getElementById('clave'); if(c&&!saving) c.focus(); }
  }
  function refreshBar(){
    var st=root.querySelector('.status'), sv=root.querySelector('[data-act="save"]');
    if(st){st.className='status '+(dirty?'dirty':'saved');st.textContent=statusText();}
    if(sv) sv.disabled=!dirty||saving;
  }
  function stash(){try{localStorage.setItem(DRAFT,JSON.stringify(state));}catch(e){}}
  function changed(full){dirty=true;msg='';okMsg='';stash();if(full)render();else refreshBar();}
  function loadDraft(){
    try{var d=localStorage.getItem(DRAFT);
      if(d&&d!==saved){state=JSON.parse(d);dirty=true;okMsg='';msg='Recuperamos cambios que todavía no publicaste.';}
      else localStorage.removeItem(DRAFT);
    }catch(e){}
  }

  /* Achica la foto a 1400 px y la pasa a WEBP (o JPG si el navegador no puede) */
  function shrink(file){
    return new Promise(function(res,rej){
      var r=new FileReader();
      r.onerror=function(){rej();};
      r.onload=function(){
        var img=new Image();
        img.onerror=function(){rej();};
        img.onload=function(){
          var max=1400,w=img.naturalWidth,h=img.naturalHeight,k=Math.min(1,max/Math.max(w,h));
          var c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);
          c.getContext('2d').drawImage(img,0,0,c.width,c.height);
          var out=c.toDataURL('image/webp',0.8);
          if(out.indexOf('data:image/webp')!==0) out=c.toDataURL('image/jpeg',0.82);
          res(out);
        };
        img.src=r.result;
      };
      r.readAsDataURL(file);
    });
  }

  /* ---------- Guardar ---------- */
  function photoPaths(){
    var ps=['hero.foto','hero.foto2','hero.foto3','eventos.foto'];
    state.tortas.forEach(function(t,i){ps.push('tortas.'+i+'.foto');});
    return ps;
  }
  function save(){
    if(saving||!dirty) return;
    var copy=JSON.parse(JSON.stringify(state)), fotos=[], assigned=[];
    photoPaths().forEach(function(p){
      var v=getPath(copy,p), m=typeof v==='string'&&v.match(/^data:image\/(webp|jpeg|png);base64,(.*)$/);
      if(m){
        var ext=m[1]==='jpeg'?'jpg':m[1];
        var path='fotos/'+Date.now().toString(36)+Math.random().toString(36).slice(2,8)+'.'+ext;
        fotos.push({path:path,base64:m[2]}); setPath(copy,p,path); assigned.push([p,path]);
      }
    });
    var datos='window.DATOS = '+JSON.stringify(copy,null,2)+';\n';
    saving=true;msg='';okMsg='';refreshBar();
    api({datos:datos,fotos:fotos}).then(function(j){
      saving=false;
      if(j._status===200&&j.ok){
        /* las fotos nuevas tardan 1-2 minutos en estar online: mientras, se muestran desde la compu */
        assigned.forEach(function(a){local[a[1]]=getPath(state,a[0]);setPath(state,a[0],a[1]);});
        saved=JSON.stringify(state);dirty=false;
        try{localStorage.removeItem(DRAFT);}catch(e){}
        okMsg='Publicado. En 1 o 2 minutos se ve en la página.';
      } else if(j._status===401){
        logged=false;clave='';try{sessionStorage.removeItem(KEY);}catch(e){}msg='La sesión venció. Ingresá la contraseña de nuevo; tus cambios siguen guardados.';
      } else if(j.error==='github'){
        msg='GitHub no aceptó los cambios. Revisá el token en Cloudflare. Detalle: '+(j.detalle||'');
      } else if(j._status===413||j.error==='grande'){
        msg='Son demasiadas fotos juntas. Publicá de a menos fotos por vez.';
      } else {
        msg='No se pudo publicar. Probá de nuevo en un rato.';
      }
      render();
    }).catch(function(){saving=false;msg='No se pudo conectar. Revisá tu internet y probá de nuevo.';render();});
  }

  /* ---------- Eventos ---------- */
  root.addEventListener('submit',function(e){
    if(e.target.id!=='login') return;
    e.preventDefault(); var c=document.getElementById('clave').value; if(c) login(c);
  });
  root.addEventListener('input',function(e){
    var p=e.target.getAttribute('data-path'); if(!p) return;
    setPath(state,p,e.target.value);
    if(/^tortas\.\d+\.nombre$/.test(p)){var card=e.target.closest('.cake-ed');var st=card&&card.querySelector('.cake-ed-top strong');if(st)st.textContent=e.target.value||'Torta sin nombre';}
    changed(false);
  });
  root.addEventListener('change',function(e){
    var p=e.target.getAttribute('data-photo'); if(!p||!e.target.files||!e.target.files[0]) return;
    var f=e.target.files[0];
    if(!/^image\/(jpeg|png|webp)$/.test(f.type)&&!/\.(jpe?g|png|webp)$/i.test(f.name)){msg='Ese archivo no es una foto JPG, PNG o WEBP.';render();return;}
    shrink(f).then(function(d){setPath(state,p,d);changed(true);}).catch(function(){msg='No se pudo leer esa foto. Probá con otra.';render();});
  });
  root.addEventListener('click',function(e){
    var b=e.target.closest('[data-act]'); if(!b) return;
    var a=b.getAttribute('data-act'), i=+b.getAttribute('data-i'), T=state.tortas;
    if(a==='save') return save();
    if(a==='preview'){preview=!preview;render();window.scrollTo(0,0);return;}
    if(a==='logout'){logged=false;clave='';msg='';try{sessionStorage.removeItem(KEY);}catch(x){}render();return;}
    if(a==='add'){T.push({id:'t'+Date.now().toString(36),nombre:'Nueva torta',desc:'',precio:'',foto:''});changed(true);
      var eds=root.querySelectorAll('.cake-ed');if(eds.length)eds[eds.length-1].scrollIntoView({block:'center'});return;}
    if(a==='up'&&i>0){T.splice(i-1,0,T.splice(i,1)[0]);return changed(true);}
    if(a==='down'&&i<T.length-1){T.splice(i+1,0,T.splice(i,1)[0]);return changed(true);}
    if(a==='askdel'){confirmDel=T[i].id;return render();}
    if(a==='nodel'){confirmDel=null;return render();}
    if(a==='del'){T.splice(i,1);confirmDel=null;return changed(true);}
    if(a==='clear'){setPath(state,b.getAttribute('data-path'),'');return changed(true);}
  });
  window.addEventListener('beforeunload',function(e){if(dirty&&logged){e.preventDefault();e.returnValue='';}});

  /* Si ya entró en esta pestaña, no vuelve a pedir la contraseña */
  try{var c=sessionStorage.getItem(KEY);if(c){login(c);}else render();}catch(e){render();}
})();
