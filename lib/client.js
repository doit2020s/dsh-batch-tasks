window.__ModuleLoader__.load({id:"dsh-batch-tasks",factory:(require)=>{var module={exports:{}};var exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.jsx
var client_exports = {};
__export(client_exports, {
  Panel: () => Panel,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);
var import_react_dom = require("react-dom");

// src/panel.css
var panel_default = ".dbt{--bt-bg:#101719;--bt-card:#172123;--bt-line:#2b3a3d;--bt-text:#e8efed;--bt-muted:#94aaa6;--bt-accent:#79dfbe;background:var(--bt-bg);color:var(--bt-text);font:14px/1.6 'Segoe UI','Microsoft YaHei',sans-serif;padding:28px;min-height:600px;border-radius:14px;box-sizing:border-box;outline:none;color-scheme:dark}.dbt *{box-sizing:border-box}.dbt h1,.dbt h2,.dbt h3,.dbt p{margin:0}.dbt h1{font-size:25px;font-weight:650;letter-spacing:.02em;margin:5px 0}.dbt h2{font-size:16px}.dbt h3{font-size:14px}.dbt button,.dbt input,.dbt textarea{font:inherit}.dbt button{cursor:pointer;padding:7px 12px;color:var(--bt-text);background:#213033;border:1px solid var(--bt-line);border-radius:7px;white-space:nowrap}.dbt button:hover:not(:disabled){border-color:var(--bt-accent);background:#293f41}.dbt button:disabled{opacity:.4;cursor:not-allowed}.dbt button:focus-visible,.dbt input:focus,.dbt textarea:focus{outline:2px solid var(--bt-accent);outline-offset:2px}.dbt-header,.dbt-header-right,.dbt-card-title{display:flex;align-items:center;justify-content:space-between;gap:12px}.dbt-header{margin-bottom:25px;align-items:flex-start}.dbt-header p,.dbt-hint,.dbt footer{font-size:12px;color:var(--bt-muted)}.dbt-eyebrow{font-size:10px;letter-spacing:.18em;color:var(--bt-accent)}.dbt-live{font-size:12px;color:var(--bt-muted);padding-top:9px}.dbt-live:before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:#6e8180;margin-right:7px}.dbt-live.on:before{background:var(--bt-accent);box-shadow:0 0 8px #79dfbe50}.dbt-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px}.dbt-stats>div{border:1px solid var(--bt-line);border-radius:9px;padding:13px 17px;background:var(--bt-card)}.dbt-stats span{display:block;font-size:11px;color:var(--bt-muted)}.dbt-stats strong{font-size:27px;font-weight:550;font-variant-numeric:tabular-nums;line-height:1.5}.dbt-stats>div:nth-child(4) strong{color:var(--bt-accent)}.dbt-columns{display:grid;grid-template-columns:minmax(290px,350px) minmax(300px,1fr);gap:20px;align-items:start}.dbt-card{background:var(--bt-card);border:1px solid var(--bt-line);border-radius:10px;padding:18px;min-width:0}.dbt-card-title{margin-bottom:16px}.dbt-card-title button{font-size:11px;padding:5px 10px}.dbt-card-title small{font-size:12px;color:var(--bt-muted);font-weight:400;margin-left:6px}.dbt label{font-size:11px;color:var(--bt-muted);display:block;margin:11px 0}.dbt input:not([type=file]),.dbt textarea{display:block;background:#10191b;color:var(--bt-text);border:1px solid var(--bt-line);border-radius:6px;width:100%;padding:9px 10px;font-size:12px;margin-top:5px}.dbt textarea{height:180px;resize:vertical;font:12px/1.9 'Consolas','Microsoft YaHei',monospace}.dbt textarea::placeholder{color:#617875}.dbt-input-count{display:flex;gap:4px;font-size:11px;color:var(--bt-muted);padding:8px 0}.dbt-input-count b{color:var(--bt-accent)}.dbt-input-count span{margin-left:auto}.dbt-form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.dbt details{font-size:11px;color:var(--bt-muted);margin:12px 0}.dbt summary{cursor:pointer}.dbt details p{margin:10px 0;line-height:1.8}.dbt button.dbt-primary{background:var(--bt-accent);color:#142e26;border-color:var(--bt-accent);font-weight:650;width:100%;margin:10px 0 12px}.dbt .dbt-primary:hover:not(:disabled){background:#9cebd0;color:#142e26}.dbt-hint{line-height:1.8;font-size:11px}.dbt-progress{height:4px;background:#26373a;border-radius:4px;overflow:hidden;margin-bottom:18px}.dbt-progress>div{height:100%;background:var(--bt-accent);transition:width .25s}.dbt-toolbar{display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;margin-bottom:16px}.dbt-toolbar>div{display:flex;gap:7px}.dbt-toolbar button{font-size:11px}.dbt button.dbt-danger{color:#ffb6ab;border-color:#794b43;background:#342726}.dbt-filters{display:flex;gap:4px;border-bottom:1px solid var(--bt-line);padding-bottom:11px}.dbt-filters button{font-size:11px;border:0;background:none;color:var(--bt-muted);padding:5px 9px}.dbt-filters button.selected{color:var(--bt-accent);background:#243c35}.dbt-list{max-height:510px;overflow:auto;min-height:220px}.dbt-task{display:flex;align-items:center;border-bottom:1px solid #263537;gap:5px}.dbt button.dbt-task-main{display:flex;align-items:center;gap:12px;min-width:0;width:100%;text-align:left;white-space:normal;padding:14px 0;border:0;background:transparent}.dbt .dbt-task-main:hover:not(:disabled){background:#203133}.dbt-task.chosen{background:#203330}.dbt-line{color:#718c86;font-size:11px;font-family:monospace;flex-shrink:0}.dbt-task-text{font-size:12px;min-width:0;flex:1;overflow-wrap:anywhere}.dbt-task-text small{display:block;color:var(--bt-muted);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px;margin-top:3px}.dbt-badge{font-size:10px;padding:2px 6px;border-radius:4px;background:#253537;white-space:nowrap;flex-shrink:0;color:var(--bt-muted)}.dbt-badge.running,.dbt-badge.starting{color:#a5d7fc;background:#253b49}.dbt-badge.succeeded{color:var(--bt-accent);background:#234138}.dbt-badge.failed,.dbt-badge.killed,.dbt-badge.interrupted,.dbt-badge.unconfirmed{color:#ffb6ab;background:#462e2a}.dbt button.dbt-stop-one{font-size:10px;padding:3px 6px}.dbt-empty{padding:50px 12px;text-align:center;color:var(--bt-muted)}.dbt-empty>div{font-size:28px;color:var(--bt-accent);margin-bottom:7px}.dbt-empty p{font-size:12px;margin-top:8px}.dbt-detail{border-top:1px solid var(--bt-line);padding-top:15px;margin-top:10px}.dbt-detail code{font-size:10px;color:var(--bt-muted);overflow-wrap:anywhere}.dbt-detail p{font-size:12px;margin-top:10px}.dbt-detail pre{max-height:300px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#10191b;padding:12px;border-radius:6px;font-size:12px;line-height:1.7}.dbt footer{margin-top:20px;font-size:10px}.dbt-error{color:#ffc0b4;background:#422a28;border:1px solid #75453e;padding:10px 14px;border-radius:7px;margin-bottom:16px;font-size:12px;overflow-wrap:anywhere}.dbt-error button{float:right;padding:0 5px}.dbt-overlay{position:fixed;inset:0;z-index:1000;background:#081012dd;overflow:auto;padding:24px;backdrop-filter:blur(7px)}.dbt-overlay>.dbt{max-width:1400px;margin:auto}.dbt-confirm-backdrop{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;background:#0009;padding:25px}.dbt-confirm{background:var(--bt-card);border:1px solid var(--bt-line);border-radius:12px;padding:26px;max-width:460px;box-shadow:0 20px 80px #0008}.dbt-confirm p{margin:15px 0 22px;color:var(--bt-muted)}.dbt-confirm>div{display:flex;justify-content:flex-end;gap:10px}@media(max-width:850px){.dbt{padding:16px}.dbt-columns{grid-template-columns:1fr}.dbt-stats{grid-template-columns:repeat(3,1fr)}.dbt-overlay{padding:8px}.dbt-header h1{font-size:21px}.dbt-list{max-height:400px}}\n\n/* A bounded dialog keeps the desktop visible and the close control away from window controls. */\n.dbt-overlay {\n  display: grid;\n  place-items: center;\n  z-index: 2147483000;\n  padding: 36px max(32px, 5vw);\n  overflow: hidden;\n  background: rgba(5, 16, 19, .62);\n  overscroll-behavior: contain;\n}\n.dbt-overlay > .dbt {\n  width: min(960px, 100%);\n  max-width: none;\n  min-height: 0;\n  max-height: min(840px, calc(100dvh - 96px));\n  margin: 0;\n  overflow: auto;\n  border: 1px solid #47605c;\n  border-radius: 16px;\n  box-shadow: 0 30px 90px #000a;\n  overscroll-behavior: contain;\n}\n.dbt-overlay .dbt-header {\n  position: sticky;\n  top: 0;\n  z-index: 2;\n  padding: 12px 0 14px;\n  margin-top: -12px;\n  background: var(--bt-bg);\n  border-bottom: 1px solid var(--bt-line);\n}\n.dbt-close {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 9px;\n  min-width: 106px;\n  border-color: #64847b !important;\n  font-weight: 600 !important;\n}\n.dbt-close span { font-size: 19px; line-height: 1; }\n.dbt-batch-root {\n  margin: -7px 0 14px !important;\n  color: var(--bt-muted);\n  font-size: 11px;\n  overflow-wrap: anywhere;\n}\n.dbt-batch-root code { color: var(--bt-text); }\n.dbt-task-text small.dbt-task-directory { color: #7ddcc0; }\n.dbt-session-id {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 7px;\n  color: var(--bt-muted);\n  font-size: 11px;\n}\n.dbt-session-id code { flex: 1; min-width: 150px; }\n.dbt-session-id button { font-size: 11px; padding: 4px 9px; }\n.dbt-directory-detail {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto;\n  align-items: center;\n  gap: 5px 10px;\n  margin-top: 12px;\n  padding: 10px 12px;\n  border: 1px solid var(--bt-line);\n  border-radius: 7px;\n  background: #10191b;\n}\n.dbt-directory-detail span {\n  grid-column: 1 / -1;\n  color: var(--bt-muted);\n  font-size: 11px;\n}\n.dbt-directory-detail code {\n  color: var(--bt-text);\n  user-select: text;\n  word-break: break-all;\n}\n.dbt-directory-detail button { font-size: 11px; padding: 4px 9px; }\n@media (max-width: 900px) {\n  .dbt-overlay { padding: 20px; }\n  .dbt-overlay > .dbt { max-height: calc(100dvh - 40px); }\n  .dbt-columns { grid-template-columns: 1fr; }\n  .dbt-stats { grid-template-columns: repeat(3, 1fr); }\n}\n@media (max-width: 540px) {\n  .dbt-overlay { padding: 8px; }\n  .dbt-overlay > .dbt { max-height: calc(100dvh - 16px); }\n  .dbt-header { align-items: flex-start; }\n  .dbt-header-right { flex-direction: column-reverse; align-items: flex-end; }\n  .dbt-header p { max-width: 230px; }\n  .dbt-stats { grid-template-columns: repeat(2, 1fr); }\n  .dbt-form-row { grid-template-columns: 1fr; }\n}\n\n.dbt select {\n  display: block;\n  width: 100%;\n  margin-top: 5px;\n  padding: 9px 10px;\n  border: 1px solid var(--bt-line);\n  border-radius: 6px;\n  background: #10191b;\n  color: var(--bt-text);\n  font: 12px/1.6 'Segoe UI', 'Microsoft YaHei', sans-serif;\n}\n.dbt select:focus { outline: 2px solid var(--bt-accent); outline-offset: 2px; }\n.dbt select:disabled { opacity: .5; }\n.dbt-preset-unavailable {\n  margin: 7px 0 12px;\n  color: #ffc0b4;\n  font-size: 11px;\n  overflow-wrap: anywhere;\n}\n.dbt-preset-unavailable div { margin-top: 3px; }\n.dbt-batch-preset {\n  margin: -8px 0 14px !important;\n  color: var(--bt-muted);\n  font-size: 11px;\n  overflow-wrap: anywhere;\n}\n.dbt-batch-preset code, .dbt-agent-detail code { color: var(--bt-text); }\n.dbt-agent-detail {\n  margin-top: 8px;\n  color: var(--bt-muted);\n  font-size: 11px;\n  overflow-wrap: anywhere;\n}\n\n.dbt-submit-actions {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);\n  gap: 9px;\n  margin: 10px 0 12px;\n}\n.dbt-submit-actions.can-stop { grid-template-columns: minmax(0, 1fr) minmax(165px, .85fr); }\n.dbt-submit-actions .dbt-primary { margin: 0; min-height: 42px; }\n.dbt-submit-actions .dbt-stop-dispatch {\n  min-height: 42px;\n  border-width: 2px;\n  font-weight: 650;\n  white-space: normal;\n}\n.dbt-submit-actions .dbt-stop-dispatch:hover:not(:disabled) { background: #59332e; }\n.dbt-task-text small.dbt-task-error {\n  max-width: none;\n  overflow: visible;\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n  color: #ffc0b4;\n}\n.dbt-error-banner { user-select: text; }\n.dbt-error-banner .dbt-error-message { white-space: pre-wrap; overflow-wrap: anywhere; }\n.dbt-error-banner details { margin: 8px 0 0; color: #ffc0b4; }\n.dbt-error-banner summary { text-decoration: underline; text-underline-offset: 2px; }\n.dbt-error-banner pre {\n  max-height: 250px;\n  overflow: auto;\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n  margin: 9px 0 0;\n  padding: 9px;\n  background: #281b1b;\n  border-radius: 5px;\n  font: 11px/1.6 'Consolas', 'Microsoft YaHei', monospace;\n}\n.dbt-queue > .dbt-card-title { flex-wrap: wrap; }\n.dbt-queue-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }\n.dbt-queue-actions .dbt-clear-list { border-color: #794b43; }\n.dbt-clear-hint { margin: -7px 0 12px !important; color: #d6aca6; font-size: 11px; line-height: 1.6; }\n@media (max-width: 540px) {\n  .dbt-submit-actions.can-stop { grid-template-columns: minmax(0, 1fr); }\n  .dbt-queue-actions { width: 100%; justify-content: flex-end; }\n}\n";

// src/validation.js
var LIMITS = { tasks: 1e4, concurrency: 16, lineChars: 64e3, inputChars: 4e6 };
function parseTasks(text) {
  if (typeof text !== "string" || text.length > LIMITS.inputChars) throw new Error("\u4EFB\u52A1\u6587\u672C\u4E3A\u7A7A\u6216\u8D85\u8FC7 400 \u4E07\u5B57\u7B26");
  const rows = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).map((prompt, i) => ({ prompt: prompt.trim(), line: i + 1 })).filter((x) => x.prompt);
  if (!rows.length || rows.length > LIMITS.tasks) throw new Error("\u8BF7\u8F93\u5165 1\uFF5E10000 \u6761\u975E\u7A7A\u4EFB\u52A1");
  if (rows.some((x) => x.prompt.length > LIMITS.lineChars)) throw new Error("\u5355\u6761\u4EFB\u52A1\u4E0D\u80FD\u8D85\u8FC7 64000 \u5B57\u7B26");
  return rows;
}

// src/client.jsx
var import_jsx_runtime = require("react/jsx-runtime");
var labels = { pending: "\u5F85\u6295\u9012", starting: "\u542F\u52A8\u4E2D", running: "\u6267\u884C\u4E2D", stopping: "\u6B63\u5728\u505C\u6B62", succeeded: "\u5DF2\u5B8C\u6210", failed: "\u5931\u8D25", cancelled: "\u5DF2\u53D6\u6D88", killed: "\u5DF2\u5F3A\u5236\u4E2D\u65AD", interrupted: "\u670D\u52A1\u4E2D\u65AD", unconfirmed: "\u7EC8\u6B62\u672A\u786E\u8BA4" };
var modeLabels = { idle: "\u51C6\u5907\u5C31\u7EEA", running: "\u8C03\u5EA6\u8FDB\u884C\u4E2D", paused: "\u6682\u505C\u6295\u9012", stopped: "\u5DF2\u505C\u6B62\u6295\u9012", finished: "\u672C\u6279\u6B21\u5DF2\u7ED3\u675F" };
var busyStatuses = ["starting", "running", "stopping", "unconfirmed"];
function Panel({ call, onClose, onOpenSession, initialCwd = "" }) {
  const [state, setState] = (0, import_react.useState)(null), [text, setText] = (0, import_react.useState)(""), [filter, setFilter] = (0, import_react.useState)("all");
  const [form, setForm] = (0, import_react.useState)({ concurrency: 3, timeoutMinutes: 30, cwd: "", provider: "", model: "", agentPreset: "", profile: "batch-sdk" });
  const [defaults, setDefaults] = (0, import_react.useState)(null), [error, setError] = (0, import_react.useState)(""), [busy, setBusy] = (0, import_react.useState)(false), [startingBatch, setStartingBatch] = (0, import_react.useState)(false), [stopBusy, setStopBusy] = (0, import_react.useState)(false), [openingSession, setOpeningSession] = (0, import_react.useState)(false);
  const [dismissedStateError, setDismissedStateError] = (0, import_react.useState)(null);
  const [selected, setSelected] = (0, import_react.useState)(null), [confirmation, setConfirmation] = (0, import_react.useState)(null), [copiedPath, setCopiedPath] = (0, import_react.useState)("");
  const mounted = (0, import_react.useRef)(true), fileRef = (0, import_react.useRef)();
  const rootRef = (0, import_react.useRef)();
  (0, import_react.useEffect)(() => {
    mounted.current = true;
    let timer, controller = new AbortController();
    void call("defaults", {}, controller.signal).then((v) => {
      if (!mounted.current) return;
      const defaultPreset = Array.isArray(v.presets) && v.presets.some((p) => p.id === v.defaultAgentPreset && !p.broken) ? v.defaultAgentPreset : "";
      setDefaults(v);
      setForm((f) => ({ ...f, cwd: initialCwd, provider: v.provider ?? f.provider, model: v.model ?? f.model, profile: v.profile ?? f.profile, agentPreset: defaultPreset }));
    }).catch((e) => {
      if (mounted.current) setError(e.message);
    });
    async function poll() {
      try {
        const value = await call("snapshot", {}, controller.signal);
        if (mounted.current) setState(value);
      } catch (e) {
        if (mounted.current) setError(e.message);
      }
      if (mounted.current) timer = setTimeout(poll, 1200);
    }
    void poll();
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [call]);
  (0, import_react.useEffect)(() => {
    if (onClose) rootRef.current?.focus();
  }, [onClose]);
  function handleDialogKeyDown(event) {
    if (!onClose) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (confirmation) setConfirmation(null);
      else onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusRoot = confirmation ? rootRef.current.querySelector(".dbt-confirm") : rootRef.current;
    const focusable = [...focusRoot.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')].filter((el) => el.getClientRects().length && !el.closest("[hidden]"));
    if (!focusable.length) {
      event.preventDefault();
      rootRef.current.focus();
      return;
    }
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === rootRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  async function action(method, payload = {}) {
    const isStop = /^(stop|force)/.test(method);
    const setLock = isStop ? setStopBusy : setBusy;
    if (method === "start") setStartingBatch(true);
    setLock(true);
    setError("");
    try {
      const s = await call(method, payload);
      if (mounted.current) {
        setState(s);
        if (method === "clear") {
          setSelected(null);
          setFilter("all");
          setDismissedStateError(null);
        }
      }
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) {
        setLock(false);
        if (method === "start") setStartingBatch(false);
      }
    }
  }
  function confirmStopAll() {
    setConfirmation({ method: "stopAll", title: "\u505C\u6B62\u672C\u6279\u6B21\u4EFB\u52A1\uFF1F", text: "\u7ACB\u5373\u505C\u6B62\u6295\u9012\u5E76\u53D6\u6D88\u5F85\u6295\u9012\u4EFB\u52A1\uFF0C\u540C\u65F6\u8BF7\u6C42\u5173\u95ED\u672C\u6279\u6B21\u6B63\u5728\u6267\u884C\u7684\u4F1A\u8BDD\u300210 \u79D2\u5185\u65E0\u6CD5\u6B63\u5E38\u9000\u51FA\u7684\u4EFB\u52A1\u5C06\u81EA\u52A8\u5F3A\u5236\u4E2D\u65AD\u3002\u5DF2\u751F\u6210\u6587\u4EF6\u548C\u4F1A\u8BDD\u8BB0\u5F55\u4FDD\u7559\u3002" });
  }
  function confirmClear() {
    setConfirmation({ method: "clear", title: "\u6E05\u7A7A\u6240\u6709\u6295\u9012\u8BB0\u5F55\uFF1F", text: `\u5C06\u4ECE\u63D2\u4EF6\u9762\u677F\u548C\u6301\u4E45\u5316\u961F\u5217\u4E2D\u5220\u9664\u672C\u6279\u6B21\u7684\u5168\u90E8 ${tasks.length} \u6761\u6295\u9012\u8BB0\u5F55\uFF0C\u6B64\u64CD\u4F5C\u65E0\u6CD5\u5728\u63D2\u4EF6\u4E2D\u64A4\u9500\u3002\u5DF2\u521B\u5EFA\u7684 DSH \u4F1A\u8BDD\u3001\u4EFB\u52A1\u5DE5\u4F5C\u76EE\u5F55\u53CA\u6587\u4EF6\u90FD\u4F1A\u4FDD\u7559\u3002`, confirmLabel: "\u786E\u8BA4\u6E05\u7A7A" });
  }
  function download() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state?.id || "batch"}-results.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  async function readFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 16e6) throw new Error("\u6587\u4EF6\u4E0D\u80FD\u8D85\u8FC7 16MB");
      const value = await file.text();
      parseTasks(value);
      setText(value);
      setError("");
    } catch (e) {
      setError(e.message);
    }
    event.target.value = "";
  }
  async function copyTaskDirectory(path) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("\u6B64\u73AF\u5883\u4E0D\u652F\u6301\u4E00\u952E\u590D\u5236");
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
    } catch (e) {
      setError(`${e.message}\uFF0C\u8BF7\u5728\u8BE6\u60C5\u4E2D\u624B\u52A8\u590D\u5236\u8DEF\u5F84\u3002`);
    }
  }
  async function openSession(id) {
    if (!onOpenSession) return;
    setOpeningSession(true);
    setError("");
    try {
      await onOpenSession(id);
      onClose?.();
    } catch (e) {
      setError(`\u65E0\u6CD5\u6253\u5F00\u4F1A\u8BDD\uFF1A${e.message}`);
    } finally {
      if (mounted.current) setOpeningSession(false);
    }
  }
  let totalInput = 0;
  try {
    totalInput = parseTasks(text).length;
  } catch {
  }
  const tasks = state?.tasks ?? [], counts = state?.counts ?? {};
  const canStart = !!state && !tasks.some((t) => !["succeeded", "failed", "cancelled", "killed", "interrupted"].includes(t.status));
  const canStop = startingBatch || state?.mode === "running" || state?.mode === "paused" || Number(state?.liveCount) > 0 || Number(counts.pending) > 0;
  const canClear = tasks.length > 0 && !["running", "paused"].includes(state?.mode) && Number(state?.liveCount) === 0 && Number(counts.pending || 0) === 0 && tasks.every((t) => ["succeeded", "failed", "cancelled", "killed", "interrupted"].includes(t.status));
  const visibleError = error || (state?.error !== dismissedStateError ? state?.error : "") || "";
  const shown = tasks.filter((t) => filter === "all" || (filter === "active" ? busyStatuses.includes(t.status) : filter === "failed" ? ["failed", "killed", "interrupted"].includes(t.status) : t.status === filter));
  const detail = tasks.find((t) => t.id === selected);
  const detailWorkDir = detail?.workDir || state?.config?.cwd || "";
  const presets = Array.isArray(defaults?.presets) ? defaults.presets : [];
  const selectedPreset = presets.find((p) => p.id === form.agentPreset && !p.broken);
  const brokenPresets = presets.filter((p) => p.broken);
  const detailAgentPreset = detail?.agentPreset || state?.config?.agentPreset || "";
  const presetLabel = (id) => {
    const preset = presets.find((p) => p.id === id);
    return preset?.name && preset.name !== id ? `${preset.name} (${id})` : id;
  };
  const finished = tasks.filter((t) => ["succeeded", "failed", "cancelled", "killed", "interrupted"].includes(t.status)).length;
  const field = (name, value) => setForm((f) => ({ ...f, [name]: value }));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt", ref: rootRef, tabIndex: -1, role: onClose ? "dialog" : void 0, "aria-modal": onClose ? "true" : void 0, "aria-label": "\u6279\u91CF\u4EFB\u52A1\u9762\u677F", onKeyDown: handleDialogKeyDown, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: panel_default }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dbt-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dbt-eyebrow", children: "HARNESS \xB7 BATCH TASKS" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "\u6279\u91CF\u4EFB\u52A1\u5DE5\u4F5C\u53F0" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u4E00\u884C\u4E00\u4E2A\u4EFB\u52A1\uFF0C\u72EC\u7ACB\u4F1A\u8BDD\u6267\u884C\uFF0C\u7A7A\u95F2\u540D\u989D\u81EA\u52A8\u8865\u4F4D\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-header-right", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `dbt-live ${state?.mode === "running" ? "on" : ""}`, children: modeLabels[state?.mode] || "\u8FDE\u63A5\u4E2D" }),
        onClose && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "dbt-close", onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }, "aria-label": "\u5173\u95ED\u6279\u91CF\u4EFB\u52A1\u9762\u677F", children: [
          "\u5173\u95ED\u9762\u677F ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", children: "\xD7" })
        ] })
      ] })
    ] }),
    visibleError && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-error dbt-error-banner", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => {
        setError("");
        setDismissedStateError(state?.error ?? null);
      }, "aria-label": "\u6536\u8D77\u9519\u8BEF", children: "\xD7" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dbt-error-message", children: visibleError.length > 180 ? `${visibleError.slice(0, 180)}\u2026` : visibleError }),
      visibleError.length > 180 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "\u67E5\u770B\u5B8C\u6574\u9519\u8BEF" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { children: visibleError })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dbt-stats", children: [["\u4EFB\u52A1\u603B\u6570", tasks.length], ["\u6B63\u5728\u6267\u884C", state?.liveCount || 0], ["\u7B49\u5F85\u6295\u9012", counts.pending || 0], ["\u6B63\u5E38\u5B8C\u6210", counts.succeeded || 0], ["\u5F02\u5E38 / \u4E2D\u65AD", (counts.failed || 0) + (counts.killed || 0) + (counts.interrupted || 0)]].map(([name, n]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: name }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: n.toString().padStart(2, "0") })
    ] }, name)) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-columns", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dbt-card dbt-compose", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-card-title", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u4EFB\u52A1\u8F93\u5165" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: () => fileRef.current?.click(), disabled: !canStart, children: "\u5BFC\u5165 TXT" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { ref: fileRef, type: "file", accept: ".txt,text/plain", onChange: readFile, hidden: true })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: "dbt-tasks", children: "\u6BCF\u884C\u4E00\u6761 \xB7 \u5FFD\u7565\u7A7A\u884C \xB7 \u4FDD\u7559\u91CD\u590D\u4EFB\u52A1" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { id: "dbt-tasks", disabled: !canStart, value: text, onChange: (e) => setText(e.target.value), placeholder: "\u4E3A\u4EA7\u54C1 A \u7F16\u5199\u4E00\u4EFD\u4ECB\u7ECD\uFF0C\u4FDD\u5B58\u4E3A result.md\n\u4E3A\u4EA7\u54C1 B \u7F16\u5199\u4E00\u4EFD\u4ECB\u7ECD\uFF0C\u4FDD\u5B58\u4E3A result.md\n\u4E3A\u4EA7\u54C1 C \u7F16\u5199\u4E00\u4EFD\u4ECB\u7ECD\uFF0C\u4FDD\u5B58\u4E3A result.md" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-input-count", children: [
          "\u5DF2\u8BC6\u522B ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: totalInput }),
          " \u6761\u4EFB\u52A1",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "UTF-8 \u6587\u672C" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-form-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
            "\u5E76\u53D1\u4F1A\u8BDD\u6570",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "number", min: "1", max: "16", value: form.concurrency, onChange: (e) => field("concurrency", Number(e.target.value)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
            "\u5355\u4EFB\u52A1\u8D85\u65F6\uFF08\u5206\u949F\uFF09",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "number", disabled: !canStart, min: "1", max: "1440", value: form.timeoutMinutes, onChange: (e) => field("timeoutMinutes", Number(e.target.value)) })
          ] })
        ] }),
        !canStart && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => action("concurrency", { value: form.concurrency }), children: "\u8C03\u6574\u5F53\u524D\u5E76\u53D1\u4E0A\u9650" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          "\u6279\u6B21\u5DE5\u4F5C\u6839\u76EE\u5F55\uFF08\u7EDD\u5BF9\u8DEF\u5F84\uFF09",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { disabled: !canStart, value: form.cwd, onChange: (e) => field("cwd", e.target.value), placeholder: "\u4F8B\u5982 D:\\\\tasks\uFF1B\u6BCF\u6761\u4EFB\u52A1\u5728\u5176\u4E2D\u5EFA\u7ACB\u4E13\u5C5E\u5B50\u76EE\u5F55" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dbt-hint", children: initialCwd && form.cwd === initialCwd ? "\u5DF2\u5E26\u5165\u5F53\u524D\u4F1A\u8BDD\u7684\u76EE\u5F55\uFF0C\u53EF\u4EE5\u81EA\u884C\u4FEE\u6539\u3002\u6BCF\u884C\u4EFB\u52A1\u4F1A\u5728\u8BE5\u76EE\u5F55\u4E0B\u5EFA\u7ACB\u72EC\u7ACB\u5B50\u76EE\u5F55\u3002" : form.cwd.trim() ? "\u6BCF\u884C\u4EFB\u52A1\u4F1A\u5728\u6B64\u6839\u76EE\u5F55\u4E0B\u5EFA\u7ACB\u72EC\u7ACB\u5B50\u76EE\u5F55\uFF0C\u76F8\u5BF9\u8DEF\u5F84\u751F\u6210\u7684\u6587\u4EF6\u4FDD\u5B58\u5728\u5404\u81EA\u76EE\u5F55\u4E2D\u3002" : "\u8BF7\u586B\u5199\u5DE5\u4F5C\u6839\u76EE\u5F55\uFF1B\u6BCF\u884C\u4EFB\u52A1\u4F1A\u5728\u5176\u4E2D\u5EFA\u7ACB\u72EC\u7ACB\u5B50\u76EE\u5F55\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { htmlFor: "dbt-agent-preset", children: [
          "\u6267\u884C Agent \u9884\u8BBE",
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { id: "dbt-agent-preset", disabled: !canStart || !presets.length, value: form.agentPreset, onChange: (e) => field("agentPreset", e.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u8BF7\u9009\u62E9 Agent \u9884\u8BBE" }),
            presets.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: p.id, disabled: !!p.broken, children: [
              presetLabel(p.id),
              p.isDefault ? " \xB7 \u5F53\u524D\u9ED8\u8BA4" : "",
              p.broken ? " \xB7 \u4E0D\u53EF\u7528" : ""
            ] }, p.id))
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dbt-hint", children: selectedPreset ? `${selectedPreset.description || "\u4F7F\u7528\u6B64\u9884\u8BBE\u7684\u5B9E\u9645 Agent \u914D\u7F6E\u3002"} \u9884\u8BBE\u4F1A\u51B3\u5B9A\u4F1A\u8BDD\u7684\u5DE5\u5177\u548C\u63D0\u793A\u8BCD\u3002` : presets.length ? "\u8BF7\u9009\u62E9\u53EF\u7528\u7684 Agent \u9884\u8BBE\uFF1B\u672A\u6307\u5B9A\u65F6\u4E0D\u4F1A\u6295\u9012\u4EFB\u52A1\u3002\u9884\u8BBE\u4F1A\u51B3\u5B9A\u4F1A\u8BDD\u7684\u5DE5\u5177\u548C\u63D0\u793A\u8BCD\u3002" : "\u6B63\u5728\u8BFB\u53D6 DSH \u7684 Agent \u9884\u8BBE\uFF1B\u8BFB\u53D6\u5931\u8D25\u65F6\u4E0D\u4F1A\u6295\u9012\u4EFB\u52A1\u3002" }),
        brokenPresets.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-preset-unavailable", children: [
          "\u4E0D\u53EF\u7528\u7684\u9884\u8BBE\uFF1A",
          brokenPresets.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            p.id,
            "\uFF1A",
            p.broken
          ] }, p.id))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-form-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
            "\u6A21\u578B\u63D0\u4F9B\u65B9",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { disabled: !canStart, value: form.provider, onChange: (e) => field("provider", e.target.value) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
            "\u6A21\u578B\u540D\u79F0",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { disabled: !canStart, value: form.model, onChange: (e) => field("model", e.target.value) })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "\u6267\u884C\u914D\u7F6E\u8BF4\u660E" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
            "\u72EC\u7ACB SDK Profile",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { disabled: !canStart, value: form.profile, onChange: (e) => field("profile", e.target.value) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
            "\u9996\u6B21\u8FD0\u884C\u4F1A\u4ECE\u5B98\u65B9 SDK \u6A21\u677F\u521B\u5EFA\u6B64\u914D\u7F6E\u3002\u5B83\u5171\u7528 DSH \u51ED\u636E\u548C\u8BBE\u7F6E\uFF1B\u5DE5\u5177\u63D2\u4EF6\u9700\u5B89\u88C5\u5230\u6B64 Profile\u3002\u9700\u8981\u4EA4\u4E92\u786E\u8BA4\u7684\u4EFB\u52A1\u53EF\u80FD\u7B49\u5F85\u81F3\u8D85\u65F6\u3002\u5F53\u524D\u8FD0\u884C\u65F6\uFF1A",
            defaults?.harnessVersion || "\u8BFB\u53D6\u4E2D",
            "\u3002"
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: `dbt-submit-actions${canStop ? " can-stop" : ""}`, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dbt-primary", disabled: busy || !canStart || !totalInput || !form.cwd.trim() || !selectedPreset, onClick: () => action("start", { ...form, text }), children: busy ? "\u6B63\u5728\u5904\u7406\u2026" : `\u5F00\u59CB\u6267\u884C${totalInput ? ` ${totalInput} \u6761\u4EFB\u52A1` : ""}` }),
          canStop && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dbt-danger dbt-stop-dispatch", disabled: stopBusy, onClick: confirmStopAll, children: stopBusy ? "\u6B63\u5728\u505C\u6B62\u2026" : "\u505C\u6B62\u6295\u9012\u5E76\u5173\u95ED\u4F1A\u8BDD" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dbt-hint", children: "\u6BCF\u6761\u4EFB\u52A1\u6709\u72EC\u7ACB\u4F1A\u8BDD\u548C\u5DE5\u4F5C\u5B50\u76EE\u5F55\uFF0C\u53EF\u4EE5\u4F7F\u7528\u76F8\u540C\u7684\u76F8\u5BF9\u6587\u4EF6\u540D\u3002\u5173\u95ED\u9762\u677F\u4E0D\u4F1A\u505C\u6B62\u4EFB\u52A1\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dbt-card dbt-queue", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-card-title", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", { children: [
            "\u6267\u884C\u961F\u5217 ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
              finished,
              " / ",
              tasks.length
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-queue-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: !tasks.length, onClick: download, children: "\u5BFC\u51FA\u7ED3\u679C" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dbt-danger dbt-clear-list", disabled: busy || startingBatch || stopBusy || !canClear, onClick: confirmClear, children: "\u6E05\u7A7A\u5217\u8868" })
          ] })
        ] }),
        state?.config?.cwd && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dbt-batch-root", children: [
          "\u672C\u6279\u6B21\u6839\u76EE\u5F55\uFF1A",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: state.config.cwd })
        ] }),
        state?.id && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dbt-batch-preset", children: [
          "\u672C\u6279\u6B21 Agent \u9884\u8BBE\uFF1A",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: state?.config?.agentPreset ? presetLabel(state.config.agentPreset) : "\u672A\u6307\u5B9A\uFF08\u65E7\u6279\u6B21\uFF09" })
        ] }),
        state?.mode === "paused" && !state?.config?.agentPreset && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dbt-hint", children: "\u65E7\u6279\u6B21\u6CA1\u6709\u7ED1\u5B9A Agent \u9884\u8BBE\u3002\u8BF7\u505C\u6B62\u5269\u4F59\u4EFB\u52A1\uFF0C\u518D\u9009\u62E9\u9884\u8BBE\u521B\u5EFA\u65B0\u6279\u6B21\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dbt-progress", role: "progressbar", "aria-label": "\u4EFB\u52A1\u8FDB\u5EA6", "aria-valuenow": finished, "aria-valuemin": 0, "aria-valuemax": tasks.length || 1, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { width: `${tasks.length ? finished / tasks.length * 100 : 0}%` } }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-toolbar", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            state?.mode === "paused" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy || !state?.config?.agentPreset, onClick: () => action("resume"), children: "\u7EE7\u7EED\u6295\u9012" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy || state?.mode !== "running", onClick: () => action("pause"), children: "\u6682\u505C\u6295\u9012" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: stopBusy || !canStop, onClick: confirmStopAll, children: "\u505C\u6B62\u5168\u90E8" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dbt-danger", disabled: stopBusy || !state?.liveCount, onClick: () => setConfirmation({ method: "forceAll", title: "\u7ACB\u5373\u5F3A\u5236\u4E2D\u65AD\u5168\u90E8\uFF1F", text: "\u7ACB\u5373\u7ED3\u675F\u672C\u6279\u6B21\u7684\u4EFB\u52A1\u8FDB\u7A0B\u53CA\u5176\u666E\u901A\u5B50\u8FDB\u7A0B\uFF1B\u672A\u843D\u76D8\u8F93\u51FA\u53EF\u80FD\u4E0D\u5B8C\u6574\u3002\u4E0D\u4F1A\u7ED3\u675F\u5176\u4ED6 DSH \u4F1A\u8BDD\u3002" }), children: "\u5F3A\u5236\u4E2D\u65AD\u5168\u90E8" })
        ] }),
        tasks.length > 0 && !canClear && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dbt-clear-hint", children: "\u6E05\u7A7A\u5217\u8868\u524D\uFF0C\u8BF7\u5148\u505C\u6B62\u6295\u9012\u5E76\u7B49\u5F85\u6B63\u5728\u6267\u884C\u7684\u4F1A\u8BDD\u7ED3\u675F\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dbt-filters", children: [["all", "\u5168\u90E8"], ["active", "\u8FD0\u884C\u4E2D"], ["pending", "\u5F85\u6295\u9012"], ["succeeded", "\u5DF2\u5B8C\u6210"], ["failed", "\u5F02\u5E38"]].map(([key, label]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: filter === key ? "selected" : "", onClick: () => setFilter(key), children: label }, key)) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dbt-list", children: shown.length ? shown.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: `dbt-task ${selected === t.id ? "chosen" : ""}`, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { className: "dbt-task-main", onClick: () => setSelected(selected === t.id ? null : t.id), children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dbt-line", children: String(t.line).padStart(3, "0") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dbt-task-text", children: [
              t.prompt,
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { className: t.error ? "dbt-task-error" : void 0, children: t.error || t.activity || (t.status === "pending" ? "\u7B49\u5F85\u7A7A\u95F2\u4F1A\u8BDD" : t.sessionId) }),
              (t.workDir || state?.config?.cwd) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { className: "dbt-task-directory", title: t.workDir || state.config.cwd, children: [
                t.workDir ? "\u4EFB\u52A1\u76EE\u5F55" : "\u65E7\u6279\u6B21\u76EE\u5F55",
                "\uFF1A",
                t.workDir || state.config.cwd
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `dbt-badge ${t.status}`, children: labels[t.status] })
          ] }),
          busyStatuses.includes(t.status) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dbt-stop-one", "aria-label": `\u505C\u6B62\u7B2C ${t.line} \u884C`, disabled: stopBusy, onClick: () => action("stopOne", { id: t.id }), children: "\u505C\u6B62" })
        ] }, t.id)) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-empty", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: "\u2637" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: tasks.length ? "\u6B64\u5206\u7C7B\u6CA1\u6709\u4EFB\u52A1" : "\u961F\u5217\u51C6\u5907\u5C31\u7EEA" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: tasks.length ? "\u53EF\u5207\u6362\u5176\u4ED6\u5206\u7C7B\u67E5\u770B\u3002" : "\u5BFC\u5165\u6587\u672C\u6216\u7C98\u8D34\u4EFB\u52A1\uFF0C\u8BBE\u7F6E\u5E76\u53D1\u6570\u91CF\u540E\u5F00\u59CB\u3002" })
        ] }) }),
        detail && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", { className: "dbt-detail", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-card-title", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { children: [
              "\u7B2C ",
              detail.line,
              " \u884C \xB7 ",
              labels[detail.status]
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: () => setSelected(null), children: "\u6536\u8D77" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-session-id", children: [
            "\u4F1A\u8BDD ID\uFF1A",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: detail.sessionId }),
            onOpenSession && ["succeeded", "failed"].includes(detail.status) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: openingSession, onClick: () => void openSession(detail.sessionId), children: openingSession ? "\u6253\u5F00\u4E2D\u2026" : "\u6253\u5F00\u4F1A\u8BDD" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-agent-detail", children: [
            "Agent \u9884\u8BBE\uFF1A",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: detailAgentPreset ? presetLabel(detailAgentPreset) : "\u672A\u6307\u5B9A\uFF08\u65E7\u6279\u6B21\uFF09" })
          ] }),
          detailWorkDir && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-directory-detail", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: detail.workDir ? "\u4EFB\u52A1\u5DE5\u4F5C\u76EE\u5F55" : "\u65E7\u6279\u6B21\u5171\u7528\u5DE5\u4F5C\u76EE\u5F55" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { title: detailWorkDir, children: detailWorkDir }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => void copyTaskDirectory(detailWorkDir), children: copiedPath === detailWorkDir ? "\u5DF2\u590D\u5236" : "\u590D\u5236\u8DEF\u5F84" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: detail.prompt }),
          detail.error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dbt-error", children: detail.error }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { children: detail.result || "\u5C1A\u65E0\u6587\u672C\u7ED3\u679C\u3002\u4F1A\u8BDD\u5B8C\u6574\u8BB0\u5F55\u7531 DSH \u4FDD\u5B58\u3002" }),
          busyStatuses.includes(detail.status) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dbt-danger", onClick: () => setConfirmation({ method: "forceOne", payload: { id: detail.id }, title: "\u5F3A\u5236\u4E2D\u65AD\u8FD9\u6761\u4EFB\u52A1\uFF1F", text: "\u4EC5\u7ED3\u675F\u8BE5\u4EFB\u52A1\u7684\u6267\u884C\u8FDB\u7A0B\uFF0C\u4FDD\u7559\u5DF2\u6709\u8BB0\u5F55\u3002" }), children: "\u5F3A\u5236\u4E2D\u65AD\u6B64\u4EFB\u52A1" })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("footer", { children: "\u5B8C\u6210\u72B6\u6001\u8868\u793A DSH \u6B63\u5E38\u7ED3\u675F\u672C\u8F6E\uFF1B\u4EFB\u52A1\u5185\u5BB9\u662F\u5426\u8FBE\u6807\u8BF7\u67E5\u770B\u7ED3\u679C\u3002\u5173\u95ED\u4F1A\u8BDD\u4FDD\u7559\u65E5\u5FD7\uFF0C\u4E0D\u64A4\u9500\u5DF2\u7ECF\u5B8C\u6210\u7684\u6587\u4EF6\u64CD\u4F5C\u3002" }),
    confirmation && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dbt-confirm-backdrop", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-confirm", role: "alertdialog", "aria-modal": "true", "aria-label": confirmation.title, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: confirmation.title }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: confirmation.text }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { autoFocus: true, onClick: () => setConfirmation(null), children: "\u8FD4\u56DE" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dbt-danger", onClick: () => {
          const c = confirmation;
          setConfirmation(null);
          void action(c.method, c.payload);
        }, children: confirmation.confirmLabel || "\u786E\u8BA4\u4E2D\u65AD" })
      ] })
    ] }) })
  ] });
}
var inject = ["slots", "connection", "sessions"];
function apply(ctx) {
  let openPanels = 0;
  let latestSnapshot = null;
  let lastSessionRefreshAt = 0;
  let lastSessionRefreshSignature = "";
  let sessionRefreshInFlight = false;
  let deferredRefreshTimer = null;
  let backgroundTimer = null;
  let backgroundPollInFlight = false;
  function sessionSignature(snapshot) {
    if (!Array.isArray(snapshot?.tasks)) return "";
    return snapshot.tasks.filter((task) => task.sessionId && ["running", "stopping", "succeeded", "failed", "cancelled", "killed", "interrupted", "unconfirmed"].includes(task.status)).map((task) => `${task.sessionId}:${task.status}`).join("|");
  }
  async function refreshSessionListWhenChanged() {
    if (sessionRefreshInFlight) return;
    const signature = sessionSignature(latestSnapshot);
    if (!signature || signature === lastSessionRefreshSignature) return;
    const remaining = 3e3 - (Date.now() - lastSessionRefreshAt);
    if (remaining > 0) {
      if (!deferredRefreshTimer) deferredRefreshTimer = setTimeout(() => {
        deferredRefreshTimer = null;
        void refreshSessionListWhenChanged();
      }, remaining);
      return;
    }
    lastSessionRefreshAt = Date.now();
    lastSessionRefreshSignature = signature;
    sessionRefreshInFlight = true;
    try {
      await ctx.sessions.refresh();
    } catch {
      lastSessionRefreshSignature = "";
    } finally {
      sessionRefreshInFlight = false;
    }
    if (sessionSignature(latestSnapshot) !== lastSessionRefreshSignature) void refreshSessionListWhenChanged();
  }
  function noteSnapshot(snapshot) {
    latestSnapshot = snapshot;
    void refreshSessionListWhenChanged();
    const active = snapshot?.mode === "running" || Number(snapshot?.liveCount) > 0;
    if (active && !backgroundTimer) {
      backgroundTimer = setInterval(async () => {
        if (openPanels || backgroundPollInFlight) return;
        backgroundPollInFlight = true;
        try {
          await call("snapshot");
        } catch {
        } finally {
          backgroundPollInFlight = false;
        }
      }, 3e3);
    } else if (!active && backgroundTimer) {
      clearInterval(backgroundTimer);
      backgroundTimer = null;
    }
  }
  const call = async (endpoint, payload = {}, signal) => {
    const reply = await ctx.connection.rpc.call("/api", `batch-tasks/${endpoint}`, payload, signal);
    if (!reply.ok) throw new Error(reply.error?.message || "\u8BF7\u6C42\u5931\u8D25");
    if (reply.value && Array.isArray(reply.value.tasks)) noteSnapshot(reply.value);
    return reply.value;
  };
  function currentCwd() {
    const list = ctx.sessions.list.getSnapshot();
    const cwd = list?.current == null ? void 0 : list.byId?.[list.current]?.cwd;
    return typeof cwd === "string" ? cwd : "";
  }
  function Overlay({ onClose, fromSession = false }) {
    const [initialCwd] = (0, import_react.useState)(() => fromSession ? currentCwd() : "");
    (0, import_react.useEffect)(() => {
      openPanels++;
      return () => {
        openPanels = Math.max(0, openPanels - 1);
        queueMicrotask(() => {
          if (!openPanels) void refreshSessionListWhenChanged();
        });
      };
    }, []);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dbt-overlay", onClick: (e) => e.stopPropagation(), onPointerDown: (e) => e.stopPropagation(), onPointerUp: (e) => e.stopPropagation(), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: panel_default }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Panel, { call, initialCwd, onClose, onOpenSession: async (id) => {
        await ctx.sessions.refresh();
        ctx.sessions.open(id);
      } })
    ] });
  }
  function SettingsPanel() {
    const [open, setOpen] = (0, import_react.useState)(false);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: 20, lineHeight: 1.8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u6279\u91CF\u4EFB\u52A1" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u5BFC\u5165\u6BCF\u884C\u4E00\u6761\u7684\u4EFB\u52A1\u6587\u672C\uFF0C\u9009\u62E9\u6267\u884C Agent \u9884\u8BBE\u3001\u5E76\u53D1\u4F1A\u8BDD\u6570\u91CF\u548C\u5DE5\u4F5C\u6839\u76EE\u5F55\u3002\u6BCF\u6761\u4EFB\u52A1\u4F7F\u7528\u72EC\u7ACB\u4F1A\u8BDD\u53CA\u5DE5\u4F5C\u5B50\u76EE\u5F55\uFF0C\u81EA\u52A8\u8865\u4F4D\u5E76\u7EDF\u4E00\u7BA1\u7406\u6267\u884C\u8FDB\u7A0B\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => setOpen(true), style: { marginTop: 18, padding: "10px 18px", borderRadius: 8, background: "#79dfbe", color: "#142e26" }, children: "\u6253\u5F00\u6279\u91CF\u4EFB\u52A1\u5DE5\u4F5C\u53F0" })
      ] }),
      open && (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Overlay, { onClose: () => setOpen(false) }), document.body)
    ] });
  }
  function HeaderAction() {
    const [open, setOpen] = (0, import_react.useState)(false);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", title: "\u6253\u5F00\u6279\u91CF\u4EFB\u52A1\u5DE5\u4F5C\u53F0", onClick: () => setOpen(true), style: { padding: "4px 10px", fontSize: 12, border: "1px solid currentColor", borderRadius: 6 }, children: "\u6279\u91CF\u4EFB\u52A1" }),
      open && (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Overlay, { fromSession: true, onClose: () => setOpen(false) }), document.body)
    ] });
  }
  ctx.effect(() => () => {
    clearInterval(backgroundTimer);
    clearTimeout(deferredRefreshTimer);
  }, "batch-tasks: session list refresh");
  ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: "batch-tasks", order: 70, label: () => "\u6279\u91CF\u4EFB\u52A1" }, SettingsPanel));
  ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({ name: "conversation.session.header.actions", id: "batch-tasks", order: 35 }, HeaderAction));
}

return module.exports;}});
