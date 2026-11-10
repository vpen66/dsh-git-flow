/**
 * 工作流面板的浏览器半侧。
 *
 * 这是一个手写的普通 JS 客户端 bundle：Web 页面通过 `window.__ModuleLoader__`
 * 加载它，React 来自宿主的共享模块表。面板注册为右侧 Sidebar 的会话级标签页。
 *
 * 视觉上是「HUD 控制台」：深色玻璃、网格底纹、霓虹青紫描边、执行中的扫描动画。
 * 底色与文字尽量复用宿主的 `--dsw-*` 设计变量，因此浅色主题下依然可读。
 *
 * 面板有两个页签：
 * - 执行：分支列表（左键切换、右键选指令执行）；参数与执行进度在选择指令后的弹窗里。
 * - 指令：新建/编辑/删除指令，自由增删步骤、调整顺序、勾选是否推送。
 *
 * 展示逻辑抽在 `renderRun` / `renderEdit` 里：接收完整状态快照并返回 React 树，
 * 不读 hook、不发请求，因此可以脱离浏览器直接测试。
 */
window.__ModuleLoader__.load({
  id: 'dsh-git-flow',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 标签页类型 id：同时是 tab 注册、正文 key 与标题 key。 */
    const TAB_ID = 'dsh-git-flow'
    /** 标签页类型：面板按 kind 打开。 */
    const TAB_KIND = 'git-flow'
    /** 样式表 <style> 的 id，用于幂等注入。 */
    const STYLE_ID = 'dsh-git-flow-style'
    /** 记住上次选中的指令，重开面板时回到它，而不是跳回第一个。 */
    const LAST_TEMPLATE_KEY = 'dsh-git-flow:last-template'
    /** 记住折叠的分支目录：只存被折叠的路径，其余默认展开。 */
    const COLLAPSED_KEY = 'dsh-git-flow:collapsed-groups'

    /** 各请求路由（浏览器相对路径）。 */
    const ROUTE = {
      repo: 'git-flow/repo',
      templates: 'git-flow/templates',
      save: 'git-flow/templates/save',
      remove: 'git-flow/templates/delete',
      step: 'git-flow/step',
      lastStep: 'git-flow/last-step',
      clearLastStep: 'git-flow/last-step/clear',
      conflict: 'git-flow/merge-conflict',
      restore: 'git-flow/templates/restore-default',
      checkout: 'git-flow/checkout',
      switchBranch: 'git-flow/switch-branch',
      graph: 'git-flow/graph',
      fetch: 'git-flow/fetch',
      commit: 'git-flow/commit',
      changes: 'git-flow/changes',
      diff: 'git-flow/diff',
    }

    /**
     * 面板样式表。视觉集中在这里：类名以 `dgf-` 开头避免与宿主冲突。
     *
     * 颜色优先取宿主的 `--dsw-*` 变量（浅深主题自动切换），霓虹色作为固定强调色。
     */
    const CSS = `
.dgf-root{
  --dgf-cyan:#22d3ee; --dgf-violet:#8b5cf6; --dgf-green:#34d399;
  --dgf-amber:#fbbf24; --dgf-red:#fb7185;
  --dgf-line:color-mix(in srgb, var(--dsw-alias-border-l1,#26313f) 70%, transparent);
  --dgf-surface:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#11161f) 86%, transparent);
  --dgf-text:var(--dsw-alias-label-primary,#e6eefc);
  --dgf-dim:var(--dsw-alias-label-tertiary,#8ea0b8);
  position:relative; display:flex; flex-direction:column; height:100%;
  font-family:var(--dsw-font-family,system-ui,-apple-system,sans-serif);
  color:var(--dgf-text);
  background:
    radial-gradient(900px 420px at 8% -12%, rgba(34,211,238,.13), transparent 62%),
    radial-gradient(700px 380px at 108% 4%, rgba(139,92,246,.13), transparent 58%),
    var(--dsw-alias-bg-base,#0a0e14);
  overflow:hidden;
}
.dgf-root::before{
  content:""; position:absolute; inset:0; pointer-events:none; opacity:.55;
  background-image:
    linear-gradient(rgba(120,180,255,.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(120,180,255,.07) 1px, transparent 1px);
  background-size:26px 26px;
  -webkit-mask-image:radial-gradient(130% 70% at 50% 0%, #000 30%, transparent 78%);
  mask-image:radial-gradient(130% 70% at 50% 0%, #000 30%, transparent 78%);
}
.dgf-scroll{position:relative; z-index:1; overflow-y:auto; overflow-x:hidden; padding:0 12px 14px;
  display:flex; flex-direction:column; gap:10px; flex:1}
.dgf-scroll::-webkit-scrollbar{width:6px}
.dgf-scroll::-webkit-scrollbar-thumb{background:rgba(120,180,255,.22); border-radius:99px}

.dgf-hud{position:relative; z-index:2; padding:10px 12px 8px; display:flex; align-items:center;
  justify-content:space-between; gap:8px}
.dgf-brand{display:flex; align-items:center; gap:7px; min-width:0}
.dgf-brand-name{font-size:10.5px; letter-spacing:.2em; text-transform:uppercase; font-weight:600;
  background:linear-gradient(90deg,var(--dgf-cyan),var(--dgf-violet));
  -webkit-background-clip:text; background-clip:text; color:transparent}
.dgf-led{width:6px; height:6px; border-radius:50%; background:var(--dgf-green);
  box-shadow:0 0 8px var(--dgf-green); animation:dgf-pulse 2.2s ease-in-out infinite; flex:none}
.dgf-led[data-state=warn]{background:var(--dgf-amber); box-shadow:0 0 8px var(--dgf-amber)}
.dgf-led[data-state=bad]{background:var(--dgf-red); box-shadow:0 0 8px var(--dgf-red)}
@keyframes dgf-pulse{0%,100%{opacity:1}50%{opacity:.35}}

.dgf-tabs{display:flex; gap:2px; padding:2px; border-radius:10px; border:1px solid var(--dgf-line);
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#11161f) 70%, transparent)}
.dgf-tab{flex:1; appearance:none; border:0; cursor:pointer; padding:5px 10px; border-radius:8px;
  font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; font-family:inherit;
  color:var(--dgf-dim); background:transparent; transition:color .18s, background .18s, box-shadow .18s}
.dgf-tab:hover{color:var(--dgf-text)}
.dgf-tab[data-on=true]{color:#041018; background:linear-gradient(120deg,var(--dgf-cyan),#67e8f9);
  box-shadow:0 0 14px rgba(34,211,238,.45); font-weight:600}

.dgf-sec{position:relative; border:1px solid var(--dgf-line); border-radius:12px; padding:10px;
  background:linear-gradient(180deg, color-mix(in srgb,var(--dgf-surface) 92%, transparent), transparent);
  display:flex; flex-direction:column; gap:8px}
.dgf-sec::after{content:""; position:absolute; inset:-1px; border-radius:12px; pointer-events:none;
  background:linear-gradient(140deg, rgba(34,211,238,.20), transparent 38%, transparent 62%, rgba(139,92,246,.18));
  -webkit-mask:linear-gradient(#000,#000) content-box, linear-gradient(#000,#000);
  -webkit-mask-composite:xor; mask-composite:exclude; padding:1px}
.dgf-sec-head{display:flex; align-items:center; justify-content:space-between; gap:8px}
.dgf-sec-title{font-size:9.5px; letter-spacing:.18em; text-transform:uppercase; color:var(--dgf-dim)}
.dgf-caption{font-size:11px; color:var(--dgf-dim); line-height:1.5; word-break:break-word}
.dgf-mono{font-family:var(--dsh-font-family-code-default,ui-monospace,Menlo,monospace); font-size:11px}

.dgf-btn{appearance:none; font-family:inherit; cursor:pointer; font-size:10.5px; letter-spacing:.06em;
  padding:4px 10px; border-radius:8px; border:1px solid var(--dgf-line); color:var(--dgf-text);
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#11161f) 60%, transparent);
  transition:border-color .16s, box-shadow .16s, color .16s, transform .12s}
.dgf-btn:hover:not(:disabled){border-color:rgba(34,211,238,.6);
  box-shadow:0 0 12px rgba(34,211,238,.28); color:#bff4ff}
.dgf-btn:active:not(:disabled){transform:translateY(1px)}
.dgf-btn:disabled{opacity:.45; cursor:default}
.dgf-btn[data-variant=primary]{border-color:rgba(34,211,238,.55); color:#a9f0ff;
  background:linear-gradient(120deg, rgba(34,211,238,.18), rgba(139,92,246,.16));
  box-shadow:0 0 12px rgba(34,211,238,.18)}
.dgf-btn[data-variant=primary]:hover:not(:disabled){box-shadow:0 0 18px rgba(34,211,238,.42)}
.dgf-btn[data-variant=danger]{border-color:rgba(251,113,133,.4); color:#ffb3c0}
.dgf-btn[data-variant=danger]:hover:not(:disabled){box-shadow:0 0 12px rgba(251,113,133,.3); color:#ffd0d8}
.dgf-btn[data-variant=ghost]{border-color:transparent; color:var(--dgf-dim); background:transparent}
.dgf-btn[data-variant=ghost]:hover:not(:disabled){color:var(--dgf-text); border-color:var(--dgf-line)}

.dgf-input,.dgf-select{appearance:none; font-family:inherit; font-size:11px; padding:4px 8px;
  border-radius:8px; border:1px solid var(--dgf-line); color:var(--dgf-text); min-width:0;
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#11161f) 55%, transparent);
  transition:border-color .16s, box-shadow .16s}
.dgf-input:focus,.dgf-select:focus{outline:none; border-color:rgba(34,211,238,.7);
  box-shadow:0 0 0 2px rgba(34,211,238,.16)}
.dgf-input::placeholder{color:var(--dgf-dim); opacity:.7}
.dgf-field{display:flex; align-items:center; gap:8px}
.dgf-field-label{font-size:10px; letter-spacing:.1em; text-transform:uppercase;
  color:var(--dgf-dim); min-width:84px; flex:none}
.dgf-grow{flex:1; min-width:0}

/* 指令列表：一行一个卡片，点开的那张在下方展开配置 */
.dgf-tpllist{display:flex; flex-direction:column; gap:6px}
.dgf-tplrow{position:relative; border:1px solid var(--dgf-line); border-radius:10px; overflow:hidden;
  background:linear-gradient(180deg, rgba(120,180,255,.05), rgba(120,180,255,.015));
  transition:border-color .18s, box-shadow .18s, background .18s}
.dgf-tplrow:hover{border-color:rgba(34,211,238,.35)}
.dgf-tplrow[data-on=true]{border-color:rgba(34,211,238,.55);
  background:linear-gradient(180deg, rgba(34,211,238,.10), rgba(34,211,238,.025));
  box-shadow:0 0 0 1px rgba(34,211,238,.16), 0 8px 22px -16px rgba(34,211,238,.75)}
.dgf-tplrow[data-on=true]::before{content:""; position:absolute; left:0; top:0; bottom:0; width:2px;
  background:linear-gradient(180deg, var(--dgf-cyan), var(--dgf-violet));
  box-shadow:0 0 10px rgba(34,211,238,.65)}
.dgf-tplhead{appearance:none; -webkit-appearance:none; font-family:inherit; cursor:pointer;
  width:100%; display:flex; align-items:center; gap:8px; padding:9px 11px; border:0;
  background:transparent; color:var(--dgf-text); font-size:12px; line-height:1.4; text-align:left;
  transition:background .16s}
.dgf-tplhead:hover{background:rgba(34,211,238,.06)}
.dgf-tplcaret{flex:none; width:15px; height:15px; display:grid; place-items:center; border-radius:4px;
  font-size:9px; line-height:1; color:var(--dgf-cyan);
  background:rgba(34,211,238,.12); border:1px solid rgba(34,211,238,.28);
  transition:transform .2s ease, background .16s, box-shadow .16s}
/* 展开时箭头转 90°；收起时转回来 */
.dgf-tplrow[data-on=true]:not([data-collapsed=true]) .dgf-tplcaret{transform:rotate(90deg);
  background:rgba(34,211,238,.28); border-color:rgba(34,211,238,.5);
  box-shadow:0 0 8px rgba(34,211,238,.35)}
.dgf-tplname{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-weight:500; letter-spacing:.01em}
.dgf-tplrow[data-on=true] .dgf-tplname{color:#a9f0ff}
.dgf-tplbody{display:flex; flex-direction:column; gap:10px; padding:11px; 
  border-top:1px solid color-mix(in srgb, var(--dgf-line) 85%, transparent);
  background:rgba(6,10,16,.28)}
.dgf-subsec{display:flex; flex-direction:column; gap:6px; padding:9px; border-radius:9px;
  background:rgba(120,180,255,.04);
  border:1px solid color-mix(in srgb, var(--dgf-line) 65%, transparent)}

.dgf-pipe{display:flex; flex-direction:column}
.dgf-node-row{position:relative; display:grid; grid-template-columns:22px 1fr; gap:10px; padding-bottom:10px}
.dgf-node-row:last-child{padding-bottom:0}
.dgf-rail{position:absolute; left:10.5px; top:16px; bottom:-2px; width:1px;
  background:linear-gradient(180deg, rgba(34,211,238,.55), rgba(139,92,246,.35))}
.dgf-node-row:last-child .dgf-rail{display:none}
.dgf-node{position:relative; z-index:1; width:22px; height:22px; border-radius:50%; display:grid;
  place-items:center; font-family:var(--dsh-font-family-code-default,monospace); font-size:9.5px;
  font-weight:600; border:1px solid var(--dgf-line); color:var(--dgf-dim);
  background:color-mix(in srgb, var(--dsw-alias-bg-base,#0a0e14) 92%, transparent)}
.dgf-node[data-status=ok]{border-color:rgba(52,211,153,.8); color:var(--dgf-green);
  box-shadow:0 0 10px rgba(52,211,153,.45)}
.dgf-node[data-status=skipped]{border-color:rgba(251,191,36,.7); color:var(--dgf-amber);
  box-shadow:0 0 8px rgba(251,191,36,.3)}
.dgf-node[data-status=failed]{border-color:rgba(251,113,133,.85); color:var(--dgf-red);
  box-shadow:0 0 10px rgba(251,113,133,.45)}
.dgf-node[data-status=running]{border-color:transparent; color:#a9f0ff;
  background:conic-gradient(from 0deg, transparent 0 70%, var(--dgf-cyan) 92%, transparent 100%);
  box-shadow:0 0 14px rgba(34,211,238,.5); animation:dgf-spin 1.1s linear infinite}
@keyframes dgf-spin{to{transform:rotate(360deg)}}

.dgf-step{position:relative; border:1px solid var(--dgf-line); border-radius:10px; padding:7px 9px;
  background:linear-gradient(180deg, color-mix(in srgb,var(--dgf-surface) 80%, transparent), transparent);
  display:flex; flex-direction:column; gap:5px; overflow:hidden;
  transition:border-color .18s, box-shadow .18s}
.dgf-step[data-status=ok]{border-color:rgba(52,211,153,.35)}
.dgf-step[data-status=skipped]{border-color:rgba(251,191,36,.32)}
.dgf-step[data-status=failed]{border-color:rgba(251,113,133,.5); box-shadow:0 0 12px rgba(251,113,133,.16)}
.dgf-step[data-status=running]{border-color:rgba(34,211,238,.55); box-shadow:0 0 16px rgba(34,211,238,.22)}
.dgf-step[data-status=running]::after{content:""; position:absolute; inset:0; pointer-events:none;
  background:linear-gradient(100deg, transparent 30%, rgba(34,211,238,.16) 50%, transparent 70%);
  animation:dgf-sweep 1.4s linear infinite}
@keyframes dgf-sweep{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
.dgf-step-top{display:flex; align-items:center; gap:6px; justify-content:space-between}
.dgf-flow{font-family:var(--dsh-font-family-code-default,monospace); font-size:11px; display:flex;
  align-items:center; gap:5px; flex-wrap:wrap; min-width:0}
.dgf-flow-src{color:var(--dgf-dim)}
.dgf-flow-arrow{color:var(--dgf-cyan); opacity:.85}
.dgf-flow-dst{color:var(--dgf-text); font-weight:500}
.dgf-note{font-size:10px; color:var(--dgf-dim)}
.dgf-result{font-size:10.5px; color:var(--dgf-dim); line-height:1.45; word-break:break-word}
.dgf-result[data-status=failed]{color:#ffb3c0}
.dgf-output{margin:0; max-height:180px; overflow:auto; white-space:pre-wrap; word-break:break-word;
  font-family:var(--dsh-font-family-code-default,ui-monospace,Menlo,monospace); font-size:10px;
  line-height:1.5; color:var(--dgf-dim); background:rgba(6,10,16,.35);
  border:1px solid color-mix(in srgb, var(--dgf-line) 70%, transparent); border-radius:8px; padding:6px 8px}
.dgf-resume{font-size:10.5px; line-height:1.5; color:#a5f3fc; background:rgba(34,211,238,.08);
  border:1px solid rgba(34,211,238,.28); border-radius:7px; padding:5px 7px}

.dgf-chip.dgf-keep-case, .dgf-menu-title.dgf-keep-case{text-transform:none; letter-spacing:0}
.dgf-chip{font-size:9px; letter-spacing:.08em; text-transform:uppercase; padding:1.5px 6px;
  border-radius:5px; border:1px solid var(--dgf-line); color:var(--dgf-dim);
  white-space:nowrap; line-height:1.4}
.dgf-chip[data-tone=kind]{border-color:rgba(139,92,246,.45); color:#c4b5fd; background:rgba(139,92,246,.10)}
.dgf-chip[data-tone=push]{border-color:rgba(34,211,238,.45); color:#a5f3fc; background:rgba(34,211,238,.10)}
.dgf-chip[data-tone=ok]{border-color:rgba(52,211,153,.55); color:var(--dgf-green)}
.dgf-chip[data-tone=skip]{border-color:rgba(251,191,36,.55); color:var(--dgf-amber)}
.dgf-chip[data-tone=run]{border-color:rgba(34,211,238,.6); color:#a5f3fc;
  animation:dgf-pulse 1.2s ease-in-out infinite}
.dgf-chip[data-tone=fail]{border-color:rgba(251,113,133,.6); color:var(--dgf-red)}
.dgf-chip[data-tone=auto]{border-color:rgba(139,92,246,.5); color:#c4b5fd; background:rgba(139,92,246,.10)}
.dgf-chip[data-tone=auto]::before{content:"⟲ "; opacity:.8}

.dgf-meter{display:flex; align-items:center; gap:8px}
.dgf-meter-bar{position:relative; flex:1; height:3px; border-radius:99px; overflow:hidden;
  background:rgba(120,180,255,.14)}
.dgf-meter-fill{position:absolute; inset:0 auto 0 0; border-radius:99px;
  background:linear-gradient(90deg,var(--dgf-cyan),var(--dgf-violet));
  box-shadow:0 0 10px rgba(34,211,238,.5); transition:width .35s ease}
.dgf-meter-text{font-family:var(--dsh-font-family-code-default,monospace); font-size:10px; color:var(--dgf-dim)}

.dgf-log{display:flex; flex-direction:column; gap:2px; max-height:180px; overflow-y:auto;
  font-family:var(--dsh-font-family-code-default,monospace); font-size:10.5px; line-height:1.5;
  border-top:1px solid var(--dgf-line); padding-top:8px}
.dgf-log-row{display:flex; gap:6px; color:var(--dgf-dim)}
.dgf-log-row[data-ok=false]{color:#ffb3c0}
.dgf-log-mark{color:var(--dgf-cyan); flex:none}
.dgf-log-row[data-ok=false] .dgf-log-mark{color:var(--dgf-red)}

.dgf-alert{display:flex; flex-direction:column; gap:8px; padding:10px; border-radius:10px;
  border:1px solid rgba(251,113,133,.45); background:rgba(251,113,133,.08); color:#ffc9d2;
  font-size:11px; line-height:1.5}
.dgf-empty{color:var(--dgf-dim); font-size:11px; text-align:center; padding:18px 8px}

.dgf-conflict{display:flex; flex-direction:column; gap:7px; padding:9px 10px; border-radius:10px;
  border:1px solid rgba(251,113,133,.5); background:rgba(251,113,133,.09); color:#ffc9d2}
.dgf-conflict-title{display:flex; align-items:center; gap:6px; font-size:10.5px; letter-spacing:.08em;
  text-transform:uppercase; color:var(--dgf-red); font-weight:600}
.dgf-conflict-files{display:flex; flex-direction:column; gap:2px; max-height:120px; overflow-y:auto;
  font-family:var(--dsh-font-family-code-default,monospace); font-size:10.5px; color:#ffd0d8}
.dgf-conflict-file::before{content:"! "; color:var(--dgf-red)}
.dgf-conflict-hint{font-size:10px; color:var(--dgf-dim); line-height:1.5}

/* 顶部「上次执行失败」横幅：面板重开/应用重启后仍然可见 */
.dgf-lastfail{display:flex; flex-direction:column; gap:7px; padding:9px 10px; border-radius:10px;
  border:1px solid rgba(251,113,133,.55); background:rgba(251,113,133,.10); color:#ffc9d2}
.dgf-lastfail-title{font-size:11px; font-weight:600; letter-spacing:.06em; color:var(--dgf-red)}
.dgf-lastfail-meta{font-size:10px; color:var(--dgf-dim); word-break:break-word}
.dgf-lastfail-msg{font-size:10.5px; line-height:1.5; word-break:break-word}
.dgf-lastfail-actions{display:flex; gap:6px; flex-wrap:wrap}

/* 分支选择器：输入框 + 可选下拉 */
.dgf-picker{position:relative; flex:1; min-width:0}
.dgf-picker-field{display:flex; align-items:center; gap:5px; min-width:0}
.dgf-picker-caret{appearance:none; -webkit-appearance:none; flex:none; width:22px; height:22px;
  display:grid; place-items:center; cursor:pointer; font-family:inherit; font-size:10px;
  border-radius:6px; border:1px solid var(--dgf-line); background:rgba(34,211,238,.08);
  color:var(--dgf-cyan); transition:background .16s, border-color .16s}
.dgf-picker-caret:hover{background:rgba(34,211,238,.18); border-color:rgba(34,211,238,.5)}
.dgf-picker-list{z-index:1000; max-height:200px; overflow-y:auto; display:flex; flex-direction:column;
  gap:1px; padding:4px;
  border-radius:9px; border:1px solid rgba(34,211,238,.35);
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#11161f) 96%, #05080d);
  box-shadow:0 14px 30px -14px rgba(0,0,0,.85), 0 0 0 1px rgba(34,211,238,.12)}
.dgf-picker-item{appearance:none; -webkit-appearance:none; font-family:inherit; cursor:pointer;
  display:flex; align-items:center; gap:7px; padding:5px 7px; border:0; border-radius:6px;
  background:transparent; color:var(--dgf-text); font-size:11px; text-align:left;
  transition:background .12s, color .12s}
.dgf-picker-item:hover{background:rgba(34,211,238,.16); color:#bff4ff}
.dgf-picker-hint{font-family:var(--dsh-font-family-code-default,monospace); font-size:10.5px; flex:none}
.dgf-picker-label{font-size:10px; color:var(--dgf-dim); overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap}
.dgf-picker-empty{padding:8px; font-size:10.5px; color:var(--dgf-dim); text-align:center}

.dgf-var{padding:6px 0; border-bottom:1px dashed color-mix(in srgb, var(--dgf-line) 60%, transparent)}
.dgf-var:last-child{border-bottom:0}
.dgf-var-sub{display:flex; gap:6px; margin-top:5px}
.dgf-var-sub .dgf-field-label{min-width:44px; font-size:9.5px}

.dgf-edit-row{display:flex; gap:6px; align-items:center; flex-wrap:wrap}
.dgf-iconbtn{appearance:none; cursor:pointer; font-family:inherit; width:22px; height:22px;
  display:grid; place-items:center; border-radius:6px; border:1px solid var(--dgf-line);
  background:transparent; color:var(--dgf-dim); font-size:11px;
  transition:color .14s, border-color .14s, box-shadow .14s}
.dgf-iconbtn:hover{color:var(--dgf-text); border-color:rgba(34,211,238,.5);
  box-shadow:0 0 8px rgba(34,211,238,.25)}
.dgf-iconbtn[data-variant=danger]:hover{color:#ffb3c0; border-color:rgba(251,113,133,.55);
  box-shadow:0 0 8px rgba(251,113,133,.25)}

.dgf-confirm-mask{position:absolute; inset:0; z-index:60; display:flex; align-items:center;
  justify-content:center; padding:14px; background:rgba(3,7,12,.74);
  -webkit-backdrop-filter:blur(3px); backdrop-filter:blur(3px)}
.dgf-confirm{width:100%; max-height:100%; overflow-y:auto; display:flex; flex-direction:column; gap:9px;
  padding:13px; border-radius:12px; border:1px solid rgba(251,191,36,.5);
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#11161f) 97%, #05080d);
  box-shadow:0 24px 60px -24px rgba(0,0,0,.95), 0 0 0 1px rgba(251,191,36,.16)}
.dgf-confirm-title{display:flex; align-items:center; gap:7px; font-size:12px; font-weight:600;
  color:var(--dgf-text)}
.dgf-confirm-meta{font-family:var(--dsh-font-family-code-default,monospace); font-size:10px;
  color:var(--dgf-dim); word-break:break-all}
.dgf-confirm-steps{display:flex; flex-direction:column; gap:4px; max-height:240px; overflow-y:auto;
  padding:8px; border-radius:8px; background:rgba(120,180,255,.05);
  border:1px solid color-mix(in srgb, var(--dgf-line) 65%, transparent)}
.dgf-confirm-step{display:flex; align-items:center; gap:6px; font-size:11px; min-width:0}
.dgf-sha{font-family:var(--dsh-font-family-code-default,monospace); font-size:10.5px;
  color:var(--dgf-dim); flex:none}
.dgf-confirm-text{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-family:var(--dsh-font-family-code-default,monospace); color:var(--dgf-text)}
.dgf-confirm-hint{font-size:10px; line-height:1.5; color:var(--dgf-dim)}
.dgf-confirm-actions{display:flex; gap:6px}
.dgf-confirm-actions .dgf-btn{flex:1; padding:7px 10px}
/* 提交对话框：把黄色警示描边换成青色，因为提交本身不是危险操作 */
.dgf-confirm[data-tone=commit]{border-color:rgba(34,211,238,.5);
  box-shadow:0 24px 60px -24px rgba(0,0,0,.95), 0 0 0 1px rgba(34,211,238,.16)}
.dgf-commit-input{width:100%; min-height:66px; resize:vertical; font-family:inherit; font-size:11px;
  line-height:1.55; padding:7px 9px; border-radius:8px; border:1px solid var(--dgf-line);
  color:var(--dgf-text);
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#11161f) 55%, transparent);
  transition:border-color .16s, box-shadow .16s}
.dgf-commit-input:focus{outline:none; border-color:rgba(34,211,238,.7);
  box-shadow:0 0 0 2px rgba(34,211,238,.16)}
.dgf-commit-input::placeholder{color:var(--dgf-dim); opacity:.7}
/* 提交弹层的文件勾选列表 */
.dgf-files{display:flex; flex-direction:column; gap:1px; max-height:190px; overflow-y:auto; padding:4px;
  border-radius:8px; background:rgba(120,180,255,.05);
  border:1px solid color-mix(in srgb, var(--dgf-line) 65%, transparent)}
.dgf-file{display:flex; align-items:center; gap:4px; padding:2px 3px; border-radius:6px}
.dgf-file:hover{background:rgba(34,211,238,.08)}
.dgf-file-main{flex:1; min-width:0; display:flex; align-items:center; gap:7px; cursor:pointer;
  font-size:11px; color:var(--dgf-text); padding:1px 2px}
.dgf-file input{accent-color:#22d3ee; margin:0; flex:none; cursor:pointer}
.dgf-file-diff{appearance:none; flex:none; cursor:pointer; font-family:var(--dsh-font-family-code-default,monospace);
  font-size:9px; padding:1px 6px; border-radius:5px; border:1px solid var(--dgf-line);
  color:var(--dgf-dim); background:transparent; transition:color .14s, border-color .14s}
.dgf-file-diff:hover:not(:disabled){color:#bff4ff; border-color:rgba(34,211,238,.5)}
/* 单文件 diff 预览：统一视图是「旧行号 新行号 内容」，并排视图左右各一列 */
.dgf-diff-head{display:flex; align-items:center; gap:6px; min-width:0}
.dgf-diff-title{overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0}
.dgf-diff{display:flex; flex-direction:column; max-height:320px; overflow:auto; border-radius:8px;
  border:1px solid color-mix(in srgb, var(--dgf-line) 65%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-bg-base,#0a0e14) 75%, transparent);
  font-family:var(--dsh-font-family-code-default,ui-monospace,Menlo,monospace);
  font-size:10.5px; line-height:1.5; tab-size:2}
.dgf-diff-row{display:grid; grid-template-columns:38px 38px minmax(0,1fr); align-items:stretch}
.dgf-diff-row[data-kind=hunk],.dgf-diff-row[data-kind=meta]{grid-template-columns:minmax(0,1fr);
  padding:2px 7px; color:var(--dgf-cyan)}
.dgf-diff-row[data-kind=meta]{color:var(--dgf-dim)}
.dgf-diff-row[data-kind=add]{background:rgba(52,211,153,.10)}
.dgf-diff-row[data-kind=del]{background:rgba(251,113,133,.12)}
.dgf-diff-ln{color:var(--dgf-dim); text-align:right; padding:0 6px; user-select:none;
  font-variant-numeric:tabular-nums; white-space:nowrap; background:rgba(0,0,0,.14);
  border-right:1px solid color-mix(in srgb, var(--dgf-line) 55%, transparent)}
.dgf-diff-code{white-space:pre; padding:0 7px; color:var(--dgf-text)}
.dgf-diff-row[data-kind=add] .dgf-diff-code{color:#86efac}
.dgf-diff-row[data-kind=del] .dgf-diff-code{color:#fda4af}
.dgf-diff-row-split{grid-template-columns:38px minmax(0,1fr) 38px minmax(0,1fr)}
/* 并排时每列都很窄，超长行先裁掉，避免盖住右侧那一列；要看全文切回统一视图 */
.dgf-diff-row-split .dgf-diff-code{overflow:hidden; border-right:1px solid rgba(120,180,255,.14)}
.dgf-diff-row-split .dgf-diff-code:last-child{border-right:0}
.dgf-diff-add{color:#86efac; background:rgba(52,211,153,.10)}
.dgf-diff-del{color:#fda4af; background:rgba(251,113,133,.12)}
.dgf-file-badge{flex:none; width:38px; text-align:center; font-size:9px; letter-spacing:.06em;
  padding:1px 0; border-radius:4px; border:1px solid var(--dgf-line); color:var(--dgf-dim)}
.dgf-file-badge[data-status=A]{color:var(--dgf-green); border-color:rgba(52,211,153,.5)}
.dgf-file-badge[data-status=D]{color:var(--dgf-red); border-color:rgba(251,113,133,.5)}
.dgf-file-badge[data-status=?]{color:#a5f3fc; border-color:rgba(34,211,238,.45)}
.dgf-file-badge[data-status=M]{color:var(--dgf-amber); border-color:rgba(251,191,36,.45)}
.dgf-file-path{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-family:var(--dsh-font-family-code-default,ui-monospace,Menlo,monospace); font-size:10.5px}

.dgf-toggle{display:flex; align-items:center; gap:6px; font-size:10.5px; color:var(--dgf-dim);
  cursor:pointer; padding:2px 0; user-select:none}
.dgf-toggle:hover{color:var(--dgf-text)}
.dgf-toggle input{accent-color:#22d3ee; cursor:pointer; margin:0}

.dgf-dock{position:sticky; bottom:0; z-index:2; display:flex; gap:6px; padding:8px 0 10px;
  background:linear-gradient(180deg, transparent,
    color-mix(in srgb, var(--dsw-alias-bg-base,#0a0e14) 92%, transparent) 45%)}
.dgf-dock .dgf-btn{flex:1; padding:7px 10px}

/* 分支列表：左键切换当前分支，右键弹出「用指令执行」菜单 */
.dgf-branches{display:flex; flex-direction:column; gap:1px; max-height:210px; overflow-y:auto; padding:3px;
  border-radius:8px; background:rgba(120,180,255,.04);
  border:1px solid color-mix(in srgb, var(--dgf-line) 65%, transparent)}
.dgf-branch{appearance:none; -webkit-appearance:none; font-family:inherit; cursor:pointer;
  text-align:left; display:flex; align-items:center; gap:6px; padding:4px 6px; border:0;
  border-radius:6px; background:transparent; color:var(--dgf-text); font-size:11px; min-width:0;
  transition:background .14s}
.dgf-branch:hover:not(:disabled){background:rgba(34,211,238,.10)}
.dgf-branch[data-on=true]{background:rgba(34,211,238,.14)}
.dgf-branch:disabled{opacity:.5; cursor:default}
.dgf-branch-name{font-family:var(--dsh-font-family-code-default,monospace); flex:none; max-width:58%;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.dgf-branch[data-on=true] .dgf-branch-name{color:#a9f0ff; font-weight:600}
.dgf-branch-meta{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:9.5px; color:var(--dgf-dim); text-align:right}
/* 分支目录：带 / 的分支按前缀折叠，目录行只折叠不切换 */
.dgf-group{display:flex; flex-direction:column; gap:1px}
.dgf-group-head{appearance:none; -webkit-appearance:none; font-family:inherit; cursor:pointer;
  text-align:left; display:flex; align-items:center; gap:5px; padding:4px 6px; border:0;
  border-radius:6px; background:transparent; color:var(--dgf-text); font-size:11px; min-width:0}
.dgf-group-head:hover{background:rgba(139,92,246,.10)}
.dgf-folder-icon{flex:none; width:12px; height:12px; fill:currentColor; color:var(--dgf-dim);
  opacity:.9; transition:color .14s, opacity .14s}
.dgf-group[data-collapsed=false] .dgf-folder-icon{color:var(--dgf-amber); opacity:1}
.dgf-group-name{font-family:var(--dsh-font-family-code-default,monospace); font-weight:600;
  flex:0 1 auto; max-width:70%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:color-mix(in srgb, var(--dgf-text) 82%, transparent)}
.dgf-group-count{flex:none; font-size:9px; color:var(--dgf-dim); opacity:.75}
.dgf-group-children{display:flex; flex-direction:column; gap:1px}
/* 提交图：左侧 SVG 画泳道与分叉/合并曲线，右侧是紧凑的单行提交信息 */
.dgf-graph{max-height:420px; overflow-y:auto; padding:3px 2px; border-radius:8px;
  background:rgba(120,180,255,.04);
  border:1px solid color-mix(in srgb, var(--dgf-line) 65%, transparent)}
.dgf-graph-body{position:relative}
.dgf-graph-svg{position:absolute; left:2px; top:0; overflow:hidden; pointer-events:none}
.dgf-graph-row{display:flex; flex-direction:row; align-items:center; gap:6px;
  min-width:0; padding-right:6px; border-radius:6px; cursor:default;
  /* 背景只铺在文字区，避免悬停/当前行盖住左侧的泳道线 */
  background-clip:content-box}
.dgf-graph-row:hover{background:rgba(34,211,238,.08)}
.dgf-graph-row[data-head=true]{background:rgba(34,211,238,.10)}
.dgf-graph-subject{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:10.5px; color:var(--dgf-text)}
.dgf-graph-refs{flex:none; display:flex; align-items:center; gap:2px; max-width:30%; overflow:hidden}
.dgf-graph-ref{flex:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-family:var(--dsh-font-family-code-default,monospace); font-size:8.5px; padding:0 3px;
  border-radius:4px; border:1px solid var(--dgf-line); color:var(--dgf-dim)}
.dgf-graph-ref[data-kind=head]{color:#a5f3fc; border-color:rgba(34,211,238,.55); background:rgba(34,211,238,.10)}
.dgf-graph-ref[data-kind=remote]{color:#c4b5fd; border-color:rgba(139,92,246,.5)}
.dgf-graph-ref[data-kind=tag]{color:var(--dgf-amber); border-color:rgba(251,191,36,.45)}
.dgf-graph-ref[data-kind=branch]{color:var(--dgf-green); border-color:rgba(52,211,153,.45)}
.dgf-graph-meta{flex:none; display:flex; align-items:center; gap:4px; font-size:9px;
  color:var(--dgf-dim); font-family:var(--dsh-font-family-code-default,monospace)}
.dgf-graph-hash{flex:none; opacity:.85}
.dgf-graph-author{flex:none; max-width:40px; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; opacity:.85}
.dgf-graph-time{flex:none; white-space:nowrap}
.dgf-graph-more{display:flex; justify-content:center; padding-top:4px}
/* 右键菜单：固定定位，避免被面板的滚动容器裁掉 */
.dgf-menu-mask{position:fixed; inset:0; z-index:1200}
.dgf-menu{position:fixed; z-index:1201; width:232px; max-height:min(340px,70vh); overflow-y:auto;
  display:flex; flex-direction:column; gap:1px; padding:5px; border-radius:10px;
  border:1px solid rgba(34,211,238,.45);
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#11161f) 98%, #05080d);
  box-shadow:0 20px 50px -18px rgba(0,0,0,.95), 0 0 0 1px rgba(34,211,238,.14)}
.dgf-menu-title{padding:3px 7px; font-size:9px; letter-spacing:.16em; text-transform:uppercase;
  color:var(--dgf-dim)}
.dgf-menu-item{appearance:none; -webkit-appearance:none; font-family:inherit; cursor:pointer;
  text-align:left; display:flex; align-items:center; gap:6px; padding:6px 8px; border:0;
  border-radius:7px; background:transparent; color:var(--dgf-text); font-size:11px; min-width:0}
.dgf-menu-item:hover:not(:disabled){background:rgba(34,211,238,.14); color:#bff4ff}
.dgf-menu-item:disabled{opacity:.5; cursor:default}
.dgf-menu-item-text{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.dgf-menu-sep{height:1px; margin:4px 2px;
  background:color-mix(in srgb, var(--dgf-line) 75%, transparent)}
/* 执行弹窗：参数与流程在 prepare，逐步状态在 running/done */
.dgf-exec-body{display:flex; flex-direction:column; gap:9px; max-height:58vh; overflow-y:auto;
  padding-right:2px}
.dgf-exec-vars{display:flex; flex-direction:column; gap:2px}

@media (prefers-color-scheme: light){
  .dgf-root{background:
    radial-gradient(900px 420px at 8% -12%, rgba(8,145,178,.10), transparent 62%),
    radial-gradient(700px 380px at 108% 4%, rgba(109,40,217,.08), transparent 58%),
    var(--dsw-alias-bg-base,#f7f9fc)}
  .dgf-root::before{background-image:
    linear-gradient(rgba(30,64,120,.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(30,64,120,.06) 1px, transparent 1px)}
  .dgf-brand-name{background:linear-gradient(90deg,#0e7490,#6d28d9);
    -webkit-background-clip:text; background-clip:text}
  .dgf-tab[data-on=true]{color:#f8fdff; background:linear-gradient(120deg,#0891b2,#7c3aed)}
  .dgf-result[data-status=failed]{color:#be123c}
  .dgf-log-row[data-ok=false]{color:#be123c}
  .dgf-alert{color:#9f1239; border-color:rgba(190,18,60,.35); background:rgba(190,18,60,.06)}
  .dgf-lastfail{color:#9f1239; border-color:rgba(190,18,60,.4); background:rgba(190,18,60,.07)}
  .dgf-node[data-status=ok]{box-shadow:0 0 8px rgba(5,150,105,.3)}
}

@media (prefers-reduced-motion: reduce){
  .dgf-led,.dgf-chip[data-tone=run],.dgf-node[data-status=running],
  .dgf-step[data-status=running]::after{animation:none}
}
`

    /**
     * 注入或刷新样式表。
     *
     * 不能「已存在就跳过」：浏览器半侧会热更新，而 `<style>` 元素留在页面上不会自己变，
     * 于是新增的类名拿不到样式，界面上那些元素会退回浏览器默认外观（浅灰按钮）。
     * 因此每次 apply 都比对内容，不一致就覆盖。
     */
    function ensureStyles() {
      if (typeof document === 'undefined') return
      const existing = document.getElementById(STYLE_ID)
      if (existing !== null && existing !== undefined) {
        if (existing.textContent !== CSS) existing.textContent = CSS
        return
      }
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /**
     * 读上次选中的指令 id。
     *
     * 存储不可用（隐私模式、被禁用）时返回空串，功能退化为「选第一个」，不影响使用。
     *
     * @returns 指令 id；没有记录时为空串。
     */
    function readLastTemplate() {
      try {
        return window.localStorage.getItem(LAST_TEMPLATE_KEY) ?? ''
      } catch {
        return ''
      }
    }

    /**
     * 记住当前选中的指令 id。
     *
     * @param id 指令 id；传空串表示清除记录。
     */
    function rememberTemplate(id) {
      try {
        if (id === '') window.localStorage.removeItem(LAST_TEMPLATE_KEY)
        else window.localStorage.setItem(LAST_TEMPLATE_KEY, id)
      } catch {
        // 存储不可用只影响下次打开时的默认选中，不影响当前会话。
      }
    }

    /**
     * 拼类名，跳过空值。
     *
     * @param names 类名列表。
     * @returns 类名字符串。
     */
    function cx(...names) {
      return names.filter(Boolean).join(' ')
    }

    /**
     * 发一个 JSON POST 到宿主路由。
     *
     * @param route 浏览器相对路由。
     * @param body 请求体。
     * @returns 解析后的响应；非 2xx 时抛出。
     */
    async function post(route, body) {
      const response = await fetch(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const error = new Error(`${route} 返回 ${response.status}`)
        error.status = response.status
        throw error
      }
      return await response.json()
    }

    /**
     * 把请求失败翻译成能指导操作的中文说明。
     *
     * 404/405 几乎总是同一个原因：宿主进程还在跑旧版本的服务端半侧。浏览器端有热更新，
     * 服务端没有——插件代码只在应用启动时加载。遇到这种直接告诉用户重启，而不是甩状态码。
     *
     * @param err 捕获到的错误。
     * @returns 展示文本。
     */
    function explain(err) {
      const status = err && err.status
      if (status === 404 || status === 405) {
        return '面板与服务端版本不一致：当前运行的宿主还没加载新版插件。'
          + '请完全退出并重新打开 DeepSeek Harness（浏览器端的改动会热更新，服务端不会）。'
      }
      return err && err.message ? err.message : String(err)
    }

    /**
     * 通配符匹配分支名；不含 `*` 时按全等比较。
     *
     * @param name 分支名。
     * @param pattern 模式；为空表示全部匹配。
     * @returns 命中为 true。
     */
    function matches(name, pattern) {
      if (!pattern) return true
      if (!pattern.includes('*')) return name === pattern
      const escaped = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      return new RegExp(`^${escaped.join('.*')}$`).test(name)
    }

    /** 新建空指令的默认骨架。 */
    function blankTemplate() {
      return {
        id: `tpl-${Date.now().toString(36)}`,
        name: '新指令',
        variables: [{ key: 'base', label: '基础分支', kind: 'pick', pattern: '*' }],
        steps: [{ id: 's1', kind: 'create', source: '{base}', target: 'release/x', push: false }],
      }
    }

    /** 新建组合指令的默认骨架：compose 为空表示还没选要组合的指令。 */
    function blankComposeTemplate() {
      return {
        id: `tpl-${Date.now().toString(36)}`,
        name: '新组合指令',
        description: '',
        sync: 'merge',
        compose: [],
        variables: [],
        steps: [],
      }
    }

    /**
     * 是否是组合指令（存在 compose 字段即组合，空数组表示还没选组件）。
     *
     * @param template 指令。
     * @returns 是否组合指令。
     */
    function isComposedTemplate(template) {
      return template !== null && template !== undefined && Array.isArray(template.compose)
    }

    /**
     * 把组合指令展开成可执行的普通指令：按顺序合并变量、拼接被引用指令的步骤，
     * 并给步骤 id 加上来源前缀，避免多条指令的 s1 冲突。
     *
     * @param template 组合指令或普通指令。
     * @param templates 全部指令。
     * @returns `{ template, error }`；出错时 template 为 null。
     */
    function expandComposedTemplate(template, templates) {
      const byId = new Map((templates ?? []).map(item => [item.id, item]))
      const variables = []
      const variableKeys = new Set()
      const steps = []
      const usedIds = new Set()
      const path = []
      const addVariable = variable => {
        if (variableKeys.has(variable.key)) return
        variableKeys.add(variable.key)
        variables.push(variable)
      }
      const walk = current => {
        if (path.includes(current.id)) {
          return `组合存在循环引用：${[...path, current.id].join(' → ')}`
        }
        path.push(current.id)
        try {
          for (const variable of current.variables ?? []) addVariable(variable)
          if (isComposedTemplate(current)) {
            for (const id of current.compose ?? []) {
              const child = byId.get(id)
              if (child === undefined) return `组合引用的指令不存在：${id}`
              const error = walk(child)
              if (error !== null) return error
            }
            return null
          }
          for (const step of current.steps ?? []) {
            let stepId = `${current.id}:${step.id}`
            let suffix = 2
            while (usedIds.has(stepId)) {
              stepId = `${current.id}:${step.id}#${suffix}`
              suffix += 1
            }
            usedIds.add(stepId)
            steps.push({ ...step, id: stepId })
          }
          return null
        } finally {
          path.pop()
        }
      }
      const error = walk(template)
      if (error !== null) return { template: null, error }
      return { template: { ...template, variables, steps }, error: null }
    }

    /**
     * 按指令声明初始化变量取值。
     *
     * @param template 指令。
     * @param branches 仓库现有分支名。
     * @returns 变量字典。
     */
    function initialValues(template, branches) {
      const values = {}
      for (const variable of template.variables ?? []) {
        if (typeof variable.default === 'string' && variable.default !== '') {
          values[variable.key] = variable.default
          continue
        }
        // pick 且模式是精确分支名时直接选中它（例如 develop），省一次点击。
        if (variable.kind === 'pick' && variable.pattern && !variable.pattern.includes('*')) {
          values[variable.key] = branches.includes(variable.pattern) ? variable.pattern : ''
          continue
        }
        values[variable.key] = ''
      }
      return applyDerived(template.variables ?? [], values)
    }

    /**
     * 把 `{变量}` 替换成实际值，用于预览。
     *
     * @param field 指令字段。
     * @param values 变量取值。
     * @returns 预览文本。
     */
    function preview(field, values) {
      return String(field).replace(/\{([A-Za-z0-9_]+)\}/g, (_w, name) => {
        const value = values[name]
        return value === undefined || value === '' ? `{${name}}` : value
      })
    }

    /**
     * 计算一个变量的自动填充值。
     *
     * 与 `src/templates.ts` 的 `computeDerived` 是同一套规则：浏览器半侧无法引用
     * 服务端模块，而表单要在输入时立刻联动，不能每敲一个字请求一次服务端。
     * 改规则时两处必须同步。
     *
     * @param variable 目标变量声明。
     * @param values 当前变量取值。
     * @returns 推导值；来源为空或没有规则时为空串。
     */
    function computeDerived(variable, values) {
      const rule = variable.derive
      if (!rule) return ''
      const source = values[rule.from]
      // 来源为空：退回默认值，避免用户清空来源时字段残留上一个分支名。
      if (source === undefined || source === '') return variable.default || ''
      const take = rule.take || 'after-slash'
      let part = source
      if (take === 'after-slash') {
        const cut = source.indexOf('/')
        part = cut === -1 ? source : source.slice(cut + 1)
      } else if (take === 'last-segment') {
        const parts = source.split('/')
        part = parts[parts.length - 1] || source
      }
      // 截出来是空的（例如刚输到 `feature/`）：只保留前缀，别把字段清成空白。
      if (part === '') return rule.prefix || ''
      return `${rule.prefix || ''}${part}`
    }

    /**
     * 把全部推导变量算一遍，支持链式推导。
     *
     * @param variables 变量声明。
     * @param values 初始取值。
     * @returns 补齐推导后的取值。
     */
    function applyDerived(variables, values) {
      const next = { ...values }
      for (let round = 0; round < variables.length; round += 1) {
        let changed = false
        for (const variable of variables) {
          if (!variable.derive) continue
          const derived = computeDerived(variable, next)
          if (next[variable.key] !== derived) {
            next[variable.key] = derived
            changed = true
          }
        }
        if (!changed) break
      }
      return next
    }

    /**
     * 在某个变量变化后，把「正在跟随」的推导变量跟着更新。
     *
     * 是否跟随由 `following` 显式决定，而不是靠比较旧值：推导字段往往带着默认值
     * （如 `release/`），用「值没变过」判断会把它误判成用户手改。跟随集合在组件里
     * 维护——用户手动填了值就退出，把字段清空就恢复。
     *
     * @param variables 变量声明。
     * @param next 变化后的取值。
     * @param changedKey 刚变化的变量 key。
     * @param following 当前处于跟随状态的变量 key 列表。
     * @returns 更新后的取值。
     */
    function propagateDerived(variables, next, changedKey, following) {
      const out = { ...next }
      for (const variable of variables) {
        if (!variable.derive || variable.derive.from !== changedKey) continue
        if (!following.includes(variable.key)) continue
        out[variable.key] = computeDerived(variable, out)
      }
      return out
    }

    /**
     * 给右键的分支挑一个最合适的 `pick` 变量：优先通配符最具体的那个。
     *
     * 例如默认指令里 `{base}` 的模式是 `*`、`{feature}` 是 `feature/*`，
     * 右键 `feature/v1.0.1` 应该落到 `{feature}` 而不是 `{base}`。
     *
     * @param variables 指令变量声明。
     * @param branch 右键的分支名；空串表示不预填。
     * @returns 变量声明；没有 pick 变量或分支为空时返回 null。
     */
    function pickVariableFor(variables, branch) {
      const picks = (variables ?? []).filter(variable => variable.kind === 'pick')
      if (picks.length === 0 || branch === '') return null
      const scored = picks
        .map(variable => ({ variable, pattern: typeof variable.pattern === 'string' ? variable.pattern : '' }))
        .filter(item => item.pattern !== '' && matches(branch, item.pattern))
        .map(item => ({ variable: item.variable, literal: item.pattern.replace(/\*/g, '').length }))
        .sort((a, b) => b.literal - a.literal)
      if (scored.length > 0) return scored[0].variable
      return picks[0]
    }

    /**
     * 用右键的分支给指令变量预填默认值。
     *
     * 只改动一个最匹配的 `pick` 变量，再按推导规则补齐 release/tag 之类的字段；
     * 弹窗里用户仍然可以改。分支为空（例如从失败横幅重试）时只按指令默认值初始化。
     *
     * @param template 指令。
     * @param branches 仓库现有分支名。
     * @param branch 右键的分支名。
     * @returns 预填后的变量取值。
     */
    function prefillValues(template, branches, branch) {
      const values = initialValues(template, branches)
      const pick = pickVariableFor(template.variables ?? [], branch)
      if (pick === null) return values
      return applyDerived(template.variables ?? [], { ...values, [pick.key]: branch })
    }

    /**
     * 状态 → 徽标文案与色调。
     *
     * @param status 状态。
     * @returns 文案与色调。
     */
    function statusView(status) {
      if (status === 'ok') return { text: '已完成', tone: 'ok' }
      if (status === 'skipped') return { text: '已跳过', tone: 'skip' }
      if (status === 'running') return { text: '执行中', tone: 'run' }
      if (status === 'failed') return { text: '失败', tone: 'fail' }
      return { text: '待执行', tone: '' }
    }

    /**
     * 改动类型 → 中文徽标。
     *
     * @param status 文件列表接口返回的改动类型（M/A/D/?）。
     * @returns 徽标文本。
     */
    function changeLabel(status) {
      if (status === 'A') return '新增'
      if (status === 'D') return '删除'
      if (status === '?') return '未跟踪'
      return '修改'
    }

    /** 统一 diff 的文件头前缀；逐行解析前先跳过，避免把 `--- a/x` 当成删除行。 */
    const DIFF_HEADER_PREFIXES = [
      'diff --git ', 'index ', 'new file mode ', 'deleted file mode ', 'old mode ', 'new mode ',
      'similarity index ', 'dissimilarity index ', 'rename from ', 'rename to ', 'copy from ', 'copy to ',
      '--- ', '+++ ',
    ]

    /**
     * 解析统一 diff 文本，并算出每行对应的新旧行号。
     *
     * hunk 头之前的文件头（`diff --git`、`index`、`---/+++` 等）跳过不展示；
     * hunk 里以 `\` 开头的是「文件末尾没有换行」的提示，作为 meta 行显示。
     *
     * @param patch 统一 diff 文本。
     * @returns 行数组；每行有 type，内容行为 add/del/ctx 并带 oldNo/newNo。
     */
    function parseDiff(patch) {
      const rows = []
      let oldNo = 0
      let newNo = 0
      let inHunk = false
      for (const line of String(patch ?? '').split('\n')) {
        if (line === '') continue
        if (!inHunk && DIFF_HEADER_PREFIXES.some(prefix => line.startsWith(prefix))) continue
        if (line.startsWith('@@')) {
          const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
          oldNo = match === null ? 0 : Number.parseInt(match[1], 10)
          newNo = match === null ? 0 : Number.parseInt(match[2], 10)
          inHunk = true
          rows.push({ key: rows.length, type: 'hunk', text: line })
          continue
        }
        const marker = line.charAt(0)
        if (marker === '+') {
          rows.push({ key: rows.length, type: 'add', oldNo: null, newNo, text: line.slice(1) })
          newNo += 1
        } else if (marker === '-') {
          rows.push({ key: rows.length, type: 'del', oldNo, newNo: null, text: line.slice(1) })
          oldNo += 1
        } else if (marker === ' ') {
          rows.push({ key: rows.length, type: 'ctx', oldNo, newNo, text: line.slice(1) })
          oldNo += 1
          newNo += 1
        } else {
          rows.push({ key: rows.length, type: 'meta', text: line })
        }
      }
      return rows
    }

    /**
     * 把统一 diff 的行配对成并排视图的两列：连续的删除与新增左右对齐。
     *
     * @param rows parseDiff 的结果。
     * @returns 并排行；内容行是 pair（left/right 可能为 null），其余原样保留。
     */
    function toSplitRows(rows) {
      const out = []
      let deletions = []
      let additions = []
      /** 把积攒的删除/新增按顺序配对输出。 */
      const flush = () => {
        const count = Math.max(deletions.length, additions.length)
        for (let index = 0; index < count; index += 1) {
          out.push({
            key: out.length,
            type: 'pair',
            left: deletions[index] ?? null,
            right: additions[index] ?? null,
          })
        }
        deletions = []
        additions = []
      }
      for (const row of rows) {
        if (row.type === 'del') { deletions.push(row); continue }
        if (row.type === 'add') { additions.push(row); continue }
        flush()
        out.push({ ...row, key: out.length })
      }
      flush()
      return out
    }

    /**
     * 统一 diff 的一行：旧行号、新行号、内容。
     *
     * @param props `row` 为 parseDiff 的一行。
     * @returns React 节点。
     */
    function DiffUnifiedRow(props) {
      const row = props.row
      if (row.type === 'hunk' || row.type === 'meta') {
        return h('div', { className: 'dgf-diff-row', 'data-kind': row.type },
          h('span', { className: 'dgf-diff-code' }, row.text))
      }
      const marker = row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '
      return h('div', { className: 'dgf-diff-row', 'data-kind': row.type },
        h('span', { className: 'dgf-diff-ln' }, row.oldNo === null ? '' : String(row.oldNo)),
        h('span', { className: 'dgf-diff-ln' }, row.newNo === null ? '' : String(row.newNo)),
        h('span', { className: 'dgf-diff-code' }, `${marker}${row.text}`))
    }

    /**
     * 并排 diff 的一行：左列旧版本、右列新版本。
     *
     * @param props `row` 为 toSplitRows 的一行。
     * @returns React 节点。
     */
    function DiffSplitRow(props) {
      const row = props.row
      if (row.type === 'hunk' || row.type === 'meta') {
        return h('div', { className: 'dgf-diff-row dgf-diff-row-split', 'data-kind': row.type },
          h('span', { className: 'dgf-diff-code' }, row.text))
      }
      const left = row.type === 'pair' ? row.left : row
      const right = row.type === 'pair' ? row.right : row
      const leftMarker = left !== null && left.type === 'del' ? '-' : ' '
      const rightMarker = right !== null && right.type === 'add' ? '+' : ' '
      return h('div', { className: 'dgf-diff-row dgf-diff-row-split', 'data-kind': row.type },
        h('span', { className: 'dgf-diff-ln' }, left === null ? '' : String(left.oldNo)),
        h('span', {
          className: `dgf-diff-code${left !== null && left.type === 'del' ? ' dgf-diff-del' : ''}`,
        }, left === null ? '' : `${leftMarker}${left.text}`),
        h('span', { className: 'dgf-diff-ln' }, right === null ? '' : String(right.newNo)),
        h('span', {
          className: `dgf-diff-code${right !== null && right.type === 'add' ? ' dgf-diff-add' : ''}`,
        }, right === null ? '' : `${rightMarker}${right.text}`))
    }

    /**
     * 提交弹层里的单文件 diff 预览。纯函数。
     *
     * @param view 状态与回调（diffPath/diffData/diffError/diffLoading/diffMode 与回调）。
     * @param busy 是否正在执行其它操作。
     * @returns React 节点数组。
     */
    function renderDiffBlock(view, busy) {
      const diff = view.diffData ?? null
      const unifiedRows = diff === null ? [] : parseDiff(diff.patch)
      const splitRows = diff === null ? [] : toSplitRows(unifiedRows)
      const mode = view.diffMode === 'split' ? 'split' : 'unified'
      const head = h('div', { className: 'dgf-sec-head', key: 'diff-head' },
        h('div', { className: 'dgf-diff-head' },
          h('button', {
            className: 'dgf-btn',
            'data-variant': 'ghost',
            disabled: busy === true,
            onClick: view.onDiffBack,
          }, '← 返回'),
          h('span', { className: 'dgf-caption dgf-mono dgf-diff-title', title: view.diffPath }, view.diffPath)),
        h('div', { style: { display: 'flex', gap: '4px', flex: 'none' } },
          diff === null ? null : h('span', { className: 'dgf-chip', 'data-tone': 'ok' }, `+${diff.added}`),
          diff === null ? null : h('span', { className: 'dgf-chip', 'data-tone': 'fail' }, `-${diff.deleted}`),
          diff !== null && diff.binary ? h('span', { className: 'dgf-chip' }, '二进制') : null,
          h('button', {
            className: 'dgf-btn',
            'data-variant': mode === 'unified' ? 'primary' : 'ghost',
            onClick: () => view.onDiffMode('unified'),
          }, '统一'),
          h('button', {
            className: 'dgf-btn',
            'data-variant': mode === 'split' ? 'primary' : 'ghost',
            onClick: () => view.onDiffMode('split'),
          }, '并排')))
      const body = view.diffLoading === true
        ? h('div', { className: 'dgf-empty', key: 'diff-loading' }, '正在读取 diff…')
        : view.diffError !== null && view.diffError !== undefined
          ? h('div', { className: 'dgf-alert', key: 'diff-error' }, String(view.diffError))
          : diff === null
            ? null
            : diff.binary
              ? h('div', { className: 'dgf-empty', key: 'diff-binary' }, '二进制文件，无法预览内容差异')
              : unifiedRows.length === 0
                ? h('div', { className: 'dgf-empty', key: 'diff-empty' }, '没有可展示的内容差异')
                : h('div', { className: 'dgf-diff', key: 'diff' },
                  (mode === 'split' ? splitRows : unifiedRows).map(row =>
                    mode === 'split'
                      ? h(DiffSplitRow, { key: row.key, row })
                      : h(DiffUnifiedRow, { key: row.key, row })))
      const truncated = diff !== null && diff.truncated === true
        ? h('div', { className: 'dgf-confirm-hint', key: 'diff-truncated' }, 'diff 太大，只显示前面部分')
        : null
      return [head, body, truncated]
    }

    /**
     * 顶部 HUD：状态灯、品牌与页签。
     *
     * @param props 当前页签、状态灯与切换回调。
     * @returns React 节点。
     */
    function Hud(props) {
      return h('div', { className: 'dgf-hud' },
        h('div', { className: 'dgf-brand' },
          h('span', { className: 'dgf-led', 'data-state': props.led }),
          h('span', { className: 'dgf-brand-name' }, 'Git Flow')),
        h('div', { className: 'dgf-tabs', style: { flex: '0 0 auto' } },
          h('button', {
            className: 'dgf-tab',
            'data-on': props.tab === 'run' ? 'true' : 'false',
            onClick: props.onRunTab,
          }, '执行'),
          h('button', {
            className: 'dgf-tab',
            'data-on': props.tab === 'edit' ? 'true' : 'false',
            onClick: props.onEditTab,
          }, '指令')))
    }

    /**
     * 分支选择器：可点选的下拉 + 可输入过滤 + 允许手填。
     *
     * 步骤里的「来源 / 目标」既可能是指令变量（`{feature}`），也可能是仓库里现有的
     * 分支，还可能是这次要新建、暂时不存在的分支。所以三样都要能用：下拉点选、
     * 输入过滤、直接手打。
     *
     * @param props `value`、`variables`（指令变量）、`branches`（仓库分支）、`onChange`。
     * @returns React 节点。
     */
    function BranchPicker(props) {
      const { value, variables, branches, onChange, placeholder } = props
      // 打开状态、过滤词、浮层位置都是本组件私有的。
      const [open, setOpen] = React.useState(false)
      const [query, setQuery] = React.useState('')
      const [rect, setRect] = React.useState(null)

      const options = [
        ...variables.map(variable => ({
          value: `{${variable.key}}`,
          label: variable.label,
          hint: `{${variable.key}}`,
          kind: 'var',
        })),
        ...branches.map(name => ({ value: name, label: '', hint: name, kind: 'branch' })),
      ]
      const keyword = query.trim().toLowerCase()
      const filtered = keyword === ''
        ? options
        : options.filter(option =>
          option.value.toLowerCase().includes(keyword) || option.label.toLowerCase().includes(keyword))

      const isVariable = /^\{[A-Za-z0-9_]+\}$/.test(value)
      const isBranch = !isVariable && branches.includes(value)
      const kindChip = isVariable
        ? h('span', { className: 'dgf-chip', 'data-tone': 'kind' }, '变量')
        : isBranch
          ? h('span', { className: 'dgf-chip', 'data-tone': 'ok' }, '分支')
          : value.trim() === ''
            ? null
            : h('span', { className: 'dgf-chip' }, '手填')

      /**
       * 记录输入框位置并展开浮层。
       *
       * 面板本身是可滚动的，绝对定位的下拉会被滚动容器裁掉，所以浮层用固定定位，
       * 位置取自输入框当前的视口坐标；下方空间不够时向上翻。
       *
       * @param element 输入框元素。
       */
      const openAt = (element) => {
        if (element === null || element === undefined) {
          setOpen(true)
          return
        }
        const box = element.getBoundingClientRect()
        const below = window.innerHeight - box.bottom
        const flip = below < 170 && box.top > 190
        setRect({ left: box.left, width: box.width, top: flip ? undefined : box.bottom + 4, bottom: flip ? window.innerHeight - box.top + 4 : undefined })
        setQuery('')
        setOpen(true)
      }

      return h('div', { className: 'dgf-picker' },
        h('div', { className: 'dgf-picker-field' },
          h('input', {
            className: cx('dgf-input', 'dgf-grow'),
            value,
            placeholder,
            onFocus: event => openAt(event.currentTarget),
            onChange: event => {
              onChange(event.target.value)
              setQuery(event.target.value)
              if (rect === null) openAt(event.currentTarget)
              else setOpen(true)
            },
            onBlur: () => {
              setTimeout(() => setOpen(false), 140)
            },
          }),
          h('button', {
            type: 'button',
            className: 'dgf-picker-caret',
            title: '选择变量或分支',
            onMouseDown: event => event.preventDefault(),
            onClick: event => {
              if (open) {
                setOpen(false)
                return
              }
              openAt(reactCurrentInput(event))
            },
          }, '▾'),
          kindChip),
        open && rect !== null
          ? h('div', {
            className: 'dgf-picker-list',
            style: {
              position: 'fixed',
              left: `${rect.left}px`,
              width: `${rect.width}px`,
              ...(rect.top === undefined ? { bottom: `${rect.bottom}px` } : { top: `${rect.top}px` }),
            },
          },
          filtered.length === 0
            ? h('div', { className: 'dgf-picker-empty' }, '没有匹配项，可直接输入')
            : null,
          filtered.map(option => h('button', {
            key: `${option.kind}:${option.value}`,
            type: 'button',
            className: 'dgf-picker-item',
            onMouseDown: event => event.preventDefault(),
            onClick: () => {
              onChange(option.value)
              setOpen(false)
            },
          },
          h('span', { className: 'dgf-picker-hint' }, option.hint),
          option.label ? h('span', { className: 'dgf-picker-label' }, option.label) : null)))
          : null)
    }

    /**
     * 取下拉按钮所在的选择器元素里的输入框。
     *
     * @param event 点击事件。
     * @returns 输入框元素，拿不到时返回 undefined。
     */
    function reactCurrentInput(event) {
      const wrapper = event && event.currentTarget ? event.currentTarget.parentElement : null
      return wrapper ? wrapper.querySelector('input') : undefined
    }

    /**
     * 分支列表的行数据。
     *
     * 本地分支带最新提交与领先/落后数量；只在远端存在的分支标记 remote，
     * 切过去时由服务端创建本地跟踪分支。
     *
     * @param repo 仓库状态。
     * @returns 行数组。
     */
    function branchRows(repo) {
      if (!repo || !Array.isArray(repo.branches)) return []
      const locals = repo.branches.map(item => ({
        name: item.name,
        remote: false,
        current: item.name === repo.current,
        ahead: typeof item.ahead === 'number' ? item.ahead : 0,
        behind: typeof item.behind === 'number' ? item.behind : 0,
        subject: typeof item.subject === 'string' ? item.subject : '',
      }))
      const seen = new Set(locals.map(row => row.name))
      const remotes = []
      for (const name of repo.remoteBranches ?? []) {
        if (typeof name !== 'string' || name === '' || seen.has(name)) continue
        seen.add(name)
        remotes.push({ name, remote: true, current: false, ahead: 0, behind: 0, subject: '' })
      }
      return [...locals, ...remotes]
    }

    /**
     * 把分支名按 `/` 拆成目录树：带前缀的分支折叠到目录里，叶子只显示最后一段。
     *
     * 目录与叶子按名称排序；目录节点带子孙分支数，叶子节点保留完整行数据
     * （切换、右键执行都用完整分支名）。
     *
     * @param repo 仓库状态。
     * @returns 根层节点数组。
     */
    function branchTree(repo) {
      /** 新建一个目录节点。 */
      const makeDir = (name, path) => ({ kind: 'dir', name, path, dirs: new Map(), leaves: new Map() })
      const root = makeDir('', '')
      for (const row of branchRows(repo)) {
        const segments = row.name.split('/').filter(segment => segment !== '')
        if (segments.length === 0) continue
        const leaf = segments.pop()
        let node = root
        let path = ''
        for (const segment of segments) {
          path = path === '' ? segment : `${path}/${segment}`
          let dir = node.dirs.get(segment)
          if (dir === undefined) {
            dir = makeDir(segment, path)
            node.dirs.set(segment, dir)
          }
          node = dir
        }
        node.leaves.set(leaf, { kind: 'branch', label: leaf, row })
      }
      /** 排序并展开成可渲染节点；目录的 count 是子孙分支总数。 */
      const materialize = node => {
        // 先列目录（按名字排序），再把这一层没有目录的分支排在后面，
        // 避免出现“目录 / 单分支 / 目录”这种夹心顺序。
        const dirs = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b))
        const leaves = [...node.leaves.keys()].sort((a, b) => a.localeCompare(b))
        return [
          ...dirs.map(name => {
            const dir = node.dirs.get(name)
            const children = materialize(dir)
            const count = children.reduce((sum, child) => sum + (child.kind === 'dir' ? child.count : 1), 0)
            return { kind: 'dir', name, path: dir.path, count, children }
          }),
          ...leaves.map(name => node.leaves.get(name)),
        ]
      }
      return materialize(root)
    }

    /**
     * 收集树里所有目录的路径，用于「展开全部 / 收起全部」。
     *
     * @param nodes 树节点数组。
     * @param out 收集结果。
     * @returns 目录路径数组。
     */
    function collectDirPaths(nodes, out = []) {
      for (const node of nodes) {
        if (node.kind !== 'dir') continue
        out.push(node.path)
        collectDirPaths(node.children, out)
      }
      return out
    }

    /**
     * 目录图标：展开与收起用不同形状，替代早期的尖角符号。
     *
     * @param props `open` 是否展开。
     * @returns React 节点。
     */
    function FolderIcon(props) {
      const open = props.open === true
      return h('svg', {
        className: 'dgf-folder-icon',
        viewBox: '0 0 16 16',
        width: '12',
        height: '12',
        'data-open': open ? 'true' : 'false',
        'aria-hidden': 'true',
        focusable: 'false',
      },
      open
        ? [
          h('path', {
            key: 'back',
            d: 'M1.75 4.25A1.25 1.25 0 0 1 3 3h3.1l1.4 1.6H13a1.25 1.25 0 0 1 1.25 1.25v1.4H1.75z',
          }),
          h('path', {
            key: 'front',
            d: 'M1.74 7.25h12.62l-1.3 4.6A1.25 1.25 0 0 1 11.85 13H3a1.25 1.25 0 0 1-1.26-1.4z',
          }),
        ]
        : h('path', {
          key: 'closed',
          d: 'M1.75 4.25A1.25 1.25 0 0 1 3 3h3.1l1.4 1.6H13a1.25 1.25 0 0 1 1.25 1.25v5.9A1.25 1.25 0 0 1 13 13H3a1.25 1.25 0 0 1-1.25-1.25z',
        }))
    }

    /**
     * 分支列表：按 `/` 折叠成目录树，左键切换当前分支，右键弹出「用指令执行」菜单。
     *
     * 当前分支所在的目录链默认展开，其它目录默认收起；点目录行切换展开状态，
     * 右上角按钮一次展开或收起全部。
     *
     * @param props `repo`、`busy`、`onSwitch`、`onMenu`。
     * @returns React 节点。
     */
    function BranchList(props) {
      const { repo, busy, onSwitch, onMenu } = props
      const tree = branchTree(repo)
      const current = repo && typeof repo.current === 'string' ? repo.current : ''
      const total = tree.reduce((sum, node) => sum + (node.kind === 'dir' ? node.count : 1), 0)
      const dirPaths = collectDirPaths(tree)
      // 当前分支的祖先目录路径；用于初始展开和切换分支后自动展开。
      const ancestorPaths = current.split('/').slice(0, -1).map((segment, index, all) => all.slice(0, index + 1).join('/'))
      const [expanded, setExpanded] = React.useState(() => new Set(ancestorPaths))
      React.useEffect(() => {
        setExpanded(prev => {
          const next = new Set(prev)
          for (const path of ancestorPaths) next.add(path)
          return next
        })
        // ancestorPaths 由 current 派生，依赖 current 即可。
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [current])
      const allOpen = dirPaths.length > 0 && dirPaths.every(path => expanded.has(path))
      const inProgress = repo && repo.inProgress !== null && repo.inProgress !== undefined
      const dirty = repo && typeof repo.dirtyCount === 'number' && repo.dirtyCount > 0
      const state = inProgress
        ? { tone: 'fail', text: '不可切换' }
        : dirty
          ? { tone: 'skip', text: '有未提交改动' }
          : { tone: 'ok', text: '可切换' }

      /** 展开/收起一个目录。 */
      const toggleDir = path => setExpanded(prev => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      })

      /** 全部展开 / 全部收起。 */
      const toggleAll = () => setExpanded(allOpen ? new Set() : new Set(dirPaths))

      /** 按深度缩进，目录与叶子共用。 */
      const indent = depth => ({ paddingLeft: `${6 + depth * 12}px` })

      /** 递归渲染树节点。 */
      const renderNodes = (nodes, depth) => nodes.flatMap(node => {
        if (node.kind === 'branch') {
          const row = node.row
          return [h('button', {
            key: `b:${row.name}`,
            type: 'button',
            className: 'dgf-branch',
            style: indent(depth),
            'data-on': row.current ? 'true' : 'false',
            'data-remote': row.remote ? 'true' : 'false',
            disabled: busy === true,
            title: row.remote
              ? `${row.name}（只在远端存在，切换时创建本地跟踪分支）`
              : (row.subject || row.name),
            onClick: () => {
              if (row.current) return
              onSwitch(row.name)
            },
            onContextMenu: event => {
              event.preventDefault()
              onMenu(row.name, event)
            },
          },
          h('span', { className: 'dgf-branch-name', title: row.name }, node.label),
          row.current ? h('span', { className: 'dgf-chip', 'data-tone': 'ok' }, '当前') : null,
          row.remote ? h('span', { className: 'dgf-chip' }, '远端') : null,
          h('span', { className: 'dgf-branch-meta' },
            row.remote
              ? '右键用指令执行'
              : [row.ahead > 0 ? `↑${row.ahead}` : '', row.behind > 0 ? `↓${row.behind}` : '',
                row.subject].filter(Boolean).join(' · ')))]
        }
        const open = expanded.has(node.path)
        return [h('div', {
          key: `d:${node.path}`,
          className: 'dgf-group',
          'data-collapsed': open ? 'false' : 'true',
        },
        h('button', {
          type: 'button',
          className: 'dgf-group-head',
          style: indent(depth),
          title: `${node.path}/（${node.count} 个分支）`,
          onClick: () => toggleDir(node.path),
          onContextMenu: event => event.preventDefault(),
        },
        h(FolderIcon, { open }),
        h('span', { className: 'dgf-group-name' }, node.name),
        h('span', { className: 'dgf-group-count' }, String(node.count))),
        open ? h('div', { className: 'dgf-group-children' }, renderNodes(node.children, depth + 1)) : null)]
      })

      return h('div', { className: 'dgf-sec' },
        h('div', { className: 'dgf-sec-head' },
          h('span', { className: 'dgf-sec-title' }, `分支 · ${total}`),
          h('div', { style: { display: 'flex', gap: '4px' } },
            h('span', { className: 'dgf-chip dgf-keep-case', 'data-tone': 'ok' }, current ? `当前 ${current}` : '游离 HEAD'),
            h('span', { className: 'dgf-chip', 'data-tone': state.tone }, state.text))),
        total === 0
          ? h('div', { className: 'dgf-empty' }, '没有可用分支')
          : h('div', { className: 'dgf-branches' }, renderNodes(tree, 0)),
        dirPaths.length === 0
          ? null
          : h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
            h('button', {
              className: 'dgf-btn',
              'data-variant': 'ghost',
              style: { flex: 'none', padding: '2px 6px', fontSize: '9px' },
              title: allOpen ? '收起所有目录' : '展开所有目录',
              onClick: toggleAll,
            }, allOpen ? '收起全部' : '展开全部')))
    }

    /**
     * 分支右键菜单：选指令执行，或切换到这个分支。
     *
     * 用全屏透明遮罩承载「点击外部关闭」，菜单本身固定定位，位置按视口夹紧。
     *
     * @param props `branch`、`x`、`y`、`templates`、`current` 与回调。
     * @returns React 节点。
     */
    function BranchMenu(props) {
      const { branch, x, y, templates, current, onPickTemplate, onSwitch, onClose } = props
      const width = 232
      const height = Math.min(320, 92 + (templates ?? []).length * 30)
      const left = Math.max(6, Math.min(x, (window.innerWidth || 0) - width - 6))
      const top = Math.max(6, Math.min(y, (window.innerHeight || 0) - height - 6))
      return h('div', {
        className: 'dgf-menu-mask',
        onClick: onClose,
        onContextMenu: event => {
          event.preventDefault()
          onClose()
        },
      },
      h('div', {
        className: 'dgf-menu',
        style: { left: `${left}px`, top: `${top}px` },
        onClick: event => event.stopPropagation(),
      },
      h('div', { className: 'dgf-menu-title dgf-keep-case' }, `分支 ${branch}`),
      h('div', { className: 'dgf-menu-title' }, '用指令执行'),
      templates === null || templates === undefined || templates.length === 0
        ? h('div', { className: 'dgf-caption', style: { padding: '2px 8px' } },
          '还没有指令，去「指令」页签新建')
        : templates.map(template => h('button', {
          key: template.id,
          type: 'button',
          className: 'dgf-menu-item',
          disabled: template.invalid !== undefined && template.invalid !== null && template.invalid !== '',
          title: template.invalid ? `指令有问题：${template.invalid}` : `用「${template.name}」执行`,
          onClick: () => onPickTemplate(template),
        },
        h('span', { className: 'dgf-menu-item-text' }, template.name),
        template.invalid ? h('span', { className: 'dgf-chip', 'data-tone': 'fail' }, '有问题') : null)),
      h('div', { className: 'dgf-menu-sep' }),
      h('button', {
        type: 'button',
        className: 'dgf-menu-item',
        disabled: branch === current,
        onClick: () => onSwitch(branch),
      }, h('span', { className: 'dgf-menu-item-text' },
        branch === current ? '已在这个分支' : '切换到此分支'))))
    }

    /**
     * 一行变量输入。
     *
     * @param props 变量声明、当前值、分支名与变更回调。
     * @returns React 节点。
     */
    function VariableRow(props) {
      const { variable, value, branches, onChange } = props
      let control
      if (variable.kind === 'pick') {
        const options = branches.filter(name => matches(name, variable.pattern))
        const known = options.includes(value)
        control = h('select', {
          className: cx('dgf-select', 'dgf-grow'),
          value,
          onChange: event => onChange(event.target.value),
        },
        h('option', { value: '' }, value === '' ? '— 选择分支 —' : '— 清空 —'),
        // 只有「当前值不在候选里」时才补一项，避免空值再生成一个空选项。
        value !== '' && !known ? h('option', { value }, value) : null,
        options.map(name => h('option', { key: name, value: name }, name)))
      } else {
        control = h('input', {
          className: cx('dgf-input', 'dgf-grow'),
          value,
          placeholder: variable.default || variable.label,
          onChange: event => onChange(event.target.value),
        })
      }
      const derived = variable.derive ? computeDerived(variable, { ...props.values, ...{ [variable.key]: value } }) : ''
      const isAuto = derived !== '' && derived === value
      return h('div', { className: 'dgf-var' },
        h('div', { className: 'dgf-field' },
          h('span', { className: 'dgf-field-label' }, variable.label),
          control,
          isAuto ? h('span', { className: 'dgf-chip', 'data-tone': 'auto', title: '随来源变量自动填写' }, '自动') : null))
    }

    /**
     * 步骤类型的中文短标签（徽标与动作文案共用）。
     *
     * @param kind 步骤类型。
     * @returns 徽标文案。
     */
    function stepKindLabel(kind) {
      return kind === 'create'
        ? '建分支'
        : kind === 'push'
          ? '推送'
          : kind === 'tag'
            ? '打标签'
            : kind === 'pull'
              ? '拉取'
              : kind === 'commit'
                ? '提交'
                : '合并'
    }

    /**
     * 这一步能不能勾「执行完推送」。
     *
     * 建分支、合并、打标签之后可以顺手推；推送/拉取/提交没有可推送的对象。
     *
     * @param kind 步骤类型。
     * @returns 是否显示推送勾选。
     */
    function stepPushable(kind) {
      return kind === 'create' || kind === 'merge' || kind === 'tag'
    }

    /**
     * 一步的流程片段：来源（或动作）、箭头、目标。
     *
     * 推送没有来源；拉取/提交只有一个动作对象，都不显示来源箭头。
     *
     * @param step 指令步骤。
     * @param source 解析后的来源。
     * @param target 解析后的目标。
     * @returns React 节点数组。
     */
    function stepFlow(step, source, target) {
      const kind = step.kind
      if (kind === 'pull') {
        return [
          h('span', { className: 'dgf-flow-src' }, '拉取'),
          h('span', { className: 'dgf-flow-dst' }, target),
        ]
      }
      if (kind === 'commit') {
        return [
          h('span', { className: 'dgf-flow-src' }, '提交：'),
          h('span', { className: 'dgf-flow-dst' }, target),
        ]
      }
      return [
        kind === 'push'
          ? h('span', { className: 'dgf-flow-src' }, '推送')
          : h('span', { className: 'dgf-flow-src' }, kind === 'create' || kind === 'tag' ? `从 ${source}` : source),
        kind === 'push' ? null : h('span', { className: 'dgf-flow-arrow' }, '▸'),
        h('span', { className: 'dgf-flow-dst' }, kind === 'tag' ? `标签 ${target}` : target),
      ]
    }

    /**
     * 顶部「上次执行失败」横幅。
     *
     * 记录来自服务端持久化：面板重开、应用重启后依然能看到上次为什么失败。
     *
     * @param props `record`、展开状态与三个回调。
     * @returns React 节点。
     */
    function LastFailureBanner(props) {
      const { record, open } = props
      if (!record) return null
      const when = typeof record.at === 'string' ? new Date(record.at) : null
      const timeText = when !== null && !Number.isNaN(when.getTime())
        ? when.toLocaleString('zh-CN', { hour12: false })
        : ''
      const stepLabel = typeof record.stepIndex === 'number' ? `第 ${record.stepIndex + 1} 步` : '某一步'
      const action = record.kind === 'push'
        ? `推送 ${record.target}`
        : record.kind === 'create'
          ? `从 ${record.source} 创建 ${record.target}`
          : record.kind === 'tag'
            ? `打标签 ${record.target}`
            : record.kind === 'pull'
              ? `拉取 ${record.target}`
              : record.kind === 'commit'
                ? `提交：${record.target}`
                : `${record.source} → ${record.target}`
      return h('div', { className: 'dgf-lastfail', role: 'alert' },
        h('div', { className: 'dgf-lastfail-title' }, '⚠ 上次执行失败'),
        h('div', { className: 'dgf-lastfail-meta' },
          [timeText, record.templateName, `${stepLabel}：${action}`].filter(Boolean).join(' · ')),
        h('div', { className: 'dgf-lastfail-msg' }, record.message || '未知错误'),
        h('div', { className: 'dgf-lastfail-actions' },
          h('button', { className: 'dgf-btn', onClick: props.onToggle }, open ? '收起详情' : '查看详情'),
          typeof record.stepIndex === 'number'
            ? h('button', {
              className: 'dgf-btn',
              'data-variant': 'primary',
              onClick: props.onRetry,
            }, '重试这一步')
            : null,
          h('button', {
            className: 'dgf-btn',
            'data-variant': 'ghost',
            onClick: props.onDismiss,
          }, '忽略')),
        open && record.output ? h('pre', { className: 'dgf-output' }, record.output) : null)
    }

    /**
     * 决定展示哪一条失败记录。
     *
     * 面板挂载时会异步读回服务端记录；如果这期间用户已经执行并产生了更新的失败，
     * 读回的旧值不能把它覆盖掉。按时间戳取新者：服务端更新时以服务端为准。
     *
     * @param previous 当前展示的记录（可能来自本地执行）。
     * @param last 服务端读回的记录。
     * @returns 应该展示的记录，或 null。
     */
    function pickLastFailure(previous, last) {
      const next = last && last.ok === false ? last : null
      if (previous === null || previous === undefined) return next
      const previousAt = Date.parse(previous.at ?? '')
      const lastAt = last ? Date.parse(last.at ?? '') : Number.NaN
      if (Number.isFinite(previousAt) && (!Number.isFinite(lastAt) || previousAt >= lastAt)) return previous
      return next
    }

    /**
     * 一个执行步骤的管线节点。
     *
     * @param props 步骤、下标、解析后的分支、状态与回调。
     * @returns React 节点。
     */
    function StepNode(props) {
      const { step, index, source, target, status, busy, showRun } = props
      const view = statusView(status ? status.status : 'todo')
      const state = status ? status.status : 'todo'
      const output = status && typeof status.output === 'string' ? status.output : ''
      // 默认展开失败步骤的原始输出：推送/拉取失败的真实原因都在这里。
      const [detail, setDetail] = React.useState(null)
      const showOutput = output !== '' && (detail === null ? state === 'failed' : detail)
      return h('div', { className: 'dgf-node-row' },
        h('span', { className: 'dgf-rail' }),
        h('span', { className: 'dgf-node', 'data-status': state }, String(index + 1)),
        h('div', { className: 'dgf-step', 'data-status': state },
          h('div', { className: 'dgf-step-top' },
            h('div', { style: { display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' } },
              h('span', { className: 'dgf-chip', 'data-tone': 'kind' }, stepKindLabel(step.kind)),
              h('span', { className: 'dgf-chip', 'data-tone': view.tone }, view.text),
              stepPushable(step.kind) && step.push ? h('span', {
                className: 'dgf-chip',
                'data-tone': 'push',
                title: step.kind === 'tag' ? '打完标签后推送该标签' : null,
              }, step.kind === 'tag' ? '推送标签' : '推送') : null),
            showRun === false
              ? null
              : h('button', {
                className: 'dgf-btn',
                disabled: busy === true,
                onClick: () => props.onRun(index),
              }, '执行')),
          h('div', { className: 'dgf-flow' }, ...stepFlow(step, source, target)),
          step.note ? h('div', { className: 'dgf-note' }, step.note) : null,
          status && status.message
            ? h('div', { className: 'dgf-result', 'data-status': state }, status.message)
            : null,
          status && Array.isArray(status.conflicts) && status.conflicts.length > 0
            ? h('div', { className: 'dgf-conflict-files' },
              status.conflicts.map(file => h('div', { key: file, className: 'dgf-conflict-file' }, file)))
            : null,
          output !== ''
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
              h('button', {
                className: 'dgf-btn',
                'data-variant': 'ghost',
                style: { alignSelf: 'flex-start' },
                title: '展开这一步的 git 原始输出',
                onClick: () => setDetail(!showOutput),
              }, showOutput ? '收起详情' : '查看详情'),
              showOutput ? h('pre', { className: 'dgf-output' }, output) : null)
            : null,
          // 冲突在外部解决并提交后，合并/变基已经结束，横幅会消失；
          // 这里明确告诉用户"接着点执行就行"，否则会以为流程断了。
          props.resumeHint === true
            ? h('div', { className: 'dgf-resume' },
              '✓ 冲突已处理完（合并已结束），点「执行」重跑这一步即可继续')
            : null))
    }

    /**
     * 终端风格的日志。
     *
     * @param props `log` 为 `{ ok, text }` 数组。
     * @returns React 节点。
     */
    function LogView(props) {
      if (!props.log || props.log.length === 0) return null
      return h('div', { className: 'dgf-log' },
        props.log.map((line, i) => h('div', {
          key: i,
          className: 'dgf-log-row',
          'data-ok': line.ok ? 'true' : 'false',
        },
        h('span', { className: 'dgf-log-mark' }, line.ok ? '✓' : '✗'),
        h('span', null, line.text))))
    }

    /** 提交图泳道配色：按泳道序号循环使用。 */
    const GRAPH_COLORS = [
      '#22d3ee', '#8b5cf6', '#34d399', '#fbbf24', '#fb7185', '#60a5fa', '#f472b6', '#a3e635',
      '#f97316', '#2dd4bf', '#c084fc', '#eab308', '#38bdf8', '#4ade80', '#f87171', '#a78bfa',
    ]
    /** 提交图行高（px）。 */
    const GRAPH_ROW_HEIGHT = 26
    /** 提交图每条泳道宽度（px）。 */
    const GRAPH_LANE_WIDTH = 12
    /**
     * 显示泳道数：只保留「主线」和「合并支线」两条，像 IDEA 的 Git 日志一样简洁。
     * 真实泳道可能更多，但全部映射到这两条上，避免一屏几十条线。
     */
    const GRAPH_VISIBLE_LANES = 2

    /**
     * 提交时间：今天/昨天显示时分，更早显示日期 + 时分（参照 Git 客户端的排版）。
     *
     * @param at Unix 秒。
     * @returns `今天 14:03` / `昨天 18:28` / `2026/11/6 18:16`；非法值返回空串。
     */
    function commitTime(at) {
      if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return ''
      const date = new Date(at * 1000)
      const pad = value => String(value).padStart(2, '0')
      const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
      const today = new Date()
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
      const startOfYesterday = startOfToday - 86400000
      if (date.getTime() >= startOfToday) return `今天 ${clock}`
      if (date.getTime() >= startOfYesterday) return `昨天 ${clock}`
      return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${clock}`
    }

    /**
     * 把 `git log --pretty=%D` 的引用串转成徽标信息。
     *
     * @param ref 引用串，如 `HEAD -> feat/x`、`tag: v1.0.1`、`origin/master`、`master`。
     * @returns `{ label, kind }`；kind 用于区分颜色。
     */
    function graphRefInfo(ref) {
      const text = String(ref)
      if (text.startsWith('HEAD -> ')) return { label: text.slice('HEAD -> '.length), kind: 'head' }
      if (text === 'HEAD') return { label: 'HEAD', kind: 'head' }
      if (text.startsWith('tag: ')) return { label: text.slice('tag: '.length), kind: 'tag' }
      if (text.startsWith('origin/')) return { label: text, kind: 'remote' }
      return { label: text, kind: 'branch' }
    }

    /**
     * 计算提交图的泳道与连线。
     *
     * 逐条分配泳道：已经被期望的提交沿原泳道；新出现的提交找空闲泳道；额外父提交
     * （合并）占用一条泳道。最后再根据父子关系生成连线，前端按行高画曲线。
     *
     * @param commits 提交数组（新→旧，父提交在后）。
     * @returns `{ rows, edges, laneCount }`。
     */
    function layoutCommitGraph(commits) {
      const rowOf = new Map(commits.map((commit, index) => [commit.hash, index]))
      const laneOf = new Map()
      const rows = []
      let lanes = []
      for (let row = 0; row < commits.length; row += 1) {
        const commit = commits[row]
        let lane = lanes.indexOf(commit.hash)
        if (lane === -1) {
          // 新的分支尖端从最右侧占用一条泳道，避免挤到别人的线上。
          lane = lanes.length
          lanes.push(commit.hash)
        }
        laneOf.set(commit.hash, lane)
        rows.push({ commit, row, lane })
        // 当前提交出列；它的第一个父提交接替这条泳道，其余父提交紧挨着插到右侧。
        // 分支结束（没有可继续的父提交）时，泳道直接回收，后面的泳道整体左移。
        lanes.splice(lane, 1)
        let insertAt = lane
        for (const parent of commit.parents) {
          if (!rowOf.has(parent) || lanes.includes(parent)) continue
          lanes.splice(insertAt, 0, parent)
          insertAt += 1
        }
      }

      const edges = []
      let laneCount = 0
      for (const item of rows) {
        const { commit, row, lane } = item
        laneCount = Math.max(laneCount, lane + 1)
        for (const parent of commit.parents) {
          const parentRow = rowOf.get(parent)
          const parentLane = laneOf.get(parent)
          if (parentRow === undefined || parentLane === undefined) continue
          laneCount = Math.max(laneCount, parentLane + 1)
          edges.push({ fromRow: row, fromLane: lane, toRow: parentRow, toLane: parentLane })
        }
      }
      return { rows, edges, laneCount }
    }

    /**
     * 提交图：画分叉/合并曲线、引用徽标、作者与相对时间。
     *
     * @param props `graph`、`loading`、`error` 与刷新回调。
     * @returns React 节点。
     */
    function CommitGraph(props) {
      const { graph, loading, error, onRefresh, onLoadMore, onScope } = props
      // graph.error 也可能带原因（例如路由返回的仓库错误），两处都认。
      const errorText = error !== null && error !== undefined
        ? error
        : graph && graph.error !== null && graph.error !== undefined
          ? graph.error
          : null
      const commits = graph && Array.isArray(graph.commits) ? graph.commits : []
      const layout = React.useMemo(() => layoutCommitGraph(commits), [commits])
      // 只画两条泳道：0=主线，1=合并支线；真实泳道的 2、3、4… 都压到支线上。
      const laneX = lane => Math.min(Math.max(lane, 0), GRAPH_VISIBLE_LANES - 1) * GRAPH_LANE_WIDTH
        + GRAPH_LANE_WIDTH / 2 + 2
      const graphWidth = GRAPH_VISIBLE_LANES * GRAPH_LANE_WIDTH + 4
      const graphHeight = layout.rows.length * GRAPH_ROW_HEIGHT
      // 颜色按真实泳道取，所以每个被合并的分支都有自己的颜色；
      // 几何上仍然只占「主线 / 合并支线」两个位置，保持简洁。
      const colorOf = lane => GRAPH_COLORS[Math.max(lane, 0) % GRAPH_COLORS.length]
      const headHash = graph && typeof graph.head === 'string' ? graph.head : ''
      const hasMore = graph !== null && graph !== undefined && graph.hasMore === true
      // 到接口上限后不再显示「加载更多」。
      const showMore = hasMore && props.canLoadMore !== false
      const mid = GRAPH_ROW_HEIGHT / 2

      const edges = layout.edges.map((edge, index) => {
        const x1 = laneX(edge.fromLane)
        const y1 = edge.fromRow * GRAPH_ROW_HEIGHT + mid
        const x2 = laneX(edge.toLane)
        const y2 = edge.toRow * GRAPH_ROW_HEIGHT + mid
        // 像 Git 客户端一样：分叉/汇入只在相邻行之间画一小段斜线，之后沿父泳道垂直向下，
        // 避免从合并点直接拉一条横跨多行的长斜线。
        const yNext = Math.min(y1 + GRAPH_ROW_HEIGHT, y2)
        const d = x1 === x2
          ? `M${x1} ${y1}L${x2} ${y2}`
          : `M${x1} ${y1}C${x1} ${y1 + GRAPH_ROW_HEIGHT * 0.35} ${x2} ${yNext - GRAPH_ROW_HEIGHT * 0.35} ${x2} ${yNext}L${x2} ${y2}`
        return h('path', {
          key: `edge:${index}`,
          d,
          fill: 'none',
          stroke: colorOf(Math.max(edge.fromLane, edge.toLane)),
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          opacity: 0.85,
        })
      })
      const dots = layout.rows.map(({ commit, row, lane }) => h('circle', {
        key: `dot:${commit.hash}`,
        cx: laneX(lane),
        cy: row * GRAPH_ROW_HEIGHT + mid,
        r: commit.hash === headHash ? 4.2 : 3.2,
        fill: colorOf(lane),
        stroke: '#05080d',
        strokeWidth: 1.4,
      }))

      const scope = props.scope === 'all' ? 'all' : 'head'
      return h('div', { className: 'dgf-sec dgf-graph-sec' },
        h('div', { className: 'dgf-sec-head' },
          h('span', { className: 'dgf-sec-title' }, `提交图 · ${commits.length}${hasMore ? '+' : ''}`),
          h('div', { style: { display: 'flex', gap: '2px', alignItems: 'center' } },
            h('button', {
              className: 'dgf-btn',
              'data-variant': scope === 'all' ? 'primary' : 'ghost',
              style: { padding: '2px 6px', fontSize: '9px' },
              title: '全部本地分支 + 标签 + HEAD（默认，和 Git 客户端一致）',
              onClick: () => onScope('all'),
            }, '全部'),
            h('button', {
              className: 'dgf-btn',
              'data-variant': scope === 'head' ? 'primary' : 'ghost',
              style: { padding: '2px 6px', fontSize: '9px' },
              title: '只看当前分支的历史',
              onClick: () => onScope('head'),
            }, '本分支'),
            loading === true ? h('span', { className: 'dgf-chip', 'data-tone': 'run' }, '读取中') : null,
            h('button', {
              className: 'dgf-btn',
              'data-variant': 'ghost',
              title: '重新读取提交图',
              disabled: loading === true,
              onClick: onRefresh,
            }, '↻'))),
        errorText !== null
          ? h('div', { className: 'dgf-alert' }, String(errorText))
          : commits.length === 0
            ? h('div', { className: 'dgf-empty' }, loading === true ? '正在读取提交图…' : '没有提交')
            : h('div', { className: 'dgf-graph' },
              h('div', { className: 'dgf-graph-body', style: { minHeight: `${graphHeight}px` } },
                h('svg', {
                  className: 'dgf-graph-svg',
                  width: String(graphWidth),
                  height: String(graphHeight),
                  viewBox: `0 0 ${graphWidth} ${graphHeight}`,
                  'aria-hidden': 'true',
                }, [...edges, ...dots]),
                layout.rows.map(({ commit, row }) => h('div', {
                  key: commit.hash,
                  className: 'dgf-graph-row',
                  'data-head': commit.hash === headHash ? 'true' : 'false',
                  style: { height: `${GRAPH_ROW_HEIGHT}px`, paddingLeft: `${graphWidth + 4}px` },
                  title: `${commit.hash.slice(0, 10)} · ${commit.author} · ${commitTime(commit.at)}`,
                },
                h('span', {
                  className: 'dgf-graph-subject',
                  title: commit.subject || '(无提交信息)',
                }, commit.subject || '(无提交信息)'),
                (commit.refs ?? []).length === 0
                  ? null
                  : h('span', { className: 'dgf-graph-refs' },
                    (commit.refs ?? []).slice(0, 3).map(ref => {
                      const info = graphRefInfo(ref)
                      return h('span', {
                        key: ref,
                        className: 'dgf-graph-ref',
                        'data-kind': info.kind,
                        title: ref,
                      }, info.label)
                    })),
                h('span', { className: 'dgf-graph-meta' },
                  h('span', { className: 'dgf-graph-time' }, commitTime(commit.at)),
                  h('span', { className: 'dgf-graph-hash' }, commit.hash.slice(0, 7)),
                  h('span', { className: 'dgf-graph-author', title: commit.author }, commit.author)))))),
        showMore
          ? h('div', { className: 'dgf-graph-more' },
            h('button', {
              className: 'dgf-btn',
              'data-variant': 'ghost',
              disabled: loading === true,
              onClick: onLoadMore,
            }, loading === true ? '加载中…' : '加载更多'))
          : null)
    }

    /**
     * 把一步解析成「从哪到哪」的中文说明，用于执行弹窗的流程预览。
     *
     * @param step 指令步骤。
     * @param values 变量取值。
     * @returns 说明文本。
     */
    function stepSummary(step, values) {
      const source = preview(step.source, values)
      const target = preview(step.target, values)
      return step.kind === 'push'
        ? `推送 ${target}`
        : step.kind === 'create'
          ? `从 ${source} 创建 ${target}`
          : step.kind === 'tag'
            ? `从 ${source} 打标签 ${target}`
            : step.kind === 'pull'
              ? `拉取 ${target}`
              : step.kind === 'commit'
                ? `提交：${target}`
                : `${source} → ${target}`
    }

    /**
     * 执行弹窗。
     *
     * prepare 阶段：参数表单 + 解析后的完整流程 + 执行/取消；
     * running/done 阶段：逐步状态、日志、冲突处理与失败重试。关闭后执行日志仍留在面板里。
     *
     * @param props 指令、阶段、变量取值、步骤状态与回调。
     * @returns React 节点。
     */
    function ExecutionModal(props) {
      const { template, phase, values, statuses, log, busy, repo, restore } = props
      const branches = repo && Array.isArray(repo.branches) ? repo.branches.map(item => item.name) : []
      const variables = template.variables ?? []
      const steps = template.steps ?? []
      const missing = variables.filter(variable => (values[variable.key] ?? '').trim() === '').length
      const commitOverrides = props.commitOverrides ?? {}
      const commitSteps = steps
        .map((step, index) => ({ step, index }))
        .filter(item => item.step.kind === 'commit')
        .map((item, order) => ({ ...item, order }))
      /** 显示/执行时用的提交说明：用户改过用改后的值，否则按指令内容和变量解析。 */
      const commitDisplay = step => (step.kind === 'commit' && commitOverrides[step.id] !== undefined
        ? commitOverrides[step.id]
        : preview(step.target, values))
      const commitBlank = commitSteps.some(item => commitDisplay(item.step).trim() === '')
      const displayStep = step => (step.kind === 'commit' && commitOverrides[step.id] !== undefined
        ? { ...step, target: commitOverrides[step.id] }
        : step)
      const doneCount = steps.filter(step => {
        const status = statuses[step.id]
        return status && (status.status === 'ok' || status.status === 'skipped')
      }).length
      const percent = steps.length === 0 ? 0 : Math.round((doneCount / steps.length) * 100)
      const failed = typeof props.failedIndex === 'number' && props.failedIndex >= 0
      const running = phase === 'running'
      const conflict = repo.inProgress !== null && repo.inProgress !== undefined

      const metaParts = [repo.root]
      if (props.branch) metaParts.push(`右键分支 ${props.branch}`)
      if (repo.current) metaParts.push(`当前 ${repo.current}`)

      const prepareBody = [
        h('div', { key: 'vars-head', className: 'dgf-sec-head' },
          h('span', { className: 'dgf-sec-title' }, '参数'),
          missing === 0
            ? h('span', { className: 'dgf-chip', 'data-tone': 'ok' }, '就绪')
            : h('span', { className: 'dgf-chip', 'data-tone': 'skip' }, `还有 ${missing} 个未填`)),
        h('div', { key: 'vars', className: 'dgf-exec-vars' },
          variables.length === 0
            ? h('div', { className: 'dgf-caption' }, '这个指令没有变量')
            : variables.map(variable => h(VariableRow, {
              key: variable.key,
              variable,
              values,
              value: values[variable.key] ?? '',
              branches,
              onChange: next => props.onValue(variable.key, next),
            }))),
        ...(commitSteps.length === 0
          ? []
          : [
            h('div', { key: 'commit-head', className: 'dgf-sec-head' },
              h('span', { className: 'dgf-sec-title' }, '提交说明'),
              commitBlank
                ? h('span', { className: 'dgf-chip', 'data-tone': 'fail' }, '需填写')
                : h('span', { className: 'dgf-chip', 'data-tone': 'ok' }, '可改')),
            ...commitSteps.map(item => {
              const override = commitOverrides[item.step.id]
              return h('div', { key: `commit:${item.step.id}`, className: 'dgf-field' },
                // 只有一个提交步骤时不再重复写「提交说明」：区块标题已经写过一次；
                // 多个提交步骤才用「第 N 步」区分。
                commitSteps.length > 1
                  ? h('span', { className: 'dgf-field-label' }, `第 ${item.order + 1} 步`)
                  : null,
                h('input', {
                  className: cx('dgf-input', 'dgf-grow'),
                  value: override !== undefined ? override : commitDisplay(item.step),
                  placeholder: '写这次提交的说明',
                  onChange: event => props.onCommitOverride(item.step.id, event.target.value),
                }),
                override !== undefined
                  ? h('span', { key: 'edited', className: 'dgf-chip', 'data-tone': 'kind' }, '已改')
                  : h('span', { key: 'auto', className: 'dgf-chip', 'data-tone': 'auto' }, '自动'),
                override !== undefined
                  ? h('button', {
                    key: 'reset',
                    type: 'button',
                    className: 'dgf-btn',
                    'data-variant': 'ghost',
                    style: { flex: 'none', padding: '2px 6px', fontSize: '9px' },
                    title: '恢复指令里的提交说明',
                    onClick: () => props.onCommitOverride(item.step.id, null),
                  }, '↺ 指令')
                  : null)
            }),
            h('div', { key: 'commit-hint', className: 'dgf-confirm-hint' },
              '默认取指令里的提交说明；直接修改只影响这次执行。清空后不会自动回填，可重新输入或点「↺ 指令」恢复'),
          ]),
        h('div', { key: 'flow-head', className: 'dgf-sec-head' },
          h('span', { className: 'dgf-sec-title' }, `流程 · ${steps.length} 步`),
          h('span', { className: 'dgf-meter-text' }, missing === 0 && !commitBlank ? '可执行' : '待填写')),
        h('div', { key: 'flow', className: 'dgf-confirm-steps' },
          steps.length === 0
            ? h('div', { className: 'dgf-caption' }, '这个指令还没有步骤，去「指令」页签添加')
            : steps.map((step, index) => h('div', { key: step.id, className: 'dgf-confirm-step' },
              h('span', { className: 'dgf-sha' }, `${index + 1}.`),
              h('span', { className: 'dgf-confirm-text' }, stepSummary(displayStep(step), values)),
              stepPushable(step.kind) && step.push
                ? h('span', { className: 'dgf-chip', 'data-tone': 'push' },
                  step.kind === 'tag' ? '推送标签' : '推送')
                : null))),
        h('label', { key: 'restore', className: 'dgf-toggle' },
          h('input', {
            type: 'checkbox',
            checked: restore,
            onChange: event => props.onToggleRestore(event.target.checked),
          }),
          h('span', null, '执行完切回原分支')),
        h('div', { key: 'hint', className: 'dgf-confirm-hint' },
          restore && repo.current
            ? `执行过程中会 checkout 到目标分支，完成后切回 ${repo.current}；已完成的分支与合并会自动跳过`
            : '执行过程中会 checkout 到目标分支，结束后停在最后一个分支；已完成的分支与合并会自动跳过'),
      ]

      const progressBody = [
        h('div', { key: 'progress-head', className: 'dgf-sec-head' },
          h('span', { className: 'dgf-sec-title' }, `流水线 · ${steps.length} 步`),
          h('span', { className: 'dgf-meter-text' }, `${doneCount}/${steps.length} · ${percent}%`)),
        h('div', { key: 'progress-bar', className: 'dgf-meter' },
          h('div', { className: 'dgf-meter-bar' },
            h('div', { className: 'dgf-meter-fill', style: { width: `${percent}%` } }))),
        h('div', { key: 'progress-steps', className: 'dgf-pipe' }, steps.map((step, index) => h(StepNode, {
          key: step.id,
          step,
          index,
          source: preview(step.source, values),
          target: preview(displayStep(step).target, values),
          status: statuses[step.id],
          busy,
          showRun: false,
        }))),
        h(LogView, { key: 'progress-log', log }),
        conflict
          ? h('div', { key: 'conflict' },
            h('div', { className: 'dgf-conflict-title' }, `⚠ ${repo.inProgress}`),
            (repo.conflicts ?? []).length > 0
              ? h('div', { className: 'dgf-conflict-files' },
                (repo.conflicts ?? []).map(file => h('div', { key: file, className: 'dgf-conflict-file' }, file)))
              : null,
            h('div', { className: 'dgf-conflict-hint' },
              (repo.conflicts ?? []).length > 0
                ? '在终端或编辑器里解决这些文件，然后 git add；解决后「继续」可用'
                : '冲突已全部暂存，可以点「继续」收尾'),
            h('div', { style: { display: 'flex', gap: '6px' } },
              h('button', {
                className: 'dgf-btn',
                'data-variant': 'primary',
                disabled: busy === true || (repo.conflicts ?? []).length > 0,
                onClick: props.onContinueMerge,
              }, '继续'),
              h('button', {
                className: 'dgf-btn',
                'data-variant': 'danger',
                disabled: busy === true,
                onClick: props.onAbortMerge,
              }, '中止')))
          : null,
      ]

      const actions = phase === 'prepare'
        ? [
          h('button', { key: 'cancel', className: 'dgf-btn', disabled: busy === true, onClick: props.onCancel }, '取消'),
          h('button', {
            key: 'run',
            className: 'dgf-btn',
            'data-variant': 'primary',
            disabled: busy === true || missing > 0 || commitBlank || steps.length === 0,
            onClick: props.onRun,
          }, busy === true ? '执行中…' : '执行'),
        ]
        : running
          ? [h('div', { key: 'running-hint', className: 'dgf-confirm-hint', style: { flex: 1 } },
            '执行中，跑完会自动停在结果页…')]
          : [
            failed
              ? h('button', {
                key: 'retry',
                className: 'dgf-btn',
                'data-variant': 'primary',
                disabled: busy === true,
                onClick: props.onRetry,
              }, '从失败处重试')
              : null,
            h('button', { key: 'close', className: 'dgf-btn', disabled: busy === true, onClick: props.onClose }, '关闭'),
          ]

      return h('div', { className: 'dgf-confirm-mask' },
        h('div', {
          className: 'dgf-confirm',
          ...(failed ? {} : { 'data-tone': 'commit' }),
        },
        h('div', { className: 'dgf-confirm-title' },
          h('span', { className: 'dgf-led', 'data-state': failed ? 'bad' : running ? 'warn' : 'ok' }),
          phase === 'prepare'
            ? `用「${template.name}」执行`
            : `「${template.name}」${running ? '执行中' : failed ? '执行失败' : '执行完成'}`),
        h('div', { className: 'dgf-confirm-meta' }, metaParts.join(' · ')),
        h('div', { className: 'dgf-exec-body' }, phase === 'prepare' ? prepareBody : progressBody),
        h('div', { className: 'dgf-confirm-actions' }, ...actions)))
    }

    /**
     * 渲染「执行」页签。纯函数。
     *
     * 面板只负责仓库状态与分支列表；执行入口在分支右键菜单，参数与进度都在弹窗里。
     *
     * @param view 状态与回调。
     * @returns React 节点。
     */
    function renderRun(view) {
      const { repo, templates, busy, log, error } = view

      if (error !== null && repo === null) {
        return h('div', { className: 'dgf-root' },
          h('div', { className: 'dgf-scroll', style: { paddingTop: '12px' } },
            h('div', { className: 'dgf-alert' }, error),
            h('button', { className: 'dgf-btn', onClick: view.onRefresh }, '重试')))
      }
      if (repo === null) {
        return h('div', { className: 'dgf-root' },
          h('div', { className: 'dgf-empty' }, '正在读取仓库状态…'))
      }
      if (repo.isRepo === false) {
        return h('div', { className: 'dgf-root' },
          h('div', { className: 'dgf-scroll', style: { paddingTop: '12px' } },
            h('div', { className: 'dgf-alert' }, repo.error || '当前目录不是 git 仓库'),
            h('button', { className: 'dgf-btn', onClick: view.onRefresh }, '重试')))
      }

      const dirty = repo.dirtyCount > 0
      const untracked = (repo.untrackedCount ?? 0) > 0
      const canCommit = dirty || untracked
      const merging = repo.inProgress !== null && repo.inProgress !== undefined
      // 提交弹层：null 表示文件列表还在读取；error 时列表区域换成错误提示。
      const commitFiles = Array.isArray(view.commitFiles) ? view.commitFiles : null
      const commitSelected = Array.isArray(view.commitSelected) ? view.commitSelected : []
      const commitSelectedSet = new Set(commitSelected)
      const commitListError = view.commitFilesError ?? null
      const canSubmitCommit = commitFiles !== null && commitListError === null
        && commitSelected.length > 0 && (view.commitMessage ?? '').trim() !== ''

      // 提交弹层：diff 预览模式下整块换成对比视图，否则是文件勾选列表。
      const commitFilesBlock = view.diffPath !== null && view.diffPath !== undefined
        ? renderDiffBlock(view, busy)
        : [
          h('div', { className: 'dgf-sec-head', key: 'commit-files-head' },
            h('span', { className: 'dgf-sec-title' },
              commitFiles === null
                ? '改动文件'
                : `改动文件 · 已选 ${commitSelected.length}/${commitFiles.length}`),
            h('div', { style: { display: 'flex', gap: '4px' } },
              h('button', {
                className: 'dgf-btn',
                'data-variant': 'ghost',
                disabled: busy === true || commitFiles === null || commitFiles.length === 0,
                onClick: view.onCommitSelectAll,
              }, '全选'),
              h('button', {
                className: 'dgf-btn',
                'data-variant': 'ghost',
                disabled: busy === true || commitSelected.length === 0,
                onClick: view.onCommitSelectNone,
              }, '全不选'))),
          commitFiles === null
            ? h('div', { className: 'dgf-empty', key: 'commit-files-loading' }, '正在读取改动文件…')
            : commitListError !== null
              ? null
              : h('div', { className: 'dgf-files', key: 'commit-files' },
                commitFiles.length === 0
                  ? h('div', { className: 'dgf-empty' }, '工作区没有可提交的改动')
                  : commitFiles.map(file => h('div', {
                    key: file.path,
                    className: 'dgf-file',
                  },
                  h('label', { className: 'dgf-file-main', title: file.path },
                    h('input', {
                      type: 'checkbox',
                      checked: commitSelectedSet.has(file.path),
                      disabled: busy === true,
                      onChange: () => view.onCommitToggle(file.path),
                    }),
                    h('span', { className: 'dgf-file-badge', 'data-status': file.status },
                      changeLabel(file.status)),
                    h('span', { className: 'dgf-file-path' }, file.path)),
                  h('button', {
                    className: 'dgf-file-diff',
                    title: '查看这个文件的对比 diff',
                    disabled: busy === true,
                    onClick: () => view.onDiffOpen(file.path),
                  }, 'diff')))),
          commitListError !== null
            ? h('div', { className: 'dgf-alert', key: 'commit-files-error' },
              h('span', null, commitListError),
              h('button', {
                className: 'dgf-btn',
                disabled: busy === true,
                onClick: view.onCommitReload,
              }, '重试'))
            : null,
          view.commitFilesTruncated === true
            ? h('div', { className: 'dgf-confirm-hint', key: 'commit-files-truncated' },
              '改动太多，只列出前 500 项；未列出的改动不会提交')
            : null,
        ]

      return h('div', { className: 'dgf-root' },
        h(Hud, {
          tab: 'run',
          led: error !== null ? 'bad' : canCommit ? 'warn' : 'ok',
          onRunTab: view.onRunTab,
          onEditTab: view.onEditTab,
        }),
        h('div', { className: 'dgf-scroll' },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
            h('span', { className: 'dgf-caption dgf-mono', title: repo.root }, repo.root),
            h('div', { style: { display: 'flex', gap: '4px' } },
              h('button', { className: 'dgf-btn', 'data-variant': 'ghost', onClick: view.onRefresh }, '刷新'),
              h('button', {
                className: 'dgf-btn',
                'data-variant': 'ghost',
                title: '从 origin 拉取，更新各分支的落后情况（只 fetch，不改工作区）',
                disabled: busy === true,
                onClick: view.onPull,
              }, '拉取'),
              h('button', {
                className: 'dgf-btn',
                'data-variant': 'ghost',
                title: merging
                  ? '合并/变基未完成：先点「继续」或「中止」再提交'
                  : canCommit
                    ? '提交工作区里的改动（可勾选文件，只提交到本地不推送）'
                    : '工作区没有需要提交的改动',
                disabled: busy === true || merging || !canCommit,
                onClick: view.onCommitOpen,
              }, '提交'))),
          h('div', { className: 'dgf-caption' },
            repo.current ? `当前 ${repo.current}` : '游离 HEAD',
            dirty ? ` · 已跟踪改动 ${repo.dirtyCount}` : (untracked ? '' : ' · 工作区干净'),
            untracked ? ` · 未跟踪 ${repo.untrackedCount}` : ''),

          // 分支列表：左键切换，右键选指令执行。
          h(BranchList, {
            repo,
            busy,
            onSwitch: view.onSwitchBranch,
            onMenu: view.onBranchMenu,
          }),

          // 提交图：分支下方的历史/分叉/合并视图（只读）。
          h(CommitGraph, {
            graph: view.graph ?? null,
            loading: view.graphLoading === true,
            error: view.graphError ?? null,
            scope: view.graphScope === 'head' ? 'head' : 'all',
            onScope: view.onGraphScope,
            onRefresh: view.onRefreshGraph,
            onLoadMore: view.onLoadMoreGraph,
            canLoadMore: view.graphCanLoadMore !== false,
          }),

          // 上次执行失败：服务端持久化，重开面板/重启应用后仍然提示。
          h(LastFailureBanner, {
            record: view.lastFailure ?? null,
            open: view.failureOpen === true,
            onToggle: view.onToggleFailure,
            onDismiss: view.onDismissFailure,
            onRetry: view.onRetryFailure,
          }),

          // 合并停在冲突里：给出文件清单与两个出口，不用切终端也能收尾。
          repo.inProgress !== null && repo.inProgress !== undefined
            ? h('div', { className: 'dgf-conflict' },
              h('div', { className: 'dgf-conflict-title' }, `⚠ ${repo.inProgress}`),
              (repo.conflicts ?? []).length > 0
                ? h('div', { className: 'dgf-conflict-files' },
                  repo.conflicts.map(file => h('div', { key: file, className: 'dgf-conflict-file' }, file)))
                : null,
              h('div', { className: 'dgf-conflict-hint' },
                (repo.conflicts ?? []).length > 0
                  ? '在终端或编辑器里解决这些文件，然后 git add。面板每 3 秒自动检测一次，解决后「继续」即可点；也可点「刷新」立即检查。'
                  : '冲突已全部暂存，可以点「继续」收尾。'),
              h('div', { style: { display: 'flex', gap: '6px' } },
                h('button', {
                  className: 'dgf-btn',
                  'data-variant': 'primary',
                  // 还有未解决文件时禁用；状态由 3 秒轮询自动更新，不必手点刷新。
                  disabled: busy === true || (repo.conflicts ?? []).length > 0,
                  title: (repo.conflicts ?? []).length > 0
                    ? '还有未解决的文件：解决后 git add，面板会自动检测'
                    : '冲突已全部暂存，点这里收尾',
                  onClick: view.onContinueMerge,
                }, '继续'),
                h('button', {
                  className: 'dgf-btn',
                  'data-variant': 'danger',
                  disabled: busy === true,
                  onClick: view.onAbortMerge,
                }, '中止')))
            : null,

          h(LogView, { log })),

        // 提交对话框：勾选要提交的文件、填提交说明后提交到当前分支。
        view.commitOpen === true
          ? h('div', { className: 'dgf-confirm-mask' },
            h('div', { className: 'dgf-confirm', 'data-tone': 'commit' },
              h('div', { className: 'dgf-confirm-title' },
                h('span', { className: 'dgf-led', 'data-state': 'warn' }),
                '提交工作区改动'),
              h('div', { className: 'dgf-confirm-meta' },
                `${repo.root}${repo.current ? ` · 当前 ${repo.current}` : ''}`),
              commitFilesBlock,
              h('textarea', {
                className: 'dgf-commit-input',
                value: view.commitMessage ?? '',
                placeholder: '提交说明（必填，可用多行，例如：fix: 修正登录跳转）',
                autoFocus: true,
                rows: 3,
                onChange: event => view.onCommitMessage(event.target.value),
                onKeyDown: event => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault()
                    if (busy !== true && canSubmitCommit) view.onCommitSubmit()
                  }
                },
              }),
              view.commitError ? h('div', { className: 'dgf-alert' }, view.commitError) : null,
              h('div', { className: 'dgf-confirm-hint' },
                canSubmitCommit
                  ? 'Ctrl/⌘ + Enter 提交；只提交勾选的文件，不推送'
                  : '勾选至少一个文件并填写提交说明'),
              h('div', { className: 'dgf-confirm-actions' },
                h('button', {
                  className: 'dgf-btn',
                  disabled: busy === true,
                  onClick: view.onCommitCancel,
                }, '取消'),
                h('button', {
                  className: 'dgf-btn',
                  'data-variant': 'primary',
                  disabled: busy === true || !canSubmitCommit,
                  onClick: view.onCommitSubmit,
                }, busy === true ? '提交中…' : '提交'))))
          : null,

        // 右键菜单：选指令执行，或切换到这个分支。
        view.menu === null || view.menu === undefined
          ? null
          : h(BranchMenu, {
            branch: view.menu.branch,
            x: view.menu.x,
            y: view.menu.y,
            templates,
            current: repo.current,
            onPickTemplate: view.onPickTemplate,
            onSwitch: branch => {
              view.onCloseMenu()
              view.onSwitchBranch(branch)
            },
            onClose: view.onCloseMenu,
          }),

        // 执行弹窗：先确认参数与流程，执行中逐步显示状态，失败可从失败处重试。
        view.execution === null || view.execution === undefined
          || view.executionTemplate === null || view.executionTemplate === undefined
          ? null
          : h(ExecutionModal, {
            template: view.executionTemplate,
            branch: view.execution.branch,
            phase: view.execution.phase,
            values: view.values ?? {},
            statuses: view.statuses ?? {},
            log,
            busy,
            repo,
            restore: view.restoreBranch !== false,
            failedIndex: typeof view.failedIndex === 'number' ? view.failedIndex : -1,
            commitOverrides: view.commitOverrides ?? {},
            onCommitOverride: view.onCommitOverride,
            onValue: view.onValue,
            onToggleRestore: view.onRestoreBranch,
            onRun: view.onRun,
            onRetry: view.onRetryRun,
            onCancel: view.onCancelExecution,
            onClose: view.onCloseExecution,
            onAbortMerge: view.onAbortMerge,
            onContinueMerge: view.onContinueMerge,
          }))
    }

    /**
     * 渲染「指令」页签。纯函数。
     *
     * @param view 草稿指令、指令列表与回调。
     * @returns React 节点。
     */
    /**
     * 渲染一个指令的编辑表单：名称、说明、变量、步骤、预览。
     *
     * 只在列表里展开的那一项调用，因此它不关心"当前是哪个指令"。
     *
     * @param view 回调集合。
     * @param draft 正在编辑的指令草稿。
     * @returns React 节点数组。
     */
    function renderTemplateBody(view, draft) {
      const composed = isComposedTemplate(draft)
      const expansion = composed
        ? expandComposedTemplate(draft, view.templates ?? [])
        : { template: draft, error: null }
      const chosenComponents = new Set(draft.compose ?? [])
      const componentOptions = (view.templates ?? [])
        .filter(item => item.id !== draft.id && !chosenComponents.has(item.id))
      /** 用变量默认值预览一遍步骤。 */
      const guess = {}
      for (const variable of draft.variables ?? []) guess[variable.key] = variable.default ?? ''

      return [
        view.draftInvalid
          ? h('div', { className: 'dgf-alert' }, `这个指令有问题：${view.draftInvalid}。修好之前无法保存。`)
          : null,

        // 基本信息
        h('div', { className: 'dgf-field' },
          h('span', { className: 'dgf-field-label' }, '名称'),
          h('input', {
            className: cx('dgf-input', 'dgf-grow'),
            value: draft.name,
            onChange: event => view.onEdit({ name: event.target.value }),
          })),
        h('div', { className: 'dgf-field' },
          h('span', { className: 'dgf-field-label' }, '说明'),
          h('input', {
            className: cx('dgf-input', 'dgf-grow'),
            value: draft.description ?? '',
            placeholder: '可不填',
            onChange: event => view.onEdit({ description: event.target.value }),
          })),
        h('div', { className: 'dgf-field' },
          h('span', { className: 'dgf-field-label' }, '分叉时'),
          h('select', {
            className: cx('dgf-select', 'dgf-grow'),
            value: draft.sync ?? 'merge',
            onChange: event => view.onEdit({ sync: event.target.value }),
          },
          h('option', { value: 'merge' }, '分叉时合并远端（merge）'),
          h('option', { value: 'rebase' }, '分叉时变基到远端（rebase）'),
          h('option', { value: 'ff' }, '只快进，分叉就停下'))),

        // 变量（组合指令的变量由被引用指令自动合并，不在这里单独编辑）
        composed ? null : h('div', { className: 'dgf-subsec' },
          h('div', { className: 'dgf-sec-head' },
            h('span', { className: 'dgf-sec-title' }, '变量'),
            h('button', { className: 'dgf-btn', onClick: view.onAddVariable }, '＋ 变量')),
          h('div', { className: 'dgf-caption' }, '步骤里用 {key} 引用'),
          (draft.variables ?? []).map((variable, index) => h('div', { key: index, className: 'dgf-var' },
            h('div', { className: 'dgf-edit-row' },
              h('input', {
                className: 'dgf-input',
                style: { width: '68px' },
                value: variable.key,
                placeholder: 'key',
                onChange: event => view.onEditVariable(index, {
                  key: event.target.value.replace(/[^A-Za-z0-9_]/g, ''),
                }),
              }),
              h('input', {
                className: cx('dgf-input', 'dgf-grow'),
                value: variable.label,
                placeholder: '显示名',
                onChange: event => view.onEditVariable(index, { label: event.target.value }),
              }),
              h('select', {
                className: 'dgf-select',
                value: variable.kind,
                onChange: event => view.onEditVariable(index, { kind: event.target.value }),
              },
              h('option', { value: 'pick' }, '选分支'),
              h('option', { value: 'input' }, '手填')),
              h('button', {
                className: 'dgf-iconbtn',
                'data-variant': 'danger',
                title: '删除变量',
                onClick: () => view.onRemoveVariable(index),
              }, '×')),
            h('div', { className: 'dgf-var-sub' },
              h('span', { className: 'dgf-field-label' }, '过滤'),
              h('input', {
                className: cx('dgf-input', 'dgf-grow'),
                value: variable.pattern ?? '',
                placeholder: 'feature/* ，留空为全部',
                onChange: event => view.onEditVariable(index, { pattern: event.target.value }),
              })),
            h('div', { className: 'dgf-var-sub' },
              h('span', { className: 'dgf-field-label' }, '默认'),
              h('input', {
                className: cx('dgf-input', 'dgf-grow'),
                value: variable.default ?? '',
                placeholder: '可不填',
                onChange: event => view.onEditVariable(index, { default: event.target.value }),
              })),
            // 自动填充：从另一个变量截取片段拼成本变量的值。
            h('div', { className: 'dgf-var-sub' },
              h('span', { className: 'dgf-field-label' }, '自动'),
              h('select', {
                className: 'dgf-select',
                value: variable.derive ? variable.derive.from : '',
                onChange: event => {
                  const from = event.target.value
                  view.onEditVariable(index, {
                    derive: from === ''
                      ? undefined
                      : {
                        from,
                        take: variable.derive ? variable.derive.take : 'after-slash',
                        prefix: variable.derive ? variable.derive.prefix : '',
                      },
                  })
                },
              },
              h('option', { value: '' }, '不自动'),
              (draft.variables ?? [])
                .filter(item => item.key !== variable.key && item.key !== '')
                .map(item => h('option', { key: item.key, value: item.key }, `来自 ${item.key}`))),
              variable.derive
                ? h('select', {
                  className: 'dgf-select',
                  value: variable.derive.take || 'after-slash',
                  onChange: event => view.onEditVariable(index, {
                    derive: { ...variable.derive, take: event.target.value },
                  }),
                },
                h('option', { value: 'after-slash' }, '取 / 之后'),
                h('option', { value: 'last-segment' }, '取最后一段'),
                h('option', { value: 'whole' }, '整个值'))
                : null,
              variable.derive
                ? h('input', {
                  className: cx('dgf-input', 'dgf-grow'),
                  value: variable.derive.prefix ?? '',
                  placeholder: '前缀，如 release/',
                  onChange: event => view.onEditVariable(index, {
                    derive: { ...variable.derive, prefix: event.target.value },
                  }),
                })
                : null)))),

        // 步骤（组合指令的步骤由被引用指令展开）
        composed ? null : h('div', { className: 'dgf-subsec' },
          h('div', { className: 'dgf-sec-head' },
            h('span', { className: 'dgf-sec-title' }, `步骤 · ${(draft.steps ?? []).length}`),
            h('button', { className: 'dgf-btn', onClick: view.onAddStep }, '＋ 步骤')),
          h('div', { className: 'dgf-pipe' }, (draft.steps ?? []).map((step, index) => h('div', {
            key: index,
            className: 'dgf-node-row',
          },
          h('span', { className: 'dgf-rail' }),
          h('span', { className: 'dgf-node' }, String(index + 1)),
          h('div', { className: 'dgf-step' },
            h('div', { className: 'dgf-edit-row' },
              h('select', {
                className: 'dgf-select',
                value: step.kind,
                onChange: event => view.onEditStep(index, { kind: event.target.value }),
              },
              h('option', { value: 'create' }, '建分支'),
              h('option', { value: 'merge' }, '合并'),
              h('option', { value: 'tag' }, '打标签'),
              h('option', { value: 'push' }, '推送'),
              h('option', { value: 'pull' }, '拉取'),
              h('option', { value: 'commit' }, '提交')),
              // 推送/拉取/提交本身没有可推送的对象，只有建分支/合并/打标签能顺手推。
              stepPushable(step.kind)
                ? h('label', {
                  style: {
                    display: 'flex', alignItems: 'center', gap: '4px',
                    fontSize: '10px', color: 'var(--dgf-dim)',
                  },
                },
                h('input', {
                  type: 'checkbox',
                  checked: step.push === true,
                  onChange: event => view.onEditStep(index, { push: event.target.checked }),
                }), step.kind === 'tag' ? '推送标签' : '推送')
                : null,
              h('div', { className: 'dgf-grow' }),
              h('button', {
                className: 'dgf-iconbtn', title: '上移', onClick: () => view.onMoveStep(index, -1),
              }, '↑'),
              h('button', {
                className: 'dgf-iconbtn', title: '下移', onClick: () => view.onMoveStep(index, 1),
              }, '↓'),
              h('button', {
                className: 'dgf-iconbtn',
                'data-variant': 'danger',
                title: '删除步骤',
                onClick: () => view.onRemoveStep(index),
              }, '×')),
            step.kind === 'push'
              ? h('div', { className: 'dgf-field', style: { marginTop: '5px' } },
                h('span', { className: 'dgf-field-label' }, '分支'),
                h(BranchPicker, {
                  value: step.target,
                  variables: draft.variables ?? [],
                  branches: view.branches ?? [],
                  placeholder: '要推到远端的分支',
                  onChange: next => view.onEditStep(index, { target: next }),
                }))
              : step.kind === 'pull'
                ? h('div', { className: 'dgf-field', style: { marginTop: '5px' } },
                  h('span', { className: 'dgf-field-label' }, '分支'),
                  h(BranchPicker, {
                    value: step.target,
                    variables: draft.variables ?? [],
                    branches: view.branches ?? [],
                    placeholder: '要更新到远端最新的本地分支',
                    onChange: next => view.onEditStep(index, { target: next }),
                  }))
              : step.kind === 'commit'
                ? h('div', null,
                  h('div', { className: 'dgf-field', style: { marginTop: '5px' } },
                    h('span', { className: 'dgf-field-label' }, '提交说明'),
                    h(BranchPicker, {
                      value: step.target,
                      variables: draft.variables ?? [],
                      branches: [],
                      placeholder: '如 chore: 提交工作区；点 ▾ 选择变量（会替换当前内容）',
                      onChange: next => view.onEditStep(index, { target: next }),
                    })),
                  h('div', { className: 'dgf-caption' }, '只提交到本地，不推送；需要推送请再加一个「推送」步骤'))
              : step.kind === 'tag'
                ? h('div', null,
                  h('div', { className: 'dgf-field', style: { marginTop: '5px' } },
                    h('span', { className: 'dgf-field-label' }, '从'),
                    h(BranchPicker, {
                      value: step.source,
                      variables: draft.variables ?? [],
                      branches: view.branches ?? [],
                      placeholder: '选要打标签的分支，也可直接输入',
                      onChange: next => view.onEditStep(index, { source: next }),
                    })),
                  h('div', { className: 'dgf-field', style: { marginTop: '4px' } },
                    h('span', { className: 'dgf-field-label' }, '标签'),
                    h('input', {
                      className: cx('dgf-input', 'dgf-grow'),
                      value: step.target,
                      placeholder: '标签名，如 v1.0.1；可用 {变量}',
                      onChange: event => view.onEditStep(index, { target: event.target.value }),
                    })))
              : h('div', null,
                h('div', { className: 'dgf-field', style: { marginTop: '5px' } },
                  h('span', { className: 'dgf-field-label' }, step.kind === 'create' ? '从' : '来源'),
                  h(BranchPicker, {
                    value: step.source,
                    variables: draft.variables ?? [],
                    branches: view.branches ?? [],
                    placeholder: '选变量或分支，也可直接输入',
                    onChange: next => view.onEditStep(index, { source: next }),
                  })),
                h('div', { className: 'dgf-field', style: { marginTop: '4px' } },
                  h('span', { className: 'dgf-field-label' }, step.kind === 'create' ? '创建' : '目标'),
                  h(BranchPicker, {
                    value: step.target,
                    variables: draft.variables ?? [],
                    branches: view.branches ?? [],
                    placeholder: '选变量或分支，也可直接输入',
                    onChange: next => view.onEditStep(index, { target: next }),
                  })))))))),

        // 组合指令：选择组件、自动合并变量、查看展开后的步骤
        composed ? h('div', { className: 'dgf-subsec' },
          h('div', { className: 'dgf-sec-head' },
            h('span', { className: 'dgf-sec-title' }, `包含指令 · ${(draft.compose ?? []).length}`),
            h('select', {
              className: 'dgf-select',
              value: '',
              onChange: event => {
                const id = event.target.value
                if (id !== '') view.onAddComponent(id)
              },
            },
            h('option', { value: '' }, '＋ 选择指令'),
            componentOptions.map(item => h('option', { key: item.id, value: item.id }, item.name)))),
          (draft.compose ?? []).length === 0
            ? h('div', { className: 'dgf-empty' }, '还没有选择要组合的指令')
            : (draft.compose ?? []).map((id, index) => {
              const found = (view.templates ?? []).find(item => item.id === id)
              return h('div', { key: `${id}:${index}`, className: 'dgf-edit-row', style: { marginTop: '4px' } },
                h('span', { className: 'dgf-node' }, String(index + 1)),
                h('span', { className: 'dgf-tplname' }, found === undefined ? `缺失的指令（${id}）` : found.name),
                found !== undefined && isComposedTemplate(found)
                  ? h('span', { className: 'dgf-chip' }, '组合')
                  : null,
                h('div', { className: 'dgf-grow' }),
                h('button', {
                  className: 'dgf-iconbtn', title: '上移', onClick: () => view.onMoveComponent(index, -1),
                }, '↑'),
                h('button', {
                  className: 'dgf-iconbtn', title: '下移', onClick: () => view.onMoveComponent(index, 1),
                }, '↓'),
                h('button', {
                  className: 'dgf-iconbtn',
                  'data-variant': 'danger',
                  title: '移除',
                  onClick: () => view.onRemoveComponent(index),
                }, '×'))
            }),
          expansion.error === null
            ? h('div', { className: 'dgf-caption' },
              `变量自动合并：${(expansion.template.variables ?? []).map(variable => variable.key).join('、') || '无'}`)
            : h('div', { className: 'dgf-alert' }, expansion.error),
          expansion.error === null && expansion.template.steps.length > 0
            ? h('div', { style: { marginTop: '6px' } },
              expansion.template.steps.map((step, index) => h('div', { key: `${step.id}:${index}`, className: 'dgf-flow' },
                h('span', { className: 'dgf-chip' }, stepKindLabel(step.kind)),
                h('span', null, `${step.source ? `${preview(step.source, guess)} → ` : ''}${preview(step.target, guess)}`))))
            : null)
          : null,

        // 预览（普通指令）
        composed ? null : h('div', { className: 'dgf-subsec' },
          h('div', { className: 'dgf-sec-head' },
            h('span', { className: 'dgf-sec-title' }, '预览')),
          (draft.steps ?? []).map((step, index) => {
            const source = preview(step.source, guess)
            const target = preview(step.target, guess)
            return h('div', { key: index, className: 'dgf-flow' },
              ...stepFlow(step, source, target),
              stepPushable(step.kind) && step.push
                ? h('span', { className: 'dgf-chip', 'data-tone': 'push' },
                  step.kind === 'tag' ? '推送标签' : '推送')
                : null)
          })),

        // 操作
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
          h('button', {
            className: 'dgf-btn',
            'data-variant': 'primary',
            disabled: view.busy === true,
            onClick: view.onSaveTemplate,
          }, view.busy ? '保存中…' : '保存指令'),
          h('button', { className: 'dgf-btn', onClick: view.onDuplicateTemplate }, '复制'),
          h('button', {
            className: 'dgf-btn',
            'data-variant': 'danger',
            title: '删除后不可恢复，但会自动留一份备份',
            onClick: view.onDeleteTemplate,
          }, view.confirmDelete === true ? '确认删除？' : '删除'),
          view.dirty === true
            ? h('span', {
              className: 'dgf-chip',
              'data-tone': 'skip',
              title: '还没保存；收起或切走会丢弃这次修改',
            }, '未保存')
            : null,
          view.confirmDelete === true
            ? h('span', { className: 'dgf-conflict-hint' }, '再点一次才真删')
            : null),
      ].filter(Boolean)
    }

    /**
     * 渲染「指令」页签：指令列表，点开某一项在其下方展开配置。
     *
     * @param view 草稿指令、指令列表与回调。
     * @returns React 节点。
     */
    function renderEdit(view) {
      const { draft, templates, log } = view

      if (!draft) {
        return h('div', { className: 'dgf-root' },
          h(Hud, { tab: 'edit', led: 'ok', onRunTab: view.onRunTab, onEditTab: view.onEditTab }),
          h('div', { className: 'dgf-scroll' },
            h('div', { className: 'dgf-sec' },
              h('div', { className: 'dgf-sec-head' },
                h('span', { className: 'dgf-sec-title' }, '指令'),
                h('div', { style: { display: 'flex', gap: '4px' } },
                  h('button', {
                    className: 'dgf-btn',
                    'data-variant': 'ghost',
                    title: '重新从磁盘读取指令（AI 新增指令后点这里）',
                    onClick: view.onReloadTemplates,
                  }, '↻'),
                  h('button', {
                    className: 'dgf-btn', 'data-variant': 'primary', onClick: view.onNewTemplate,
                  }, '新建'),
                  h('button', { className: 'dgf-btn', onClick: view.onNewCompose }, '组合'),
                  h('button', { className: 'dgf-btn', onClick: view.onRestoreDefault }, '恢复默认'))),
              templates.length === 0
                ? h('div', { className: 'dgf-empty' },
                  h('div', null, '还没有指令'),
                  h('button', {
                    className: 'dgf-btn',
                    'data-variant': 'primary',
                    style: { marginTop: '8px' },
                    onClick: view.onRestoreDefault,
                  }, '恢复默认指令'))
                : h('div', { className: 'dgf-tpllist' }, templates.map(item => h('div', {
                  key: item.id,
                  className: 'dgf-tplrow',
                },
                h('button', {
                  className: 'dgf-tplhead',
                  onClick: () => view.onSelectTemplate(item.id),
                },
                h('span', { className: 'dgf-tplcaret' }, '▸'),
                h('span', { className: 'dgf-tplname' }, item.name),
                Array.isArray(item.compose) ? h('span', { className: 'dgf-chip' }, '组合') : null,
                item.invalid === undefined ? null : h('span', { className: 'dgf-chip', 'data-tone': 'fail' }, '有问题')))))),
            h(LogView, { log })))
      }

      // 列表以已保存的指令为准，但"新建"出来的草稿还没保存，必须也占一行，
      // 否则点了新建却看不到任何可编辑的东西。
      const savedIds = new Set(templates.map(item => item.id))
      const draftUnsaved = draft !== null && !savedIds.has(draft.id)
      const rows = draftUnsaved ? [{ ...draft, __unsaved: true }, ...templates] : templates

      return h('div', { className: 'dgf-root' },
        h(Hud, { tab: 'edit', led: 'ok', onRunTab: view.onRunTab, onEditTab: view.onEditTab }),
        h('div', { className: 'dgf-scroll' },
          h('div', { className: 'dgf-sec' },
            h('div', { className: 'dgf-sec-head' },
              h('span', { className: 'dgf-sec-title' }, `指令 · ${rows.length}`),
              h('div', { style: { display: 'flex', gap: '4px' } },
                h('button', {
                  className: 'dgf-btn',
                  'data-variant': 'ghost',
                  title: '重新从磁盘读取指令（AI 新增指令后点这里）',
                  onClick: view.onReloadTemplates,
                }, '↻'),
                h('button', {
                  className: 'dgf-btn', 'data-variant': 'primary', onClick: view.onNewTemplate,
                }, '新建'),
                h('button', { className: 'dgf-btn', onClick: view.onNewCompose }, '组合'),
                h('button', { className: 'dgf-btn', onClick: view.onRestoreDefault }, '恢复默认'))),

            // 列表：一行一个指令，点开的那个在下方展开配置。
            h('div', { className: 'dgf-tpllist' }, rows.map(item => {
              const active = item.id === draft.id
              // 展开中的行用实时草稿渲染，名称等改动立刻反映在行头上。
              const shown = active ? draft : item
              return h('div', {
                key: item.id,
                className: 'dgf-tplrow',
                'data-on': active ? 'true' : 'false',
                'data-collapsed': active && view.collapsed === true ? 'true' : 'false',
              },
              h('button', {
                className: 'dgf-tplhead',
                onClick: () => {
                  if (active) view.onToggleRow()
                  else view.onSelectTemplate(item.id)
                },
              },
              h('span', { className: 'dgf-tplcaret' }, '▸'),
              h('span', { className: 'dgf-tplname' }, shown.name),
              Array.isArray(shown.compose) ? h('span', { className: 'dgf-chip' }, '组合') : null,
              item.__unsaved
                ? h('span', { className: 'dgf-chip', 'data-tone': 'auto' }, '新的')
                : null,
              shown.invalid === undefined || shown.invalid === null
                ? null
                : h('span', { className: 'dgf-chip', 'data-tone': 'fail' }, '有问题'),
              active && view.dirty === true
                ? h('span', { className: 'dgf-chip', 'data-tone': 'skip' }, '未保存')
                : null,
              active && view.collapsed === true
                ? h('span', { className: 'dgf-chip' }, '已收起')
                : null),
              active && view.collapsed !== true
                ? h('div', { className: 'dgf-tplbody' }, renderTemplateBody(view, draft))
                : null)
            }))),

          h(LogView, { log })))
    }

    /**
     * 面板主体：取数与交互，渲染交给 renderRun / renderEdit。
     *
     * @param props `sessionId` 由槽位注入。
     * @returns React 节点。
     */
    function GitFlowPanel(props) {
      const sessionId = props.sessionId
      const [tab, setTab] = React.useState('run')
      const [repo, setRepo] = React.useState(null)
      const [templates, setTemplates] = React.useState([])
      // 提交图：只读缓存、加载与错误状态。
      const [graph, setGraph] = React.useState(null)
      const [graphLoading, setGraphLoading] = React.useState(false)
      const [graphError, setGraphError] = React.useState(null)
      // 已加载的提交图条数；「加载更多」会逐步提高。
      const [graphLimit, setGraphLimit] = React.useState(50)
      // 提交图范围：all=全部本地分支（默认，和 Git 客户端一致）；head=只看当前分支。
      const [graphScope, setGraphScope] = React.useState('all')
      const [selectedId, setSelectedId] = React.useState('')
      const [values, setValues] = React.useState({})
      const [statuses, setStatuses] = React.useState({})
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [log, setLog] = React.useState([])
      const [error, setError] = React.useState(null)
      // 删除要连点两次才生效，避免误触把指令删掉。
      const [confirmDelete, setConfirmDelete] = React.useState(false)
      // 指令行是否收起。收起只是不显示表单，草稿仍留在内存里，再点开还能接着改。
      const [collapsed, setCollapsed] = React.useState(false)
      // 流程跑完后把用户送回来时所在的分支，避免停在最后一次合并的目标分支上。
      const [restoreBranch, setRestoreBranch] = React.useState(true)
      // 右键菜单：{ branch, x, y }；执行弹窗：{ templateId, branch, startIndex, phase }。
      const [menu, setMenu] = React.useState(null)
      const [execution, setExecution] = React.useState(null)
      // 组合指令展开后的可执行版本；普通指令就是它本身。
      const [executionExpanded, setExecutionExpanded] = React.useState(null)
      // 本次执行里手改过的提交说明：stepId -> 文本；空表示跟随指令内容。
      const [commitOverrides, setCommitOverrides] = React.useState({})
      // 最近一次执行失败记录：服务端持久化，面板重开/应用重启后仍能提示。
      const [lastFailure, setLastFailure] = React.useState(null)
      const [failureOpen, setFailureOpen] = React.useState(false)
      // 提交对话框：是否打开、提交说明与失败原因。
      const [commitOpen, setCommitOpen] = React.useState(false)
      const [commitMessage, setCommitMessage] = React.useState('')
      const [commitError, setCommitError] = React.useState(null)
      // 提交弹层的改动文件列表与勾选状态；null 表示还在读取。
      const [commitFiles, setCommitFiles] = React.useState(null)
      const [commitFilesTruncated, setCommitFilesTruncated] = React.useState(false)
      const [commitFilesError, setCommitFilesError] = React.useState(null)
      const [commitSelected, setCommitSelected] = React.useState([])
      // diff 预览：正在看的文件、内容/错误/加载状态与视图模式。
      const [diffPath, setDiffPath] = React.useState(null)
      const [diffData, setDiffData] = React.useState(null)
      const [diffError, setDiffError] = React.useState(null)
      const [diffLoading, setDiffLoading] = React.useState(false)
      const [diffMode, setDiffMode] = React.useState('unified')
      // 连续点多个文件时只采用最后一次请求的结果。
      const diffRequest = React.useRef(0)
      // 正在跟随推导的变量 key；用户手填后移出，清空后放回。
      const [following, setFollowing] = React.useState([])

      const branches = React.useMemo(
        () => (repo && repo.branches ? repo.branches.map(item => item.name) : []),
        [repo],
      )
      const currentBranch = repo && typeof repo.current === 'string' ? repo.current : ''
      // 指令页签仍按 selectedId 编辑；执行弹窗用自己记住的指令，避免互相影响。
      const template = templates.find(item => item.id === selectedId) ?? templates[0] ?? null
      const executionTemplate = execution === null || execution === undefined
        ? null
        : executionExpanded

      /** 读仓库状态。 */
      const refreshRepo = async () => {
        if (!sessionId) return
        try {
          const data = await post(ROUTE.repo, { sessionId })
          setRepo(data.repo)
          setError(data.repo && data.repo.error ? data.repo.error : null)
        } catch (err) {
          setError(explain(err))
        }
      }

      /** 读提交图（只读）；按当前范围和条数取，支持逐步加载更多。 */
      const graphRequestId = React.useRef(0)
      const refreshGraph = async (limit = graphLimit, scope = graphScope) => {
        if (!sessionId) return
        // 只认最后一次请求的结果，避免旧请求晚到把执行后的新图覆盖回去。
        const requestId = graphRequestId.current + 1
        graphRequestId.current = requestId
        setGraphLoading(true)
        try {
          const data = await post(ROUTE.graph, { sessionId, limit, scope })
          if (graphRequestId.current !== requestId) return
          setGraph(data.graph ?? { commits: [], current: '', head: '', error: null })
          setGraphError(data.graph && data.graph.error ? data.graph.error : null)
        } catch (err) {
          if (graphRequestId.current !== requestId) return
          setGraphError(explain(err))
        } finally {
          if (graphRequestId.current === requestId) setGraphLoading(false)
        }
      }

      /** 读回「上次执行失败」记录：应用重启后仍能看到上次为什么失败。 */
      const refreshLastStep = async () => {
        if (!sessionId) return
        try {
          const data = await post(ROUTE.lastStep, { sessionId })
          const last = data.last
          setLastFailure(previous => pickLastFailure(previous, last))
        } catch {
          // 读不到历史不影响面板主流程。
        }
      }

      /** 拉取远端更新，然后把仓库状态重新读一遍。 */
      const pullUpdates = async () => {
        if (busy) return
        setBusy(true)
        try {
          const data = await post(ROUTE.fetch, { sessionId })
          const result = data.result
          setLog([{ ok: result.ok, text: result.message }])
        } catch (err) {
          setLog([{ ok: false, text: explain(err) }])
        } finally {
          setBusy(false)
          await refreshRepo()
          await refreshGraph()
        }
      }

      /** 切换到指定分支；成功/失败都记录结果，最后重读仓库状态。 */
      const switchToBranch = async (branch) => {
        if (busy || !branch || branch === currentBranch) return
        setBusy(true)
        try {
          const data = await post(ROUTE.switchBranch, { sessionId, branch })
          const result = data.result
          setLog([{ ok: result.ok, text: result.message }])
        } catch (err) {
          setLog([{ ok: false, text: explain(err) }])
        } finally {
          setBusy(false)
          await refreshRepo()
          await refreshGraph()
        }
      }

      /** 读提交弹层要展示的改动文件，并把勾选重置为全选。 */
      const loadCommitFiles = async () => {
        setCommitFiles(null)
        setCommitFilesTruncated(false)
        setCommitFilesError(null)
        try {
          const data = await post(ROUTE.changes, { sessionId })
          const files = Array.isArray(data.files) ? data.files : []
          setCommitFiles(files)
          setCommitFilesTruncated(data.truncated === true)
          setCommitSelected(files.map(file => file.path))
        } catch (err) {
          const message = explain(err)
          setCommitFiles([])
          setCommitSelected([])
          setCommitFilesError(message)
        }
      }

      /** 打开单个文件的 diff 预览；连续点击时只采用最后一次请求。 */
      const openDiff = async (path) => {
        const request = diffRequest.current + 1
        diffRequest.current = request
        setDiffPath(path)
        setDiffData(null)
        setDiffError(null)
        setDiffLoading(true)
        try {
          const data = await post(ROUTE.diff, { sessionId, path })
          if (diffRequest.current !== request) return
          if (data.error) setDiffError(data.error)
          else setDiffData(data.diff ?? null)
        } catch (err) {
          if (diffRequest.current !== request) return
          setDiffError(explain(err))
        } finally {
          if (diffRequest.current === request) setDiffLoading(false)
        }
      }

      /** 关闭 diff 预览，回到提交弹层的文件列表。 */
      const closeDiff = () => {
        diffRequest.current += 1
        setDiffPath(null)
        setDiffData(null)
        setDiffError(null)
        setDiffLoading(false)
      }

      /** 提交勾选的文件；失败时把原因留在对话框里，成功则关闭对话框并重读仓库。 */
      const submitCommit = async () => {
        if (busy) return
        setBusy(true)
        setCommitError(null)
        try {
          const data = await post(ROUTE.commit, {
            sessionId,
            message: commitMessage,
            files: commitSelected,
          })
          const result = data.result
          setLog([{ ok: result.ok, text: result.message }])
          if (result.ok) {
            setCommitOpen(false)
            setCommitMessage('')
            setCommitFiles(null)
            setCommitSelected([])
            closeDiff()
          } else {
            setCommitError(result.message)
          }
        } catch (err) {
          const message = explain(err)
          setLog([{ ok: false, text: message }])
          setCommitError(message)
        } finally {
          setBusy(false)
          await refreshRepo()
          await refreshGraph()
        }
      }

      /** 读指令列表。 */
      const refreshTemplates = async () => {
        try {
          const data = await post(ROUTE.templates, {})
          setTemplates(data.templates ?? [])
          if (!selectedId && (data.templates ?? []).length > 0) {
            const list = data.templates
            const remembered = readLastTemplate()
            const found = list.find(item => item.id === remembered)
            setSelectedId(found === undefined ? list[0].id : found.id)
          }
        } catch (err) {
          setLog([{ ok: false, text: explain(err) }])
        }
      }

      React.useEffect(() => {
        void (async () => {
          await refreshTemplates()
          await refreshRepo()
          await refreshGraph()
          await refreshLastStep()
        })()
        // 只在会话变化时初始化一次。
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [sessionId])

      // 合并/变基停在冲突里时定时重读仓库：用户在外部解决并 git add 后，
      // 面板能自己发现「冲突已清空」，不必手动点刷新。
      const operationInProgress = repo !== null && typeof repo.inProgress === 'string' && repo.inProgress !== ''
      React.useEffect(() => {
        if (!sessionId || !operationInProgress) return undefined
        const timer = setInterval(() => {
          void refreshRepo()
        }, 3000)
        return () => clearInterval(timer)
        // refreshRepo 只依赖 sessionId，间接触发依赖用 operationInProgress 即可。
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [sessionId, operationInProgress])

      /**
       * 执行一个步骤并更新状态。
       *
       * @param active 本次执行使用的指令。
       * @param index 步骤下标。
       * @returns 该步结果。
       */
      const runOne = async (active, index) => {
        const step = active.steps[index]
        if (!step) return { ok: false, message: '步骤不存在' }
        const override = step.kind === 'commit' ? commitOverrides[step.id] : undefined
        const payload = override === undefined ? step : { ...step, target: override }
        setStatuses(prev => ({ ...prev, [step.id]: { status: 'running', message: '' } }))
        try {
          // 同步策略随指令走；缺省 merge（分叉时自动合并远端最新）。
          const data = await post(ROUTE.step, {
            sessionId,
            step: payload,
            values,
            sync: active.sync ?? 'merge',
            templateName: active.name,
            stepIndex: index,
          })
          const outcome = data.outcome
          const status = outcome.ok ? (outcome.skipped ? 'skipped' : 'ok') : 'failed'
          setStatuses(prev => ({
            ...prev,
            [step.id]: {
              status,
              message: outcome.message,
              ...(Array.isArray(outcome.conflicts) && outcome.conflicts.length > 0
                ? { conflicts: outcome.conflicts }
                : {}),
              ...(typeof outcome.output === 'string' && outcome.output !== ''
                ? { output: outcome.output }
                : {}),
            },
          }))
          setLog(prev => [...prev, { ok: outcome.ok, text: outcome.message }])
          // 失败记录也留在顶部横幅；服务端同时持久化，重开面板/重启后仍可见。
          if (outcome.ok) {
            setLastFailure(null)
          } else {
            setLastFailure({
              at: new Date().toISOString(),
              templateName: active.name,
              stepIndex: index,
              stepId: step.id,
              kind: typeof outcome.kind === 'string' ? outcome.kind : step.kind,
              source: typeof outcome.source === 'string' ? outcome.source : '',
              target: typeof outcome.target === 'string' ? outcome.target : '',
              ok: false,
              skipped: outcome.skipped === true,
              message: typeof outcome.message === 'string' ? outcome.message : '',
              output: typeof outcome.output === 'string' ? outcome.output : '',
            })
          }
          return outcome
        } catch (err) {
          const message = explain(err)
          setStatuses(prev => ({ ...prev, [step.id]: { status: 'failed', message } }))
          setLog(prev => [...prev, { ok: false, text: message }])
          setLastFailure({
            at: new Date().toISOString(),
            templateName: active.name,
            stepIndex: index,
            stepId: step.id,
            kind: step.kind,
            source: typeof step.source === 'string' ? step.source : '',
            target: typeof payload.target === 'string' ? payload.target : '',
            ok: false,
            skipped: false,
            message,
            output: '',
          })
          return { ok: false, message }
        }
      }

      /**
       * 切回指定分支并记录结果。
       *
       * @param branch 要切回的分支；空值或 HEAD 时直接跳过。
       */
      const restoreTo = async (branch) => {
        if (!restoreBranch || branch === '' || branch === 'HEAD') return
        try {
          const data = await post(ROUTE.checkout, { sessionId, branch })
          setLog(prev => [...prev, { ok: data.result.ok, text: data.result.message }])
        } catch (err) {
          setLog(prev => [...prev, { ok: false, text: explain(err) }])
        }
      }

      /** 当前分支名，作为“执行完切回”的目标。 */
      const startBranchOf = () => (repo && typeof repo.current === 'string' ? repo.current : '')

      /**
       * 打开执行弹窗：用右键的分支预填参数、清空上一次的状态。
       *
       * @param active 要执行的指令。
       * @param branch 右键的分支名，作为参数默认值；为空表示不预填。
       * @param startIndex 从第几步开始执行（失败重试用）。
       */
      const openExecution = (active, branch, startIndex = 0) => {
        const expanded = expandComposedTemplate(active, templates)
        setMenu(null)
        if (expanded.error !== null) {
          setLog([{ ok: false, text: expanded.error }])
          return
        }
        const runnable = expanded.template
        setSelectedId(active.id)
        rememberTemplate(active.id)
        setExecutionExpanded(runnable)
        setValues(prefillValues(runnable, branches, branch))
        setFollowing((runnable.variables ?? []).filter(variable => variable.derive).map(variable => variable.key))
        setStatuses({})
        setLog([])
        setRestoreBranch(true)
        setCommitOverrides({})
        setExecution({
          templateId: active.id,
          branch: typeof branch === 'string' ? branch : '',
          startIndex,
          phase: 'prepare',
        })
      }

      /** 关闭执行弹窗；执行中不允许关闭，避免状态更新落在已卸载的界面逻辑上。 */
      const closeExecution = () => {
        if (busy) return
        const finished = execution !== null && execution !== undefined && execution.phase === 'done'
        setExecution(null)
        setExecutionExpanded(null)
        // 执行结束后再兜底刷新一次仓库与提交图：即使某次自动刷新被旧请求覆盖/失败，
        // 关闭窗口时也能看到最新的合并结果。
        if (finished) {
          void refreshRepo()
          void refreshGraph()
        }
      }

      /** 右键分支：打开指令菜单。 */
      const openBranchMenu = (branch, event) => {
        if (busy) return
        setMenu({ branch, x: event.clientX, y: event.clientY })
      }

      /** 从失败横幅重新打开弹窗：按记录里的指令名找回指令，从失败的那一步开始。 */
      const retryLastFailure = () => {
        if (!lastFailure) return
        const found = templates.find(item => item.name === lastFailure.templateName)
        if (found === undefined) {
          setLog([{ ok: false, text: '上次失败用的指令已不存在，无法重试' }])
          return
        }
        const index = typeof lastFailure.stepIndex === 'number' ? lastFailure.stepIndex : 0
        openExecution(found, '', index)
      }

      /**
       * 顺序执行步骤，遇到失败即停；整段跑完（或失败停下）后切回起点分支。
       *
       * @param active 本次执行使用的指令。
       * @param fromIndex 起始下标。
       */
      const runAll = async (active, fromIndex = 0) => {
        if (busy || !active) return
        // 步骤会 checkout 到各个目标分支，先记住起点，跑完再切回来。
        const startBranch = startBranchOf()
        setBusy(true)
        setExecution(prev => (prev === null || prev === undefined ? prev : { ...prev, phase: 'running' }))
        try {
          for (let i = fromIndex; i < active.steps.length; i += 1) {
            const outcome = await runOne(active, i)
            if (!outcome.ok) break
          }
        } finally {
          await restoreTo(startBranch)
          setBusy(false)
          await refreshRepo()
          await refreshGraph()
          setExecution(prev => (prev === null || prev === undefined ? prev : { ...prev, phase: 'done' }))
        }
      }

      /**
       * 处理进行中的合并：中止，或在冲突全部解决后收尾。
       *
       * @param action `abort` 或 `continue`。
       */
      const resolveMerge = async (action) => {
        if (busy) return
        setBusy(true)
        try {
          const data = await post(ROUTE.conflict, { sessionId, action })
          const result = data.result
          setLog([{ ok: result.ok, text: result.message }])
        } catch (err) {
          setLog([{ ok: false, text: explain(err) }])
        } finally {
          setBusy(false)
          await refreshRepo()
          await refreshGraph()
        }
      }

      /** 保存当前草稿指令。 */
      const saveTemplate = async () => {
        if (busy || !draft) return
        setBusy(true)
        try {
          const data = await post(ROUTE.save, { template: draft })
          if (data.error) {
            setLog([{ ok: false, text: data.error }])
            return
          }
          setTemplates(data.templates ?? [])
          setSelectedId(draft.id)
          rememberTemplate(draft.id)
          setLog([{ ok: true, text: `已保存指令「${draft.name}」` }])
        } catch (err) {
          setLog([{ ok: false, text: explain(err) }])
        } finally {
          setBusy(false)
        }
      }

      /**
       * 删除当前草稿指令；第一次调用只进入确认态。
       */
      const requestDelete = () => {
        if (busy || !draft) return
        if (confirmDelete !== true) {
          setConfirmDelete(true)
          return
        }
        setConfirmDelete(false)
        void deleteTemplate()
      }

      /** 真正执行删除。 */
      const deleteTemplate = async () => {
        if (busy || !draft) return
        setBusy(true)
        try {
          const data = await post(ROUTE.remove, { id: draft.id })
          const next = (data.templates ?? [])[0]
          setTemplates(data.templates ?? [])
          setSelectedId(next ? next.id : '')
          rememberTemplate(next ? next.id : '')
          setDraft(next ? JSON.parse(JSON.stringify(next)) : null)
          setLog([{ ok: true, text: '已删除指令' }])
        } catch (err) {
          setLog([{ ok: false, text: explain(err) }])
        } finally {
          setBusy(false)
        }
      }

      /**
       * 更新一个变量并联动推导字段。
       *
       * @param key 变量 key。
       * @param value 新值。
       */
      const scheduleValue = (key, value) => {
        // 组合指令执行时用展开后的变量表（合并了各组件的变量）。
        const variables = (executionTemplate ?? template)?.variables ?? []
        setValues(prev => {
          const changed = { ...prev, [key]: value }
          return propagateDerived(variables, changed, key, following)
        })
        // 用户手改推导字段：填了值就退出跟随，清空则恢复跟随。
        const isDerived = variables.some(variable => variable.key === key && variable.derive)
        if (isDerived) {
          setFollowing(prev => {
            const isFollowing = prev.includes(key)
            if (value.trim() === '' && !isFollowing) return [...prev, key]
            if (value.trim() !== '' && isFollowing) return prev.filter(item => item !== key)
            return prev
          })
        }
      }

      /** 把内置默认指令加回来。 */
      const restoreDefault = async () => {
        if (busy) return
        setBusy(true)
        try {
          const data = await post(ROUTE.restore, {})
          setTemplates(data.templates ?? [])
          setLog([{ ok: true, text: data.restored ? '已恢复默认指令' : '默认指令已存在' }])
        } catch (err) {
          setLog([{ ok: false, text: explain(err) }])
        } finally {
          setBusy(false)
        }
      }

      /** 进入编辑页签，用当前指令填充草稿。 */
      const startEdit = () => {
        setDraft(template ? JSON.parse(JSON.stringify(template)) : blankTemplate())
        setConfirmDelete(false)
        setCollapsed(false)
        setLog([])
        setTab('edit')
      }

      const failedStepIndex = executionTemplate
        ? executionTemplate.steps.findIndex(step => statuses[step.id] && statuses[step.id].status === 'failed')
        : -1

      const shared = {
        onRunTab: () => setTab('run'),
        onEditTab: startEdit,
      }

      if (tab === 'run') {
        return renderRun({
          ...shared,
          repo,
          templates,
          busy,
          log,
          error,
          lastFailure,
          failureOpen,
          onToggleFailure: () => setFailureOpen(prev => !prev),
          onDismissFailure: () => {
            setLastFailure(null)
            void post(ROUTE.clearLastStep, { sessionId }).catch(() => {})
          },
          onRetryFailure: retryLastFailure,
          onRefresh: async () => {
            await refreshRepo()
            await refreshGraph()
          },
          onPull: () => void pullUpdates(),
          graph,
          graphLoading,
          graphError,
          graphScope,
          graphCanLoadMore: graphLimit < 500,
          onRefreshGraph: () => void refreshGraph(),
          onLoadMoreGraph: () => {
            const next = Math.min(graphLimit + 50, 500)
            setGraphLimit(next)
            void refreshGraph(next, graphScope)
          },
          onGraphScope: next => {
            if (next === graphScope) return
            setGraphScope(next)
            setGraphLimit(50)
            void refreshGraph(50, next)
          },
          onSwitchBranch: branch => void switchToBranch(branch),
          onBranchMenu: openBranchMenu,
          menu,
          onCloseMenu: () => setMenu(null),
          onPickTemplate: active => openExecution(active, menu === null || menu === undefined ? '' : menu.branch),
          execution,
          executionTemplate,
          values,
          statuses,
          restoreBranch,
          commitOverrides,
          onCommitOverride: (stepId, text) => setCommitOverrides(prev => {
            const next = { ...prev }
            // null/undefined 表示恢复指令内容；空字符串表示这次就是空的（可继续输入）。
            if (text === null || text === undefined) delete next[stepId]
            else next[stepId] = text
            return next
          }),
          onValue: (key, value) => scheduleValue(key, value),
          onRestoreBranch: next => setRestoreBranch(next),
          onRun: () => {
            if (execution === null || execution === undefined || executionTemplate === null) return
            void runAll(executionTemplate, execution.startIndex)
          },
          onRetryRun: () => {
            if (execution === null || execution === undefined || executionTemplate === null) return
            void runAll(executionTemplate, failedStepIndex < 0 ? 0 : failedStepIndex)
          },
          onCancelExecution: closeExecution,
          onCloseExecution: closeExecution,
          onAbortMerge: () => void resolveMerge('abort'),
          onContinueMerge: () => void resolveMerge('continue'),
          failedIndex: failedStepIndex,
          commitOpen,
          commitMessage,
          commitError,
          commitFiles,
          commitFilesTruncated,
          commitFilesError,
          commitSelected,
          diffPath,
          diffData,
          diffError,
          diffLoading,
          diffMode,
          onDiffOpen: path => void openDiff(path),
          onDiffBack: () => closeDiff(),
          onDiffMode: mode => setDiffMode(mode),
          onCommitOpen: () => {
            setCommitError(null)
            setCommitOpen(true)
            closeDiff()
            void loadCommitFiles()
          },
          onCommitMessage: next => setCommitMessage(next),
          onCommitToggle: path => setCommitSelected(prev =>
            (prev.includes(path) ? prev.filter(item => item !== path) : [...prev, path])),
          onCommitSelectAll: () => setCommitSelected((commitFiles ?? []).map(file => file.path)),
          onCommitSelectNone: () => setCommitSelected([]),
          onCommitReload: () => void loadCommitFiles(),
          onCommitCancel: () => {
            if (busy) return
            setCommitOpen(false)
            setCommitError(null)
            closeDiff()
          },
          onCommitSubmit: () => void submitCommit(),
        })
      }

      // 草稿与已保存版本不一致时提示「未保存」，避免切页签丢掉修改还不知道。
      const stored = draft ? templates.find(item => item.id === draft.id) : undefined
      const draftDirty = draft !== null
        && (stored === undefined || JSON.stringify(stored) !== JSON.stringify(draft))

      return renderEdit({
        ...shared,
        draft,
        templates,
        busy,
        log,
        dirty: draftDirty,
        confirmDelete,
        collapsed,
        onToggleRow: () => setCollapsed(prev => !prev),
        draftInvalid: draft && draft.invalid ? draft.invalid : null,
        onRestoreDefault: () => void restoreDefault(),
        onReloadTemplates: () => void refreshTemplates(),
        onSelectTemplate: id => {
          const found = templates.find(item => item.id === id)
          setSelectedId(id)
          rememberTemplate(id)
          setConfirmDelete(false)
          setCollapsed(false)
          setDraft(found ? JSON.parse(JSON.stringify(found)) : null)
        },
        onNewTemplate: () => {
          setDraft(blankTemplate())
          setLog([])
        },
        onNewCompose: () => {
          setDraft(blankComposeTemplate())
          setLog([])
        },
        onAddComponent: id => {
          if (typeof id !== 'string' || id === '') return
          setDraft(prev => ({ ...prev, compose: [...(prev.compose ?? []), id] }))
        },
        onRemoveComponent: index => setDraft(prev => {
          const compose = [...(prev.compose ?? [])]
          compose.splice(index, 1)
          return { ...prev, compose }
        }),
        onMoveComponent: (index, delta) => setDraft(prev => {
          const compose = [...(prev.compose ?? [])]
          const target = index + delta
          if (target < 0 || target >= compose.length) return prev
          const [moved] = compose.splice(index, 1)
          compose.splice(target, 0, moved)
          return { ...prev, compose }
        }),
        onDuplicateTemplate: () => {
          if (!draft) return
          const copy = JSON.parse(JSON.stringify(draft))
          copy.id = `tpl-${Date.now().toString(36)}`
          copy.name = `${draft.name} 副本`
          setDraft(copy)
        },
        onDeleteTemplate: requestDelete,
        onEdit: patch => { setConfirmDelete(false); setDraft(prev => ({ ...prev, ...patch })) },
        onEditVariable: (index, patch) => setDraft(prev => {
          const next = JSON.parse(JSON.stringify(prev))
          next.variables[index] = { ...next.variables[index], ...patch }
          return next
        }),
        onAddVariable: () => setDraft(prev => {
          const next = JSON.parse(JSON.stringify(prev))
          next.variables = [...(next.variables ?? []), {
            key: `v${(next.variables ?? []).length + 1}`, label: '新变量', kind: 'input',
          }]
          return next
        }),
        onRemoveVariable: index => setDraft(prev => {
          const next = JSON.parse(JSON.stringify(prev))
          next.variables.splice(index, 1)
          return next
        }),
        onEditStep: (index, patch) => setDraft(prev => {
          const next = JSON.parse(JSON.stringify(prev))
          next.steps[index] = { ...next.steps[index], ...patch }
          return next
        }),
        onAddStep: () => setDraft(prev => {
          const next = JSON.parse(JSON.stringify(prev))
          next.steps = [...(next.steps ?? []), {
            id: `s${Date.now().toString(36)}`, kind: 'merge', source: '{base}', target: 'develop', push: false,
          }]
          return next
        }),
        onRemoveStep: index => setDraft(prev => {
          const next = JSON.parse(JSON.stringify(prev))
          next.steps.splice(index, 1)
          return next
        }),
        onMoveStep: (index, delta) => setDraft(prev => {
          const next = JSON.parse(JSON.stringify(prev))
          const target = index + delta
          if (target < 0 || target >= next.steps.length) return next
          const [moved] = next.steps.splice(index, 1)
          next.steps.splice(target, 0, moved)
          return next
        }),
        onSaveTemplate: () => void saveTemplate(),
      })
    }

    return {
      // `sidebarRightTabs` 与 `sidebarRight` 是面板存在的先决条件：没有右侧栏
      // 就没有可注册的标签页，声明它们让加载器等这些服务就绪再激活。
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'],
      /** 供测试直接调用；不属于宿主契约。 */
      __test: {
        renderRun, renderEdit, post, explain, initialValues, preview, matches,
        blankTemplate, statusView, CSS, computeDerived, applyDerived, propagateDerived,
        GitFlowPanel, BranchPicker, StepNode, LastFailureBanner,
        branchRows, branchTree, collectDirPaths, FolderIcon, BranchList, BranchMenu, ExecutionModal, stepSummary,
        CommitGraph, layoutCommitGraph, graphRefInfo, commitTime,
        blankComposeTemplate, isComposedTemplate, expandComposedTemplate,
        stepKindLabel, stepPushable, stepFlow,
        pickVariableFor, prefillValues,
        parseDiff, toSplitRows, changeLabel,
      },
      apply(ctx) {
        ensureStyles()

        /** 依次尝试注册的各面；一面失败不影响其它面。 */
        const register = (label, run) => {
          try {
            run()
          } catch (error) {
            console.error(`[git-flow] ${label} 注册失败`, error)
          }
        }

        const tabs = (() => {
          try {
            return typeof ctx.get === 'function' ? ctx.get('sidebarRightTabs') : undefined
          } catch {
            return undefined
          }
        })()
        const sidebar = (() => {
          try {
            return typeof ctx.get === 'function' ? ctx.get('sidebarRight') : undefined
          } catch {
            return undefined
          }
        })()

        if (tabs === undefined || tabs === null) {
          console.warn('[git-flow] 没有 sidebarRightTabs 服务，面板不会出现')
          return
        }

        // 标签页类型：kind 就是 openTab 使用的名字，guide 让它在右栏引导页里出现。
        register('tab type', () => {
          ctx.effect(() => tabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            title: () => 'Git 工作流',
            guide: [{
              id: 'git-flow',
              order: 70,
              title: () => 'Git 工作流',
              description: () => '自定义步骤的工作流指令与执行',
            }],
          }), 'git-flow: tab type')
        })

        // 正文：会话级。`sessionId` 只传给 inject，由它并入 props 交给组件。
        register('tab body', () => {
          ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: TAB_ID,
              inject: sessionId => ({ sessionId }),
            },
            GitFlowPanel,
          ))
        })

        // 标题：与正文同 key，保持标签文字稳定。
        register('tab title', () => {
          ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
            { name: 'sidebar.right.pane.tab.title', key: TAB_ID },
            () => h('span', null, 'Git 工作流'),
          ))
        })

        // 会话头部入口按钮。
        register('header button', () => {
          ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
            { name: 'conversation.session.header.utilities', id: 'git-flow-open', order: 60 },
            () => h(
              'button',
              {
                type: 'button',
                title: '打开 Git 工作流面板',
                style: {
                  fontSize: '11px', padding: '2px 9px', borderRadius: '7px',
                  border: '1px solid rgba(34,211,238,.45)', background: 'rgba(34,211,238,.10)',
                  color: '#a5f3fc', cursor: 'pointer', letterSpacing: '.06em',
                },
                onClick: () => {
                  try {
                    sidebar.openTab(TAB_KIND)
                  } catch (error) {
                    console.error('[git-flow] 打开面板失败', error)
                  }
                },
              },
              'Git',
            ),
          ))
        })
      },
    }
  },
})
