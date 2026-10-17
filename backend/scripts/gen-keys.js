// Membuat kunci rahasia untuk server. Jalankan:  npm run keys
// Hasilnya disalin ke Environment Variables di Render (lihat panduan). JANGAN dibagikan ke orang lain.
import crypto from 'node:crypto';
import webpush from 'web-push';

const vapid = webpush.generateVAPIDKeys();
console.log('');
console.log('Salin tiga baris ini ke Environment Variables di Render:');
console.log('------------------------------------------------------------');
console.log(`JWT_SECRET=${crypto.randomBytes(48).toString('hex')}`);
console.log(`VAPID_PUBLIC_KEY=${vapid.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapid.privateKey}`);
console.log('------------------------------------------------------------');
console.log('Catatan: kalau kunci VAPID diganti, semua HP harus mengaktifkan notifikasi lagi.');
console.log('');
