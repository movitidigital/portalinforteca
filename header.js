/* ==========================================================
   HEADER.JS — Header unificado (Inforteca)
   ========================================================== */

(function () {
  'use strict';

  const SUPABASE_URL = 'https://zldugoqlcrzarpqvtaoh.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsZHVnb3FsY3J6YXJwcXZ0YW9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0NTU5NzUsImV4cCI6MjEwNjAzMTk3NX0.wUzL7ZmMdoksTVC_PlIiT1nDkhJnf7l0UYMcY-NShWA';

  const sb = window.supabaseClient
    || (window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null);

  const $ = (id) => document.getElementById(id);
  const escapeHTML = (s) => String(s || '').replace(/[&<>"']/g,
    m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  let _avatarUrlAtual = null;
  let _avatarArquivo = null;
  let _perfilHeader = null;
  let _userHeader = null;

  /* ==========================================================
     RENDER DO HEADER
     ========================================================== */
  function renderHeader(opts) {
    const header = $('appHeader');
    if (!header) return;

    const titulo      = opts.titulo      || 'Portal';
    const mostraBusca = opts.mostraBusca === true;
    const mostraNotif = opts.mostraNotif === true;

    header.className = 'h-16 md:h-20 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 z-10 shrink-0';

    header.innerHTML = `
      <div class="flex items-center gap-3">
        <button onclick="if(window.toggleSidebar) toggleSidebar();" class="md:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg">
          <i data-lucide="menu" class="w-6 h-6"></i>
        </button>
        <h2 id="headerTitle" class="text-lg font-bold text-[#000033]">${escapeHTML(titulo)}</h2>
      </div>

      <div class="flex items-center gap-4 ml-auto">

        ${mostraBusca ? `
          <button onclick="if(window.abrirBuscaGlobal) abrirBuscaGlobal();"
            class="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors">
            <i data-lucide="search" class="w-4 h-4"></i>
            <span class="text-xs font-bold">Buscar</span>
            <kbd class="px-1.5 py-0.5 bg-white border border-slate-300 rounded text-[10px] font-mono text-slate-500">Ctrl K</kbd>
          </button>
        ` : ''}

        ${mostraNotif ? `
          <button class="relative p-2 text-slate-400 hover:text-[#0e8890] transition-colors rounded-full hover:bg-slate-50">
            <i data-lucide="bell" class="w-5 h-5"></i>
          </button>
        ` : ''}

        <div class="h-8 w-px bg-slate-200"></div>

        <div class="flex items-center gap-3">
          <div class="text-right hidden sm:block">
            <p id="userName" class="text-sm font-semibold text-slate-700 leading-none">Carregando...</p>
            <p id="userPerm" class="text-xs text-slate-500 mt-1">...</p>
          </div>

          <button onclick="abrirModalAvatar()" id="btnAbrirAvatar"
            class="relative w-10 h-10 rounded-full bg-[#0e8890]/10 border-2 border-[#0e8890]/20 hover:border-[#0e8890] flex items-center justify-center text-[#0e8890] font-bold overflow-hidden transition-all hover:scale-105 hover:shadow-lg group"
            title="Alterar foto de perfil">
            <i data-lucide="user" id="headerAvatarIcone" class="w-5 h-5"></i>
            <img id="headerAvatarImg" src="" alt="Foto de perfil" class="hidden absolute inset-0 w-full h-full object-cover">
            <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <i data-lucide="camera" class="w-4 h-4 text-white"></i>
            </div>
          </button>
        </div>
      </div>
    `;

    if (!$('modalAvatar')) {
      document.body.insertAdjacentHTML('beforeend', MODAL_AVATAR_HTML);
    }

    if (window.lucide) window.lucide.createIcons();
  }

  /* ==========================================================
     MODAL DE AVATAR
     ========================================================== */
  const MODAL_AVATAR_HTML = `
    <div id="modalAvatar" class="fixed inset-0 z-[70] hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div class="bg-gradient-to-r from-[#000033] to-[#0e8890] px-6 py-5 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
              <i data-lucide="camera" class="w-5 h-5 text-white"></i>
            </div>
            <div>
              <h3 class="text-white font-black text-sm uppercase tracking-wide">Foto de Perfil</h3>
              <p class="text-[10px] text-white/70 font-bold">JPG, PNG ou WebP · até 2 MB</p>
            </div>
          </div>
          <button onclick="fecharModalAvatar()" class="text-white/70 hover:text-white transition-colors">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>

        <div class="p-6">
          <div class="flex flex-col items-center mb-5">
            <div class="relative group">
              <div id="avatarPreview" class="w-32 h-32 rounded-full bg-[#0e8890]/10 border-4 border-white shadow-xl flex items-center justify-center overflow-hidden">
                <i data-lucide="user" class="w-14 h-14 text-[#0e8890]"></i>
              </div>
              <button id="avatarBtnRemover" onclick="removerFotoPerfil()"
                class="hidden absolute -top-1 -right-1 w-8 h-8 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg flex items-center justify-center transition-transform hover:scale-110">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
            <p id="avatarNomeUser" class="mt-3 text-sm font-black text-slate-800">—</p>
            <p id="avatarPermUser" class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">—</p>
          </div>

          <input type="file" id="avatarInput" accept="image/*" class="hidden" onchange="onFotoSelecionada(this)">

          <div class="space-y-2">
            <button onclick="document.getElementById('avatarInput').click()"
              class="w-full flex items-center justify-center gap-2 bg-[#0e8890] hover:bg-[#0b6c72] text-white py-3 rounded-xl text-sm font-black uppercase tracking-wide shadow-sm transition-colors">
              <i data-lucide="upload" class="w-4 h-4"></i>
              <span id="avatarBtnTexto">Escolher Foto</span>
            </button>

            <button id="avatarBtnSalvar" onclick="salvarFotoPerfil()"
              class="hidden w-full items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl text-sm font-black uppercase tracking-wide shadow-sm transition-colors">
              <i data-lucide="check" class="w-4 h-4"></i>
              Salvar Foto
            </button>
          </div>

          <div id="avatarAlert" class="hidden text-xs p-3 rounded-xl border font-medium mt-4"></div>

          <p class="text-[10px] text-slate-400 text-center mt-4 leading-relaxed">
            💡 Dica: use uma foto quadrada e bem iluminada.
          </p>
        </div>
      </div>
    </div>
  `;

  /* ==========================================================
     CARREGA PERFIL + AVATAR (com retry inteligente)
     ========================================================== */
  async function carregarPerfilHeader() {
    if (!sb) return;

    try {
      // 1) Tenta pegar do state da página (o dashboard popula primeiro)
      let perfil = window.state?.perfil;
      let user = window.state?.user;

      // 2) Se a página ainda não populou, espera a sessão
      if (!user) {
        let session = null;
        for (let i = 0; i < 30; i++) {
          const { data } = await sb.auth.getSession();
          if (data?.session) { session = data.session; break; }
          await new Promise(r => setTimeout(r, 100));
        }
        if (!session) return;
        user = session.user;
      }

      // 3) Se ainda não tem perfil, busca direto do Supabase
      if (!perfil && user) {
        const { data, error } = await sb
          .from('perfis')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        if (error) console.warn('[Header] Erro ao buscar perfil:', error);
        perfil = data;
      }

      // 4) Se ainda nada, aborta silenciosamente
      if (!perfil || !user) {
        console.warn('[Header] Perfil não encontrado — usando fallback');
        return;
      }

      _userHeader = user;
      _perfilHeader = perfil;

      const nome = perfil?.nome_completo || user?.email || 'Usuário';
      const perm = perfil?.permissao || 'Operador';

      if ($('userName')) $('userName').textContent = nome;
      if ($('userPerm')) $('userPerm').textContent = perm;

      atualizarAvatarUI(perfil?.avatar_url || null);
    } catch (e) {
      console.warn('[Header] Falha ao carregar perfil:', e);
    }
  }

  /* ==========================================================
     AVATAR — UI
     ========================================================== */
  function atualizarAvatarUI(url) {
    _avatarUrlAtual = url || null;
    const img = $('headerAvatarImg');
    const icone = $('headerAvatarIcone');
    if (!img || !icone) return;

    if (url) {
      img.src = url;
      img.classList.remove('hidden');
      icone.classList.add('hidden');
    } else {
      img.src = '';
      img.classList.add('hidden');
      icone.classList.remove('hidden');
    }
  }

  function renderPreviewAvatar(url) {
    const box = $('avatarPreview');
    if (!box) return;
    if (url) {
      box.innerHTML = `<img src="${escapeHTML(url)}" alt="Avatar" class="w-full h-full object-cover">`;
      $('avatarBtnRemover')?.classList.remove('hidden');
    } else {
      box.innerHTML = `<i data-lucide="user" class="w-14 h-14 text-[#0e8890]"></i>`;
      $('avatarBtnRemover')?.classList.add('hidden');
    }
    if (window.lucide) window.lucide.createIcons();
  }

  /* ==========================================================
     AVATAR — FUNÇÕES PÚBLICAS
     ========================================================== */
  window.abrirModalAvatar = function () {
    const m = $('modalAvatar');
    if (!m) return;

    _avatarArquivo = null;
    $('avatarInput').value = '';
    $('avatarAlert').classList.add('hidden');
    $('avatarBtnSalvar').classList.add('hidden');
    $('avatarBtnSalvar').classList.remove('flex');
    $('avatarBtnTexto').textContent = 'Escolher Foto';

    $('avatarNomeUser').textContent = _perfilHeader?.nome_completo || 'Usuário';
    $('avatarPermUser').textContent = _perfilHeader?.permissao || 'Operador';

    renderPreviewAvatar(_avatarUrlAtual);
    m.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  };

  window.fecharModalAvatar = function () {
    $('modalAvatar')?.classList.add('hidden');
    _avatarArquivo = null;
  };

  window.onFotoSelecionada = function (input) {
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      mostrarAlertaAvatar('❌ O arquivo precisa ser uma imagem (JPG, PNG ou WebP).', 'red');
      input.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      mostrarAlertaAvatar('❌ Imagem muito grande. Máximo 2 MB.', 'red');
      input.value = '';
      return;
    }

    _avatarArquivo = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      const box = $('avatarPreview');
      if (box) box.innerHTML = `<img src="${e.target.result}" alt="Preview" class="w-full h-full object-cover">`;
      $('avatarBtnRemover')?.classList.remove('hidden');
      $('avatarBtnTexto').textContent = 'Escolher outra foto';
      $('avatarBtnSalvar').classList.remove('hidden');
      $('avatarBtnSalvar').classList.add('flex');
      $('avatarAlert').classList.add('hidden');
      if (window.lucide) window.lucide.createIcons();
    };
    reader.readAsDataURL(file);
  };

  window.salvarFotoPerfil = async function () {
    if (!_avatarArquivo || !sb || !_userHeader) return;

    const btn = $('avatarBtnSalvar');
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Enviando…`;
    if (window.lucide) window.lucide.createIcons();

    try {
      const userId = _userHeader.id;
      const ext = (_avatarArquivo.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${userId}/${Date.now()}.${ext}`;

      const { error: errUpload } = await sb.storage
        .from('avatars')
        .upload(path, _avatarArquivo, {
          cacheControl: '3600',
          upsert: false,
          contentType: _avatarArquivo.type,
        });
      if (errUpload) throw new Error('Erro no upload: ' + errUpload.message);

      const { data: { publicUrl } } = sb.storage.from('avatars').getPublicUrl(path);

      const { data: rpcData, error: errRpc } = await sb.rpc('atualizar_avatar', { p_url: publicUrl });
      if (errRpc) throw errRpc;
      if (!rpcData?.success) throw new Error(rpcData?.erro || 'Erro ao salvar no perfil');

      if (_perfilHeader) _perfilHeader.avatar_url = publicUrl;
      if (window.state?.perfil) window.state.perfil.avatar_url = publicUrl;

      atualizarAvatarUI(publicUrl);
      renderPreviewAvatar(publicUrl);

      mostrarAlertaAvatar('✅ Foto atualizada com sucesso!', 'emerald');

      setTimeout(() => window.fecharModalAvatar(), 1500);
    } catch (err) {
      console.error('[Avatar]', err);
      mostrarAlertaAvatar('❌ ' + err.message, 'red');
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i> Salvar Foto`;
      if (window.lucide) window.lucide.createIcons();
    }
  };

  window.removerFotoPerfil = async function () {
    if (!_avatarUrlAtual || !sb) return;
    if (!confirm('Remover sua foto de perfil?\n\nVocê voltará a usar o ícone genérico.')) return;

    const btn = $('avatarBtnRemover');
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>`;
    if (window.lucide) window.lucide.createIcons();

    try {
      const { data: rpcData, error: errRpc } = await sb.rpc('remover_avatar');
      if (errRpc) throw errRpc;
      if (!rpcData?.success) throw new Error(rpcData?.erro || 'Erro ao remover');

      try {
        const path = _avatarUrlAtual.split('/avatars/')[1]?.split('?')[0];
        if (path) await sb.storage.from('avatars').remove([path]);
      } catch (e) { console.warn('[Avatar] Não apagou arquivo:', e); }

      if (_perfilHeader) _perfilHeader.avatar_url = null;
      if (window.state?.perfil) window.state.perfil.avatar_url = null;

      atualizarAvatarUI(null);
      renderPreviewAvatar(null);

      mostrarAlertaAvatar('✅ Foto removida.', 'emerald');
      setTimeout(() => window.fecharModalAvatar(), 1200);
    } catch (err) {
      console.error('[Avatar]', err);
      mostrarAlertaAvatar('❌ ' + err.message, 'red');
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="trash-2" class="w-4 h-4"></i>`;
      if (window.lucide) window.lucide.createIcons();
    }
  };

  function mostrarAlertaAvatar(msg, cor) {
    const box = $('avatarAlert');
    if (!box) return;
    const cores = {
      red:     'bg-red-50 border-red-200 text-red-600',
      emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
      amber:   'bg-amber-50 border-amber-200 text-amber-700',
    };
    box.textContent = msg;
    box.className = `text-xs p-3 rounded-xl border font-medium mt-4 ${cores[cor] || cores.red}`;
    box.classList.remove('hidden');
  }

  /* Fechar modal */
  document.addEventListener('click', (e) => {
    const modal = $('modalAvatar');
    if (!modal || modal.classList.contains('hidden')) return;
    if (e.target === modal) window.fecharModalAvatar();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('modalAvatar')?.classList.contains('hidden')) {
      window.fecharModalAvatar();
    }
  });

  /* ==========================================================
     BOOT
     ========================================================== */
  function boot() {
    const header = $('appHeader');
    if (!header) return;

    renderHeader({
      titulo:      header.dataset.title || 'Portal',
      mostraBusca: header.dataset.search === 'true',
      mostraNotif: header.dataset.notif === 'true',
    });

    // 🔁 Tenta carregar o perfil várias vezes (até o dashboard popular)
    [200, 600, 1200, 2500].forEach((delay) => {
      setTimeout(carregarPerfilHeader, delay);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  setTimeout(boot, 200);
})();
