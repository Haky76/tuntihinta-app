
import React from 'react';
import { COMPANY, COPYRIGHT_YEAR } from '../config';

export default function Footer() {
  return (
    <footer className="mt-8 py-6 text-sm text-zinc-600 border-t">
      <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-2">
        <div>© {COPYRIGHT_YEAR} {COMPANY}. Kaikki oikeudet pidätetään.</div>
        <nav className="flex items-center gap-4">
          <a className="hover:underline" href="mailto:hannu.kyntaja@netikka.fi">Ota yhteyttä</a>
          <a className="hover:underline" href="/terms.html" target="_blank" rel="noreferrer">Käyttöehdot</a>
          <a className="hover:underline" href="/privacy.html" target="_blank" rel="noreferrer">Tietosuojaseloste</a>
        </nav>
      </div>
    </footer>
  );
}
