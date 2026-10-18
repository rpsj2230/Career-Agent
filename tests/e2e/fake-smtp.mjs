// A tiny SMTP server for tests: accepts any login, keeps every message it receives (raw MIME) so tests can inspect it.
import net from "node:net";

export function startFakeSmtp() {
  const messages = [];
  const server = net.createServer((sock) => {
    let buf = "", inData = false, data = "", mail = { from: "", to: [] }, authStep = 0;
    const w = (s) => sock.write(`${s}\r\n`);
    w("220 fake-smtp ready");
    sock.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) { data += buf; buf = ""; return; }
          data += buf.slice(0, end); buf = buf.slice(end + 5); inData = false;
          messages.push({ from: mail.from, to: mail.to, raw: data }); data = ""; w("250 queued"); continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
        const up = line.toUpperCase();
        if (authStep === 1) { authStep = 2; w("334 UGFzc3dvcmQ6"); continue; }
        if (authStep === 2) { authStep = 0; w("235 ok"); continue; }
        if (up.startsWith("EHLO") || up.startsWith("HELO")) { sock.write("250-fake-smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n"); }
        else if (up.startsWith("AUTH PLAIN")) w("235 ok");
        else if (up.startsWith("AUTH LOGIN")) { authStep = 1; w("334 VXNlcm5hbWU6"); }
        else if (up.startsWith("MAIL FROM")) { mail = { from: line.slice(10), to: [] }; w("250 ok"); }
        else if (up.startsWith("RCPT TO")) { mail.to.push(line.slice(8).replace(/[<>]/g, "").trim()); w("250 ok"); }
        else if (up === "DATA") { inData = true; w("354 go"); }
        else if (up === "QUIT") { w("221 bye"); sock.end(); }
        else w("250 ok");
      }
    });
    sock.on("error", () => undefined);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, messages, close: () => server.close() })));
}
