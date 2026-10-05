/* ============================================================
   SIDEBAR COMPARTILHADA — PORTAL INFORTECA
   Fonte única do menu. Qualquer alteração aqui reflete em
   TODAS as páginas que incluírem <script src="sidebar.js"></script>
   ============================================================ */

(function () {
  'use strict';

  /* ============================================================
     CONFIGURAÇÃO DO MENU
     Para adicionar/remover módulos, edite APENAS este array.
     ============================================================ */
  const ITENS_MENU = [
    // Views internas do dashboard (abrem como aba dentro do dashboard.html)
    { key: 'dashboard',      tipo: 'view', viewId: 'dashboard',      icon: 'layout-dashboard', label: 'Dashboard' },
    { key: 'clientes',       tipo: 'view', viewId: 'clientes',       icon: 'search',           label: 'Clientes TIM' },
    { key: 'portabilidades', tipo: 'view', viewId: 'portabilidades', icon: 'arrow-left-right', label: 'Portabilidades' },
    { key: 'faturas',        tipo: 'view', viewId: 'faturas',        icon: 'file-text',        label: 'Faturas' },
    { key: 'suspensoes',     tipo: 'view', viewId: 'suspensoes',     icon: 'shield-alert',     label: 'Gestão de Acessos',    badge: 'badgeSuspensoes' },
    { key: 'gestao',         tipo: 'view', viewId: 'gestao',         icon: 'file-check-2',     label: 'Gestão de Clientes',   badge: 'badgeGestao' },
    { key: 'prospeccao',     tipo: 'view', viewId: 'prospeccao',     icon: 'users',            label: 'Prospecção' },

    // Páginas externas (HTML separado)
    { key: 'premiada',       tipo: 'page', url: 'premiada.html',     icon: 'trophy',           label: 'Inforteca Premiada' },
    { key: 'metas',          tipo: 'page', url: 'metas.html',        icon: 'target',           label: 'Acompanhamento de Metas' },
    { key: 'usuarios',       tipo: 'page', url: 'usuarios.html',     icon: 'user-cog',         label: 'Gestão de Usuários' },
  ];

  /* ============================================================
     CSS INJETADO (collapse + sidebar)
     ============================================================ */
  const CSS = `
    #sidebar { transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1); overflow-x: hidden; }
    #sidebar.collapsed { width: 72px !important; }
    #sidebar.collapsed .nav-label,
    #sidebar.collapsed #sidebarBrand > div > h1,
    #sidebar.collapsed #sidebarBrand > div > p,
    #sidebar.collapsed .menu-section-title { display: none; }
    #sidebar.collapsed .nav-item { justify-content: center; padding-left: 0; padding-right: 0; gap: 0; }
    #sidebar.collapsed p.px-3 { display: none; }
    #sidebar.collapsed #badgeSuspensoes,
    #sidebar.collapsed #badgeGestao {
      right: 4px; top: 2px; transform: scale(0.85);
    }
    #sidebar.collapsed .logout-label { display: none; }
    #sidebar.collapsed .logout-btn { justify-content: center; padding-left: 0; padding-right: 0; }
    #sidebar.collapsed #sidebarBrand { justify-content: center; }
    #sidebar.collapsed #sidebarBrand > div { display: none; }
    #sidebar.collapsed #sidebarBrand img { height: 36px; }
    #sidebar.collapsed #sidebarToggleIcon { transform: rotate(180deg); }
  `;

  /* ============================================================
     HELPERS
     ============================================================ */
  function injectCSS() {
    if (document.getElementById('_sidebarCSS')) return;
    const style = document.createElement('style');
    style.id = '_sidebarCSS';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function getCurrentPage() {
    const path = window.location.pathname.split('/').pop();
    return path || 'dashboard.html';
  }

  function getCurrentHash() {
    return window.location.hash.replace('#', '').trim();
  }

  function isItemActive(item) {
    const page = getCurrentPage();
    const hash = getCurrentHash();

    if (item.tipo === 'view') {
      const isDashboard = (page === 'dashboard.html' || page === '' || page === 'index.html');
      if (!isDashboard) return false;
      if (!hash) return item.viewId === 'dashboard';
      return item.viewId === hash;
    }
    return page === item.url;
  }

  /* ============================================================
     BUILDERS DE HTML
     ============================================================ */
  function buildBrandingHTML() {
    return `
      <div class="h-20 flex items-center justify-between px-4 border-b border-white/10 shrink-0">
        <div id="sidebarBrand" class="flex items-center gap-2 overflow-hidden transition-all duration-300 min-w-0">
          <img src="/LOGOINFORTECATIM2026.png" alt="Inforteca"
            class="h-9 w-auto object-contain shrink-0"
            onerror="this.style.display='none'; this.parentElement.querySelector('.fallback-logo').style.display='flex';">
          <div class="min-w-0">
            <h1 class="text-sm font-black tracking-tight leading-none truncate">PORTAL INFORTECA</h1>
            <p class="text-[9px] text-slate-400 font-medium uppercase tracking-widest mt-1 truncate">Loja TIM Dom José</p>
          </div>
          <div class="fallback-logo hidden items-center gap-2">
            <span class="text-[#E60000] text-2xl leading-none font-black">==</span>
            <div>
              <h1 class="text-sm font-black tracking-tight leading-none">INFORTECA</h1>
              <p class="text-[9px] text-slate-400 font-medium uppercase tracking-widest mt-1">Loja TIM Dom José</p>
            </div>
          </div>
        </div>
        <button id="sidebarToggle" onclick="window.toggleSidebarCollapse && window.toggleSidebarCollapse()"
          class="hidden md:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
          title="Recolher / expandir menu">
          <i data-lucide="panel-left-close" id="sidebarToggleIcon" class="w-4 h-4"></i>
        </button>
      </div>`;
  }

  function buildMenuItemHTML(item) {
    const ativo = isItemActive(item);
    const baseClasses = 'nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer';
    const classes = ativo
      ? `${baseClasses} bg-[#0e8890] text-white font-medium shadow-md shadow-[#0e8890]/20`
      : `${baseClasses} text-slate-300 hover:text-white hover:bg-white/10`;

    const badgeHTML = item.badge
      ? `<span id="${item.badge}" class="hidden absolute top-1.5 right-2 bg-red-500 text-white text-[9px] font-bold w-5 h-5 rounded-full items-center justify-center">0</span>`
      : '';

    const posClass = item.badge ? ' relative' : '';
    const labelSpan = `<span class="nav-label text-sm font-medium">${item.label}</span>`;

    if (item.tipo === 'view') {
      const page = getCurrentPage();
      const isDashboard = (page === 'dashboard.html' || page === '' || page === 'index.html');

      if (isDashboard) {
        return `
          <button data-nav="${item.key}" onclick="if(window.navegar){window.navegar('${item.viewId}')}"
            class="${classes}${posClass}">
            <i data-lucide="${item.icon}" class="w-5 h-5 shrink-0"></i>
            ${labelSpan}
            ${badgeHTML}
          </button>`;
      }
      return `
        <a href="dashboard.html#${item.viewId}" data-nav="${item.key}"
          class="${classes}${posClass}">
          <i data-lucide="${item.icon}" class="w-5 h-5 shrink-0"></i>
          ${labelSpan}
          ${badgeHTML}
        </a>`;
    }

    return `
      <a href="${item.url}" data-nav="${item.key}"
        class="${classes}${posClass}">
        <i data-lucide="${item.icon}" class="w-5 h-5 shrink-0"></i>
        ${labelSpan}
        ${badgeHTML}
      </a>`;
  }

  function buildMenuHTML() {
    return `
      <nav class="p-4 space-y-1.5 mt-2">
        <p class="menu-section-title px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Menu Principal</p>
        ${ITENS_MENU.map(buildMenuItemHTML).join('')}
      </nav>`;
  }

  function buildFooterHTML() {
    return `
      <div class="p-4 border-t border-white/10">
        <button onclick="if(window.terminarSessao){window.terminarSessao()}"
          class="logout-btn flex items-center gap-3 px-3 py-2.5 w-full text-slate-300 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors text-sm font-medium cursor-pointer">
          <i data-lucide="log-out" class="w-5 h-5 shrink-0"></i>
          <span class="logout-label">Encerrar Sessão</span>
        </button>
      </div>`;
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function render() {
    const aside = document.getElementById('sidebar');
    if (!aside) return;

    aside.innerHTML = `
      <div>
        ${buildBrandingHTML()}
        ${buildMenuHTML()}
      </div>
      ${buildFooterHTML()}
    `;

    aplicarEstadoSidebarInicial();

    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons();
    }
  }

  /* ============================================================
     COLLAPSE
     ============================================================ */
  const SIDEBAR_KEY = 'inforteca_sidebar_collapsed';

  function aplicarEstadoSidebar(colapsado) {
    const s = document.getElementById('sidebar');
    if (!s) return;
    if (colapsado) s.classList.add('collapsed');
    else s.classList.remove('collapsed');
    document.documentElement.style.setProperty('--sidebar-width', colapsado ? '72px' : '256px');
  }

  function toggleSidebarCollapse() {
    const s = document.getElementById('sidebar');
    if (!s) return;
    const vaiColapsar = !s.classList.contains('collapsed');
    aplicarEstadoSidebar(vaiColapsar);
    localStorage.setItem(SIDEBAR_KEY, vaiColapsar ? '1' : '0');
    if (window.lucide) window.lucide.createIcons();
  }

  function aplicarEstadoSidebarInicial() {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    const w = window.innerWidth;
    if (saved === null) { aplicarEstadoSidebar(w < 1280); return; }
    if (w < 900) aplicarEstadoSidebar(true);
    else aplicarEstadoSidebar(saved === '1');
  }

  /* ============================================================
     MOBILE — toggle do aside
     ============================================================ */
  function toggleSidebar() {
    const s = document.getElementById('sidebar');
    if (!s) return;
    s.classList.toggle('hidden');
    s.classList.toggle('absolute');
    s.classList.toggle('inset-y-0');
    s.classList.toggle('z-40');
  }

  /* ============================================================
     INIT
     ============================================================ */
  function init() {
    injectCSS();
    render();

    let _timer;
    window.addEventListener('resize', () => {
      clearTimeout(_timer);
      _timer = setTimeout(aplicarEstadoSidebarInicial, 150);
    });
  }

  window.renderSidebar = render;
  window.toggleSidebarCollapse = toggleSidebarCollapse;
  window.toggleSidebar = window.toggleSidebar || toggleSidebar;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
