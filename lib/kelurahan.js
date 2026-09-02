/**
 * Kelurahan per kecamatan + lookup API wilayah Indonesia
 */
const KELURAHAN_BY_KECAMATAN = {
  'kebayoran baru': ['Cipete Utara', 'Cipete Selatan', 'Gandaria Utara', 'Gandaria Selatan', 'Pulo', 'Melawai', 'Petogogan', 'Rawa Barat', 'Senayan', 'Gunung'],
  'kebayoran lama': ['Kebayoran Lama Utara', 'Kebayoran Lama Selatan', 'Pondok Pinang', 'Cipulir', 'Grogol Utara', 'Grogol Selatan'],
  'cilandak': ['Cilandak Barat', 'Gandaria Selatan', 'Cipete Selatan', 'Pondok Labu', 'Lebak Bulus'],
  'pasar minggu': ['Pejaten Barat', 'Pejaten Timur', 'Jati Padang', 'Ragunan', 'Pasar Minggu', 'Kebagusan', 'Cilandak Timur'],
  'tebet': ['Tebet Barat', 'Tebet Timur', 'Menteng Dalam', 'Bukit Duri', 'Kebon Baru', 'Manggarai', 'Manggarai Selatan'],
  'gambir': ['Gambir', 'Cideng', 'Petojo Utara', 'Petojo Selatan', 'Duri Pulo'],
  'menteng': ['Menteng', 'Pegangsaan', 'Cikini', 'Gondangdia', 'Kebon Sirih'],
  'tanah abang': ['Gelora', 'Bendungan Hilir', 'Karet Tengsin', 'Petamburan', 'Kebon Melati', 'Kebon Kacang', 'Kampung Bali'],
  'kelapa gading': ['Kelapa Gading Barat', 'Kelapa Gading Timur', 'Pegangsaan Dua'],
  'tanjung priok': ['Tanjung Priok', 'Kebon Bawang', 'Sungai Bambu', 'Papanggo', 'Warakas', 'Sunter Agung', 'Sunter Jaya'],
  'coblong': ['Dago', 'Sekeloa', 'Lebakgede', 'Lebaksiliwangi', 'Sadangserang', 'Cipaganti'],
  'bandung wetan': ['Cihapit', 'Citarum', 'Tamansari'],
  'sukajadi': ['Sukajadi', 'Sukawarna', 'Pasteur', 'Cipedes', 'Sukagalih'],
  'genteng': ['Embong Kaliasin', 'Ketabang', 'Peneleh', 'Genteng', 'Kapasari'],
  'tegalsari': ['Kedungdoro', 'Keputran', 'Tegalsari', 'Dr. Soetomo', 'Wonorejo'],
  'gubeng': ['Airlangga', 'Baratajaya', 'Gubeng', 'Kertajaya', 'Mojo', 'Pucangsewu'],
  'semarang tengah': ['Sekayu', 'Pekunden', 'Kranggan', 'Miroto', 'Gabahan', 'Kembangsari', 'Pandansari', 'Bangunharjo'],
  'candisari': ['Candi', 'Jatingaleh', 'Kaliwiru', 'Jomblang', 'Wonotingal', 'Tegalsari'],
  'bekasi barat': ['Bintara', 'Bintara Jaya', 'Jakasampurna', 'Kranji', 'Kota Baru'],
  'bekasi timur': ['Aren Jaya', 'Bekasi Jaya', 'Duren Jaya', 'Margahayu'],
  'beji': ['Beji', 'Beji Timur', 'Kemiri Muka', 'Kukusan', 'Pondok Cina', 'Tanah Baru'],
  'sukmajaya': ['Abadijaya', 'Bakti Jaya', 'Cisalak', 'Mekar Jaya', 'Sukmajaya', 'Tirtajaya'],
  'cimanggis': ['Cisalak Pasar', 'Curug', 'Harjamukti', 'Mekarsari', 'Pasir Gunung Selatan', 'Tugu'],
  'serpong': ['Buaran', 'Ciater', 'Lengkong Gudang', 'Lengkong Gudang Timur', 'Lengkong Karya', 'Rawa Buntu', 'Serpong'],
  'pondok aren': ['Jurang Mangu Barat', 'Jurang Mangu Timur', 'Pondok Aren', 'Pondok Betung', 'Pondok Jaya', 'Pondok Karya', 'Pondok Kacang Barat', 'Pondok Kacang Timur'],
  'ciputat': ['Cipayung', 'Ciputat', 'Rawa Buntu', 'Sawah Baru', 'Sawah Lama', 'Serua'],
  'pamulang': ['Bambu Apus', 'Benda Baru', 'Kedaung', 'Pamulang Barat', 'Pamulang Timur', 'Pondok Benda'],
};

function normalizeKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^kec\.?\s*/i, '')
    .replace(/^kecamatan\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function listKelurahanLocal(kecamatan) {
  const key = normalizeKey(kecamatan);
  if (!key) return [];
  if (KELURAHAN_BY_KECAMATAN[key]) return [...KELURAHAN_BY_KECAMATAN[key]];
  for (const [k, list] of Object.entries(KELURAHAN_BY_KECAMATAN)) {
    if (key.includes(k) || k.includes(key)) return [...list];
  }
  return [];
}

async function listKelurahanFromWilayahAPI(kecamatan) {
  const key = normalizeKey(kecamatan);
  if (!key) return [];
  try {
    // Open data: cari district lalu villages — gunakan static mirror github
    const districtsUrl = 'https://emsifa.github.io/api-wilayah-indonesia/api/districts.json';
    const res = await fetch(districtsUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'bdPay-PWA/1.0' },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return [];
    const districts = await res.json();
    if (!Array.isArray(districts)) return [];
    const match = districts.find(d => {
      const n = normalizeKey(d.name);
      return n === key || n.includes(key) || key.includes(n);
    });
    if (!match) return [];
    const vRes = await fetch(`https://emsifa.github.io/api-wilayah-indonesia/api/villages/${match.id}.json`, {
      headers: { Accept: 'application/json', 'User-Agent': 'bdPay-PWA/1.0' },
      signal: AbortSignal.timeout(12000)
    });
    if (!vRes.ok) return [];
    const villages = await vRes.json();
    if (!Array.isArray(villages)) return [];
    return villages.map(v => v.name).filter(Boolean);
  } catch (e) {
    console.warn('[kelurahan] API wilayah fail:', e.message);
    return [];
  }
}

async function listKelurahan(kecamatan) {
  const local = listKelurahanLocal(kecamatan);
  if (local.length >= 4) return local;
  const remote = await listKelurahanFromWilayahAPI(kecamatan);
  if (remote.length) return remote;
  if (local.length) return local;
  const k = kecamatan || 'Area';
  return [`${k} Pusat`, `${k} Timur`, `${k} Barat`, 'Kelurahan Lainnya'];
}

module.exports = { listKelurahan, listKelurahanLocal, KELURAHAN_BY_KECAMATAN, normalizeKey };
