import { URL } from "node:url";
import axios from "axios";
import { lookup } from "node:dns/promises";
import { Agent } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["192.0.0.0", 24], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
export function publicImageAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4") : family === 6 && globalV6.check(address, "ipv6") && !address.toLowerCase().startsWith("2002:") && !address.toLowerCase().startsWith("2001:db8:");
}
export function validatePublicImageUrl(raw: string): URL {
  const url = new URL(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".internal") || (isIP(hostname) && !publicImageAddress(hostname))) throw new Error("Image URL must use public HTTPS");
  return url;
}
const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true }).then((addresses) => {
    if (!addresses.length || addresses.some((item) => !publicImageAddress(item.address))) return callback(new Error("Image host resolved to a private address"), "", 4);
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  }).catch((error) => callback(error, "", 4));
};
export const publicHttpsAgent = new Agent({ lookup: publicLookup });
/** Enforce the byte cap during transfer and revalidate each redirect and DNS resolution. */
export async function downloadPublicImage(raw: string, timeout: number) {
  const url = validatePublicImageUrl(raw);
  return axios.get(url.href, {
    responseType: "arraybuffer", timeout, maxContentLength: 5 * 1024 * 1024,
    maxBodyLength: 5 * 1024 * 1024, maxRedirects: 3, httpsAgent: publicHttpsAgent, proxy: false,
    beforeRedirect: (options) => { validatePublicImageUrl(`${options.protocol}//${options.hostname}${options.port ? `:${options.port}` : ""}${options.path || "/"}`); },
  });
}
