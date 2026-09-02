/**
 * Reverse geocoding → Kecamatan, Kota/Kabupaten, Kode Pos
 */
const DEMO_AREAS = [
  { lat: -6.2615, lng: 106.8106, kelurahan: 'Cipete Utara', kecamatan: 'Kebayoran Baru', kota: 'Jakarta Selatan', kode_pos: '12150' },
  { lat: -6.2088, lng: 106.8456, kelurahan: 'Gambir', kecamatan: 'Gambir', kota: 'Jakarta Pusat', kode_pos: '10110' },
  { lat: -6.1751, lng: 106.8650, kelurahan: 'Kelapa Gading Barat', kecamatan: 'Kelapa Gading', kota: 'Jakarta Utara', kode_pos: '14240' },
  { lat: -6.9175, lng: 107.6191, kelurahan: 'Dago', kecamatan: 'Coblong', kota: 'Bandung', kode_pos: '40135' },
  { lat: -7.2575, lng: 112.7521, kelurahan: 'Embong Kaliasin', kecamatan: 'Genteng', kota: 'Surabaya', kode_pos: '60271' },
  { lat: -6.9667, lng: 110.4167, kelurahan: 'Sekayu', kecamatan: 'Semarang Tengah', kota: 'Semarang', kode_pos: '50132' },
  { lat: -6.2383, lng: 106.9756, kelurahan: 'Kranji', kecamatan: 'Bekasi Barat', kota: 'Bekasi', kode_pos: '17133' },
  { lat: -6.4025, lng: 106.7942, kelurahan: 'Beji', kecamatan: 'Beji', kota: 'Depok', kode_pos: '16421' },
  { lat: -6.3025, lng: 106.6520, kelurahan: 'Serpong', kecamatan: 'Serpong', kota: 'Tangerang Selatan', kode_pos: '15310' }
];

function nearestDemo(lat, lng) {
  let best = DEMO_AREAS[0];
  let bestD = Infinity;
  for (const a of DEMO_AREAS) {
    const d = (a.lat - lat) ** 2 + (a.lng - lng) ** 2;
    if (d < bestD) { bestD = d; best = a; }
  }
  return { ...best, source: 'demo_nearest' };
}

async function reverseGeocode(lat, lng) {
  lat = Number(lat);
  lng = Number(lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return { ok: false, message: 'Koordinat tidak valid. Izinkan akses lokasi di browser.' };
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, message: 'Koordinat di luar jangkauan.' };
  }

  // 1) Nominatim
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&zoom=18&accept-language=id`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'bdPay-PWA/1.0 (domestic-transfer-ppob)',
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) {
      const data = await res.json();
      const a = data.address || {};
      const kecamatan = a.city_district || a.municipality || a.county || a.suburb || a.district || a.town || '';
      const kota = a.city || a.town || a.municipality || a.county || a.state || '';
      const kode_pos = a.postcode || '';
      const kelurahan = a.village || a.suburb || a.neighbourhood || a.hamlet || a.quarter || '';
      if (kecamatan || kota || kode_pos) {
        return {
          ok: true,
          lat,
          lng,
          kelurahan,
          kecamatan: kecamatan || kota,
          kota: kota || kecamatan,
          kode_pos: kode_pos || '',
          display_name: data.display_name || '',
          source: 'nominatim'
        };
      }
    }
  } catch (e) {
    console.warn('[geo] nominatim:', e.message);
  }

  // 2) Fallback demo nearest (selalu mengembalikan data agar GPS "bisa dipakai")
  const demo = nearestDemo(lat, lng);
  return {
    ok: true,
    lat,
    lng,
    kelurahan: demo.kelurahan,
    kecamatan: demo.kecamatan,
    kota: demo.kota,
    kode_pos: demo.kode_pos,
    display_name: `${demo.kelurahan}, ${demo.kecamatan}, ${demo.kota} ${demo.kode_pos}`,
    source: demo.source,
    note: 'Lokasi GPS diterima; detail alamat dari data referensi terdekat (Nominatim tidak tersedia).'
  };
}

module.exports = { reverseGeocode };
