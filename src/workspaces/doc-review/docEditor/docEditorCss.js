/* Styles for the Review document editor — theme TOKENS only (no raw colours), and a layout that wraps at
 * phone width: the toolbar wraps, the Review pane stacks under the page, nothing scrolls the page sideways. */
// Editor-local type scale (a document page has its own reading sizes, not the app chrome scale).
const FS = { page: "14.5px", mono: "13.5px", h1: "1.7em", h2: "1.4em", h3: "1.18em", title: "2.1em", card: "12.5px", meta: "11.5px", ctl: "12px", raw: ".75em" }; // design-exempt: document-page reading scale
export const DOC_EDITOR_CSS = `
.dre-root{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;background:var(--surface-page);color:var(--text-primary);font-family:system-ui,sans-serif}
.dre-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;background:var(--surface-raised);border-bottom:1px solid var(--border-default);min-width:0}
.dre-bar .dre-group{display:flex;flex-wrap:wrap;align-items:center;gap:4px;min-width:0}
.dre-bar .dre-sep{width:1px;align-self:stretch;background:var(--border-default);margin:0 2px}
.dre-select{height:26px;max-width:100%;min-width:0;border:1px solid var(--border-default);border-radius:8px;background:var(--surface-raised);color:var(--text-primary);font:inherit;font-size:${FS.ctl};padding:0 6px}
.dre-color{width:28px;height:26px;padding:0;border:1px solid var(--border-default);border-radius:8px;background:var(--surface-raised);cursor:pointer}
.dre-note{font-size:${FS.ctl};color:var(--text-secondary);padding:4px 10px;background:var(--surface-raised);border-bottom:1px solid var(--border-default);overflow-wrap:anywhere}
.dre-note.warn{background:var(--warn-bg);color:var(--warn-text);border-color:var(--warn-border)}
.dre-note.err{background:var(--danger-bg);color:var(--danger-text);border-color:var(--danger-border)}
.dre-body{display:flex;flex:1;min-height:0;min-width:0}
.dre-scroll{flex:1;min-width:0;overflow:auto;padding:16px 12px}
.dre-page{background:var(--surface-raised);color:var(--text-primary);border:1px solid var(--border-default);border-radius:8px;max-width:820px;margin:0 auto;padding:36px 44px;min-height:60vh;outline:none;overflow-wrap:anywhere;word-break:break-word;font-size:${FS.page};line-height:1.5}
.dre-page.plain{font-family:ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;font-size:${FS.mono}}
.dre-page p{margin:0 0 .7em}
.dre-page h1{font-size:${FS.h1};margin:.9em 0 .4em;line-height:1.2}.dre-page h2{font-size:${FS.h2};margin:.9em 0 .4em;line-height:1.2}.dre-page h3{font-size:${FS.h3};margin:.9em 0 .4em;line-height:1.2}
.dre-page p[data-pstyle="Title"]{font-size:${FS.title};font-weight:700;line-height:1.15;margin-bottom:.5em}
.dre-page ul,.dre-page ol{padding-left:1.6em;margin:0 0 .7em}.dre-page li>p{margin:0 0 .2em}
.dre-page .tableWrapper{overflow-x:auto;max-width:100%;margin:0 0 .8em}
.dre-page table{border-collapse:collapse;width:100%;table-layout:fixed}
.dre-page td,.dre-page th{border:1px solid var(--border-strong);padding:4px 6px;vertical-align:top;min-width:2em;position:relative}
.dre-page td p,.dre-page th p{margin:0}
.dre-page img{max-width:100%;height:auto}
.dre-page .selectedCell:after{content:"";position:absolute;inset:0;background:var(--hover-ghost);pointer-events:none}
.dre-ins{color:var(--success-text);text-decoration:underline;text-decoration-style:solid}
.dre-del{color:var(--danger-text);text-decoration:line-through}
.dre-comment{background:var(--warn-bg);border-bottom:2px solid var(--warn-border)}
.dre-comment.active{background:var(--warn-border)}
.dre-raw{display:inline-block;font-size:${FS.raw};color:var(--text-secondary)}
.dre-raw-block{border:1px dashed var(--border-strong);border-radius:8px;padding:6px 8px;color:var(--text-secondary);font-size:${FS.ctl};margin:0 0 .7em}
.dre-pane{width:300px;flex:none;border-left:1px solid var(--border-default);background:var(--surface-raised);overflow:auto;padding:8px;display:flex;flex-direction:column;gap:8px;min-width:0}
.dre-card{border:1px solid var(--border-default);border-radius:8px;padding:8px;font-size:${FS.card};overflow-wrap:anywhere;background:var(--surface-page)}
.dre-card.resolved{opacity:.7}
.dre-card h4{margin:0 0 4px;font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.04em}
.dre-meta{font-size:${FS.meta};color:var(--text-secondary)}
.dre-card textarea,.dre-find input{width:100%;box-sizing:border-box;border:1px solid var(--border-default);border-radius:8px;background:var(--surface-raised);color:var(--text-primary);font:inherit;font-size:${FS.card};padding:5px 7px}
.dre-row{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:6px}
.dre-find{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 10px;background:var(--surface-raised);border-bottom:1px solid var(--border-default)}
.dre-find input{flex:1 1 140px;width:auto;min-width:0}
@media (max-width:700px){
  .dre-body{flex-direction:column}
  .dre-pane{width:auto;border-left:0;border-top:1px solid var(--border-default);max-height:42vh}
  .dre-page{padding:16px 14px;min-height:40vh}
  .dre-scroll{padding:8px}
  .dre-bar .dre-sep{display:none}
}
`;
