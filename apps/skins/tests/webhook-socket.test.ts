import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo, LookupFunction } from "node:net";
import { publicRequest } from "@collectcollect/core/public-request";
import { publicWebhookLookup, requestPublicWebhook } from "@collectcollect/core/webhook";

const servers: http.Server[] = [];
afterEach(() => { for (const server of servers.splice(0)) { server.closeAllConnections(); server.close(); } });
async function serve(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}
const loopback: LookupFunction = (_host, options, callback) => {
  if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
  else callback(null, "127.0.0.1", 4);
};

describe("the actual webhook socket", () => {
  it("refuses private socket DNS even if an earlier answer was public", async () => {
    let hits = 0;
    const port = await serve((_req, res) => { hits++; res.end("internal"); });
    let answers = 0;
    const resolver = async () => [{ address: ++answers === 1 ? "93.184.216.34" : "127.0.0.1" }];
    // A prior validation cannot authorize a different answer used by the actual connection.
    await resolver();
    await expect(requestPublicWebhook(`http://rebinding.invalid:${port}/admin`, { method: "POST" }, resolver)).rejects.toThrow(/not on the public internet/);
    expect(hits).toBe(0);
    expect(answers).toBe(2);
  });

  it("checks all answers, including expanded IPv6 loopback, before returning any address", async () => {
    for (const address of ["10.0.0.1", "169.254.169.254", "0:0:0:0:0:0:0:1", "not-an-ip"]) {
      const lookup = publicWebhookLookup(async () => [{ address: "93.184.216.34" }, { address }]);
      await expect(new Promise((resolve, reject) => lookup("host.invalid", { all: true }, (err, value) => err ? reject(err) : resolve(value)))).rejects.toThrow(/not on the public internet/);
    }
  });

  it("uses the supplied socket address while keeping the original HTTP Host", async () => {
    let host: string | undefined;
    const port = await serve((req, res) => { host = req.headers.host; res.end("ok"); });
    const response = await publicRequest(`http://does-not-resolve.invalid:${port}/`, {}, loopback);
    expect(await response.text()).toBe("ok");
    expect(host).toBe(`does-not-resolve.invalid:${port}`);
  });

  it("refuses redirects and closes the response without visiting an internal target", async () => {
    let hits = 0;
    const internal = await serve((_req, res) => { hits++; res.end("internal"); });
    const port = await serve((_req, res) => { res.writeHead(307, { location: `http://127.0.0.1:${internal}/admin` }); res.end(); });
    await expect(publicRequest(`http://hook.invalid:${port}/`, { redirect: "error" }, loopback)).rejects.toThrow(/redirects are not allowed/);
    expect(hits).toBe(0);
  });
});
