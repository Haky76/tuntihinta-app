
import React, { useEffect, useState } from 'react';
import { REQUIRE_ACCESS, PAYMENT_LINK_URL, grantAccess, hasAccess, currentAccessKey } from '../config';

async function verifyRemote(key: string): Promise<boolean> {
  try {
    const r = await fetch("/api/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    const j = await r.json();
    return j.ok === true;
  } catch { return false; }
}

export default function AccessGate({ children }: { children: React.ReactNode }) {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!REQUIRE_ACCESS) { setLoading(false); return; }

    const url = new URL(window.location.href);
    const t = url.searchParams.get("token");
    (async () => {
      if (t) {
        const r = await fetch(`/api/exchange?token=${encodeURIComponent(t)}`);
        const j = await r.json();
        if (j.ok && j.license) {
          grantAccess(j.license);
          url.searchParams.delete("token");
          history.replaceState({}, "", url.toString());
        } else {
          setError("Token ei kelpaa tai on jo käytetty.");
        }
      }
      const saved = currentAccessKey();
      if (saved) {
        const ok = await verifyRemote(saved);
        if (!ok) setError("Lisenssi ei ole voimassa. Syötä uusi avain.");
        setLoading(false);
        return;
      }
      setLoading(false);
    })();
  }, []);

  if (!REQUIRE_ACCESS) return <>{children}</>;
  if (loading) return <div className="min-h-screen grid place-items-center">Avataan…</div>;

  if (hasAccess()) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow p-6 space-y-4">
        <h1 className="text-xl font-semibold">Pääsy vaaditaan</h1>
        <p className="text-sm text-zinc-600">
          Tämä on maksullinen sovellus. Syötä lisenssi-/tilausavain tai osta käyttöoikeus.
        </p>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="space-y-2">
          <label className="text-sm">Lisenssi-/tilausavain</label>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Liitä avain tähän"
            className="w-full border rounded-xl px-3 py-2"
          />
          <button
            onClick={async () => {
              if (!key) return;
              const ok = await verifyRemote(key);
              if (ok) { grantAccess(key); location.reload(); }
              else alert("Virheellinen tai inaktiivinen avain");
            }}
            className="w-full rounded-2xl bg-black text-white py-2"
          >
            Avaa sovellus
          </button>
        </div>

        <div className="pt-2">
          <button
            onClick={() => window.open(PAYMENT_LINK_URL || "#", "_blank")}
            className="w-full rounded-2xl border py-2 hover:bg-zinc-50 disabled:opacity-50"
            disabled={!PAYMENT_LINK_URL}
            title={PAYMENT_LINK_URL ? "" : "Aseta VITE_PAYMENT_LINK_URL .env-tiedostoon (valinnainen)"}
          >
            Osta käyttöoikeus
          </button>
        </div>
      </div>
    </div>
  );
}
