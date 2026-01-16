// Lightweight NoteMD logger helper
// Provides consistent formatting for log messages and helper wrappers
(function(global){
  const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
  function ts() { return new Date().toLocaleTimeString(); }

  function format(level, msg, raw, meta) {
    let out = `[${ts()}] [${(level||'info').toUpperCase()}] ${msg}`;
    if (meta) {
      try { out += ` | ${JSON.stringify(meta)}`; } catch(e) { out += ' | [meta]'; }
    }
    if (raw) {
      try { out += `\nRAW: ${JSON.stringify(raw, null, 2)}`; } catch(e) { out += '\nRAW: [unserializable]'; }
    }
    return out;
  }

  function noop(){}

  const NoteLogger = {
    LEVELS,
    format,
    debug: (msg, raw, meta) => { try { console.debug(format('debug', msg, raw, meta)); } catch(e){} },
    info:  (msg, raw, meta) => { try { console.info(format('info', msg, raw, meta)); } catch(e){} },
    warn:  (msg, raw, meta) => { try { console.warn(format('warn', msg, raw, meta)); } catch(e){} },
    error: (msg, raw, meta) => { try { console.error(format('error', msg, raw, meta)); } catch(e){} },
  };

  global.NoteLogger = NoteLogger;
})(window);
