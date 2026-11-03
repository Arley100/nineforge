import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { Report } from "./check";
import pkg from "../package.json";

/** Signed evidence that a report came from these exact inputs and this engine version. */
export type Attestation = {
  type: "nineforge-attestation/v1";
  engine: string;
  createdAt: string;
  inputs: Record<string, string>;
  report: Report;
  publicKey?: string;
  signature?: string;
};

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Deterministic JSON (sorted keys) so signatures do not depend on key order. */
export const canonical = (v: unknown): string =>
  Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]"
  : v && typeof v === "object" ? "{" + Object.keys(v).sort().filter((k) => (v as any)[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonical((v as any)[k])).join(",") + "}"
  : JSON.stringify(v);

const body = ({ publicKey, signature, ...rest }: Attestation) => Buffer.from(canonical(rest));

/** Hashes every provided input; signs with an Ed25519 private key (PEM) when given. */
export function attest(report: Report, inputs: Record<string, string | null | undefined>, privateKeyPem?: string): Attestation {
  const hashes = Object.fromEntries(Object.entries(inputs).filter(([, t]) => t != null).map(([k, t]) => [k, sha256(t!)]));
  const att: Attestation = { type: "nineforge-attestation/v1", engine: "nineforge@" + pkg.version, createdAt: new Date().toISOString(), inputs: hashes, report };
  if (!privateKeyPem) return att;
  const key = createPrivateKey(privateKeyPem);
  return { ...att, publicKey: createPublicKey(key).export({ type: "spki", format: "pem" }).toString(), signature: sign(null, body(att), key).toString("base64") };
}

/**
 * Checks the signature (against a pinned public key when given, else the embedded one) and,
 * for every input supplied, that its hash matches. `pinned: false` means integrity only, not identity.
 */
export function verifyAttestation(att: Attestation, inputs: Record<string, string> = {}, trustedPublicKeyPem?: string) {
  const problems: string[] = [];
  const keyPem = trustedPublicKeyPem ?? att.publicKey;
  if (!att.signature || !keyPem) problems.push("attestation is not signed");
  else {
    try { if (!verify(null, body(att), createPublicKey(keyPem), Buffer.from(att.signature, "base64"))) problems.push("signature does not match (report or inputs were altered, or a different key signed it)"); }
    catch (e) { problems.push("cannot verify signature: " + (e instanceof Error ? e.message : String(e))); }
  }
  for (const [name, text] of Object.entries(inputs)) {
    if (!att.inputs[name]) problems.push(name + " was not part of the attestation");
    else if (att.inputs[name] !== sha256(text)) problems.push(name + " does not match the attested hash");
  }
  return { ok: problems.length === 0, pinned: !!trustedPublicKeyPem, problems };
}

export function generateKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKey: publicKey.export({ type: "spki", format: "pem" }).toString() };
}
