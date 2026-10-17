// A small IMAP4rev1 server (plain TCP, one mailbox) so the real imapflow client code path can be exercised in tests.
// It implements just what a read-only alert fetch needs: CAPABILITY, ID, LOGIN, NAMESPACE, LIST, SELECT/EXAMINE, UID SEARCH, UID FETCH, NOOP, CLOSE, LOGOUT.
import net from "node:net";

/** @param {{ user?: string, password?: string, folders?: Record<string, any[]>, port?: number }} [opts] */
export function startFakeImap({ user = "me@example.com", password = "app-pass", folders = /** @type {Record<string, any[]>} */ ({ INBOX: [] }), port = 0 } = {}) {
  const log = [];
  const state = { logins: 0, failedLogins: 0, searches: [], fetched: [], selected: [], mutations: [] };
  const server = net.createServer((sock) => {
    let selected = null, buf = "", pendingAuth = null;
    const send = (s) => sock.write(s + "\r\n");
    send("* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] fake imap ready");
    const quoted = (s) => (s.startsWith('"') ? s.slice(1, -1) : s);
    const mailsOf = () => folders[selected] ?? [];
    const rfc822 = (m) => Buffer.from(
      `From: ${m.from}\r\nTo: ${user}\r\nSubject: ${m.subject}\r\nDate: ${m.date.toUTCString()}\r\nMessage-ID: <${m.uid}@fake>\r\n${Object.entries(m.headers ?? {}).map(([k, v]) => `${k}: ${v}\r\n`).join("")}MIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${m.html}`, "utf8");
    function handle(line) {
      if (pendingAuth) {
        const tag = pendingAuth; pendingAuth = null; log.push(`${tag} <auth response>`);
        const d = Buffer.from(line, "base64").toString().split("\0");
        if (d[1] === user && d[2] === password) { state.logins++; return send(`${tag} OK logged in`); }
        state.failedLogins++; return send(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
      }
      log.push(line);
      const m = line.match(/^(\S+)\s+(.*)$/s); if (!m) return;
      const [, tag, rest] = m; const cmd = rest.split(" ")[0].toUpperCase();
      switch (cmd) {
        case "CAPABILITY": send("* CAPABILITY IMAP4rev1 AUTH=PLAIN"); return send(`${tag} OK done`);
        case "ID": send('* ID ("name" "fake")'); return send(`${tag} OK done`);
        case "NOOP": return send(`${tag} OK done`);
        case "LOGIN": {
          const parts = rest.match(/LOGIN\s+("(?:[^"\\]|\\.)*"|\S+)\s+("(?:[^"\\]|\\.)*"|\S+)/i);
          if (parts && quoted(parts[1]) === user && quoted(parts[2]) === password) { state.logins++; return send(`${tag} OK [CAPABILITY IMAP4rev1] logged in`); }
          state.failedLogins++; return send(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
        }
        case "AUTHENTICATE": {
          const ir = rest.split(/\s+/)[2];
          if (!ir) { pendingAuth = tag; return send("+ "); }
          const decoded = ir ? Buffer.from(ir, "base64").toString().split("\0") : [];
          if (decoded[1] === user && decoded[2] === password) { state.logins++; return send(`${tag} OK logged in`); }
          state.failedLogins++; return send(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
        }
        case "NAMESPACE": send('* NAMESPACE (("" "/")) NIL NIL'); return send(`${tag} OK done`);
        case "LIST": case "LSUB": {
          // LIST "" "" asks only for the hierarchy delimiter
          if (/^(LIST|LSUB)\s+""\s+""\s*$/i.test(rest)) { send('* LIST (\\Noselect) "/" ""'); return send(`${tag} OK done`); }
          const verb = cmd;
          for (const f of Object.keys(folders)) send(`* ${verb} (\\HasNoChildren) "/" "${f}"`);
          return send(`${tag} OK done`);
        }
        case "STATUS": return send(`${tag} OK done`);
        case "ENABLE": return send(`${tag} OK done`);
        case "SELECT": case "EXAMINE": {
          const name = quoted(rest.split(" ").slice(1).join(" ").trim());
          if (!folders[name]) return send(`${tag} NO [NONEXISTENT] Mailbox doesn't exist: ${name}`);
          selected = name; state.selected.push({ name, readOnly: cmd === "EXAMINE" });
          send(`* ${folders[name].length} EXISTS`); send("* 0 RECENT"); send("* OK [UIDVALIDITY 1] ok"); send(`* OK [UIDNEXT ${folders[name].length + 1}] ok`);
          send("* FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)");
          return send(`${tag} OK [${cmd === "EXAMINE" ? "READ-ONLY" : "READ-WRITE"}] done`);
        }
        case "UID": {
          const sub = rest.split(" ")[1].toUpperCase();
          if (sub === "SEARCH") {
            state.searches.push(rest);
            // honour FROM filters when present: any message whose sender contains one of the requested domains
            const froms = [...rest.matchAll(/FROM\s+"?([^"\s)]+)"?/gi)].map((x) => x[1].toLowerCase());
            const uids = mailsOf().filter((x) => !froms.length || froms.some((f) => x.from.toLowerCase().includes(f))).map((x) => x.uid);
            send(`* SEARCH ${uids.join(" ")}`.trim()); return send(`${tag} OK done`);
          }
          if (sub === "FETCH") {
            const set = rest.split(" ")[2];
            const want = new Set(set.split(",").flatMap((r) => { const [a, b] = r.split(":").map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; }));
            for (const [i, mail] of mailsOf().entries()) {
              if (!want.has(mail.uid)) continue;
              state.fetched.push(mail.uid);
              const body = rfc822(mail);
              send(`* ${i + 1} FETCH (UID ${mail.uid} INTERNALDATE "${mail.date.toUTCString().slice(5, 25).replace(/ /g, "-").replace(/-(\d{4})-/, "-$1 ")} +0000" ENVELOPE ("${mail.date.toUTCString()}" "${mail.subject}" (("" NIL "${mail.from.split("@")[0]}" "${mail.from.split("@")[1]}")) NIL NIL NIL NIL NIL NIL NIL) BODY[] {${body.length}}`);
              sock.write(body); send(")");
            }
            return send(`${tag} OK done`);
          }
          if (/STORE|COPY|MOVE|EXPUNGE/i.test(sub)) { state.mutations.push(rest); return send(`${tag} NO read-only`); }
          return send(`${tag} BAD unsupported`);
        }
        case "STORE": case "EXPUNGE": case "COPY": case "APPEND": state.mutations.push(rest); return send(`${tag} NO read-only`);
        case "CLOSE": case "UNSELECT": selected = null; return send(`${tag} OK done`);
        case "LOGOUT": send("* BYE bye"); send(`${tag} OK done`); return sock.end();
        default: return send(`${tag} BAD unknown command ${cmd}`);
      }
    }
    sock.on("data", (d) => { buf += d.toString("utf8"); let i; while ((i = buf.indexOf("\r\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); if (line) handle(line); } });
    sock.on("error", () => undefined);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port, log, state, close: () => new Promise((r) => server.close(r)) })));
}
