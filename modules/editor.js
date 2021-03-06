/*global setTimeout, Audio */

let CodeMirror = require("codemirror/lib/codemirror.js");
require("codemirror/lib/codemirror.css");

require("codemirror/addon/edit/matchbrackets.js");
require("codemirror/addon/edit/closebrackets.js");
require("codemirror/addon/hint/show-hint.js");
require("codemirror/addon/hint/show-hint.css");
require("codemirror/addon/hint/anyword-hint.js");
require("codemirror/addon/selection/active-line.js");
require("codemirror/addon/comment/comment.js");


require("codemirror/mode/javascript/javascript.js");
require("codemirror/mode/clojure/clojure.js");
require("codemirror/mode/haskell/haskell.js");

require("./editor/theme.css");

var events = require("../lib/events");
var text = require("../lib/text");
var emacs = require("./editor/emacs");
var Spinner = require("spin.js");
var seq = require("../lib/seq");

function factory(languages) {

  var languageMap = languages.reduce((acc, next) => next(CodeMirror, acc), {});

  function Editor(slide, mode) {
    const args = slide.dataset;
    const target = slide.querySelector(".slideContainer");
    const initialCode = target.innerHTML;
    const href = args.href;
    const languageModule = languageMap[mode];
    if (!languageModule) throw new Error("Language module for " + mode +
                                         " has not been registered!");

    this.onTabClose = () => {
      if (!this.cm.isClean()) {
        return "The current buffer has modifications.";
      }
    };

    // --- Comms

    this.send = (message) => {
      if (this.targetFrame) {
        this.targetFrame.contentWindow.postMessage(JSON.stringify(message), "*");
      }
    };

    this.compile = () => {
      let compiled = this.language.compile(this.cm.getDoc().getValue());
      this.cm.clearGutter("cm-errors");
      if (compiled.errors.length) {
        new Audio(require("./editor/smb_bump.mp3")).play();
        for (let i = 0; i < compiled.errors.length; i++) {
          let error = compiled.errors[i];
          let marker = document.createElement("img");
          marker.title = error.message;
          marker.classList.add("cm-error");
          this.cm.setGutterMarker(error.pos.line, "cm-errors", marker);
        }
        this.cm.getDoc().setCursor(compiled.errors[0].pos.line,
                                   compiled.errors[0].pos.col);
        return null;
      } else {
        return compiled.code;
      }
    };

    this.evalInFrame = (cm) => {
      this.send({hide: true});
      this.spin(true);
      let code = this.compile();
      this.spin(false);

      if (code === null) return;

      if (href) {
        if ((args.reload !== undefined)) {
          this.targetFrame.src = href;
          setTimeout((() => {
            events.until(this.targetFrame.contentWindow, "message", function(e) {
              if (e.data === "rdy lol") {
                this.send({code: code});
                return true;
              }
            }, this);
          }).bind(this), 100);
        } else {
          this.send({code: code});
        }
      } else {
        this.language.evalCode(code, (response) => {
          let splitLines = response.result.map((result) => result.line),
              splitCode = text.splitLines(code, splitLines),
              newCode = response.result.map((result, i) => {
                if (result.hasOwnProperty("error")) {
                  return splitCode[i] +
                    this.language.comment("!! " + result.error) + "\n";
                }
                if (result.result === null) {
                  return splitCode[i];
                } else {
                  return splitCode[i] +
                    this.language.comment("=> " + result.result) + "\n";
                }
              });
          while (newCode.length < splitCode.length) {
            newCode.push(splitCode[newCode.length]);
          }
          let cursor = this.cm.getDoc().getCursor();
          this.cm.getDoc().setValue(newCode.join(""));
          this.cm.getDoc().setCursor(cursor);
        });
      }
    };

    this.reloadFrame = (cm) => {
      if (this.targetFrame) {
        this.targetFrame.src = href;
      }
    };

    // --- keybindings

    this.iframeBind = (key) => {
      return (function() { this.send({ key: key }); }).bind(this);
    };

    const keymap = {};
    keymap["Ctrl-S"] = this.evalInFrame.bind(this);
    keymap["Ctrl-R"] = this.reloadFrame.bind(this);
    keymap["Alt-Space"] = this.iframeBind("space");
    keymap["Alt-Enter"] = this.iframeBind("enter");
    keymap["Alt-Up"] = this.iframeBind("up");
    keymap["Alt-Down"] = this.iframeBind("down");
    keymap["Alt-Left"] = this.iframeBind("left");
    keymap["Alt-Right"] = this.iframeBind("right");
    keymap["Ctrl-K"] = emacs.kill;
    keymap["Ctrl-Y"] = emacs.yank;
    keymap["Ctrl-A"] = "goLineStartSmart";
    keymap["Ctrl-E"] = "goLineEnd";
    keymap["Ctrl-,"] = "toggleComment";
    keymap.Tab = (cm) => cm.indentLine(cm.getDoc().getCursor().line);
    keymap["Ctrl-\\"] = (cm) => CodeMirror.showHint(cm);
    keymap["Ctrl-'"] = (cm) => {
      const cur = cm.getDoc().getCursor();
      const token = cm.getTokenAt(cur, true);
      cm.getDoc().extendSelection({line: cur.line, ch: token.start},
                                  {line: cur.line, ch: token.end});
    }
    keymap.Esc = (cm) => {
      // wow, much hack
      const input = document.createElement("input");
      input.setAttribute("type", "text");
      document.body.appendChild(input);
      input.focus();
      input.parentNode.removeChild(input);
    };

    // --- CodeMirror config

    const options = {
      value: text.cleanText(initialCode, "html"),
      mode: mode,
      extraKeys: keymap,
      gutters: ["cm-errors"],
      // lineNumbers: true,
      lineWrapping: false,
      matchBrackets: true,
      autoCloseBrackets: true,
      styleActiveLine: true,
      theme: "moondoge"
    };

    // --- activate

    this.activate = () => {
      slide.classList.add("editor");
      target.innerHTML = "";

      this.editorFrame = document.createElement("div");
      this.editorFrame.classList.add("editorFrame");
      target.appendChild(this.editorFrame);

      if (href) {
        slide.classList.add("withTargetFrame");
        this.targetContainer = document.createElement("div");
        this.targetContainer.classList.add("targetFrame");

        this.targetFrame = document.createElement("iframe");

        this.loaderFrame = document.createElement("div");
        this.loaderFrame.classList.add("loaderFrame");
        this.targetContainer.appendChild(this.loaderFrame);
        target.appendChild(this.targetContainer);

        const factor = Math.min(this.loaderFrame.clientWidth,
                                this.loaderFrame.clientHeight) / 13.25;
        this.spinner = new Spinner({
          color: "white",
          shadow: true,
          hwaccel: true,
          length: factor * 1.5,
          radius: factor * 3.4,
          width: factor,
          trail: 40,
          lines: 12
        }).spin(this.loaderFrame);
      }

      this.language = new languageModule();

      this.cm = CodeMirror(this.editorFrame, options);
      this.cm.setSize("100%", "100%");

      if (args.warmup !== undefined) {
        this.compile(() => {});
      }
    }

    // --- stabilise

    this.stabilise = () => {
      if (href) {
        this.targetFrame.style.display = "none";
        this.targetFrame.src = href;
        this.targetContainer.appendChild(this.targetFrame);
        events.until(this.targetFrame.contentWindow, "message", function(e) {
          if (e.data === "rdy lol") {
            this.spin(false);
            return true;
          }
        }, this);
      }
      this.cm.refresh();
      this.cleanupHandler = events.on(window, "beforeunload", this.onTabClose, this);
    }

    this.spin = (enable) => {
      if (!!this.loaderFrame) {
        if (enable) {
          this.loaderFrame.style.display = "";
          this.targetFrame.style.display = "none";
          this.spinner.spin(this.loaderFrame);
        } else {
          this.spinner.stop();
          this.loaderFrame.style.display = "none";
          this.targetFrame.style.display = "";
        }
      }
    };

    // --- cleanup

    this.cleanup = () => {
      if (this.cleanupHandler) {
        events.off(window, "onunload", this.cleanupHandler);
        this.cleanupHandler = null;
      }
      this.cm = null;
      this.language.cleanup();
      this.language = null;
      target.innerHTML = initialCode;
      target.classList.remove("editor");
    }
  }

  return Editor;
}

module.exports = factory;
