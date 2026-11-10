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
 * - 执行：选模板 → 填变量 → 按顺序执行步骤，每步独立状态，失败可单步重试。
 * - 模板：新建/编辑/删除模板，自由增删步骤、调整顺序、勾选是否推送。
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
    /** 记住上次选中的模板，重开面板时回到它，而不是跳回第一个。 */
    const LAST_TEMPLATE_KEY = 'dsh-git-flow:last-template'

    /** 各请求路由（浏览器相对路径）。 */
    const ROUTE = {
      repo: 'git-flow/repo',
      templates: 'git-flow/templates',
      save: 'git-flow/templates/save',
      remove: 'git-flow/templates/delete',
      step: 'git-flow/step',
      conflict: 'git-flow/merge-conflict',
      restore: 'git-flow/templates/restore-default',
      checkout: 'git-flow/checkout',
      fetch: 'git-flow/fetch',
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

/* 模板列表：一行一个卡片，点开的那张在下方展开配置 */
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
.dgf-resume{font-size:10.5px; line-height:1.5; color:#a5f3fc; background:rgba(34,211,238,.08);
  border:1px solid rgba(34,211,238,.28); border-radius:7px; padding:5px 7px}

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

.dgf-toggle{display:flex; align-items:center; gap:6px; font-size:10.5px; color:var(--dgf-dim);
  cursor:pointer; padding:2px 0; user-select:none}
.dgf-toggle:hover{color:var(--dgf-text)}
.dgf-toggle input{accent-color:#22d3ee; cursor:pointer; margin:0}

.dgf-dock{position:sticky; bottom:0; z-index:2; display:flex; gap:6px; padding:8px 0 10px;
  background:linear-gradient(180deg, transparent,
    color-mix(in srgb, var(--dsw-alias-bg-base,#0a0e14) 92%, transparent) 45%)}
.dgf-dock .dgf-btn{flex:1; padding:7px 10px}

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
     * 读上次选中的模板 id。
     *
     * 存储不可用（隐私模式、被禁用）时返回空串，功能退化为「选第一个」，不影响使用。
     *
     * @returns 模板 id；没有记录时为空串。
     */
    function readLastTemplate() {
      try {
        return window.localStorage.getItem(LAST_TEMPLATE_KEY) ?? ''
      } catch {
        return ''
      }
    }

    /**
     * 记住当前选中的模板 id。
     *
     * @param id 模板 id；传空串表示清除记录。
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

    /** 新建空模板的默认骨架。 */
    function blankTemplate() {
      return {
        id: `tpl-${Date.now().toString(36)}`,
        name: '新模板',
        variables: [{ key: 'base', label: '基础分支', kind: 'pick', pattern: '*' }],
        steps: [{ id: 's1', kind: 'create', source: '{base}', target: 'release/x', push: false }],
      }
    }

    /**
     * 按模板声明初始化变量取值。
     *
     * @param template 模板。
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
     * @param field 模板字段。
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
          }, '模板')))
    }

    /**
     * 分支选择器：可点选的下拉 + 可输入过滤 + 允许手填。
     *
     * 步骤里的「来源 / 目标」既可能是模板变量（`{feature}`），也可能是仓库里现有的
     * 分支，还可能是这次要新建、暂时不存在的分支。所以三样都要能用：下拉点选、
     * 输入过滤、直接手打。
     *
     * @param props `value`、`variables`（模板变量）、`branches`（仓库分支）、`onChange`。
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
            onClick: () => {
              if (open) {
                setOpen(false)
                return
              }
              openAt(reactCurrentInput(event))
            },
          }, '▾'),
          isVariable
            ? h('span', { className: 'dgf-chip', 'data-tone': 'kind' }, '变量')
            : isBranch
              ? h('span', { className: 'dgf-chip', 'data-tone': 'ok' }, '分支')
              : value.trim() === ''
                ? null
                : h('span', { className: 'dgf-chip' }, '手填')),
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
     * 一个执行步骤的管线节点。
     *
     * @param props 步骤、下标、解析后的分支、状态与回调。
     * @returns React 节点。
     */
    function StepNode(props) {
      const { step, index, source, target, status, busy } = props
      const view = statusView(status ? status.status : 'todo')
      const state = status ? status.status : 'todo'
      return h('div', { className: 'dgf-node-row' },
        h('span', { className: 'dgf-rail' }),
        h('span', { className: 'dgf-node', 'data-status': state }, String(index + 1)),
        h('div', { className: 'dgf-step', 'data-status': state },
          h('div', { className: 'dgf-step-top' },
            h('div', { style: { display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' } },
              h('span', { className: 'dgf-chip', 'data-tone': 'kind' },
                step.kind === 'create' ? '建分支' : step.kind === 'push' ? '推送' : '合并'),
              h('span', { className: 'dgf-chip', 'data-tone': view.tone }, view.text),
              step.push ? h('span', { className: 'dgf-chip', 'data-tone': 'push' }, '推送') : null),
            h('button', {
              className: 'dgf-btn',
              disabled: busy === true,
              onClick: () => props.onRun(index),
            }, '执行')),
          h('div', { className: 'dgf-flow' },
            step.kind === 'push'
              ? h('span', { className: 'dgf-flow-src' }, '推送')
              : h('span', { className: 'dgf-flow-src' }, step.kind === 'create' ? `从 ${source}` : source),
            step.kind === 'push' ? null : h('span', { className: 'dgf-flow-arrow' }, '▸'),
            h('span', { className: 'dgf-flow-dst' }, target)),
          step.note ? h('div', { className: 'dgf-note' }, step.note) : null,
          status && status.message
            ? h('div', { className: 'dgf-result', 'data-status': state }, status.message)
            : null,
          status && Array.isArray(status.conflicts) && status.conflicts.length > 0
            ? h('div', { className: 'dgf-conflict-files' },
              status.conflicts.map(file => h('div', { key: file, className: 'dgf-conflict-file' }, file)))
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

    /**
     * 渲染「执行」页签。纯函数。
     *
     * @param view 状态与回调。
     * @returns React 节点。
     */
    function renderRun(view) {
      const { repo, templates, template, values, statuses, busy, log, error } = view

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
            h('div', { className: 'dgf-alert' }, repo.error || '当前目录不是 git 仓库')))
      }

      const branches = repo.branches.map(item => item.name)
      const steps = template ? template.steps : []
      const doneCount = steps.filter(step => {
        const status = statuses[step.id]
        return status && (status.status === 'ok' || status.status === 'skipped')
      }).length
      const percent = steps.length === 0 ? 0 : Math.round((doneCount / steps.length) * 100)
      const dirty = repo.dirtyCount > 0

      return h('div', { className: 'dgf-root' },
        h(Hud, {
          tab: 'run',
          led: error !== null ? 'bad' : dirty ? 'warn' : 'ok',
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
              }, '拉取'))),
          h('div', { className: 'dgf-caption' },
            repo.current ? `当前 ${repo.current}` : '游离 HEAD',
            dirty ? ` · 已跟踪改动 ${repo.dirtyCount}` : ' · 工作区干净'),

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

          h('div', { className: 'dgf-sec' },
            h('div', { className: 'dgf-sec-head' },
              h('span', { className: 'dgf-sec-title' }, '模板'),
              h('button', { className: 'dgf-btn', 'data-variant': 'ghost', onClick: view.onNewTemplate }, '＋ 新建')),
            h('select', {
              className: 'dgf-select',
              value: template ? template.id : '',
              onChange: event => view.onSelectTemplate(event.target.value),
            }, templates.map(item => h('option', { key: item.id, value: item.id }, item.name))),
            template && template.description ? h('div', { className: 'dgf-caption' }, template.description) : null),

          template ? h('div', { className: 'dgf-sec' },
            h('div', { className: 'dgf-sec-head' },
              h('span', { className: 'dgf-sec-title' }, '参数'),
              (template.variables ?? []).some(v => (values[v.key] ?? '').trim() === '')
                ? h('span', { className: 'dgf-chip', 'data-tone': 'skip' }, '待填写')
                : h('span', { className: 'dgf-chip', 'data-tone': 'ok' }, '就绪')),
            (template.variables ?? []).length === 0
              ? h('div', { className: 'dgf-caption' }, '这个模板没有变量')
              : (template.variables ?? []).map(variable => h(VariableRow, {
                key: variable.key,
                variable,
                values,
                value: values[variable.key] ?? '',
                branches,
                onChange: next => view.onValue(variable.key, next),
              }))) : null,

          template ? h('div', { className: 'dgf-sec' },
            h('div', { className: 'dgf-sec-head' },
              h('span', { className: 'dgf-sec-title' }, `流水线 · ${steps.length} 步`),
              h('span', { className: 'dgf-meter-text' }, `${doneCount}/${steps.length}`)),
            h('div', { className: 'dgf-meter' },
              h('div', { className: 'dgf-meter-bar' },
                h('div', { className: 'dgf-meter-fill', style: { width: `${percent}%` } })),
              h('span', { className: 'dgf-meter-text' }, `${percent}%`)),
            steps.length === 0
              ? h('div', { className: 'dgf-empty' }, '这个模板还没有步骤，去「模板」页签添加')
              : h('div', { className: 'dgf-pipe' }, steps.map((step, index) => h(StepNode, {
                key: step.id,
                step,
                index,
                source: preview(step.source, values),
                target: preview(step.target, values),
                status: statuses[step.id],
                busy,
                // 该步因冲突失败，但仓库里已经没有进行中的操作 = 冲突已在外部解决
                resumeHint: Boolean(statuses[step.id]
                  && statuses[step.id].status === 'failed'
                  && Array.isArray(statuses[step.id].conflicts)
                  && statuses[step.id].conflicts.length > 0
                  && (repo.inProgress === null || repo.inProgress === undefined)),
                onRun: view.onRunOne,
              })))) : null,

          h(LogView, { log }),

          h('label', { className: 'dgf-toggle' },
            h('input', {
              type: 'checkbox',
              checked: view.restoreBranch !== false,
              onChange: event => view.onRestoreBranch(event.target.checked),
            }),
            h('span', null, '执行完切回原分支')),
          h('div', { className: 'dgf-dock' },
            h('button', {
              className: 'dgf-btn',
              'data-variant': 'primary',
              disabled: busy === true,
              onClick: view.onRunAll,
            }, busy ? '执行中…' : '▶ 全部执行'),
            view.hasFailure
              ? h('button', {
                className: 'dgf-btn',
                disabled: busy === true,
                onClick: view.onRetryFailed,
              }, '↻ 重试')
              : null),
          h('div', { className: 'dgf-caption', style: { textAlign: 'center' } },
            '已完成的分支与合并会自动跳过，可重复运行')),

        // 执行前确认：把解析后的流程摆出来，避免误触直接改分支。
        view.pending === null || view.pending === undefined
          ? null
          : h('div', { className: 'dgf-confirm-mask' },
            h('div', { className: 'dgf-confirm' },
              h('div', { className: 'dgf-confirm-title' },
                h('span', { className: 'dgf-led', 'data-state': 'warn' }),
                view.pending.mode === 'one' ? '确认执行这一步？' : '确认执行整个流程？'),
              h('div', { className: 'dgf-confirm-meta' },
                `${repo.root}`, repo.current ? ` · 当前 ${repo.current}` : ''),
              h('div', { className: 'dgf-confirm-steps' },
                (view.pending.mode === 'one'
                  ? [template.steps[view.pending.index]]
                  : template.steps.slice(view.pending.fromIndex ?? 0)
                ).filter(Boolean).map((step, offset) => {
                  const source = preview(step.source, values)
                  const target = preview(step.target, values)
                  const index = (view.pending.mode === 'one' ? view.pending.index : (view.pending.fromIndex ?? 0)) + offset
                  return h('div', { key: step.id, className: 'dgf-confirm-step' },
                    h('span', { className: 'dgf-sha' }, `${index + 1}.`),
                    h('span', { className: 'dgf-confirm-text' },
                      step.kind === 'push'
                        ? `推送 ${target}`
                        : step.kind === 'create'
                          ? `从 ${source} 创建 ${target}`
                          : `${source} → ${target}`),
                    step.kind !== 'push' && step.push
                      ? h('span', { className: 'dgf-chip', 'data-tone': 'push' }, '推送')
                      : null)
                })),
              h('div', { className: 'dgf-confirm-hint' },
                view.restoreBranch !== false && repo.current
                  ? `执行过程中会 checkout 到目标分支，完成后切回 ${repo.current}`
                  : '执行过程中会 checkout 到目标分支，结束后停在最后一个分支'),
              h('div', { className: 'dgf-confirm-actions' },
                h('button', {
                  className: 'dgf-btn',
                  onClick: view.onCancelRun,
                }, '取消'),
                h('button', {
                  className: 'dgf-btn',
                  'data-variant': 'primary',
                  disabled: busy === true,
                  onClick: view.onConfirmRun,
                }, '确认执行')))))
    }

    /**
     * 渲染「模板」页签。纯函数。
     *
     * @param view 草稿模板、模板列表与回调。
     * @returns React 节点。
     */
    /**
     * 渲染一个模板的编辑表单：名称、说明、变量、步骤、预览。
     *
     * 只在列表里展开的那一项调用，因此它不关心"当前是哪个模板"。
     *
     * @param view 回调集合。
     * @param draft 正在编辑的模板草稿。
     * @returns React 节点数组。
     */
    function renderTemplateBody(view, draft) {
      /** 用变量默认值预览一遍步骤。 */
      const guess = {}
      for (const variable of draft.variables ?? []) guess[variable.key] = variable.default ?? ''

      return [
        view.draftInvalid
          ? h('div', { className: 'dgf-alert' }, `这个模板有问题：${view.draftInvalid}。修好之前无法保存。`)
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

        // 变量
        h('div', { className: 'dgf-subsec' },
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

        // 步骤
        h('div', { className: 'dgf-subsec' },
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
              h('option', { value: 'push' }, '推送')),
              // 「推送」步骤本身就是推送，不需要再勾一次。
              step.kind === 'push'
                ? null
                : h('label', {
                  style: {
                    display: 'flex', alignItems: 'center', gap: '4px',
                    fontSize: '10px', color: 'var(--dgf-dim)',
                  },
                },
                h('input', {
                  type: 'checkbox',
                  checked: step.push === true,
                  onChange: event => view.onEditStep(index, { push: event.target.checked }),
                }), '推送'),
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

        // 预览
        h('div', { className: 'dgf-subsec' },
          h('div', { className: 'dgf-sec-head' },
            h('span', { className: 'dgf-sec-title' }, '预览')),
          (draft.steps ?? []).map((step, index) => {
            const source = preview(step.source, guess)
            const target = preview(step.target, guess)
            return h('div', { key: index, className: 'dgf-flow' },
              step.kind === 'push'
                ? h('span', { className: 'dgf-flow-src' }, '推送')
                : h('span', { className: 'dgf-flow-src' }, step.kind === 'create' ? `从 ${source}` : source),
              step.kind === 'push' ? null : h('span', { className: 'dgf-flow-arrow' }, '▸'),
              h('span', { className: 'dgf-flow-dst' }, target),
              step.kind !== 'push' && step.push
                ? h('span', { className: 'dgf-chip', 'data-tone': 'push' }, '推送')
                : null)
          })),

        // 操作
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
          h('button', {
            className: 'dgf-btn',
            'data-variant': 'primary',
            disabled: view.busy === true,
            onClick: view.onSaveTemplate,
          }, view.busy ? '保存中…' : '保存模板'),
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
     * 渲染「模板」页签：模板列表，点开某一项在其下方展开配置。
     *
     * @param view 草稿模板、模板列表与回调。
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
                h('span', { className: 'dgf-sec-title' }, '模板'),
                h('div', { style: { display: 'flex', gap: '4px' } },
                  h('button', {
                    className: 'dgf-btn', 'data-variant': 'primary', onClick: view.onNewTemplate,
                  }, '新建'),
                  h('button', { className: 'dgf-btn', onClick: view.onRestoreDefault }, '恢复默认'))),
              templates.length === 0
                ? h('div', { className: 'dgf-empty' },
                  h('div', null, '还没有模板'),
                  h('button', {
                    className: 'dgf-btn',
                    'data-variant': 'primary',
                    style: { marginTop: '8px' },
                    onClick: view.onRestoreDefault,
                  }, '恢复默认模板'))
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
                item.invalid === undefined ? null : h('span', { className: 'dgf-chip', 'data-tone': 'fail' }, '有问题')))))),
            h(LogView, { log })))
      }

      // 列表以已保存的模板为准，但"新建"出来的草稿还没保存，必须也占一行，
      // 否则点了新建却看不到任何可编辑的东西。
      const savedIds = new Set(templates.map(item => item.id))
      const draftUnsaved = draft !== null && !savedIds.has(draft.id)
      const rows = draftUnsaved ? [{ ...draft, __unsaved: true }, ...templates] : templates

      return h('div', { className: 'dgf-root' },
        h(Hud, { tab: 'edit', led: 'ok', onRunTab: view.onRunTab, onEditTab: view.onEditTab }),
        h('div', { className: 'dgf-scroll' },
          h('div', { className: 'dgf-sec' },
            h('div', { className: 'dgf-sec-head' },
              h('span', { className: 'dgf-sec-title' }, `模板 · ${rows.length}`),
              h('div', { style: { display: 'flex', gap: '4px' } },
                h('button', {
                  className: 'dgf-btn', 'data-variant': 'primary', onClick: view.onNewTemplate,
                }, '新建'),
                h('button', { className: 'dgf-btn', onClick: view.onRestoreDefault }, '恢复默认'))),

            // 列表：一行一个模板，点开的那个在下方展开配置。
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
      const [selectedId, setSelectedId] = React.useState('')
      const [values, setValues] = React.useState({})
      const [statuses, setStatuses] = React.useState({})
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [log, setLog] = React.useState([])
      const [error, setError] = React.useState(null)
      // 删除要连点两次才生效，避免误触把模板删掉。
      const [confirmDelete, setConfirmDelete] = React.useState(false)
      // 模板行是否收起。收起只是不显示表单，草稿仍留在内存里，再点开还能接着改。
      const [collapsed, setCollapsed] = React.useState(false)
      // 流程跑完后把用户送回来时所在的分支，避免停在最后一次合并的目标分支上。
      const [restoreBranch, setRestoreBranch] = React.useState(true)
      // 待确认的执行请求：{ mode: 'all' | 'retry' | 'one', fromIndex?, index? }
      const [pending, setPending] = React.useState(null)
      // 正在跟随推导的变量 key；用户手填后移出，清空后放回。
      const [following, setFollowing] = React.useState([])

      const branches = React.useMemo(
        () => (repo && repo.branches ? repo.branches.map(item => item.name) : []),
        [repo],
      )
      const template = templates.find(item => item.id === selectedId) ?? templates[0] ?? null

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
        }
      }

      /** 读模板列表。 */
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
        })()
        // 只在会话变化时初始化一次。
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [sessionId])

      const templateId = template ? template.id : ''
      const repoReady = repo !== null

      // 切换模板（或首次读到仓库）时重置变量与步骤状态。
      React.useEffect(() => {
        if (!template) return
        setValues(initialValues(template, branches))
        setFollowing((template.variables ?? []).filter(variable => variable.derive).map(variable => variable.key))
        setStatuses({})
        setLog([])
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [templateId, repoReady])

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
       * @param index 步骤下标。
       * @returns 该步结果。
       */
      const runOne = async (index) => {
        const step = template.steps[index]
        if (!step) return { ok: false, message: '步骤不存在' }
        setStatuses(prev => ({ ...prev, [step.id]: { status: 'running', message: '' } }))
        try {
          // 同步策略随模板走；缺省 merge（分叉时自动合并远端最新）。
          const data = await post(ROUTE.step, { sessionId, step, values, sync: template.sync ?? 'merge' })
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
            },
          }))
          setLog(prev => [...prev, { ok: outcome.ok, text: outcome.message }])
          return outcome
        } catch (err) {
          const message = explain(err)
          setStatuses(prev => ({ ...prev, [step.id]: { status: 'failed', message } }))
          setLog(prev => [...prev, { ok: false, text: message }])
          return { ok: false, message }
        }
      }

      /**
       * 顺序执行步骤，遇到失败即停。
       *
       * @param fromIndex 起始下标。
       */
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

      /** 当前分支名，作为"执行完切回"的目标。 */
      const startBranchOf = () => (repo && typeof repo.current === 'string' ? repo.current : '')

      const runAll = async (fromIndex = 0) => {
        if (busy) return
        // 步骤会 checkout 到各个目标分支，先记住起点，跑完再切回来。
        const startBranch = startBranchOf()
        setBusy(true)
        try {
          for (let i = fromIndex; i < template.steps.length; i += 1) {
            const outcome = await runOne(i)
            if (!outcome.ok) break
          }
        } finally {
          await restoreTo(startBranch)
          setBusy(false)
          await refreshRepo()
        }
      }

      /**
       * 只跑一步，跑完同样按开关切回原分支。
       *
       * @param index 步骤下标。
       */
      const runOneRestoring = async (index) => {
        if (busy) return
        const startBranch = startBranchOf()
        setBusy(true)
        try {
          await runOne(index)
        } finally {
          await restoreTo(startBranch)
          setBusy(false)
          await refreshRepo()
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
        }
      }

      /** 保存当前草稿模板。 */
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
          setLog([{ ok: true, text: `已保存模板「${draft.name}」` }])
        } catch (err) {
          setLog([{ ok: false, text: explain(err) }])
        } finally {
          setBusy(false)
        }
      }

      /**
       * 删除当前草稿模板；第一次调用只进入确认态。
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
          setLog([{ ok: true, text: '已删除模板' }])
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
        setValues(prev => {
          const changed = { ...prev, [key]: value }
          return propagateDerived(template.variables ?? [], changed, key, following)
        })
        // 用户手改推导字段：填了值就退出跟随，清空则恢复跟随。
        const isDerived = (template.variables ?? []).some(variable => variable.key === key && variable.derive)
        if (isDerived) {
          setFollowing(prev => {
            const isFollowing = prev.includes(key)
            if (value.trim() === '' && !isFollowing) return [...prev, key]
            if (value.trim() !== '' && isFollowing) return prev.filter(item => item !== key)
            return prev
          })
        }
      }

      /** 把内置默认模板加回来。 */
      const restoreDefault = async () => {
        if (busy) return
        setBusy(true)
        try {
          const data = await post(ROUTE.restore, {})
          setTemplates(data.templates ?? [])
          setLog([{ ok: true, text: data.restored ? '已恢复默认模板' : '默认模板已存在' }])
        } catch (err) {
          setLog([{ ok: false, text: explain(err) }])
        } finally {
          setBusy(false)
        }
      }

      /** 进入编辑页签，用当前模板填充草稿。 */
      const startEdit = () => {
        setDraft(template ? JSON.parse(JSON.stringify(template)) : blankTemplate())
        setConfirmDelete(false)
        setCollapsed(false)
        setLog([])
        setTab('edit')
      }

      const failedIndex = template
        ? template.steps.findIndex(step => statuses[step.id] && statuses[step.id].status === 'failed')
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
          template,
          values,
          statuses,
          busy,
          log,
          error,
          hasFailure: failedIndex !== -1,
          restoreBranch,
          onRestoreBranch: next => setRestoreBranch(next),
          pending,
          onCancelRun: () => setPending(null),
          onConfirmRun: () => {
            const request = pending
            setPending(null)
            if (request === null || request === undefined) return
            if (request.mode === 'one') void runOneRestoring(request.index)
            else void runAll(request.fromIndex ?? 0)
          },
          onRefresh: () => void refreshRepo(),
          onPull: () => void pullUpdates(),
          onSelectTemplate: id => {
            setSelectedId(id)
            rememberTemplate(id)
          },
          onValue: (key, value) => {
            scheduleValue(key, value)
          },
          onRunAll: () => setPending({ mode: 'all', fromIndex: 0 }),
          onAbortMerge: () => void resolveMerge('abort'),
          onContinueMerge: () => void resolveMerge('continue'),
          onRunOne: index => setPending({ mode: 'one', index }),
          onRetryFailed: () => setPending({ mode: 'retry', fromIndex: failedIndex < 0 ? 0 : failedIndex }),
          onNewTemplate: () => {
            setDraft(blankTemplate())
            setLog([])
            setTab('edit')
          },
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
        GitFlowPanel, BranchPicker,
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
              description: () => '自定义步骤的工作流模板与执行',
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
