export const studioStyles = `
[data-conversation-scroll] > [data-slot="conversation.session"]:has(> * > [data-slot="conversation.view"] > .writer-studio) ~ [data-composer-seat] {
    display:none;
}
.writer-studio {
    --writer-bg:var(--dsw-alias-bg-layer-1);
    --writer-rail:var(--dsw-alias-bg-layer-2);
    --writer-ink:var(--dsw-alias-label-primary);
    --writer-muted:var(--dsw-alias-label-secondary);
    --writer-line:var(--dsw-alias-border-l1);
    --writer-accent:var(--dsw-alias-brand-primary);
    --writer-wash:color-mix(in srgb,var(--writer-accent) 10%,var(--writer-bg));
    color:var(--writer-ink);background:var(--writer-bg);font:13px/1.6 var(--dsw-font-family);
    height:100%;min-height:0;display:flex;flex-direction:column;container:writer-workbench / inline-size;position:relative;isolation:isolate;
}
.writer-studio *{box-sizing:border-box}
.writer-studio [hidden]{display:none!important}
.writer-studio h1,.writer-studio h2,.writer-studio h3,.writer-studio p{margin:0}
.writer-studio button,.writer-studio input,.writer-studio select,.writer-studio textarea{font-family:inherit}
.writer-studio .ws-button{font:inherit;color:inherit;border:1px solid transparent;background:transparent;border-radius:6px;padding:7px 10px;text-align:left;cursor:pointer;min-width:0}
.writer-studio .ws-button:hover{background:var(--writer-wash)}
.writer-studio .ws-button:disabled{opacity:.4;cursor:default}
.writer-studio .ws-button:focus-visible,.writer-studio input:focus-visible,.writer-studio select:focus-visible,.writer-studio textarea:focus-visible,.writer-studio summary:focus-visible{outline:2px solid var(--writer-accent);outline-offset:2px}
.writer-studio .ws-button[aria-pressed=true]{background:var(--writer-wash);color:var(--writer-accent);font-weight:600}
.writer-studio .ws-outline{border-color:var(--writer-line)}
.writer-studio .ws-top{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:14px 20px;border-bottom:1px solid var(--writer-line);flex-shrink:0}
.writer-studio .ws-book{font-family:SimSun,'Songti SC',serif;font-size:19px;font-weight:500;overflow-wrap:anywhere}
.writer-studio .ws-top-status{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--writer-muted)}
.writer-studio .ws-layout{flex:1;min-height:0;display:grid;grid-template-columns:175px minmax(0,1fr)}
.writer-studio .ws-nav{background:var(--writer-rail);border-right:1px solid var(--writer-line);padding:16px 10px;overflow:auto}
.writer-studio .ws-nav-list{display:grid;gap:4px}
.writer-studio .ws-nav .ws-button{display:flex;align-items:center;gap:9px;width:100%;padding:10px}
.writer-studio .ws-nav svg{width:16px;height:16px;flex-shrink:0}
.writer-studio .ws-count{margin-left:auto;font-size:11px;font-variant-numeric:tabular-nums}
.writer-studio .ws-nav-note{border-top:1px solid var(--writer-line);margin-top:20px;padding:16px 10px;color:var(--writer-muted);font-size:12px;line-height:1.9}
.writer-studio .ws-main{min-width:0;min-height:0;position:relative;display:flex;flex-direction:column}
.writer-studio .ws-view{height:100%;min-height:0;display:flex;flex-direction:column}
.writer-studio .ws-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:14px 24px;border-bottom:1px solid var(--writer-line);flex-shrink:0}
.writer-studio .ws-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.writer-studio .ws-reader-grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 240px}
.writer-studio .ws-reader{overflow:auto;min-width:0;min-height:0;padding:34px clamp(20px,4cqw,48px) 40px;scrollbar-gutter:stable}
.writer-studio .ws-chapter-title{font:500 27px/1.6 SimSun,'Songti SC',serif;letter-spacing:1px;margin:10px 0 8px;overflow-wrap:anywhere}
.writer-studio .ws-eyebrow{font-size:11px;letter-spacing:2px;color:var(--writer-muted)}
.writer-studio .ws-meta{font-size:12px;color:var(--writer-muted);display:flex;flex-wrap:wrap;gap:12px}
.writer-studio .ws-prose{max-width:38em;margin:28px auto 0;overflow-wrap:anywhere}
.writer-studio .ws-prose p,.writer-studio .ws-prose li{font:18px/2 SimSun,'Songti SC',serif;margin-bottom:.9em}
.writer-studio .ws-prose h1,.writer-studio .ws-prose h2,.writer-studio .ws-prose h3{font-family:SimSun,'Songti SC',serif;line-height:1.8;margin:1em 0 .6em}
.writer-studio .ws-reader-footer{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;border-top:1px solid var(--writer-line);padding-top:16px;margin-top:28px}
.writer-studio .ws-context{overflow:auto;min-height:0;border-left:1px solid var(--writer-line);padding:24px 18px}
.writer-studio .ws-context-section+.ws-context-section{margin-top:25px}
.writer-studio .ws-context h3{font-size:12px;margin-bottom:10px}
.writer-studio .ws-context p{color:var(--writer-muted);line-height:1.9;font-size:12px;white-space:pre-wrap}
.writer-studio .ws-context .ws-button{font-size:12px;color:var(--writer-accent);padding:5px 0;margin-top:6px}
.writer-studio .ws-context-toggle{display:none}
.writer-studio .ws-muted{color:var(--writer-muted);font-size:12px;line-height:1.8}
.writer-studio .ws-page{padding:26px;overflow:auto;min-height:0;flex:1;scrollbar-gutter:stable}
.writer-studio .ws-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px}
.writer-studio .ws-heading h2{font-size:22px;font-weight:500;letter-spacing:1px}
.writer-studio .ws-heading p{color:var(--writer-muted);font-size:12px;margin-top:6px}
.writer-studio .ws-split{display:grid;grid-template-columns:minmax(150px,210px) minmax(0,1fr);gap:24px;align-items:start}
.writer-studio .ws-entity-list{display:grid;gap:5px;max-height:calc(100cqh - 180px);overflow:auto;align-content:start}
.writer-studio .ws-entity-list .ws-button{padding:12px;width:100%;overflow-wrap:anywhere}
.writer-studio .ws-entity-list .ws-button span{display:block}
.writer-studio .ws-detail{border-left:1px solid var(--writer-line);padding-left:24px;min-width:0;overflow-wrap:anywhere}
.writer-studio .ws-detail h2{font-size:22px;font-weight:500;margin:5px 0 12px}
.writer-studio .ws-detail h3{font-size:14px;margin:24px 0 10px}
.writer-studio .ws-detail p{line-height:1.95}
.writer-studio .ws-detail .ws-markdown{line-height:1.95}
.writer-studio .ws-markdown{overflow-wrap:anywhere}
.writer-studio .ws-markdown table{max-width:100%;display:block;overflow:auto}
.writer-studio .ws-markdown pre{max-width:100%;overflow:auto}
.writer-studio .ws-markdown img{max-width:100%}
.writer-studio .ws-tabs{display:flex;flex-wrap:wrap;gap:5px;border-bottom:1px solid var(--writer-line);padding:12px 0;margin-bottom:16px}
.writer-studio .ws-timeline{display:grid;gap:20px;margin-top:20px}
.writer-studio .ws-timeline-item{border-left:2px solid var(--writer-line);padding-left:16px}
.writer-studio .ws-timeline-item p{font-size:12px;color:var(--writer-muted);margin-top:6px;white-space:pre-wrap}
.writer-studio .ws-note{background:var(--writer-rail);padding:16px 18px;border-radius:7px;margin:16px 0;overflow-wrap:anywhere}
.writer-studio .ws-suggestion{border-top:1px solid var(--writer-line);padding:18px 0}
.writer-studio .ws-suggestion p{margin-bottom:12px;white-space:pre-wrap}
.writer-studio .ws-archive{border-top:1px solid var(--writer-line);padding:16px 0;margin-top:24px}
.writer-studio summary{cursor:pointer}
.writer-studio .ws-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;margin:24px 0}
.writer-studio .ws-stat{border-left:1px solid var(--writer-line);padding-left:16px}
.writer-studio .ws-stat strong{display:block;font-size:26px;font-weight:500;font-variant-numeric:tabular-nums}
.writer-studio .ws-progress{height:4px;background:var(--writer-rail);margin:14px 0 8px;border-radius:4px;overflow:hidden}
.writer-studio .ws-progress span{display:block;height:100%;background:var(--writer-accent)}
.writer-studio .ws-input{font:inherit;color:inherit;background:var(--writer-bg);border:1px solid var(--writer-line);border-radius:6px;padding:9px 11px;width:100%;min-width:0}
.writer-studio .ws-field{display:grid;gap:6px;font-size:12px;margin:12px 0}
.writer-studio .ws-alert{padding:10px 20px;border-bottom:1px solid var(--writer-line);color:var(--dsw-alias-state-warn-primary);font-size:12px;flex-shrink:0;overflow-wrap:anywhere}
.writer-studio .ws-empty{padding:50px 24px;text-align:center;color:var(--writer-muted);line-height:1.9}
.writer-studio .ws-overlay{position:absolute;inset:0;z-index:20;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;background:color-mix(in srgb,var(--writer-ink) 24%,transparent);overflow:auto}
.writer-studio .ws-dialog{background:var(--writer-bg);border:1px solid var(--writer-line);border-radius:10px;padding:22px;width:min(480px,100%);box-shadow:0 12px 40px color-mix(in srgb,var(--writer-ink) 15%,transparent);flex-shrink:0}
.writer-studio .ws-dialog.wide{width:min(620px,100%)}
.writer-studio .ws-dialog-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px}
.writer-studio .ws-dialog-head h2{font-size:19px;font-weight:500}
.writer-studio .ws-directory-list{height:320px;display:grid;grid-template-rows:repeat(8,40px);padding:0;margin:12px 0}
.writer-studio .ws-directory-list .ws-button{display:flex;align-items:center;gap:14px;width:100%;padding:8px 10px}
.writer-studio .ws-directory-list .ws-button span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.writer-studio .ws-number{font-variant-numeric:tabular-nums;color:var(--writer-muted);flex-shrink:0;width:38px}
.writer-studio .ws-dialog-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding-top:14px;border-top:1px solid var(--writer-line)}
.writer-studio .ws-request-text{min-height:210px;resize:vertical;line-height:1.8}
.writer-studio .ws-graph{width:100%;height:auto;max-height:360px}
.writer-studio .ws-link{color:var(--writer-accent)}
@container writer-workbench (max-width:1099px){
    .writer-studio .ws-reader-grid{grid-template-columns:minmax(0,1fr)}
    .writer-studio .ws-context{display:none}
    .writer-studio .ws-context.is-open{display:block;position:absolute;right:0;top:0;bottom:0;width:min(310px,100%);background:var(--writer-bg);z-index:2;border-left:1px solid var(--writer-line)}
    .writer-studio .ws-context-toggle{display:inline-flex}
}
@container writer-workbench (max-width:819px){
    .writer-studio .ws-layout{grid-template-columns:140px minmax(0,1fr)}
    .writer-studio .ws-page{padding:22px 18px}
    .writer-studio .ws-split{grid-template-columns:150px minmax(0,1fr);gap:16px}
    .writer-studio .ws-detail{padding-left:16px}
    .writer-studio .ws-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@container writer-workbench (max-width:619px){
    .writer-studio .ws-layout{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
    .writer-studio .ws-nav{padding:6px;border-right:0;border-bottom:1px solid var(--writer-line)}
    .writer-studio .ws-nav-list{display:flex;flex-wrap:wrap;gap:2px}
    .writer-studio .ws-nav .ws-button{width:auto;padding:7px 8px;font-size:12px}
    .writer-studio .ws-nav-note{display:none}
    .writer-studio .ws-top{padding:12px 14px}
    .writer-studio .ws-top-status{margin-left:0}
    .writer-studio .ws-toolbar{padding:10px 14px}
    .writer-studio .ws-reader{padding:24px 20px}
    .writer-studio .ws-split{grid-template-columns:minmax(0,1fr)}
    .writer-studio .ws-entity-list{display:flex;flex-wrap:wrap;max-height:180px}
    .writer-studio .ws-entity-list .ws-button{width:auto}
    .writer-studio .ws-detail{border-left:0;border-top:1px solid var(--writer-line);padding:20px 0 0}
    .writer-studio .ws-overlay{padding:10px 6px}
    .writer-studio .ws-dialog{padding:16px}
}
@media(pointer:coarse){.writer-studio .ws-button{min-height:44px}.writer-studio .ws-input{font-size:16px}.writer-studio .ws-directory-list{height:352px;grid-template-rows:repeat(8,44px)}}
.writer-studio .ws-welcome{flex:1;overflow:auto;min-height:0;max-width:920px;width:100%;margin:0 auto;padding:clamp(24px,5cqw,64px);box-sizing:border-box}
.writer-studio .ws-welcome h1{font-size:clamp(24px,3cqw,34px);line-height:1.4;margin:12px 0 20px}
.writer-studio .ws-welcome-lead{font-size:15px;line-height:1.9;color:var(--writer-muted);margin-bottom:24px}
.writer-studio .ws-welcome-paths{padding:16px 20px;background:var(--writer-rail);border:1px solid var(--writer-line);border-radius:12px;font-size:13px}
.writer-studio .ws-welcome-paths dt{color:var(--writer-muted);margin:8px 0 4px}
.writer-studio .ws-welcome-paths dd{margin:0 0 12px;overflow-wrap:anywhere}
.writer-studio .ws-welcome-preview{margin:28px 0}
.writer-studio .ws-welcome-preview h2{font-size:16px}
.writer-studio .ws-welcome-preview>div{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:20px;line-height:1.9;font-size:13px}
.writer-studio .ws-welcome-steps{padding-left:22px;font-size:14px;line-height:2;margin:24px 0}
@media(prefers-reduced-motion:reduce){.writer-studio *{scroll-behavior:auto!important}}
`
