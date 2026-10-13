/** Keyboard shortcuts shown in Settings → Pintasan (03 §3, §5.5). Handlers live where they act. */

export interface ShortcutInfo {
  readonly keys: string;
  readonly label: string;
}

export interface ShortcutGroup {
  readonly title: string;
  readonly items: ReadonlyArray<ShortcutInfo>;
}

export const SHORTCUT_GROUPS: ReadonlyArray<ShortcutGroup> = [
  {
    title: "Umum",
    items: [
      { keys: "Ctrl+K", label: "Cari perintah" },
      { keys: "Ctrl+S", label: "Simpan proyek" },
      { keys: "Ctrl+Z", label: "Urungkan" },
      { keys: "Ctrl+Y", label: "Ulangi (juga Ctrl+Shift+Z)" },
      { keys: "Ctrl+E", label: "Ekspor video" },
      { keys: "Ctrl+I", label: "Impor media" },
      { keys: "Ctrl+O", label: "Buka proyek" },
      { keys: "Ctrl+,", label: "Pengaturan" },
      { keys: "Ctrl+Shift+L", label: "Ganti tema" },
    ],
  },
  {
    title: "Pemutaran",
    items: [
      { keys: "Spasi", label: "Putar / jeda" },
      { keys: "J / K / L", label: "Mundur 1 dtk / jeda / putar" },
      { keys: "← / →", label: "Mundur / maju 1 frame (Shift: 10 frame)" },
      { keys: "Home / End", label: "Ke awal / akhir" },
    ],
  },
  {
    title: "Edit",
    items: [
      { keys: "C", label: "Potong scene di playhead" },
      { keys: "Delete", label: "Hapus yang dipilih (bisa diurungkan)" },
      { keys: "Esc", label: "Batal pilih / kembali ke alat Pilih" },
      { keys: "V / Z / B / N", label: "Alat Pilih / Zoom / Blur / Badge" },
      { keys: "Ctrl+Enter", label: "Sintesis suara scene (di kolom narasi)" },
      { keys: "Ctrl+scroll", label: "Zoom timeline" },
    ],
  },
];
