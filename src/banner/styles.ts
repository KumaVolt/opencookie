import type { SiteTheme } from '../core/types.ts';

/** Picks black or white text for a background colour (WCAG relative luminance). */
export function contrastText(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.179 ? '#000000' : '#ffffff';
}

export function css(t: SiteTheme): string {
  const btnText = contrastText(t.primary);
  return `
:host { all: initial; }
* { box-sizing: border-box; }
.oc { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: ${t.text}; }
.oc-banner {
  position: fixed; z-index: 2147483646; background: ${t.background}; color: ${t.text};
  box-shadow: 0 4px 32px rgba(0,0,0,.25); border-radius: 12px; padding: 20px;
  max-height: calc(100vh - 32px); overflow: auto;
}
/* Bar: full width, flush with the bottom edge, one row on wide screens. */
.oc-pos-bottom { left: 0; right: 0; bottom: 0; border-radius: 0; padding: 16px 24px; max-height: 70vh; box-shadow: 0 -2px 16px rgba(0,0,0,.15); }
.oc-pos-bottom .oc-inner { display: flex; align-items: center; gap: 24px; max-width: 1200px; margin: 0 auto; }
.oc-pos-bottom .oc-text { flex: 1 1 auto; min-width: 0; }
.oc-pos-bottom h2 { font-size: 16px; margin: 0 0 2px; }
.oc-pos-bottom #oc-body { margin: 0; font-size: 14px; }
.oc-pos-bottom .oc-actions { flex: 0 0 auto; flex-wrap: nowrap; align-items: center; margin: 0; }
.oc-pos-bottom .oc-btn { flex: 0 0 auto; padding: 8px 20px; }
.oc-textlink { font: inherit; font-size: 14px; background: none; border: 0; color: inherit; text-decoration: underline; cursor: pointer; min-height: 44px; padding: 0 8px; white-space: nowrap; }
.oc-banner:focus { outline: none; }
.oc-textlink:focus-visible { outline: 3px solid ${t.primary}; outline-offset: 2px; }
.oc-pos-bottom-left { left: 16px; bottom: 16px; max-width: 440px; }
.oc-pos-center { left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(560px, calc(100vw - 32px)); }
.oc h2 { font-size: 18px; margin: 0 0 8px; line-height: 1.3; }
.oc p { margin: 0 0 12px; }
.oc a { color: inherit; text-decoration: underline; }
.oc-notice { padding: 8px 12px; border-left: 4px solid ${t.primary}; background: rgba(127,127,127,.12); margin-bottom: 12px; }
.oc-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.oc-btn {
  font: inherit; font-weight: 600; cursor: pointer; border-radius: 8px; padding: 10px 18px; min-height: 44px;
  border: 2px solid ${t.primary}; background: ${t.primary}; color: ${btnText}; flex: 1 1 160px;
}
.oc-btn-link { background: transparent; color: ${t.text}; border-color: currentColor; }
.oc-btn:focus-visible, .oc-switch input:focus-visible + span, .oc summary:focus-visible, .oc-fab:focus-visible, .oc-close:focus-visible {
  outline: 3px solid ${t.primary}; outline-offset: 2px;
}
.oc-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 2147483646; }
.oc-dialog {
  position: fixed; z-index: 2147483647; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: min(640px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto;
  background: ${t.background}; color: ${t.text}; border-radius: 12px; padding: 24px; box-shadow: 0 8px 48px rgba(0,0,0,.35);
}
.oc-close { position: absolute; right: 12px; top: 12px; background: none; border: 0; font-size: 24px; line-height: 1; cursor: pointer; color: inherit; padding: 8px; min-width: 44px; min-height: 44px; }
.oc-cat { border-top: 1px solid rgba(127,127,127,.3); padding: 12px 0; }
.oc-cat-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.oc-cat-head h3 { font-size: 16px; margin: 0; }
.oc-cat p { font-size: 14px; margin: 6px 0; }
.oc-always { font-size: 13px; font-weight: 600; white-space: nowrap; }
.oc-switch { position: relative; display: inline-flex; align-items: center; cursor: pointer; }
.oc-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.oc-switch span { width: 46px; height: 26px; border-radius: 13px; background: #767676; position: relative; transition: background .15s; }
.oc-switch span::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .15s; }
.oc-switch input:checked + span { background: ${t.primary}; }
.oc-switch input:checked + span::after { transform: translateX(20px); }
.oc-switch input:disabled + span { opacity: .6; cursor: not-allowed; }
.oc details { font-size: 13px; }
.oc summary { cursor: pointer; padding: 4px 0; }
.oc table { width: 100%; border-collapse: collapse; margin-top: 6px; }
.oc th, .oc td { text-align: left; vertical-align: top; padding: 4px 6px; border-bottom: 1px solid rgba(127,127,127,.25); }
.oc code { font-size: 12px; word-break: break-all; }
.oc-fab {
  position: fixed; z-index: 2147483645; left: 16px; bottom: 16px; width: 44px; height: 44px; border-radius: 50%;
  border: 2px solid ${t.primary}; background: ${t.background}; color: ${t.primary}; cursor: pointer; display: grid; place-items: center;
  box-shadow: 0 2px 12px rgba(0,0,0,.2);
}
.oc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .oc-switch span, .oc-switch span::after { transition: none; } }
@media (max-width: 520px) { .oc-banner { left: 8px; right: 8px; bottom: 8px; padding: 16px; } .oc-btn { flex-basis: 100%; } }
@media (max-width: 760px) {
  .oc-pos-bottom { left: 0; right: 0; bottom: 0; padding: 16px; }
  .oc-pos-bottom .oc-inner { flex-direction: column; align-items: stretch; gap: 12px; }
  .oc-pos-bottom .oc-actions { flex-wrap: wrap; }
  .oc-pos-bottom .oc-btn { flex: 1 1 0; }
  .oc-pos-bottom .oc-textlink { flex-basis: 100%; }
}
`;
}
