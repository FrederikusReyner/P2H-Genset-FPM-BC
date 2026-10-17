// Pasang tema (terang/gelap) sebelum halaman tampil supaya tidak berkedip.
// Pilihan pengguna disimpan di 'p2h.theme': 'light' | 'dark' | (kosong = ikut pengaturan HP/komputer).
try {
  var pref = localStorage.getItem('p2h.theme');
  var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
} catch (e) {
  document.documentElement.setAttribute('data-theme', 'light');
}
