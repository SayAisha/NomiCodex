// Tiny local server wrapping api/search.js so the tag harness can hit it
import http from "node:http";
import handler from "./api/search.js";

http.createServer((req, res) => {
    if (!req.url.startsWith("/api/search")) { res.writeHead(404); return res.end("no"); }
    handler(req, res);
}).listen(8799, () => console.log("local search on :8799"));
