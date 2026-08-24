
document.addEventListener('click', function(e){
  var p = e.target.closest('.pearl button');
  if(p){ p.closest('.pearl').classList.toggle('open');
         p.textContent = p.closest('.pearl').classList.contains('open') ? 'Nascondi' : '🇬🇧 English'; return; }
  var c = e.target.closest('.cloze button');
  if(c){ c.closest('.row').classList.toggle('open'); }
});

(function(){
  var wrap=document.getElementById('indice'); if(!wrap) return;
  var b=wrap.querySelector('[data-toggle-en]'); if(!b) return;
  b.addEventListener('click',function(){
    var on=wrap.classList.toggle('hide-en');
    b.setAttribute('aria-pressed', on?'true':'false');
    b.textContent = on ? 'Mostra inglese' : 'Nascondi inglese';
  });
})();

/* ── Registrazione: click a turn to seek; the playing turn highlights and stays in view ── */
(function(){
  var a=document.getElementById('reg-audio'), box=document.getElementById('reg-turns');
  if(!a||!box) return;
  var turns=[].slice.call(box.querySelectorAll('.turn'));
  var times=turns.map(function(t){return parseFloat(t.dataset.t)||0;});
  box.addEventListener('click',function(e){
    var t=e.target.closest('.turn'); if(!t) return;
    a.currentTime=parseFloat(t.dataset.t)||0; a.play();
  });
  var cur=-1;
  a.addEventListener('timeupdate',function(){
    var i=times.length-1;
    while(i>0 && times[i]>a.currentTime) i--;
    if(i===cur) return;
    if(turns[cur]) turns[cur].classList.remove('playing');
    cur=i;
    if(turns[cur]){
      turns[cur].classList.add('playing');
      var r=turns[cur].getBoundingClientRect(), b=box.getBoundingClientRect();
      if(r.top<b.top||r.bottom>b.bottom) turns[cur].scrollIntoView({block:'center'});
    }
  });
})();
